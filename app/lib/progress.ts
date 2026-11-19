// Slow steps ("Check my fit", "Write my documents") run as background tasks: the work keeps going after the page
// that started it closes, and its progress is saved so any page can show it. Callers that don't ask for a task get plain JSON.
import { waitUntil } from "cloudflare:workers";
import { database } from "./automation-auth";

export type Engine = "subscription" | "api" | "free";
export type PlanStep = { key: string; label: string; expect: number };
type StepState = PlanStep & { state: "pending" | "active" | "done" | "skipped"; startedAt?: number };
export type TaskProgress = { engine: Engine | null; steps: StepState[]; startedAt: number };

export type Progress = {
  plan(engine: Engine, steps: PlanStep[]): void;
  start(key: string, label?: string): void;
  done(key: string): void;
  skip(key: string): void;
};

export const noProgress: Progress = { plan() {}, start() {}, done() {}, skip() {} };

// Rough seconds per step by engine, so the bar can move while a step runs.
export const EXPECT = {
  read: { subscription: 3, api: 3, free: 3 },
  compare: { subscription: 40, api: 35, free: 1 },
  write: { subscription: 70, api: 35, free: 1 },
  check: { subscription: 25, api: 8, free: 1 },
  fix: { subscription: 60, api: 30, free: 1 },
} as const;

export type TaskKind = "check" | "documents" | "rescore" | "prepare";
export type Work = (p: Progress) => Promise<{ status: number; body: unknown }>;

// Runs the work in the background when the page asks for it (Prefer: respond-async), otherwise answers directly.
export async function taskResponse(request: Request, userId: string, task: { kind: TaskKind; target: string; label: string }, work: Work) {
  if (!(request.headers.get("prefer") || "").includes("respond-async")) {
    const { status, body } = await work(noProgress);
    return Response.json(body, { status });
  }
  const id = await startTask(userId, task, work);
  return Response.json({ taskId: id }, { status: 202 });
}

async function startTask(userId: string, t: { kind: TaskKind; target: string; label: string }, work: Work) {
  const db = database();
  // The same job already being worked on (a second click, another tab): follow that one instead of starting again.
  if (t.target) {
    const running = await db
      .prepare("SELECT id FROM tasks WHERE user_id=? AND kind=? AND target=? AND status='running' AND updated_at>?")
      .bind(userId, t.kind, t.target, new Date(Date.now() - 15 * 60 * 1000).toISOString())
      .first<{ id: string }>();
    if (running) return running.id;
  }
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const state: TaskProgress = { engine: null, steps: [], startedAt: Date.now() };
  await db
    .prepare("INSERT INTO tasks (id,user_id,kind,target,label,status,progress_json,result_json,seen,created_at,updated_at) VALUES (?,?,?,?,?,'running',?,'',0,?,?)")
    .bind(id, userId, t.kind, t.target, t.label, JSON.stringify(state), now, now)
    .run();

  // Each step change is saved in order (there are only a handful), so a page that polls sees them as they happen.
  let saving = Promise.resolve();
  const save = () => {
    const json = JSON.stringify(state);
    saving = saving.then(() =>
      db.prepare("UPDATE tasks SET progress_json=?,updated_at=? WHERE id=?").bind(json, new Date().toISOString(), id).run().then(() => undefined, () => undefined),
    );
  };
  const mark = (key: string, next: StepState["state"], label?: string) => {
    const step = state.steps.find((s) => s.key === key);
    if (!step || (next === "skipped" && step.state === "done")) return;
    step.state = next;
    if (label) step.label = label;
    if (next === "active") step.startedAt = Date.now();
    save();
  };
  const progress: Progress = {
    plan: (engine, steps) => {
      state.engine = engine;
      // Steps already under way (an earlier phase of the same task) keep their state.
      const known = new Map(state.steps.map((s) => [s.key, s]));
      state.steps = steps.map((s) => known.get(s.key) || { ...s, state: "pending" });
      save();
    },
    start: (key, label) => mark(key, "active", label),
    done: (key) => mark(key, "done"),
    skip: (key) => mark(key, "skipped"),
  };

  const run = (async () => {
    const result = await work(progress).catch((e) => ({ status: 500, body: { error: e instanceof Error ? e.message : String(e) } }));
    await saving;
    const ok = result.status < 400;
    await db
      .prepare("UPDATE tasks SET status=?,result_json=?,updated_at=? WHERE id=?")
      .bind(ok ? "done" : "error", JSON.stringify(result), new Date().toISOString(), id)
      .run();
  })();
  // Keeps the work alive after the response is sent and the page moves on.
  waitUntil(run);
  return id;
}

// Several pieces of work shown as one task: each phase's steps come after the previous phase's.
export function phases(progress: Progress) {
  let all: PlanStep[] = [];
  return (prefix: string): Progress => ({
    plan(engine, steps) {
      all = [...all.filter((s) => !s.key.startsWith(prefix)), ...steps.map((s) => ({ ...s, key: `${prefix}${s.key}` }))];
      progress.plan(engine, all);
    },
    start: (key, label) => progress.start(`${prefix}${key}`, label),
    done: (key) => progress.done(`${prefix}${key}`),
    skip: (key) => progress.skip(`${prefix}${key}`),
  });
}
