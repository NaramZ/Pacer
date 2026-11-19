"use client";
/* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */
import { useEffect, useMemo, useState } from "react";
import { Check, Copy, ExternalLink, LoaderCircle, Pause, Play, RotateCw, X } from "lucide-react";
import { postJson } from "./jobs";
import { Sheet } from "./ui";
import { SpendMeter, type Usage } from "./profile-panel";

type Settings = {
  enabled: boolean;
  minFit: number;
  dailyLimit: number;
  roles: string[];
  locations: string[];
  excludedTerms: string[];
  sources: string[];
  paired: boolean;
  lastHeartbeatAt: string;
  autoSubmit: boolean;
  jobLimitUsd: number;
  applyEngine: "subscription" | "api";
};
type QueueItem = {
  id: string;
  company: string;
  role: string;
  location: string;
  source: string;
  source_url: string;
  application_url: string;
  status: string;
  fit_score: number;
  reason: string;
  last_error: string;
  questions_json?: string;
  ai_cost_usd?: number;
};
type Payload = { settings: Settings; queue: QueueItem[]; usage?: Usage };

const STATUS_TEXT: Record<string, string> = {
  Discovered: "Found",
  Researching: "Checking fit",
  Ready: "Ready to fill in",
  Applying: "Filling in",
  "Sign in": "Sign in needed",
  Review: "Check and submit",
  Submitted: "Sent",
  Skipped: "Skipped",
  "Needs input": "Needs you",
  Failed: "Didn’t work",
};

const EMPTY: Settings = { enabled: false, minFit: 70, dailyLimit: 5, roles: [], locations: [], excludedTerms: [], sources: [], paired: false, lastHeartbeatAt: "", autoSubmit: false, jobLimitUsd: 0.75, applyEngine: "subscription" };
const lines = (value: string) => value.split(/\n|,/).map((x) => x.trim()).filter(Boolean);
const when = (value: string) =>
  value ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value)) : "never";

export function AutomationPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [data, setData] = useState<Payload | null>(null);
  const [settings, setSettings] = useState<Settings>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pairToken, setPairToken] = useState("");

  async function load() {
    setError("");
    const r = await fetch("/api/automation");
    const d = (await r.json()) as Payload & { error?: string };
    if (!r.ok) throw new Error(d.error || "Couldn’t load Autopilot.");
    setData(d);
    setSettings(d.settings);
  }

  useEffect(() => {
    if (open) load().catch((e) => setError(e.message));
  }, [open]);

  const counts = useMemo(() => {
    const q = data?.queue || [];
    const n = (...s: string[]) => q.filter((x) => s.includes(x.status)).length;
    return { ready: n("Ready"), applying: n("Applying"), sent: n("Submitted"), help: n("Sign in", "Review", "Needs input", "Failed") };
  }, [data]);

  // Only the Start/Stop button sends "enabled", so saving rules can't switch Autopilot on or off with a stale value.
  // Takes a job out of Autopilot's line: removed, or applied to by hand (which also updates My jobs).
  async function queueAction(item: QueueItem, action: "remove" | "applied") {
    const { ok, data: d } = await postJson("/api/automation", { action, id: item.id });
    if (!ok) return setError(d.error || "Couldn’t update that job.");
    setNotice(action === "applied" ? `${item.role} at ${item.company} marked as applied. Autopilot won’t fill it in.` : `${item.role} at ${item.company} removed from Autopilot.`);
    await load().catch((e) => setError(e.message));
  }

  async function save(next: Settings = settings, message = "Rules saved.", toggle = false) {
    setBusy(true);
    setError("");
    const { ok, data: d } = await postJson<{ settings?: Settings }>("/api/automation", toggle ? next : { ...next, enabled: undefined }, "PATCH");
    setBusy(false);
    if (!ok || !d.settings) {
      setError(d.error || "Couldn’t save.");
      return;
    }
    setSettings(d.settings);
    setData((v) => (v ? { ...v, settings: d.settings! } : v));
    setNotice(message);
  }

  async function pair() {
    setBusy(true);
    setError("");
    const { ok, data: d } = await postJson<{ token?: string }>("/api/automation", { action: "pair" });
    setBusy(false);
    if (!ok || !d.token) {
      setError(d.error || "Couldn’t create a code.");
      return;
    }
    setPairToken(d.token);
    await load();
  }

  const connected = Boolean(settings.lastHeartbeatAt);

  return (
    <Sheet open={open} onClose={onClose} labelledBy="autopilot-title" className="autopilot-sheet">
      <div className="sheet-head">
        <div>
          <p className="kicker">Autopilot</p>
          <h2 id="autopilot-title" className="display medium">
            Let us find and apply <em>for you.</em>
          </h2>
          <p className="muted">
            Autopilot finds jobs that match your rules, checks your fit, and fills in each application on the employer’s own site —
            one at a time. It never presses submit: you check every form and send it yourself. If an employer needs an account (Workday
            always does), it waits while you sign in yourself.
          </p>
        </div>
        <div className="sheet-actions">
          <button className="icon-button" onClick={onClose} aria-label="Close">
            <X aria-hidden />
          </button>
        </div>
      </div>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <p className="visually-hidden" role="status">
        {notice}
      </p>

      <div className="stack">
        <section className="card autopilot-status">
          <div className="status-line">
            <span className={`dot ${connected ? "on" : ""}`} aria-hidden />
            <div>
              <h3>{connected ? "Browser helper connected" : "Browser helper not connected"}</h3>
              <p className="muted small">Last check-in: {when(settings.lastHeartbeatAt)}</p>
            </div>
          </div>
          <button
            className={`button ${settings.enabled ? "secondary" : "primary"}`}
            disabled={busy || !settings.paired}
            onClick={() =>
              save(
                { ...settings, enabled: !settings.enabled },
                settings.enabled ? "Autopilot stopped. Anything it was filling in stops before its next step, so nothing more is spent." : "Autopilot started.",
                true,
              )
            }
            aria-describedby={!settings.paired ? "pair-first" : undefined}
          >
            {busy ? <LoaderCircle className="spin" aria-hidden /> : settings.enabled ? <Pause aria-hidden /> : <Play aria-hidden />}
            {settings.enabled ? "Stop" : "Start"}
          </button>
          {settings.enabled && <p className="muted small full">Stop works instantly, even in the middle of an application.</p>}
          {!settings.paired && (
            <p id="pair-first" className="muted small full">
              Connect the browser helper below before starting.
            </p>
          )}
        </section>

        {data?.usage && (
          <section className="card" aria-label="AI spending this month">
            <SpendMeter usage={data.usage} />
            <p className="muted small">
              Filling in one application usually costs 15–40¢. Any application that reaches your per-application limit, repeats itself, only
              reads without filling anything in, or runs for 15 minutes is stopped and set aside for you. Change the monthly limit in Profile.
            </p>
          </section>
        )}

        <dl className="tally">
          {[
            ["Ready to fill in", counts.ready],
            ["Filling in now", counts.applying],
            ["Waiting for you", counts.help],
            ["Sent", counts.sent],
          ].map(([label, value]) => (
            <div key={String(label)}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>

        <section className="card" aria-labelledby="auto-title">
          <h3 id="auto-title">When a form is ready</h3>
          <fieldset className="choice">
            <legend className="visually-hidden">When a form is ready</legend>
            <label className="check">
              <input
                type="radio"
                name="auto-submit"
                checked={!settings.autoSubmit}
                onChange={() => save({ ...settings, autoSubmit: false }, "The helper will stop for you to review and submit.")}
              />
              <span>
                <b>Stop for me to review and submit</b>
                <span className="muted small"> You check every application before it’s sent.</span>
              </span>
            </label>
            <label className="check">
              <input
                type="radio"
                name="auto-submit"
                checked={settings.autoSubmit}
                onChange={() => {
                  if (window.confirm("Let the helper submit applications for you while you’re away? It only submits when every required answer comes from your profile, resume or saved answers, and keeps a record of everything it sent."))
                    save({ ...settings, autoSubmit: true }, "Auto-submit is on.");
                }}
              />
              <span>
                <b>Submit for me while I’m away</b>
                <span className="muted small">
                  {" "}
                  Only when every required answer comes from your profile, resume or saved answers. Anything it can’t answer, and
                  sign-ins, are set aside for you. Every submission is recorded with screenshots.
                </span>
              </span>
            </label>
          </fieldset>
        </section>

        <section className="card" aria-labelledby="engine-title">
          <h3 id="engine-title">Which Claude to use</h3>
          <p className="muted small">For reading jobs, writing your resume and cover letter, and filling in forms. Finding people and salary research too: they use Claude Code’s web search on your plan.</p>
          <fieldset className="choice">
            <legend className="visually-hidden">Which Claude fills in forms</legend>
            <label className="check">
              <input
                type="radio"
                name="apply-engine"
                checked={settings.applyEngine !== "api"}
                onChange={() => save({ ...settings, applyEngine: "subscription" }, "Forms will be filled in with your Claude subscription.")}
              />
              <span>
                <b>My Claude subscription</b>
                <span className="muted small">
                  {" "}
                  No extra cost while the helper is running: uses Claude Code on this computer, signed in to your Claude plan, and counts toward its usage limits. Run{" "}
                  <code>claude auth login</code> once in Terminal first.
                </span>
              </span>
            </label>
            <label className="check">
              <input
                type="radio"
                name="apply-engine"
                checked={settings.applyEngine === "api"}
                onChange={() => save({ ...settings, applyEngine: "api" }, "Forms will be filled in with your API key.")}
              />
              <span>
                <b>My API key</b>
                <span className="muted small"> Pay per use: about 6¢ to read and tailor a job, and 15–40¢ to fill in a form, within your limits.</span>
              </span>
            </label>
          </fieldset>
        </section>

        <section className="card">
          <h3>Your rules</h3>
          <p className="muted small">
            Autopilot picks from the companies you follow in Find jobs, and only applies when a job passes every rule. Titles, places
            and skipped words are shared with Find jobs.
          </p>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="min-fit">Minimum resume match (%)</label>
              <input
                id="min-fit"
                type="number"
                min={50}
                max={100}
                value={settings.minFit}
                onChange={(e) => setSettings({ ...settings, minFit: Number(e.target.value) })}
              />
            </div>
            <div className="field">
              <label htmlFor="daily-limit">Forms to fill in per day</label>
              <input
                id="daily-limit"
                type="number"
                min={1}
                max={20}
                value={settings.dailyLimit}
                onChange={(e) => setSettings({ ...settings, dailyLimit: Number(e.target.value) })}
              />
            </div>
            <div className="field">
              <label htmlFor="job-limit">Most AI spend per application ($)</label>
              <input
                id="job-limit"
                type="number"
                min={0.1}
                max={5}
                step={0.05}
                aria-describedby="job-limit-help"
                value={settings.jobLimitUsd}
                onChange={(e) => setSettings({ ...settings, jobLimitUsd: Number(e.target.value) })}
              />
              <p id="job-limit-help" className="muted small">
                Stops an application that costs more than this.
              </p>
            </div>
          </div>
          <ListField id="roles" label="Job titles" help="One per line" value={settings.roles} onChange={(roles) => setSettings({ ...settings, roles })} />
          <ListField
            id="locations"
            label="Locations"
            help="Cities, or “Remote — United States”"
            value={settings.locations}
            onChange={(locations) => setSettings({ ...settings, locations })}
          />
          <ListField
            id="excluded"
            label="Skip jobs mentioning"
            help="One per line"
            value={settings.excludedTerms}
            onChange={(excludedTerms) => setSettings({ ...settings, excludedTerms })}
          />
          <button className="button primary" onClick={() => save()} disabled={busy}>
            Save rules
          </button>
        </section>

        <section className="card">
          <h3>Connect the browser helper</h3>
          <p className="muted small">
            The helper runs on your computer and fills in applications in its own browser window, so you can watch and step in. Run
            these in a terminal in the app’s folder (Job-Hunter):
          </p>
          <ol className="steps">
            <li>
              Once, to get its browser: <code>npm run helper:setup</code>
            </li>
            <li>
              Connect it with a code from below: <code>npm run helper -- pair &lt;code&gt;</code>
            </li>
            <li>
              Start it: <code>npm run helper</code>
            </li>
          </ol>
          {pairToken ? (
            <div className="code-box">
              <code>{pairToken}</code>
              <button className="button secondary small" onClick={() => navigator.clipboard.writeText(pairToken)}>
                <Copy aria-hidden /> Copy code
              </button>
            </div>
          ) : (
            <button className="button secondary" onClick={pair} disabled={busy}>
              {settings.paired ? "Create a new code" : "Create connection code"}
            </button>
          )}
        </section>

        <section className="card">
          <div className="card-head">
            <h3>Jobs Autopilot found</h3>
            <button className="icon-button" onClick={() => load().catch((e) => setError(e.message))} aria-label="Refresh list">
              <RotateCw aria-hidden />
            </button>
          </div>
          {!data?.queue.length ? (
            <p className="muted">Nothing yet. Once Autopilot is running, jobs it finds show up here.</p>
          ) : (
            <ul className="queue">
              {data.queue.map((item) => (
                <li key={item.id}>
                  <span className={`pill q-${item.status.toLowerCase().replace(/\s+/g, "-")}`}>
                    {item.status === "Submitted" && <Check aria-hidden />}
                    {STATUS_TEXT[item.status] || item.status}
                  </span>
                  <div>
                    <b>{item.role}</b>
                    <span className="muted small">
                      {item.company} · {item.location}
                      {item.fit_score ? ` · ${item.fit_score}% match` : ""}
                      {item.ai_cost_usd ? ` · ${Math.round(item.ai_cost_usd * 100)}¢ AI` : ""}
                    </span>
                    {(item.last_error || item.reason) && <span className="small">{item.last_error || item.reason}</span>}
                    <QuestionList item={item} onChanged={() => load().catch((e) => setError(e.message))} onNotice={setNotice} />
                    {!["Submitted", "Skipped", "Applying"].includes(item.status) && (
                      <div className="queue-actions">
                        <button className="button secondary small" onClick={() => queueAction(item, "applied")}>
                          <Check aria-hidden /> I applied
                          <span className="visually-hidden"> to {item.role} at {item.company}</span>
                        </button>
                        <button className="button secondary small" onClick={() => queueAction(item, "remove")}>
                          <X aria-hidden /> Remove
                          <span className="visually-hidden">
                            {" "}
                            {item.role} at {item.company} from Autopilot
                          </span>
                        </button>
                      </div>
                    )}
                  </div>
                  <a className="icon-button" href={item.application_url || item.source_url} target="_blank" rel="noreferrer" aria-label={`Open ${item.role} at ${item.company} (new tab)`}>
                    <ExternalLink aria-hidden />
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </Sheet>
  );
}

type Flagged = { question: string; options: string[] };

function questionsOf(item: QueueItem): Flagged[] {
  try {
    return (JSON.parse(item.questions_json || "[]") as unknown[]).map((q) =>
      typeof q === "string" ? { question: q, options: [] } : { question: String((q as Flagged).question), options: (q as Flagged).options || [] },
    );
  } catch {
    return [];
  }
}

// Questions the helper couldn't answer, each with a box to answer and save it for every future application.
function QuestionList({ item, onChanged, onNotice }: { item: QueueItem; onChanged: () => void; onNotice: (s: string) => void }) {
  const questions = questionsOf(item);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");
  const canRetry = item.status === "Failed" || item.status === "Sign in" || (item.status === "Needs input" && questions.length === 0);
  if (!questions.length && !canRetry) return null;

  async function save(question: string) {
    setSaving(question);
    setError("");
    const { ok, data } = await postJson("/api/automation", { action: "answer", id: item.id, question, answer: drafts[question] || "" });
    setSaving("");
    if (!ok) {
      setError(data.error || "Couldn’t save.");
      return;
    }
    onNotice(`Saved your answer to “${question}”. It’s in Profile → Answers for applications.`);
    onChanged();
  }

  async function retry() {
    await postJson("/api/automation", { action: "retry", id: item.id });
    onNotice(`${item.role} at ${item.company} is back in line.`);
    onChanged();
  }

  return (
    <div className="questions">
      {questions.map(({ question: q, options }, i) => (
        <form
          key={q}
          className="question"
          onSubmit={(e) => {
            e.preventDefault();
            save(q);
          }}
        >
          {options.length ? (
            // Multiple choice: pick one of the form's own options.
            <fieldset className="question-options">
              <legend>{q}</legend>
              {options.map((o) => (
                <label key={o} className="check small">
                  <input type="radio" name={`q-${item.id}-${i}`} value={o} checked={drafts[q] === o} onChange={() => setDrafts({ ...drafts, [q]: o })} />
                  {o}
                </label>
              ))}
            </fieldset>
          ) : (
            <label htmlFor={`q-${item.id}-${i}`}>{q}</label>
          )}
          <div className="tag-entry">
            {!options.length && (
              <input id={`q-${item.id}-${i}`} value={drafts[q] || ""} onChange={(e) => setDrafts({ ...drafts, [q]: e.target.value })} placeholder="Your answer" />
            )}
            <button className="button secondary small" disabled={saving === q || !(drafts[q] || "").trim()}>
              {saving === q ? <LoaderCircle className="spin" aria-hidden /> : <Check aria-hidden />} Save this answer
            </button>
          </div>
        </form>
      ))}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {canRetry && (
        <button className="button primary small" onClick={retry}>
          <RotateCw aria-hidden /> Try this job again
        </button>
      )}
    </div>
  );
}

function ListField({
  id,
  label,
  help,
  value,
  onChange,
}: {
  id: string;
  label: string;
  help: string;
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const [text, setText] = useState(value.join("\n"));
  useEffect(() => setText(value.join("\n")), [value.join("\n")]);
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <p className="muted small" id={`${id}-help`}>
        {help}
      </p>
      <textarea
        id={id}
        rows={3}
        aria-describedby={`${id}-help`}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => onChange(lines(text))}
      />
    </div>
  );
}
