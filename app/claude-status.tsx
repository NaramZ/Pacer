"use client";
import { useEffect, useRef, useState } from "react";
import { postJson } from "./jobs";

type State = "subscription" | "fallback-api" | "fallback-free" | "api";
type Status = { state: State; apiFallback: boolean; hasKey: boolean; problem?: string };

const TEXT: Record<State, { short: string; tone: string; detail: string }> = {
  subscription: { short: "Claude plan", tone: "good", detail: "The helper is running, so reading jobs, writing documents and filling in forms use your Claude subscription. No API cost." },
  "fallback-api": { short: "Helper off · API", tone: "warn", detail: "The helper isn’t running, so reading jobs and writing documents would use your API key (pay per use). Forms wait for the helper." },
  "fallback-free": { short: "Helper off", tone: "neutral", detail: "The helper isn’t running. Reading jobs and writing documents use the free versions until you start it; your API key isn’t used." },
  api: { short: "API key", tone: "neutral", detail: "You chose your API key in Autopilot → Which Claude to use. Every Claude step is pay per use." },
};

// Shows at a glance whether Claude steps use the person's subscription (helper running) or would fall back to the API.
export function ClaudeStatus() {
  const [status, setStatus] = useState<Status | null>(null);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/claude-status")
        .then((r) => r.json() as Promise<Status>)
        .then((s) => {
          if (alive) setStatus(s);
        })
        .catch(() => undefined);
    load();
    const timer = setInterval(load, 20000);
    const refresh = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", refresh);
    return () => {
      alive = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  if (!status) return null;
  const base = TEXT[status.state];
  // Helper running, but Claude Code missing or signed out.
  const t = status.problem ? { ...base, short: "Claude Code not ready", tone: "warn", detail: `The helper is running, but ${status.problem.charAt(0).toLowerCase()}${status.problem.slice(1)}` } : base;
  return (
    <div className="claude-status" ref={box}>
      <button className={`status-chip ${t.tone}`} aria-expanded={open} aria-controls="claude-status-panel" onClick={() => setOpen(!open)}>
        <span className="dot" aria-hidden />
        <span className="visually-hidden">Claude: </span>
        {t.short}
      </button>
      {open && (
        <div className="status-panel" id="claude-status-panel" role="dialog" aria-label="Which Claude is being used">
          <p>{t.detail}</p>
          {status.problem && /isn.t installed/i.test(status.problem) && (
            <>
              <p className="muted small">Install it in Terminal, then restart the helper:</p>
              <code className="block">brew install --cask claude-code</code>
            </>
          )}
          {status.problem && /signed in/i.test(status.problem) && <code className="block">claude auth login</code>}
          {!status.problem && status.state !== "subscription" && status.state !== "api" && (
            <>
              <p className="muted small">Start the helper in Terminal and keep its window open:</p>
              <code className="block">cd ~/Others/Job-Hunter && npm run helper</code>
            </>
          )}
          {status.state !== "api" && status.hasKey && (
            <label className="check">
              <input
                type="checkbox"
                checked={status.apiFallback}
                onChange={async (e) => {
                  const { ok, data } = await postJson<Status>("/api/claude-status", { apiFallback: e.target.checked }, "PATCH");
                  if (ok) setStatus(data);
                }}
              />
              <span className="small">When the helper is off, use my API key for reading jobs and writing documents</span>
            </label>
          )}
          <p className="muted small">Everything, including finding people and salary research, uses your Claude plan while the helper runs.</p>
        </div>
      )}
    </div>
  );
}
