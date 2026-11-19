import type Anthropic from "@anthropic-ai/sdk";
import { APPLY_INSTRUCTIONS, modeText } from "../../../lib/apply-instructions";
import { database, runnerUserId } from "../../../lib/automation-auth";
import { apiErrorMessage, AGENT_MODEL, BudgetReachedError, claudeFor } from "../../../lib/claude";



// Old page reads and screenshots are cleared server-side once the conversation grows, so a
// long application doesn't resend every page it has seen on each step.
const CONTEXT_BETA = "context-management-2025-06-27";

// Claude is stateless: the companion keeps the conversation and sends it back each step.
// Start with {task}; then append Claude's returned content as an assistant turn plus a user turn of
// tool_result blocks (one per tool_use, each with toolset_name "browser"), and send {messages}.
export async function POST(request: Request) {
  const userId = await runnerUserId(request);
  if (!userId) return Response.json({ error: "Invalid runner token." }, { status: 401 });
  let ai;
  try {
    ai = await claudeFor(userId, "apply");
  } catch (e) {
    if (e instanceof BudgetReachedError) return Response.json({ error: e.message }, { status: 402 });
    throw e;
  }
  if (!ai) return Response.json({ error: "Add your Anthropic API key in Profile to use Autopilot." }, { status: 503 });
  const body = await request.json() as {task?:string;messages?:Anthropic.Beta.BetaMessageParam[];autoSubmit?:boolean;jobId?:string};

  // Kill switches, checked before every step so nothing is spent once they trip:
  // pausing Autopilot stops the application mid-way, and each application has its own spending cap.
  const [settings, job] = await Promise.all([
    database().prepare("SELECT enabled,job_limit_usd FROM automation_settings WHERE user_id=?").bind(userId).first<{ enabled: number; job_limit_usd: number }>(),
    database().prepare("SELECT ai_cost_usd FROM automation_queue WHERE id=? AND user_id=?").bind(String(body.jobId || ""), userId).first<{ ai_cost_usd: number }>(),
  ]);
  if (!settings?.enabled) return Response.json({ error: "Autopilot was paused, so this application was stopped.", stopped: "paused" }, { status: 409 });
  if (!job) return Response.json({ error: "This application isn’t in the Autopilot queue." }, { status: 404 });
  const limit = Number(settings.job_limit_usd) || 0.75;
  if (job.ai_cost_usd >= limit)
    return Response.json(
      { error: `Stopped: this application reached its $${limit.toFixed(2)} AI limit without finishing. Finish it yourself, or raise the limit in Autopilot.`, stopped: "limit" },
      { status: 402 },
    );
  const messages = Array.isArray(body.messages) && body.messages.length
    ? body.messages
    : [{ role: "user" as const, content: String(body.task || "Complete the application.") }];
  try {
    const message = await ai.client.beta.messages.create({
      model: AGENT_MODEL,
      max_tokens: 4000,
      betas: [CONTEXT_BETA],
      // Medium effort is enough for form filling and keeps each step cheap.
      output_config: { effort: "medium" },
      system: [
        { type: "text", text: APPLY_INSTRUCTIONS },
        // The mode is its own block, so both modes share the cached instructions above.
        { type: "text", text: modeText(Boolean(body.autoSubmit)) },
      ],
      tools: [
        {
          name: "salary_to_ask",
          description: "Looks up what to ask for on this job. Only call it when the form asks about salary and no figure was given.",
          input_schema: { type: "object", properties: {} },
        },
        { type: "browser_toolset_20260801", configs: { file_upload: { enabled: true } }, cache_control: { type: "ephemeral" } },
      ],
      context_management: {
        edits: [{
          type: "clear_tool_uses_20250919",
          // Clearing breaks the prompt cache, so it happens rarely and in big chunks.
          trigger: { type: "input_tokens", value: 50000 },
          keep: { type: "tool_uses", value: 4 },
          clear_at_least: { type: "input_tokens", value: 20000 },
          exclude_tools: ["salary_to_ask"],
        }],
      },
      cache_control: { type: "ephemeral" },
      messages,
    });
    const cost = await ai.track(AGENT_MODEL, message.usage);
    await database().prepare("UPDATE automation_queue SET ai_cost_usd=ai_cost_usd+? WHERE id=? AND user_id=?").bind(cost, String(body.jobId), userId).run();
    return Response.json({ message, done: message.stop_reason !== "tool_use", spent: job.ai_cost_usd + cost, limit });
  } catch (error) {
    return Response.json({ error: apiErrorMessage(error, "Browser step failed.") }, { status: 502 });
  }
}
