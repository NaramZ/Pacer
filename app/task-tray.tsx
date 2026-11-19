"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Check, LoaderCircle, TriangleAlert, X } from "lucide-react";
import { markSeen, ProgressView, useTasks, type Task } from "./progress-view";

// Where a finished task's result lives.
function linkFor(t: Task) {
  const id = t.kind === "check" ? String((t.result?.body as { id?: string } | undefined)?.id || "") : t.target;
  return id ? `/?job=${encodeURIComponent(id)}` : "/";
}

// Background work in the header: what's running, and what finished while you were elsewhere.
export function TaskTray() {
  const tasks = useTasks();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const running = tasks.filter((t) => t.status === "running");
  const finished = tasks.filter((t) => t.status !== "running");

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

  if (!tasks.length) return null;
  const failed = finished.some((t) => t.status === "error");
  return (
    <div className="claude-status" ref={box}>
      <button className={`status-chip ${running.length ? "" : failed ? "warn" : "good"}`} aria-expanded={open} aria-controls="task-panel" onClick={() => setOpen(!open)}>
        {running.length ? <LoaderCircle className="spin" aria-hidden /> : failed ? <TriangleAlert aria-hidden /> : <Check aria-hidden />}
        {running.length ? `${running.length} working` : `${finished.length} ready`}
      </button>
      <p className="visually-hidden" role="status" aria-live="polite">
        {running.length ? "" : finished.length ? `${finished.length} finished: ${finished.map((t) => t.label).join(", ")}` : ""}
      </p>
      {open && (
        <div className="status-panel task-panel" id="task-panel" role="dialog" aria-label="Background work">
          {running.map((t) => (
            <ProgressView key={t.id} progress={t.progress} title={t.label} />
          ))}
          {finished.map((t) => (
            <div key={t.id} className={`task-done ${t.status}`}>
              <div>
                <b>{t.label}</b>
                <span className="small">
                  {t.status === "done" ? "Ready." : String((t.result?.body as { error?: string } | undefined)?.error || "It didn’t finish.")}
                </span>
              </div>
              <div className="button-row">
                {t.status === "done" && (
                  <Link className="button primary small" href={linkFor(t)} onClick={() => { void markSeen(t.id); setOpen(false); }}>
                    Open
                  </Link>
                )}
                <button className="icon-button small" onClick={() => markSeen(t.id)} aria-label={`Dismiss: ${t.label}`}>
                  <X aria-hidden />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
