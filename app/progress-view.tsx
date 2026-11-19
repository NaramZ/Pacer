"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Check, LoaderCircle } from "lucide-react";

type Engine = "subscription" | "api" | "free";
type Step = { key: string; label: string; expect: number; state: "pending" | "active" | "done" | "skipped"; startedAt?: number };
export type ProgressState = { engine: Engine | null; steps: Step[]; startedAt: number };
export type TaskKind = "check" | "documents" | "rescore";
export type Task = {
  id: string;
  kind: TaskKind;
  target: string;
  label: string;
  status: "running" | "done" | "error";
  progress: ProgressState;
  result: { status: number; body: unknown } | null;
};
type Result<T> = { ok: boolean; data: T & { error?: string } };

const ENGINE: Record<Engine, string> = {
  subscription: "Using your Claude plan (no API cost).",
  api: "Using your API key.",
  free: "Using the free version (no Claude).",
};

/* ---------- One shared list of background tasks for the whole app ---------- */
// Slow work runs on the server as a task, so it keeps going when you change tab or page. Every page reads the same list.

let tasks: Task[] = [];
const listeners = new Set<() => void>();
const doneListeners = new Set<(t: Task) => void>();
const waiters = new Map<string, ((r: Result<unknown>) => void)[]>();
const settled = new Set<string>();
let timer: ReturnType<typeof setTimeout> | null = null;
let loaded = false;

const emit = () => listeners.forEach((l) => l());

async function refresh() {
  const r = await fetch("/api/tasks").catch(() => null);
  const data = r?.ok ? ((await r.json()) as { tasks: Task[] }) : null;
  if (data) {
    // Tasks this page is waiting on stay in the list until their answer has been handed over.
    const fresh = new Map(data.tasks.map((t) => [t.id, t]));
    for (const t of tasks) if (!fresh.has(t.id) && waiters.has(t.id)) fresh.set(t.id, (await fetchTask(t.id)) || t);
    tasks = [...fresh.values()];
    for (const t of tasks) {
      if (t.status === "running" || settled.has(t.id)) continue;
      settled.add(t.id);
      const result = { ok: (t.result?.status ?? 500) < 400, data: (t.result?.body || { error: "Something went wrong." }) as { error?: string } };
      for (const resolve of waiters.get(t.id) || []) resolve(result);
      waiters.delete(t.id);
      doneListeners.forEach((l) => l(t));
    }
    emit();
  }
  timer = null;
  if (tasks.some((t) => t.status === "running") || waiters.size) timer = setTimeout(refresh, 1500);
}

async function fetchTask(id: string) {
  const r = await fetch(`/api/tasks?id=${encodeURIComponent(id)}`).catch(() => null);
  return r?.ok ? ((await r.json()) as Task) : null;
}

function poll() {
  if (!timer) timer = setTimeout(refresh, 800);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  // The first page to look finds tasks started before a reload or on another page.
  if (!loaded) {
    loaded = true;
    for (const t of tasks) settled.add(t.id);
    void refresh();
  }
  return () => listeners.delete(listener);
}

// Starts slow work as a background task. Resolves with the answer when it finishes, even if the page has moved on.
export async function startTask<T>(url: string, body: unknown, method = "POST"): Promise<Result<T>> {
  const r = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json", Prefer: "respond-async" },
    body: JSON.stringify(body),
  }).catch(() => null);
  if (!r) return { ok: false, data: { error: "Couldn’t reach the app. Is it still running?" } as T & { error?: string } };
  const data = (await r.json().catch(() => ({}))) as { taskId?: string } & T & { error?: string };
  if (r.status !== 202 || !data.taskId) return { ok: r.ok, data };
  const id = data.taskId;
  if (!tasks.some((t) => t.id === id)) {
    const task = await fetchTask(id);
    if (task) tasks = [task, ...tasks];
    emit();
  }
  const done = new Promise<Result<T>>((resolve) => waiters.set(id, [...(waiters.get(id) || []), resolve as (r: Result<unknown>) => void]));
  poll();
  return done;
}

export function useTasks() {
  return useSyncExternalStore(
    subscribe,
    () => tasks,
    () => tasks,
  );
}

// The task running for this job right now, if any: shown in place wherever you look at that job.
export function useTask(kind: TaskKind, target: string | undefined) {
  const all = useTasks();
  return target ? all.find((t) => t.kind === kind && t.target === target && t.status === "running") || null : null;
}

// Called when any task finishes, on whatever page is open, so lists can refresh.
export function useTaskDone(listener: (t: Task) => void) {
  useEffect(() => {
    doneListeners.add(listener);
    return () => void doneListeners.delete(listener);
  }, [listener]);
}

export async function markSeen(id: string) {
  tasks = tasks.filter((t) => t.id !== id);
  emit();
  await fetch("/api/tasks", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) }).catch(() => undefined);
}

/* ---------- The progress card ---------- */

export function ProgressView({ progress, title }: { progress: ProgressState; title: string }) {
  const [now, setNow] = useState(progress.startedAt || 0);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);

  const steps = (progress.steps || []).filter((s) => s.state !== "skipped");
  const total = steps.reduce((n, s) => n + s.expect, 0) || 1;
  // Finished steps count in full; the running one moves toward (not past) its usual length.
  const done = steps.reduce((n, s) => {
    if (s.state === "done") return n + s.expect;
    if (s.state === "active" && s.startedAt) return n + Math.min(s.expect * 0.92, ((now - s.startedAt) / 1000) * 0.9);
    return n;
  }, 0);
  const percent = Math.max(3, Math.min(97, Math.round((done / total) * 100)));
  const active = steps.find((s) => s.state === "active");
  const elapsed = Math.max(0, Math.round((now - progress.startedAt) / 1000));
  // Time left: the running step's usual length minus what it has taken so far, plus the steps still to come.
  const remaining = steps.reduce((n, s) => {
    if (s.state === "pending") return n + s.expect;
    if (s.state === "active" && s.startedAt) return n + Math.max(5, s.expect - (now - s.startedAt) / 1000);
    return n;
  }, 0);
  const label = active?.label || (steps.length ? "Finishing up" : "Starting");

  return (
    <div className="progress-card">
      <div className="progress-head">
        <b>{title}</b>
        <span className="muted small" aria-hidden>
          {elapsed < 60 ? `${elapsed}s` : `${Math.floor(elapsed / 60)}m ${String(elapsed % 60).padStart(2, "0")}s`}
        </span>
      </div>
      <div className="progress-bar" role="progressbar" aria-label={title} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-valuetext={label}>
        <span style={{ width: `${percent}%` }} />
      </div>
      <p className="visually-hidden" role="status" aria-live="polite">
        {label}
      </p>
      {steps.length > 0 && (
        <ol className="progress-steps">
          {steps.map((s) => (
            <li key={s.key} className={s.state}>
              {s.state === "done" ? <Check aria-hidden /> : s.state === "active" ? <LoaderCircle className="spin" aria-hidden /> : <span className="pending-dot" aria-hidden />}
              <span>{s.label}</span>
            </li>
          ))}
        </ol>
      )}
      <p className="muted small">
        {progress.engine ? ENGINE[progress.engine] : ""}
        {remaining > 5 ? ` Usually about ${remaining >= 90 ? `${Math.round(remaining / 60)} more min` : `${Math.round(remaining / 5) * 5} more seconds`}.` : ""} You can
        leave this page; it keeps going.
      </p>
    </div>
  );
}
