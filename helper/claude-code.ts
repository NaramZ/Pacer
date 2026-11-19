// Fills in applications with the person's own Claude subscription instead of the API.
//
// The helper serves its browser tools as a small MCP server on 127.0.0.1 (random port, one-time key), then runs
// Claude Code (`claude -p`, signed in with their Claude plan) with only those tools. Nothing is billed per token;
// it counts toward the plan's usage limits. The same kill switches apply: every tool call goes through `check`.
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import type { BrowserTools, ToolContent } from "./browser-tools.ts";

type Json = Record<string, unknown>;

const ref = { type: "string", description: "An element ref from read_page or find, like ref_12" };
const TOOLS: { name: string; description: string; inputSchema: Json }[] = [
  { name: "read_page", description: 'Lists the page\'s elements with refs. Use filter "interactive" for form fields; pass ref to read just one part.', inputSchema: { type: "object", properties: { filter: { type: "string", enum: ["interactive", "all"] }, ref } } },
  { name: "find", description: "Lists elements whose description contains the text.", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
  { name: "get_page_text", description: "The page's visible text.", inputSchema: { type: "object", properties: {} } },
  { name: "screenshot", description: "A picture of the page. Only when layout or an image matters.", inputSchema: { type: "object", properties: {} } },
  { name: "form_input", description: "Fills a text box, ticks a checkbox or radio (value true/false), or picks a dropdown / type-to-search / suggestion option by meaning (\"United States\" finds \"US\"). Unlisted schools, degrees and employers get \"Other\".", inputSchema: { type: "object", properties: { ref, value: { type: ["string", "boolean"] } }, required: ["ref", "value"] } },
  { name: "click", description: "Clicks an element (buttons, links, Yes/No buttons).", inputSchema: { type: "object", properties: { ref }, required: ["ref"] } },
  { name: "type", description: "Types text into the focused element.", inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] } },
  { name: "key", description: 'Presses keys, e.g. "Enter", "Tab", "Escape".', inputSchema: { type: "object", properties: { keys: { type: "string" } }, required: ["keys"] } },
  { name: "scroll", description: "Scrolls the page, or brings an element into view when ref is given.", inputSchema: { type: "object", properties: { direction: { type: "string", enum: ["up", "down"] }, ref } } },
  { name: "wait", description: "Waits a few seconds for the page.", inputSchema: { type: "object", properties: { seconds: { type: "number" } } } },
  { name: "navigate", description: "Goes to a URL, or \"back\".", inputSchema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] } },
  { name: "file_upload", description: "Attaches files to a file field. Only the resume and cover letter paths given in the task are allowed.", inputSchema: { type: "object", properties: { ref, paths: { type: "array", items: { type: "string" } } }, required: ["ref", "paths"] } },
  { name: "salary_to_ask", description: "Looks up what to ask for on this job. Only call it when the form asks about salary and no figure was given.", inputSchema: { type: "object", properties: {} } },
];

// Our MCP tool → the helper's browser tool and its input.
function toBrowser(name: string, a: Json): [string, Json] {
  const target = a.ref ? { type: "ref", ref: String(a.ref) } : undefined;
  switch (name) {
    case "click":
      return ["left_click", { target }];
    case "key":
      return ["key", { text: a.keys }];
    case "scroll":
      return target ? ["scroll_to", { target }] : ["scroll", { scroll_direction: a.direction || "down" }];
    case "wait":
      return ["wait", { duration: Math.min(Number(a.seconds) || 2, 10) }];
    case "form_input":
    case "file_upload":
      return [name, { ...a, target }];
    default:
      return [name, a];
  }
}

const ACTIONS = new Set(["form_input", "click", "type", "key", "navigate", "file_upload"]);

function toMcp(content: ToolContent) {
  if (typeof content === "string") return [{ type: "text", text: content }];
  return content.map((b) =>
    b.type === "image"
      ? { type: "image", data: (b as { source: { data: string } }).source.data, mimeType: "image/jpeg" }
      : { type: "text", text: String((b as { text?: string }).text ?? "") },
  );
}

export type BrowserServer = { url: string; key: string; close: () => void };

// `check` runs before every tool call and returns a reason to stop (kill switch), or null to carry on.
export async function serveBrowserTools(
  tools: BrowserTools,
  opts: { salary: () => Promise<string>; check: (name: string, input: Json) => Promise<string | null> },
): Promise<BrowserServer> {
  const key = crypto.randomBytes(24).toString("hex");
  const server = http.createServer(async (req, res) => {
    const send = (status: number, body?: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(body === undefined ? "" : JSON.stringify(body));
    };
    if (req.headers.authorization !== `Bearer ${key}`) return send(401, { error: "unauthorized" });
    if (req.method !== "POST") return send(405);
    let raw = "";
    for await (const chunk of req) raw += chunk;
    let msg: { id?: number | string; method?: string; params?: Json };
    try {
      msg = JSON.parse(raw);
    } catch {
      return send(400);
    }
    const reply = (result: unknown) => send(200, { jsonrpc: "2.0", id: msg.id, result });
    if (msg.id === undefined) return send(202); // notifications
    switch (msg.method) {
      case "initialize":
        return reply({
          protocolVersion: (msg.params?.protocolVersion as string) || "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: { name: "jobhunter-browser", version: "1.0.0" },
        });
      case "ping":
        return reply({});
      case "tools/list":
        return reply({ tools: TOOLS });
      case "tools/call": {
        const name = String(msg.params?.name || "");
        const args = (msg.params?.arguments as Json) || {};
        const stop = await opts.check(name, args);
        if (stop) return reply({ content: [{ type: "text", text: `STOPPED: ${stop} End now.` }], isError: true });
        try {
          if (name === "salary_to_ask") return reply({ content: [{ type: "text", text: await opts.salary() }] });
          if (!TOOLS.some((t) => t.name === name)) throw new Error(`Unknown tool ${name}.`);
          const [browserName, input] = toBrowser(name, args);
          const content = toMcp(await tools.run(browserName, input));
          if (ACTIONS.has(name) && (await tools.signInShowing()))
            content.push({ type: "text", text: "A sign-in or create-account page is now showing. Stop and reply with just: SIGN IN NEEDED" });
          return reply({ content });
        } catch (e) {
          return reply({ content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}` }], isError: true });
        }
      }
      default:
        return send(200, { jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "Method not found" } });
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  return { url: `http://127.0.0.1:${port}/mcp`, key, close: () => server.close() };
}

// Whether Claude Code is installed and signed in with a Claude plan.
export async function claudeCodeReady(): Promise<{ ok: boolean; message: string }> {
  const out = await run(["auth", "status"], 20000).catch((e) => ({ code: 1, stdout: "", stderr: String(e) }));
  if (out.code === 127 || /ENOENT/.test(out.stderr))
    return { ok: false, message: "Claude Code isn't installed. Install it from https://claude.com/claude-code, then run: claude auth login" };
  try {
    const status = JSON.parse(out.stdout) as { loggedIn?: boolean; authMethod?: string };
    if (!status.loggedIn) return { ok: false, message: "Claude Code isn't signed in. In Terminal, run: claude auth login (choose your Claude account, not an API key)" };
    return { ok: true, message: `Claude Code signed in (${status.authMethod || "account"}).` };
  } catch {
    return { ok: false, message: `Couldn’t check Claude Code: ${(out.stderr || out.stdout).slice(0, 200)}` };
  }
}

function run(args: string[], timeoutMs: number, signal?: AbortSignal, cwd?: string, extraEnv: Record<string, string> = {}) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
    const env: NodeJS.ProcessEnv = { ...process.env, ...extraEnv };
    // Without an API key in the environment, Claude Code uses the person's signed-in Claude plan.
    delete env.ANTHROPIC_API_KEY;
    delete env.ANTHROPIC_AUTH_TOKEN;
    const child = spawn(process.env.JOB_HUNTER_CLAUDE || "claude", args, { env, cwd, signal, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    child.on("error", (e) => {
      clearTimeout(timer);
      if ((e as NodeJS.ErrnoException).code === "ENOENT") resolve({ code: 127, stdout, stderr: "ENOENT" });
      else if (e.name === "AbortError") resolve({ code: 130, stdout, stderr: "stopped" });
      else reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

// One Claude Code turn: a new task, or a follow-up to the same session (after a sign-in, or a failed submit).
export async function claudeCodeTurn(opts: {
  prompt: string;
  system: string;
  server: BrowserServer;
  sessionId?: string;
  workDir: string;
  signal: AbortSignal;
  timeoutMs: number;
}): Promise<{ text: string; sessionId: string; error?: string }> {
  fs.mkdirSync(opts.workDir, { recursive: true, mode: 0o700 });
  const mcp = { mcpServers: { jobhunter: { type: "http", url: opts.server.url, headers: { Authorization: `Bearer ${opts.server.key}` } } } };
  const args = [
    "-p",
    opts.prompt,
    "--output-format",
    "json",
    "--model",
    "sonnet",
    "--mcp-config",
    JSON.stringify(mcp),
    "--strict-mcp-config",
    // No file, shell or web tools: only the helper's browser.
    "--tools",
    "",
    "--allowedTools",
    "mcp__jobhunter",
    "--append-system-prompt",
    opts.system,
    ...(opts.sessionId ? ["--resume", opts.sessionId] : []),
  ];
  const out = await run(args, opts.timeoutMs, opts.signal, opts.workDir);
  if (out.code === 130) return { text: "", sessionId: opts.sessionId || "", error: "stopped" };
  try {
    const result = JSON.parse(out.stdout.trim().split("\n").pop() || "{}") as { result?: string; session_id?: string; is_error?: boolean };
    if (result.is_error) return { text: "", sessionId: result.session_id || "", error: explain(result.result) };
    return { text: String(result.result || "").trim(), sessionId: result.session_id || "" };
  } catch {
    const detail = (out.stderr || out.stdout).trim().slice(0, 300);
    return { text: "", sessionId: opts.sessionId || "", error: /log ?in|auth|credential/i.test(detail) ? `Claude Code isn't signed in. In Terminal, run: claude auth login. (${detail})` : `Claude Code failed: ${detail}` };
  }
}

// Claude Code's own error, with what to do about it.
function explain(message?: string) {
  const m = String(message || "Claude Code reported an error.");
  if (/log ?in|auth|credential|api_error|invalid api key/i.test(m)) return `Claude Code isn't signed in to your Claude plan. In Terminal, run: claude auth login (${m.slice(0, 120)})`;
  if (/usage limit|rate limit|limit reached/i.test(m)) return `Your Claude plan's usage limit was reached; it resets on its own. (${m.slice(0, 120)})`;
  return m.slice(0, 300);
}

export const workDirFor = (home: string) => path.join(home, "claude-work");

// One structured answer (reading a job, writing documents, the fact check) from Claude Code on the person's plan.
export async function claudeCodeAsk(req: { system: string; prompt: string; schema: unknown; model: "sonnet" | "haiku"; effort?: string; search?: number; workDir: string }) {
  fs.mkdirSync(req.workDir, { recursive: true, mode: 0o700 });
  const args = [
    "-p",
    req.prompt,
    "--output-format",
    "json",
    "--json-schema",
    // Claude Code rejects the "$schema" line that schema generators add.
    JSON.stringify(req.schema, (k, v) => (k === "$schema" ? undefined : v)),
    "--model",
    req.model,
    // Its own instructions replace Claude Code's coding ones. It gets no tools, except web search (and reading the
    // pages it finds) when the request needs it: finding people, pay data.
    "--system-prompt",
    req.search ? `${req.system}\n\nUse web search for this (at most ${req.search} searches), then answer.` : req.system,
    "--tools",
    req.search ? "WebSearch,WebFetch" : "",
    ...(req.search ? ["--allowedTools", "WebSearch,WebFetch"] : []),
    "--strict-mcp-config",
    "--no-session-persistence",
    ...(req.effort ? ["--effort", req.effort] : []),
  ];
  // Reading a job needs no extended thinking (the API version doesn't use it): 41s instead of 105s in testing.
  const out = await run(args, (req.search ? 8 : 5) * 60 * 1000, undefined, req.workDir, req.model === "haiku" ? { MAX_THINKING_TOKENS: "0" } : {});
  if (!out.stdout.trim()) throw new Error(explain(out.stderr.trim() || `Claude Code exited with code ${out.code}.`));
  let result: { result?: string; structured_output?: unknown; is_error?: boolean } = {};
  try {
    result = JSON.parse(out.stdout.trim().split("\n").pop() || "{}");
  } catch {
    const detail = (out.stderr || out.stdout).trim().slice(0, 300);
    throw new Error(/log ?in|auth|credential/i.test(detail) ? "Claude Code isn't signed in. In Terminal, run: claude auth login" : `Claude Code failed: ${detail}`);
  }
  if (result.is_error) throw new Error(explain(result.result));
  if (result.structured_output !== undefined) return result.structured_output;
  const text = String(result.result || "");
  return JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
}

// The app asks the helper (not the internet) for these answers: 127.0.0.1 only, with a one-time key.
export async function serveClaudeBridge(workDir: string, log: (...parts: unknown[]) => void) {
  const key = crypto.randomBytes(24).toString("hex");
  let ready = { ok: false, at: 0, message: "" };
  const server = http.createServer(async (req, res) => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.headers.authorization !== `Bearer ${key}`) return send(401, { error: "unauthorized" });
    if (req.method === "GET" && req.url === "/health") {
      if (Date.now() - ready.at > 60000) {
        const r = await claudeCodeReady();
        ready = { ok: r.ok, at: Date.now(), message: r.ok ? "" : r.message };
      }
      // "search": this helper can give Claude Code web search (finding people, pay data). Older helpers can't.
      return send(200, { ready: ready.ok, message: ready.message, search: true });
    }
    if (req.method !== "POST" || req.url !== "/ask") return send(404, { error: "not found" });
    let raw = "";
    for await (const chunk of req) raw += chunk;
    try {
      const body = JSON.parse(raw);
      const started = Date.now();
      const data = await claudeCodeAsk({ ...body, model: body.model === "haiku" ? "haiku" : "sonnet", workDir });
      log(`Claude subscription: answered a ${body.model === "haiku" ? "job reading" : "writing"} request in ${Math.round((Date.now() - started) / 1000)}s.`);
      return send(200, { data });
    } catch (e) {
      return send(500, { error: e instanceof Error ? e.message : String(e) });
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  return { url: `http://127.0.0.1:${port}`, key, close: () => server.close() };
}
