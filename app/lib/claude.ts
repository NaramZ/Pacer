import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod/v4";
import { database } from "./automation-auth";
import { getApiKey } from "./profile";

// Job seekers pay for their own API usage, so every call uses the cheapest model that can do the job well.
// Haiku 4.5 reads jobs and pulls salary figures from search results. Sonnet 5.5 (same price as Sonnet 5, newer)
// writes and fact-checks the documents, fills in applications (the cheapest model with the browser toolset)
// and finds people.
export const WRITING_MODEL = "claude-haiku-4-5";
export const AGENT_MODEL = "claude-sonnet-5-5";

// US dollars per million tokens. Cache reads cost 10% of input; 5-minute cache writes cost 125%.
// Web search is billed on top: $10 per 1,000 searches.
const PRICES: Record<string, { input: number; output: number }> = {
  [WRITING_MODEL]: { input: 1, output: 5 },
  [AGENT_MODEL]: { input: 2, output: 10 },
  "claude-sonnet-5": { input: 2, output: 10 },
};
const PER_SEARCH = 0.01;

export type Feature = "analysis" | "documents" | "salary" | "people" | "apply" | "networking";
export const FEATURE_LABEL: Record<Feature, string> = {
  analysis: "Reading jobs",
  documents: "Writing documents",
  salary: "Salary research",
  people: "Finding people",
  apply: "Filling in applications",
  networking: "Finding events",
};

type Usage = {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  server_tool_use?: { web_search_requests?: number | null } | null;
};

export class BudgetReachedError extends Error {
  constructor(limit: number) {
    super(`You’ve reached your monthly AI limit of $${limit.toFixed(2)}. Raise it in Profile, or it resets on the 1st.`);
  }
}

function monthStart() {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
}

export async function monthlySpend(userId: string) {
  const [budget, rows] = await Promise.all([
    database().prepare("SELECT monthly_budget_usd FROM profiles WHERE user_id=?").bind(userId).first<{ monthly_budget_usd: number }>(),
    database()
      .prepare("SELECT feature, SUM(cost_usd) AS cost, COUNT(*) AS calls FROM ai_usage WHERE user_id=? AND created_at>=? GROUP BY feature")
      .bind(userId, monthStart())
      .all<{ feature: Feature; cost: number; calls: number }>(),
  ]);
  const byFeature = (rows.results || []).map((r) => ({ feature: r.feature, label: FEATURE_LABEL[r.feature] || r.feature, cost: r.cost, calls: r.calls }));
  return { spent: byFeature.reduce((s, r) => s + r.cost, 0), budget: budget?.monthly_budget_usd ?? 5, byFeature };
}

async function record(userId: string, feature: Feature, model: string, usage: Usage) {
  const price = PRICES[model] || PRICES[AGENT_MODEL];
  const input = usage.input_tokens || 0;
  const output = usage.output_tokens || 0;
  const cacheRead = usage.cache_read_input_tokens || 0;
  const cacheWrite = usage.cache_creation_input_tokens || 0;
  const searches = usage.server_tool_use?.web_search_requests || 0;
  const cost = (input * price.input + cacheRead * price.input * 0.1 + cacheWrite * price.input * 1.25 + output * price.output) / 1_000_000 + searches * PER_SEARCH;
  await database()
    .prepare("INSERT INTO ai_usage (id,user_id,feature,model,input_tokens,output_tokens,cache_read_tokens,cache_write_tokens,web_searches,cost_usd,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
    .bind(crypto.randomUUID(), userId, feature, model, input, output, cacheRead, cacheWrite, searches, cost, new Date().toISOString())
    .run();
  return cost;
}

export type Claude = { client: Anthropic; track: (model: string, usage: Usage) => Promise<number> };

// The only way features get a Claude client: null without a key, and an error once the monthly limit is reached.
export async function claudeFor(userId: string, feature: Feature): Promise<Claude | null> {
  const found = await getApiKey(userId);
  if (!found) return null;
  const { spent, budget } = await monthlySpend(userId);
  if (spent >= budget) throw new BudgetReachedError(budget);
  return { client: new Anthropic({ apiKey: found.key }), track: (model, usage) => record(userId, feature, model, usage) };
}

export function apiErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Anthropic.AuthenticationError) return "Your Anthropic API key was rejected. Check it in Profile.";
  if (error instanceof Anthropic.RateLimitError) return "Claude is rate limited. Try again shortly.";
  if (error instanceof Anthropic.APIError) {
    if (/credit balance/i.test(error.message)) return "Your Anthropic account is out of credit. Add credit at console.anthropic.com → Billing.";
    return error.message || fallback;
  }
  return error instanceof Error ? error.message : fallback;
}

// For features with a free fallback: over the limit, run without Claude and say why.
export async function claudeOrFree(userId: string, feature: Feature): Promise<{ ai: Claude | null; limitNote: string }> {
  try {
    return { ai: await claudeFor(userId, feature), limitNote: "" };
  } catch (e) {
    if (e instanceof BudgetReachedError) return { ai: null, limitNote: `${e.message} This used the free match instead.` };
    throw e;
  }
}

// ---------- Reading jobs and writing documents: the person's Claude subscription first ----------

export type AskRequest<T> = {
  model: string;
  system: string;
  messages: { role: "user" | "assistant"; content: string }[];
  schema: z.ZodType<T>;
  maxTokens: number;
  effort?: "low" | "medium" | "high";
  // Lets Claude search the web (finding people, pay data) up to this many times.
  search?: number;
};
// One structured answer from Claude, however it's reached.
export type Writer = { via: "api" | "subscription"; ask<T>(r: AskRequest<T>): Promise<{ data: T | null; stop: string }> };

export function apiWriter(ai: Claude): Writer {
  return {
    via: "api",
    async ask<T>(r: AskRequest<T>) {
      if (r.search) return askWithSearch(ai, r);
      const response = await ai.client.messages.parse({
        model: r.model,
        max_tokens: r.maxTokens,
        system: r.system,
        messages: r.messages,
        output_config: { format: zodOutputFormat(r.schema as never), ...(r.effort && r.model !== WRITING_MODEL ? { effort: r.effort } : {}) },
      });
      await ai.track(r.model, response.usage);
      return { data: (response.parsed_output as T | null) ?? null, stop: String(response.stop_reason) };
    },
  };
}

// The API's web search, with the JSON answer read from the reply (structured output and server tools don't mix).
async function askWithSearch<T>(ai: Claude, r: AskRequest<T>): Promise<{ data: T | null; stop: string }> {
  const messages: { role: "user" | "assistant"; content: unknown }[] = [
    ...r.messages.slice(0, -1),
    { role: "user", content: `${r.messages[r.messages.length - 1].content}\n\nReply with only a JSON object matching this JSON Schema:\n${JSON.stringify(z.toJSONSchema(r.schema))}` },
  ];
  for (let attempt = 0; attempt < 3; attempt++) {
    const message = await ai.client.messages.create({
      model: r.model,
      max_tokens: r.maxTokens,
      system: r.system,
      ...(r.effort && r.model !== WRITING_MODEL ? { output_config: { effort: r.effort } } : {}),
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: r.search }],
      messages: messages as never,
    });
    await ai.track(r.model, message.usage);
    // Long searches can pause; the partial turn goes back to carry on.
    if (message.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: message.content });
      continue;
    }
    const text = message.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    try {
      const parsed = r.schema.safeParse(JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)));
      return { data: parsed.success ? parsed.data : null, stop: String(message.stop_reason) };
    } catch {
      return { data: null, stop: "invalid_output" };
    }
  }
  return { data: null, stop: "pause_turn" };
}

type Bridge = { url: string; key: string; search?: boolean };

// The browser helper, when running, serves Claude Code (signed in to the person's Claude plan) on 127.0.0.1.
// Whether the helper is running, and if so whether its Claude Code is ready (and why not).
export async function bridgeHealth(userId: string): Promise<{ running: boolean; ready: boolean; message: string }> {
  const row = await database().prepare("SELECT bridge_url,bridge_key FROM automation_settings WHERE user_id=?").bind(userId).first<{ bridge_url: string; bridge_key: string }>();
  if (!row?.bridge_url) return { running: false, ready: false, message: "" };
  try {
    const r = await fetch(`${row.bridge_url}/health`, { headers: { Authorization: `Bearer ${row.bridge_key}` }, signal: AbortSignal.timeout(3000) });
    const h = (await r.json()) as { ready?: boolean; message?: string };
    return { running: true, ready: Boolean(h.ready), message: h.message || "" };
  } catch {
    return { running: false, ready: false, message: "" };
  }
}

export async function liveBridge(userId: string): Promise<Bridge | null> {
  const row = await database()
    .prepare("SELECT apply_engine,bridge_url,bridge_key FROM automation_settings WHERE user_id=?")
    .bind(userId)
    .first<{ apply_engine: string; bridge_url: string; bridge_key: string }>();
  if (!row || row.apply_engine === "api" || !row.bridge_url) return null;
  try {
    const r = await fetch(`${row.bridge_url}/health`, { headers: { Authorization: `Bearer ${row.bridge_key}` }, signal: AbortSignal.timeout(3000) });
    const health = (await r.json()) as { ready?: boolean; search?: boolean };
    return health.ready ? { url: row.bridge_url, key: row.bridge_key, search: Boolean(health.search) } : null;
  } catch {
    return null;
  }
}

function subscriptionWriter(bridge: Bridge): Writer {
  return {
    via: "subscription",
    async ask<T>(r: AskRequest<T>) {
      // Without web search Claude would answer from memory (made-up people, guessed pay): refuse instead.
      if (r.search && !bridge.search) throw new Error("Restart the helper (Ctrl+C, then npm run helper) so it can search the web on your Claude plan.");
      // A conversation (draft, then "fix these") becomes one prompt; Claude Code answers it in one go.
      const prompt =
        r.messages.length === 1
          ? r.messages[0].content
          : r.messages.map((m) => (m.role === "assistant" ? `<your_previous_answer>\n${m.content}\n</your_previous_answer>` : m.content)).join("\n\n");
      const ask = async () => {
        const res = await fetch(`${bridge.url}/ask`, {
          method: "POST",
          headers: { Authorization: `Bearer ${bridge.key}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            system: r.system,
            prompt,
            schema: z.toJSONSchema(r.schema),
            model: r.model.includes("haiku") ? "haiku" : "sonnet",
            effort: r.effort,
            search: r.search || 0,
          }),
          signal: AbortSignal.timeout((r.search ? 9 : 6) * 60 * 1000),
        });
        return { res, body: (await res.json().catch(() => ({}))) as { data?: unknown; error?: string } };
      };
      let { res, body } = await ask();
      // A dropped connection or a busy moment usually works on a second try.
      if ((!res.ok || body.error) && /connection|overloaded|timed? ?out|5\d\d|ECONNRESET|socket/i.test(body.error || String(res.status))) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
        ({ res, body } = await ask());
      }
      if (!res.ok || body.error) throw new Error(`Your Claude subscription (Claude Code) couldn’t answer: ${body.error || res.status}`);
      const parsed = r.schema.safeParse(body.data);
      return { data: parsed.success ? parsed.data : null, stop: parsed.success ? "end_turn" : "invalid_output" };
    },
  };
}

// Subscription when the helper is running and Claude Code is signed in; otherwise the API key (saying so), then the free version.
export async function writerFor(userId: string, feature: Feature): Promise<{ ai: Writer | null; limitNote: string }> {
  const bridge = await liveBridge(userId);
  if (bridge) return { ai: subscriptionWriter(bridge), limitNote: "" };
  const settings = await database().prepare("SELECT apply_engine,api_fallback FROM automation_settings WHERE user_id=?").bind(userId).first<{ apply_engine: string; api_fallback: number }>();
  // The person chose never to use the API key when their subscription isn't available.
  if (settings && settings.apply_engine !== "api" && !settings.api_fallback)
    return { ai: null, limitNote: "The helper isn’t running, so this used the free version (your API key is off for this). Start the helper to use your Claude subscription." };
  const { ai, limitNote } = await claudeOrFree(userId, feature);
  const note =
    settings?.apply_engine !== "api" && ai
      ? "Your Claude subscription wasn’t available (start the helper with npm run helper, and sign Claude Code in), so this used your API key."
      : "";
  return { ai: ai ? apiWriter(ai) : null, limitNote: [note, limitNote].filter(Boolean).join(" ") };
}
