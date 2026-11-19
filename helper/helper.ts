// Pacer browser helper.
//
// Runs on your computer next to the app. It finds jobs that fit (free), checks your fit, then opens each
// application in its own browser window and fills it in with Claude. It never presses the final submit
// button: you review the form and submit it yourself, and the helper records it once the employer confirms.
//
//   npm run helper -- pair <code>   connect to the app with the code from Autopilot
//   npm run helper                  start
import fs from "node:fs";
import path from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright-core";
import { BrowserTools, type ToolContent } from "./browser-tools.ts";
import { linksForForm } from "../app/links.ts";
import { claudeCodeReady, claudeCodeTurn, serveBrowserTools, serveClaudeBridge, workDirFor } from "./claude-code.ts";

type Json = Record<string, unknown>;
type Block = Json & { type: string };
type Message = { role: "user" | "assistant"; content: string | Block[] };

// Everything the helper keeps (connection code, its own browser profile, generated files) stays in this folder.
const HOME = process.env.JOB_HUNTER_HELPER_HOME || path.resolve(import.meta.dirname, "..", ".helper");
const CONFIG = path.join(HOME, "config.json");
const FILES = path.join(HOME, "files");
const PROFILE = path.join(HOME, "browser-profile");
// Screenshots of each form as submitted, and of the employer's confirmation.
const RECORDS = path.join(HOME, "records");

const MAX_STEPS = 45;
// Kill switches for a confused or looping agent (the server also caps AI spend per application).
const MAX_WORK_MS = 15 * 60 * 1000;
const MAX_REPEATS = 3; // the same actions this many times in the last 6 steps
const MAX_IDLE_STEPS = 8; // steps in a row that only look at the page without changing anything
const LOOK_ONLY = new Set(["read_page", "find", "get_page_text", "screenshot", "zoom", "scroll", "scroll_to", "wait", "list_tabs", "hover"]);
// With the person's Claude subscription, each tool call is one step (the API version counts turns of several calls).
const MAX_TOOL_CALLS = 120;
// How long an open form is watched for the person's submission.
const REVIEW_WAIT_MS = 8 * 60 * 60 * 1000;
// Creating an account can involve confirming an email, so allow plenty of time.
const SIGN_IN_WAIT_MS = 30 * 60 * 1000;
const DISCOVER_EVERY_MS = 3 * 60 * 60 * 1000;
const CONFIRMATION = /thank(s| you) for (applying|your application|your interest)|application (has been |was )?(submitted|received|complete)|we('ve| have) received your application|successfully (submitted|applied)/i;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// Set when the monthly AI limit is reached, so the helper waits instead of trying job after job.
let budgetPause = "";
const log = (...parts: unknown[]) => console.log(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }), "·", ...parts);

/* ---------- Setup ---------- */

type Config = { token: string; server: string };

function readConfig(): Config | null {
  try {
    return JSON.parse(fs.readFileSync(CONFIG, "utf8")) as Config;
  } catch {
    return null;
  }
}

function pair(code: string | undefined, server = "http://localhost:5173") {
  if (!code?.startsWith("nja_")) {
    console.error("Paste the connection code from Autopilot in the app: npm run helper -- pair nja_…");
    process.exit(1);
  }
  fs.mkdirSync(HOME, { recursive: true });
  fs.writeFileSync(CONFIG, JSON.stringify({ token: code, server }, null, 2), { mode: 0o600 });
  console.log("Connected. Start the helper with: npm run helper");
}

// Prefers the Chromium installed by `npm run helper:setup`, then Chrome, Edge or Brave. Set JOB_HUNTER_BROWSER to choose.
// (Vivaldi and other heavily customised browsers can't be driven reliably.)
function findBrowser() {
  const home = process.env.HOME || process.env.USERPROFILE || "";
  const local = process.env.LOCALAPPDATA || "";
  const candidates = [
    process.env.JOB_HUNTER_BROWSER,
    chromium.executablePath(),
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    path.join(home, "Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    path.join(local, "Google\\Chrome\\Application\\chrome.exe"),
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/microsoft-edge",
    "/usr/bin/brave-browser",
  ];
  const found = candidates.find((p) => p && fs.existsSync(p));
  if (!found) throw new Error("No supported browser found. Run `npm run helper:setup` once, or install Chrome, Edge or Brave.");
  return found;
}

/* ---------- Talking to the app ---------- */

function api(config: Config) {
  return async <T = Json>(method: string, route: string, body?: unknown): Promise<T> => {
    const r = await fetch(`${config.server}${route}`, {
      method,
      headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = (await r.json().catch(() => ({}))) as T & { error?: string };
    if (!r.ok) throw new Error(data.error || `The app answered ${r.status}.`);
    return data;
  };
}

/* ---------- Applying ---------- */

type Job = Json & {
  id: string;
  company: string;
  role: string;
  application_url: string;
  source_url: string;
  tailored_resume?: string;
  cover_letter?: string;
  resume_pdf_base64?: string;
  cover_letter_pdf_base64?: string;
  job_location?: string;
  salary_note?: string;
};
type Profile = { fullName: string; email: string; phone: string; location: string; links: string; headline: string } | null;

function saveFiles(job: Job) {
  fs.mkdirSync(FILES, { recursive: true, mode: 0o700 });
  const slug = `${job.company}-${job.role}`.replace(/[^a-z0-9]+/gi, "-").slice(0, 60);
  const files: { label: string; path: string }[] = [];
  if (job.resume_pdf_base64) {
    const p = path.join(FILES, `${slug}-Resume.pdf`);
    fs.writeFileSync(p, Buffer.from(job.resume_pdf_base64, "base64"), { mode: 0o600 });
    files.push({ label: "Resume", path: p });
  }
  if (job.cover_letter_pdf_base64 && job.cover_letter) {
    const p = path.join(FILES, `${slug}-Cover-Letter.pdf`);
    fs.writeFileSync(p, Buffer.from(job.cover_letter_pdf_base64, "base64"), { mode: 0o600 });
    files.push({ label: "Cover letter", path: p });
  }
  return files;
}

function taskFor(job: Job, profile: Profile, answers: string, files: { label: string; path: string }[]) {
  return `Apply for: ${job.role} at ${job.company}
Job location: ${job.job_location || "not stated"}
The application page is already open in the current tab: ${job.application_url}
${job.salary_note || "No salary figure yet. If the form asks about salary, call salary_to_ask."}

<person>
Name: ${profile?.fullName || ""}
Email: ${profile?.email || ""}
Phone: ${profile?.phone || ""}
Location: ${profile?.location || ""}
Links: ${linksForForm(profile?.links)}
</person>

<saved_answers>
${answers || "None saved yet."}
</saved_answers>

Files you can upload:
${files.map((f) => `- ${f.label}: ${f.path}`).join("\n") || "- none"}

<resume>
${job.tailored_resume || ""}
</resume>

<cover_letter>
${job.cover_letter || ""}
</cover_letter>`;
}

async function runTools(tools: BrowserTools, blocks: Block[], salary: () => Promise<string>) {
  const results: Block[] = [];
  let failed = false;
  // Actions in one turn run in order; once one fails the rest are skipped, since they depended on it.
  for (const block of blocks.filter((b) => b.type === "tool_use")) {
    // Salary research costs a few cents, so it only happens when a form asks.
    if (block.name === "salary_to_ask" && !block.toolset_name) {
      results.push({ type: "tool_result", tool_use_id: block.id, content: await salary().catch((e) => `Couldn’t work out a salary (${e instanceof Error ? e.message : e}). Leave it and list the question.`) });
      continue;
    }
    const result: Block = { type: "tool_result", tool_use_id: block.id, toolset_name: "browser" };
    if (failed || block.toolset_name !== "browser") {
      result.content = failed ? "Not run: an earlier action in this turn failed." : "Unknown tool.";
      result.is_error = true;
    } else {
      try {
        result.content = (await tools.run(String(block.name), (block.input as Json) || {})) as ToolContent;
      } catch (e) {
        result.content = `Error: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`;
        result.is_error = true;
        failed = true;
      }
    }
    results.push(result);
  }
  return results;
}

// Waits for the person to submit. The employer's confirmation page is the proof it went through.
async function waitForSubmit(page: Page, waitMs: number): Promise<{ submitted: boolean; closed: boolean; url: string }> {
  const until = Date.now() + waitMs;
  while (Date.now() < until) {
    if (page.isClosed()) return { submitted: false, closed: true, url: "" };
    // Embedded forms (Stripe, many careers sites) show their thank-you inside the frame, so every frame is checked.
    for (const frame of page.frames()) {
      const text = await frame.evaluate(() => document.body?.innerText.slice(0, 20000) || "").catch(() => "");
      const where = (() => { try { return new URL(frame.url()).pathname; } catch { return ""; } })();
      if (CONFIRMATION.test(text) || /confirmation|thank-?you|submitted/i.test(where)) return { submitted: true, closed: false, url: frame.url() };
    }
    await sleep(3000);
  }
  return { submitted: false, closed: false, url: page.url() };
}

// Pauses while the person signs in or creates an account in the helper's window. Claude isn't called meanwhile,
// and passwords never pass through the helper. Returns false if they closed the window or it timed out.
async function waitForSignIn(
  context: BrowserContext,
  tools: BrowserTools,
  update: (status: string, extra?: Json) => Promise<unknown>,
  job: Job,
  reportedByClaude: boolean,
  waitMs: number,
) {
  const where = (await tools.signInShowing()) || context.pages().at(-1);
  const startUrl = where?.url() || "";
  await update("Sign in", { reason: "Sign in or create your account in the helper’s browser window. It carries on by itself once you’re through." });
  console.log(`\n🔑 Sign-in needed: ${job.role} at ${job.company}`);
  console.log("Sign in (or create an account) in the helper’s browser window. The helper never sees your password, and the browser remembers you for next time. Waiting…\n");
  await where?.bringToFront().catch(() => undefined);

  // Signed in = no password field for two checks in a row (and, when Claude spotted the wall, the page moved on).
  const until = Date.now() + waitMs;
  let clear = 0;
  while (Date.now() < until) {
    await sleep(3000);
    if (!context.pages().length) return false;
    const blocked = (await tools.signInShowing()) !== null || (reportedByClaude && context.pages().every((p) => p.url() === startUrl));
    clear = blocked ? 0 : clear + 1;
    if (clear >= 2) {
      await update("Applying", { reason: "Signed in; carrying on." });
      log("Signed in. Carrying on with the application.");
      await sleep(1500);
      return true;
    }
  }
  await update("Sign in", { reason: "Needs you to sign in or create an account. Sign in in the helper’s window, then press Try this job again." });
  return false;
}

type Reply = { message: { content: Block[]; stop_reason: string }; done: boolean };

// Parses Claude's closing note: the outcome line, questions it couldn't answer, and the rest as a summary.
function readSummary(summary: string) {
  const questions = [...summary.matchAll(/^\s*QUESTION:\s*(.+)$/gim)]
    .map((m) => {
      const [question, options] = m[1].split(/\s*\|\|\s*OPTIONS:\s*/i);
      return { question: question.trim(), options: options ? options.split(/\s+\|\s+/).map((o) => o.trim()).filter(Boolean).slice(0, 20) : [] };
    })
    .slice(0, 20);
  const submitRef = summary.match(/SUBMIT:\s*(ref_\d+)/i)?.[1] || "";
  // The outcome line is usually first, but Claude sometimes writes a sentence before it; the first one found counts.
  const outcome = summary.match(/^\s*\**\s*(READY FOR REVIEW|READY TO SUBMIT|NEEDS INPUT)\b/im)?.[1]?.toUpperCase() || "";
  const note = summary
    .replace(/^\s*(QUESTION|SUBMIT):.*$/gim, "")
    .replace(/^[\s\S]*?\b(READY FOR REVIEW|READY TO SUBMIT|NEEDS INPUT)\**\s*[—:-]?\s*/i, "")
    .trim()
    .slice(0, 1500);
  return { questions, submitRef, note, ready: outcome.startsWith("READY"), toSubmit: outcome === "READY TO SUBMIT" };
}

async function apply(call: ReturnType<typeof api>, context: BrowserContext, job: Job, profile: Profile, answers: string, autoSubmit: boolean, engine: "subscription" | "api") {
  const update = (status: string, extra: Json = {}) => call("POST", "/api/runner/jobs", { action: "update", id: job.id, status, ...extra });
  const files = saveFiles(job);
  const tools = new BrowserTools(context, files.map((f) => f.path));
  log(`Applying${autoSubmit ? " (auto-submit)" : ""} with ${engine === "api" ? "the API" : "your Claude subscription"}: ${job.role} at ${job.company}`);
  await update("Applying");

  let page: Page;
  try {
    page = await tools.open(job.application_url || job.source_url);
  } catch (e) {
    await update("Failed", { lastError: `Couldn’t open the application page: ${e instanceof Error ? e.message.split("\n")[0] : e}` });
    return;
  }
  // Unattended, nobody is there to sign in, so the job is set aside quickly and the helper moves on.
  const signInWait = autoSubmit ? 2 * 60 * 1000 : SIGN_IN_WAIT_MS;

  // Some application links go straight to a sign-in page; sort that out before asking Claude anything.
  if ((await tools.signInShowing()) && !(await waitForSignIn(context, tools, update, job, false, signInWait))) return finish(page, autoSubmit);

  const task = taskFor(job, profile, answers, files);
  const messages: Message[] = [];
  let steps = 0;
  let idleSteps = 0;
  const recent: string[] = [];
  const started = Date.now();
  let waited = 0; // time spent waiting for the person to sign in doesn't count as work

  // Stops the application and tells the person why. Nothing more is spent on it.
  async function stuck(reason: string) {
    log(`🛑 ${reason}`);
    await update("Needs input", { reason: `${reason} Finish it yourself, or press “Try this job again”.` });
    return null;
  }

  // A sign-in page that keeps coming back means the account isn't set up yet (or the site logged them out):
  // the job is set aside with a clear note instead of looping until the repeat kill switch trips.
  let signIns = 0;
  async function signIn(afterAction: boolean) {
    if (++signIns > 2) {
      log("🔑 The sign-in page keeps coming back; setting this job aside.");
      await update("Needs input", { reason: "This site keeps asking you to sign in. Sign in or create your account in the helper’s window, then press “Try this job again”." });
      return false;
    }
    const t = Date.now();
    const ok = await waitForSignIn(context, tools, update, job, afterAction, signInWait);
    waited += Date.now() - t;
    return ok;
  }

  // Runs Claude until it gives its closing note. Returns null if the job was already dealt with (failed, paused).
  async function fill(): Promise<string | null> {
    while (steps < MAX_STEPS) {
      let reply: Reply;
      try {
        if (Date.now() - started - waited > MAX_WORK_MS) return stuck("Stopped: this application ran for 15 minutes without finishing.");
        reply = await call("POST", "/api/runner/computer", messages.length ? { messages, autoSubmit, jobId: job.id } : { task, autoSubmit, jobId: job.id });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (/Autopilot was paused/i.test(message)) {
          log("⏸  Autopilot was paused; stopped this application.");
          await update("Ready", { reason: "Stopped because Autopilot was paused." });
          return null;
        }
        if (/AI limit without finishing/i.test(message)) return stuck(message);
        if (/monthly AI limit/i.test(message)) {
          budgetPause = message;
          await update("Ready", { reason: "Waiting: monthly AI limit reached." });
        } else await update("Failed", { lastError: message });
        return null;
      }
      steps++;
      if (!messages.length) messages.push({ role: "user", content: task });
      messages.push({ role: "assistant", content: reply.message.content });
      if (reply.done) {
        const summary = reply.message.content.filter((b) => b.type === "text").map((b) => String(b.text)).join("\n").trim();
        if (reply.message.stop_reason === "refusal") return "NEEDS INPUT — Claude wouldn’t continue with this application.";
        if (/^\s*SIGN IN NEEDED/i.test(summary)) {
          if (!(await signIn(true))) return null;
          messages.push({ role: "user", content: "The person has signed in. Carry on with the application from the current page." });
          continue;
        }
        return summary;
      }
      // Loop checks: the same actions over and over, or a long run of only looking at the page.
      const actions = reply.message.content.filter((b) => b.type === "tool_use");
      const signature = JSON.stringify(actions.map((b) => [b.name, b.input]));
      const lookingOnly = actions.every((b) => LOOK_ONLY.has(String(b.name)));
      if (!lookingOnly) recent.push(signature);
      if (!lookingOnly && recent.slice(-6).filter((x) => x === signature).length >= MAX_REPEATS) return stuck("Stopped: Claude kept repeating the same step.");
      idleSteps = lookingOnly ? idleSteps + 1 : 0;
      if (idleSteps >= MAX_IDLE_STEPS) return stuck("Stopped: Claude kept reading the page without filling anything in.");

      const results = await runTools(tools, reply.message.content, () =>
        call<{ note: string }>("POST", "/api/runner/salary", { id: job.id }).then((r) => r.note),
      );
      // An action led to a sign-in or create-account page: pause for the person, then tell Claude they're through.
      if (await tools.signInShowing()) {
        if (!(await signIn(false))) return null;
        results.push({ type: "text", text: "A sign-in page appeared and the person has now signed in. Read the page again and carry on." });
      }
      messages.push({ role: "user", content: results });
    }
    return stuck(`Stopped: the form took more than ${MAX_STEPS} steps.`);
  }

  // The same job done by Claude Code on the person's own Claude plan, through the helper's browser tools.
  let sessionId = "";
  let toolCalls = 0;
  const stopper = new AbortController();
  let stopReason = "";
  let lastStatusCheck = 0;
  async function fillWithClaudeCode(message?: string): Promise<string | null> {
    const server = await serveBrowserTools(tools, {
      salary: () => call<{ note: string }>("POST", "/api/runner/salary", { id: job.id }).then((r) => r.note),
      check: async (name, input) => {
        toolCalls++;
        // Stop in the app is checked every few seconds.
        if (Date.now() - lastStatusCheck > 5000) {
          lastStatusCheck = Date.now();
          const { enabled } = await call<{ enabled: boolean }>("GET", "/api/runner/status").catch(() => ({ enabled: true }));
          if (!enabled) stopReason = "paused";
        }
        if (!stopReason && Date.now() - started - waited > MAX_WORK_MS) stopReason = "Stopped: this application ran for 15 minutes without finishing.";
        if (!stopReason && toolCalls > MAX_TOOL_CALLS) stopReason = `Stopped: the form took more than ${MAX_TOOL_CALLS} actions.`;
        // Looking at the page again (screenshots, re-reading) is how a form gets checked, not a loop; only repeated actions count.
        const looking = ["read_page", "find", "get_page_text", "screenshot", "scroll", "wait"].includes(name);
        const signature = JSON.stringify([name, input]);
        if (!looking) recent.push(signature);
        if (!stopReason && !looking && recent.slice(-6).filter((x) => x === signature).length >= MAX_REPEATS) stopReason = "Stopped: Claude kept repeating the same step.";
        idleSteps = looking ? idleSteps + 1 : 0;
        if (!stopReason && idleSteps >= MAX_IDLE_STEPS * 2) stopReason = "Stopped: Claude kept reading the page without filling anything in.";
        if (stopReason) setTimeout(() => stopper.abort(), 1500);
        return stopReason || null;
      },
    });
    try {
      let prompt = message || task;
      // Read fresh for each application, so changes to how forms are filled apply without restarting the helper
      // (a restart closes the browser and every filled form waiting for review).
      const { APPLY_INSTRUCTIONS, modeText } = (await import(`../app/lib/apply-instructions.ts?t=${Date.now()}`)) as typeof import("../app/lib/apply-instructions.ts");
      for (;;) {
        const turn = await claudeCodeTurn({
          prompt,
          system: `${APPLY_INSTRUCTIONS}\n\n${modeText(autoSubmit)}\n\nUse the jobhunter browser tools (mcp__jobhunter__…) for everything. Refs look like ref_12.`,
          server,
          sessionId: sessionId || undefined,
          workDir: workDirFor(HOME),
          signal: stopper.signal,
          timeoutMs: MAX_WORK_MS,
        });
        if (turn.sessionId) sessionId = turn.sessionId;
        if (stopReason === "paused") {
          log("⏸  Autopilot was paused; stopped this application.");
          await update("Ready", { reason: "Stopped because Autopilot was paused." });
          return null;
        }
        if (stopReason) return stuck(stopReason);
        if (turn.error) {
          log(`Claude Code: ${turn.error}`);
          await update("Needs input", { reason: turn.error });
          return null;
        }
        if (/^\s*SIGN IN NEEDED/i.test(turn.text)) {
          if (!(await signIn(true))) return null;
          prompt = "The person has signed in. Carry on with the application from the current page.";
          continue;
        }
        return turn.text;
      }
    } finally {
      server.close();
    }
  }

  // Runs the chosen engine; a message continues the same conversation (after a failed submit, for example).
  const next = (message?: string) => {
    if (engine === "subscription") return fillWithClaudeCode(message);
    if (message) messages.push({ role: "user", content: message });
    return fill();
  };

  let summary = await next();
  if (summary === null) return finish(page, autoSubmit);

  // Unattended: submit it, keeping a full record of what was sent. Up to two tries if the page shows errors.
  if (autoSubmit) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const s = readSummary(summary!);
      if (!s.toSubmit || !s.submitRef || s.questions.length) break;
      const record = await submitWithRecord(tools, job, s.submitRef, s.note, files);
      if (record.confirmed) {
        await update("Submitted", { confirmationUrl: record.confirmationUrl, reason: "Submitted for you; the employer confirmed.", record });
        log(`✅ Submitted: ${job.role} at ${job.company}`);
        return finish(page, true);
      }
      summary = await next(
        "The submit button was pressed but no confirmation appeared. Read the page, fix anything it flags using only what you were given, then end with READY TO SUBMIT and the SUBMIT ref again — or NEEDS INPUT if you can't.",
      );
      if (summary === null) return finish(page, true);
    }
  }

  const s = readSummary(summary!);
  const status = autoSubmit ? "Needs input" : s.ready ? "Review" : "Needs input";
  const note = autoSubmit && s.ready && !s.questions.length ? `Couldn’t confirm the submission went through. ${s.note}`.trim() : s.note;
  await update(status, { reason: note, questions: s.questions });
  if (s.questions.length) console.log(`Questions to answer in the app (Autopilot):\n${s.questions.map((q) => `  • ${q.question}`).join("\n")}`);
  console.log(`\n${status === "Review" ? "👀 Ready for your review" : "✋ Needs you"}: ${job.role} at ${job.company}\n${note}\n`);
  if (autoSubmit) return finish(page, true);

  // The form stays open in its own tab for the person to check and submit (Greenhouse, for one, emails a code first);
  // the helper moves on to the next job and keeps watching this tab for the employer's confirmation.
  console.log("Left open in its own tab for you to check and submit. Moving on to the next job.\n");
  void watchForSubmit(page, update, job);
}

async function watchForSubmit(page: Page, update: (status: string, extra?: Json) => Promise<unknown>, job: Job) {
  const outcome = await waitForSubmit(page, REVIEW_WAIT_MS);
  if (outcome.submitted) {
    await update("Submitted", { confirmationUrl: outcome.url, reason: "You submitted it; the employer confirmed." }).catch(() => undefined);
    log(`✅ Submitted: ${job.role} at ${job.company}`);
  } else if (outcome.closed) {
    log(`Tab closed without submitting: ${job.role} at ${job.company}. It stays under “Check and submit” in Autopilot.`);
  }
}

// Unattended runs close each application's tab when done, so windows don't pile up.
async function finish(page: Page, close: boolean) {
  if (close) await page.close().catch(() => undefined);
}

// Records exactly what's on the form, presses submit, and records the confirmation.
async function submitWithRecord(tools: BrowserTools, job: Job, submitRef: string, note: string, files: { label: string; path: string }[]) {
  const dir = path.join(RECORDS, job.id);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const page = tools.page();
  const fields = String(await tools.run("read_page", { filter: "interactive" }));
  const before = path.join(dir, `before-${Date.now()}.jpg`);
  await page.screenshot({ path: before, fullPage: true, type: "jpeg", quality: 60 }).catch(() => undefined);
  await tools.run("left_click", { target: { type: "ref", ref: submitRef } });
  const outcome = await waitForSubmit(page, 60 * 1000);
  const after = path.join(dir, `confirmation-${Date.now()}.jpg`);
  if (outcome.submitted) await page.screenshot({ path: after, fullPage: true, type: "jpeg", quality: 60 }).catch(() => undefined);
  return {
    confirmed: outcome.submitted,
    confirmationUrl: outcome.url,
    submittedAt: new Date().toISOString(),
    mode: "auto",
    applicationUrl: page.url(),
    // Refs are the helper's own element labels; they're dropped so the record reads cleanly.
    fields: fields.replace(/ \[ref_\d+\]/g, ""),
    drafted: note,
    documents: files.map((f) => ({ label: f.label, path: f.path })),
    screenshots: outcome.submitted ? [before, after] : [before],
  };
}

/* ---------- Main loop ---------- */

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (command === "pair") return pair(rest[0], rest[1]);
  // "once": fill in the jobs already queued (for example ones you picked), then exit. No searching for more.
  const once = command === "once";

  const config = readConfig();
  if (!config) {
    console.error("Not connected yet. In the app, open Autopilot → Create connection code, then run: npm run helper -- pair <code>");
    process.exit(1);
  }
  const call = api(config);
  // One helper at a time: they share a browser profile. Say so plainly instead of a browser error.
  const pidFile = path.join(HOME, "helper.pid");
  const other = Number(fs.existsSync(pidFile) ? fs.readFileSync(pidFile, "utf8") : 0);
  if (other && other !== process.pid) {
    let alive = false;
    try {
      process.kill(other, 0);
      alive = true;
    } catch {}
    if (alive) {
      console.error(`The helper is already running (process ${other}). Stop it first (Ctrl+C in its window, or: kill ${other}), then start it again.`);
      process.exit(1);
    }
  }
  fs.writeFileSync(pidFile, String(process.pid));
  process.on("exit", () => {
    try {
      if (fs.readFileSync(pidFile, "utf8") === String(process.pid)) fs.unlinkSync(pidFile);
    } catch {}
  });
  const executablePath = findBrowser();
  log(`Using ${path.basename(executablePath)}. Your normal browser profile isn't touched; the helper keeps its own.`);
  const context = await chromium.launchPersistentContext(PROFILE, {
    executablePath,
    headless: false,
    viewport: { width: 1280, height: 800 },
    acceptDownloads: false,
    args: ["--no-first-run", "--no-default-browser-check"],
  });

  // Reading jobs and writing documents in the app go through Claude Code on your plan while the helper runs.
  const bridge = await serveClaudeBridge(workDirFor(HOME), log);
  await call("POST", "/api/runner/bridge", { url: bridge.url, key: bridge.key }).catch((e) => log(`Couldn’t offer your Claude subscription to the app: ${e instanceof Error ? e.message : e}`));
  const subscription = await claudeCodeReady();
  log(subscription.ok ? "Your Claude subscription is ready for reading jobs, writing documents and filling in forms." : subscription.message);

  let stopping = false;
  let current: string | null = null;
  const stop = async () => {
    if (stopping) process.exit(0);
    stopping = true;
    log("Stopping…");
    await call("POST", "/api/runner/bridge", { url: "" }).catch(() => undefined);
    bridge.close();
    // An application cut off halfway goes back in the queue.
    if (current) await call("POST", "/api/runner/jobs", { action: "update", id: current, status: "Ready", reason: "Helper stopped mid-application." }).catch(() => undefined);
    await context.close().catch(() => undefined);
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  context.on("close", () => void stop());

  let lastDiscover = 0;
  let pausedNoted = false;
  let claudeNoted = false;
  log("Helper running. Press Ctrl+C to stop.");
  let lastBridge = Date.now();
  while (!stopping) {
    try {
      // Checks in every minute, so the app still finds the subscription after it restarts.
      if (Date.now() - lastBridge > 60000) {
        lastBridge = Date.now();
        await call("POST", "/api/runner/bridge", { url: bridge.url, key: bridge.key }).catch(() => undefined);
      }
      const state = await call<{ enabled: boolean; next: Job | null; profile: Profile; answers: string; settings: { autoSubmit?: boolean; applyEngine?: "subscription" | "api" } | null }>(
        "GET",
        "/api/runner/jobs",
      );
      if (!state.enabled) {
        if (!pausedNoted) log("Autopilot is paused. Press Start in the app when you're ready.");
        pausedNoted = true;
        await sleep(20000);
        continue;
      }
      pausedNoted = false;

      if (budgetPause) {
        log(`${budgetPause} Checking again in an hour.`);
        budgetPause = "";
        await sleep(60 * 60 * 1000);
        continue;
      }

      if (state.next) {
        current = state.next.id;
        const engine = state.settings?.applyEngine === "api" ? "api" : "subscription";
        // Your Claude plan is used through Claude Code; it has to be signed in first. The API is never used instead.
        if (engine === "subscription") {
          const ready = await claudeCodeReady();
          if (!ready.ok) {
            if (!claudeNoted) log(`${ready.message}\n   Waiting; checking again every minute. (Or choose "API key" under Autopilot → Filling in forms.)`);
            claudeNoted = true;
            current = null;
            if (once) return stop();
            await sleep(60000);
            continue;
          }
          claudeNoted = false;
        }
        await apply(call, context, state.next, state.profile, state.answers || "", Boolean(state.settings?.autoSubmit), engine);
        current = null;
        continue;
      }
      if (once) {
        log("No more queued jobs. Done.");
        return stop();
      }

      const { discovered } = await call<{ discovered: Job[] }>("GET", "/api/runner/jobs?queue=discovered");
      if (discovered.length) {
        for (const job of discovered.slice(0, 3)) {
          log(`Checking fit: ${job.role} at ${job.company}`);
          const result = await call<{ status?: string; reason?: string }>("POST", "/api/runner/analyze", { id: job.id }).catch((e) => ({ status: "Failed", reason: String(e) }));
          log(`  → ${result.status}${result.reason ? ` (${result.reason})` : ""}`);
        }
        continue;
      }

      if (Date.now() - lastDiscover > DISCOVER_EVERY_MS) {
        lastDiscover = Date.now();
        const { jobs } = await call<{ jobs: Json[] }>("POST", "/api/runner/discover", {});
        const { added } = await call<{ added: number }>("POST", "/api/runner/jobs", { action: "discover", jobs });
        log(added ? `Found ${added} new ${added === 1 ? "job" : "jobs"} from companies you follow.` : "No new jobs right now.");
        if (added) continue;
      }
      await sleep(60000);
    } catch (e) {
      log(`Problem: ${e instanceof Error ? e.message : e}. Trying again in a minute.`);
      await sleep(60000);
    }
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
