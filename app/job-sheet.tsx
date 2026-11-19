"use client";
/* eslint-disable react-hooks/set-state-in-effect */
import { ReactNode, useEffect, useState } from "react";
import { ArrowRight, Check, ClipboardCopy, Copy, Download, ExternalLink, LoaderCircle, RotateCw, Trash2, X } from "lucide-react";
import { chromeBrief } from "./claude-in-chrome";
import { pointsFor, scoreOf } from "./scoring";
import type { ProfileState } from "./profile-panel";
import { Identity, downloadCoverLetterPdf, downloadResumePdf } from "./lib/pdf";
import { Application, Dossier, STATUS_LABEL, STATUSES, Status, dossierOf, isResearching, postJson, salaryText, submissionOf } from "./jobs";
import { Sheet, TabPanel, Tabs } from "./ui";
import { ProgressView, startTask, useTask } from "./progress-view";

type Tab = "overview" | "match" | "documents" | "listing";
const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "match", label: "Resume match" },
  { id: "documents", label: "Documents" },
  { id: "listing", label: "Listing" },
];

export function JobSheet({
  job,
  onClose,
  onDelete,
  onStatus,
  onChanged,
  onResearch,
  identity,
  aiEnabled,
  me,
  claudeInChrome,
}: {
  job: Application | null;
  onClose: () => void;
  onDelete: (a: Application) => void;
  onStatus: (a: Application, s: Status) => void;
  onChanged: () => Promise<void>;
  onResearch: (id: string) => void;
  identity: Identity;
  aiEnabled: boolean;
  me: ProfileState | null;
  claudeInChrome: boolean;
}) {
  const [tab, setTab] = useState<Tab>("overview");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setTab("overview");
    setError("");
  }, [job?.id]);

  // Re-checking runs in the background; its progress shows here whenever this job is open.
  const checkTask = useTask("check", job?.id);
  const checking = checkTask?.progress || null;
  async function research(jobDescription?: string) {
    if (!job) return;
    setBusy(true);
    setError("");
    const { ok, data } = await startTask<{ id?: string }>("/api/research", { retryId: job.id, jobDescription });
    if (!ok) setError(data.error || "Couldn’t read this job. Paste the description in the Listing tab.");
    await onChanged();
    if (ok) onResearch(job.id);
    setBusy(false);
  }

  const d = job ? dossierOf(job) : null;

  return (
    <Sheet open={Boolean(job)} onClose={onClose} labelledBy="sheet-title" className="job-sheet">
      {job && (
        <>
          <div className="sheet-head">
            <div>
              <p className="kicker">{job.company}</p>
              <h2 id="sheet-title" className="display medium">
                {job.role}
              </h2>
              <p className="muted">
                {[job.location, d?.workArrangement, salaryText(d)].filter((x) => x && x !== "Not specified").join(" · ")}
              </p>
            </div>
            <div className="sheet-actions">
              <div className="status-select">
                <label htmlFor="sheet-status" className="visually-hidden">
                  Status
                </label>
                <select id="sheet-status" value={job.status} onChange={(e) => onStatus(job, e.target.value as Status)}>
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABEL[s]}
                    </option>
                  ))}
                </select>
              </div>
              {job.url && (
                <a className="icon-button" href={job.url} target="_blank" rel="noopener noreferrer" aria-label="Open the original listing (new tab)">
                  <ExternalLink aria-hidden />
                </a>
              )}
              <button className="icon-button" onClick={() => onDelete(job)} aria-label="Delete this job">
                <Trash2 aria-hidden />
              </button>
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

          {submissionOf(job) && <SentCard job={job} />}
          {job.url && !isResearching(job) && !submissionOf(job) && <HelperCard job={job} />}
          {claudeInChrome && job.url && !isResearching(job) && !submissionOf(job) && <ChromeCard job={job} d={d} me={me} />}

          {checking ? (
            <ProgressView progress={checking} title="Checking your fit" />
          ) : isResearching(job) ? (
            <div className="state" role="status">
              <LoaderCircle className="spin" aria-hidden />
              <h3>Reading the listing</h3>
              <p>Comparing it with your resume. This takes a few seconds.</p>
            </div>
          ) : job.researchStatus === "error" ? (
            <div className="state">
              <h3>We couldn’t read this listing</h3>
              <p>{job.notes || "The page may be blocked or expired."} Paste the description in the Listing tab, or try again.</p>
              <div className="button-row">
                <button className="button primary" onClick={() => research()} disabled={busy}>
                  {busy ? <LoaderCircle className="spin" aria-hidden /> : <RotateCw aria-hidden />} Try again
                </button>
                <button className="button secondary" onClick={() => setTab("listing")}>
                  Paste description
                </button>
              </div>
              {tab === "listing" && <ListingTab job={job} d={d} busy={busy} onAnalyze={research} />}
            </div>
          ) : (
            <>
              <Tabs tabs={TABS} value={tab} onChange={setTab} label="Job details" idPrefix="job" />
              <TabPanel id={tab} idPrefix="job">
                {tab === "overview" && <OverviewTab d={d} onTab={setTab} job={job} onChanged={onChanged} aiEnabled={aiEnabled} />}
                {tab === "match" && <MatchTab d={d} job={job} onChanged={onChanged} onSeeDocs={() => setTab("documents")} />}
                {tab === "documents" && <DocumentsTab job={job} d={d} onChanged={onChanged} identity={identity} aiEnabled={aiEnabled} onSeeMatch={() => setTab("match")} />}
                {tab === "listing" && <ListingTab job={job} d={d} busy={busy} onAnalyze={research} />}
              </TabPanel>
            </>
          )}
        </>
      )}
    </Sheet>
  );
}

function OverviewTab({
  d,
  onTab,
  job,
  onChanged,
  aiEnabled,
}: {
  d: Dossier | null;
  onTab: (t: Tab) => void;
  job: Application;
  onChanged: () => Promise<void>;
  aiEnabled: boolean;
}) {
  if (!d) return <p className="muted">No analysis yet.</p>;
  const score = d.evidenceScore ?? 0;
  return (
    <div className="stack">
      <section className="score-hero">
        <div className="score-number" aria-label={`${score} percent resume match`}>
          {score}
          <span aria-hidden>%</span>
        </div>
        <div>
          <p className="kicker">
            {d.analyzedWith === "basic" ? "Basic word match" : d.analysisConfidence === "Preliminary" ? "Early estimate" : "Resume match"}
          </p>
          <p className="score-copy">{d.scoreExplanation}</p>
          <button className="text-button" onClick={() => onTab("match")}>
            See how we scored it
          </button>
        </div>
      </section>

      <SalaryCard d={d} job={job} onChanged={onChanged} aiEnabled={aiEnabled} />

      {d.descriptionWarning && (
        <p className="callout warn">
          <b>Part of the listing is missing.</b> {d.descriptionWarning}{" "}
          <button className="text-button inline" onClick={() => onTab("listing")}>
            Paste the full description
          </button>
        </p>
      )}

      {d.summary && <p className="summary">{d.summary}</p>}

      {d.recommendation && (
        <Card title="Our take">
          <p>{d.recommendation}</p>
          <dl className="pairs">
            {d.strongestAngle && (
              <div>
                <dt>Lead with</dt>
                <dd>{d.strongestAngle}</dd>
              </div>
            )}
            {d.biggestRisk && (
              <div>
                <dt>Watch out for</dt>
                <dd>{d.biggestRisk}</dd>
              </div>
            )}
          </dl>
        </Card>
      )}

      {Boolean(d.rolePriorities?.length || d.summary) && (
        <Card title="What the job is really about">
          {d.rolePriorities?.length ? (
            <ul className="list">
              {d.rolePriorities.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          ) : (
            <p>{d.summary}</p>
          )}
        </Card>
      )}

      {Boolean(d.nextSteps?.length) && (
        <Card title="Next steps">
          <ol className="list numbered">
            {d.nextSteps!.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ol>
        </Card>
      )}

      <PeopleCard d={d} job={job} onChanged={onChanged} aiEnabled={aiEnabled} />
    </div>
  );
}

const VERDICT_LABEL: Record<string, string> = { Strong: "Strong", Partial: "Partial", Gap: "Missing", "No evidence": "Missing" };

function MatchTab({ d, job, onChanged, onSeeDocs }: { d: Dossier | null; job: Application; onChanged: () => Promise<void>; onSeeDocs: () => void }) {
  const reqs = d?.requirements || [];
  if (!reqs.length) return <p className="muted">We didn’t find specific requirements. Paste the full description in the Listing tab.</p>;
  return (
    <div className="stack">
      {d?.docScore && <DocScoreCard job={job} score={d.docScore} onChanged={onChanged} onSeeDocs={onSeeDocs} savedConfirmed={d.confirmed || []} />}
      <ScoreBreakdown reqs={reqs} />
      <p className="muted">What the job asks for, what your resume shows, and what you could add — only if it’s true.</p>
      <ul className="requirements">
        {reqs.map((r, i) => {
          const verdict = r.verdict || "";
          return (
            <li key={r.id || i} className="requirement">
              <div className="req-head">
                <span className={`pill ${verdict.toLowerCase().replace(/\s+/g, "-")}`}>{VERDICT_LABEL[verdict] || verdict}</span>
                <h3>{r.requirement}</h3>
              </div>
              <dl className="evidence">
                <div>
                  <dt>The job says</dt>
                  <dd>“{r.jobEvidence || r.matchedTerm}”</dd>
                </div>
                <div>
                  <dt>Your resume shows</dt>
                  <dd>{r.resumeEvidence || "Nothing yet."}</dd>
                </div>
                {r.suggestedAddition && verdict !== "Strong" && (
                  <div>
                    <dt>You could add</dt>
                    <dd>
                      {r.suggestedAddition} <CopyButton text={r.suggestedAddition} label="Copy suggestion" />
                    </dd>
                  </div>
                )}
              </dl>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function DocumentsTab({
  job,
  d,
  onChanged,
  identity,
  aiEnabled,
  onSeeMatch,
}: {
  job: Application;
  d: Dossier | null;
  onChanged: () => Promise<void>;
  identity: Identity;
  aiEnabled: boolean;
  onSeeMatch: () => void;
}) {
  const [resume, setResume] = useState(job.tailoredResume || "");
  const [letter, setLetter] = useState(job.coverLetter || "");
  const [saved, setSaved] = useState(true);
  const [error, setError] = useState("");
  // Writing runs in the background: switch tabs or pages and it keeps going; its progress shows here when you come back.
  const writingTask = useTask("documents", job.id);
  const writingProgress = writingTask?.progress || null;
  const writing = Boolean(writingTask);
  // New documents written while you were elsewhere show up here, unless you have unsaved edits.
  useEffect(() => {
    if (!saved) return;
    setResume(job.tailoredResume || "");
    setLetter(job.coverLetter || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.tailoredResume, job.coverLetter]);

  async function generate() {
    setError("");
    const { ok, data } = await startTask<{ resume?: string; coverLetter?: string; notice?: string }>("/api/tailor", { id: job.id });
    if (!ok) {
      setError(data.error || "Couldn’t write the documents.");
      return;
    }
    setResume(data.resume || "");
    setLetter(data.coverLetter || "");
    setSaved(true);
    if (data.notice) setError(data.notice);
    await onChanged();
  }

  async function save() {
    await postJson("/api/tailor", { id: job.id, resume, coverLetter: letter }, "PATCH");
    setSaved(true);
    await onChanged();
  }

  if (writingProgress) return <ProgressView progress={writingProgress} title="Writing your documents" />;

  if (!resume && !letter)
    return (
      <div className="state">
        <h3>Tailored resume and cover letter</h3>
        <p>
          {aiEnabled
            ? "Claude rewrites your resume to lead with what this job cares about, drafts a cover letter, then fact-checks both against your original resume. Nothing is invented."
            : "Without an API key you get your resume as it is plus a cover letter outline to finish. Add a key in Profile for fully tailored documents."}
        </p>
        <button className="button primary" onClick={generate} disabled={writing}>
          {writing && <LoaderCircle className="spin" aria-hidden />}
          {writing ? "Writing…" : aiEnabled ? "Write my documents" : "Get my documents"}
        </button>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </div>
    );

  return (
    <div className="stack">
      {d?.docScore && (
        <p className="doc-score-line">
          Match with these documents: <span className="muted">{d.docScore.before}%</span> → <b>{d.docScore.after}%</b>
          {d.docScore.stale ? " (before your edits)" : ""} · the cover letter covers {d.docScore.letterCovers} of {d.docScore.total} requirements. Skills you vouch for count as met once the resume states them.{" "}
          <button className="text-button inline" onClick={onSeeMatch}>
            See each requirement
          </button>
        </p>
      )}
      {d?.docTarget && !d.docTarget.met && (
        <div className="callout warn" role="status">
          <b>Below your {d.docTarget.target}% target.</b> The most this resume can honestly reach is {d.docScore?.after ?? "less than"}%.
          {d.docTarget.short.length > 0 && <> Still short on: {d.docTarget.short.join("; ")}.</>} These are usually things like years of experience or a specific field. The resume is still tailored as far as it goes, so you can send it or skip the job.
        </div>
      )}
      {Boolean(d?.assumed?.length) && (
        <details className="callout" role="status">
          <summary>
            <b>{d!.assumed!.length} {d!.assumed!.length === 1 ? "skill" : "skills"} added from your own experience</b> (not written on your original resume). Be ready to talk through them.
          </summary>
          <ul className="list">
            {d!.assumed!.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </details>
      )}
      {Boolean(d?.docWarnings?.length) && (
        <div className="callout warn" role="status">
          <b>Check these before sending.</b> The fact check couldn’t confirm them against your resume, or they may still read as machine-written:
          <ul className="list">
            {d!.docWarnings!.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}
      {Boolean(d?.resumeChanges?.length) && (
        <Card title={`${d!.resumeChanges!.length} changes for this job`}>
          <ul className="changes">
            {d!.resumeChanges!.map((c, i) => (
              <li key={i}>
                <p>
                  <b>{c.section}</b> — {c.why}
                </p>
                <details>
                  <summary>Before and after</summary>
                  <del>{c.before}</del>
                  <ins>{c.after}</ins>
                </details>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <div className="doc-grid">
        <DocEditor
          id="resume-text"
          label="Resume"
          value={resume}
          onChange={(v) => {
            setResume(v);
            setSaved(false);
          }}
          onDownload={() => downloadResumePdf(resume, job.company, identity)}
        />
        <DocEditor
          id="letter-text"
          label="Cover letter"
          value={letter}
          onChange={(v) => {
            setLetter(v);
            setSaved(false);
          }}
          onDownload={() => downloadCoverLetterPdf(letter, job.company, job.role, identity)}
        />
      </div>
      <div className="button-row">
        <button className="button primary" onClick={save} disabled={saved}>
          {saved ? <Check aria-hidden /> : null}
          {saved ? "Saved" : "Save changes"}
        </button>
        <button className="button secondary" onClick={generate} disabled={writing}>
          {writing ? <LoaderCircle className="spin" aria-hidden /> : <RotateCw aria-hidden />} Rewrite from scratch
        </button>
      </div>
    </div>
  );
}

function DocEditor({
  id,
  label,
  value,
  onChange,
  onDownload,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  onDownload: () => void;
}) {
  return (
    <div className="doc">
      <div className="doc-head">
        <label htmlFor={id}>{label}</label>
        <div className="button-row tight">
          <CopyButton text={value} label={`Copy ${label.toLowerCase()}`} />
          <button className="button secondary small" onClick={onDownload} disabled={!value.trim()}>
            <Download aria-hidden /> PDF
          </button>
        </div>
      </div>
      <textarea id={id} value={value} onChange={(e) => onChange(e.target.value)} spellCheck />
    </div>
  );
}

function ListingTab({
  job,
  d,
  busy,
  onAnalyze,
}: {
  job: Application;
  d: Dossier | null;
  busy: boolean;
  onAnalyze: (jd: string) => void;
}) {
  const [text, setText] = useState(d?.jobDescription || job.jobDescription || "");
  const keywords = d?.keywordAnalysis || [];
  return (
    <div className="stack">
      {job.url && (
        <a className="button secondary small align-start" href={job.url} target="_blank" rel="noopener noreferrer">
          View job posting <ExternalLink aria-hidden />
          <span className="visually-hidden"> (opens in a new tab)</span>
        </a>
      )}
      {keywords.length > 0 && (
        <Card title="Keywords we found">
          <ul className="keywords">
            {keywords.map((k) => (
              <li key={`${k.term}-${k.label}`} className={`pill ${(k.verdict || "").toLowerCase().replace(/\s+/g, "-")}`}>
                {k.term}
                <span className="visually-hidden">: {VERDICT_LABEL[k.verdict] || k.verdict} in your resume</span>
              </li>
            ))}
          </ul>
          <p className="muted small">Green: your resume shows it. Amber: partly. Red: missing.</p>
        </Card>
      )}
      <div className="field">
        <label htmlFor="listing-text">Job description</label>
        <p className="muted small" id="listing-help">
          If the listing looks cut off, paste the full text here and check again.
        </p>
        <textarea id="listing-text" aria-describedby="listing-help" rows={14} value={text} onChange={(e) => setText(e.target.value)} />
      </div>
      <div className="button-row">
        <button className="button primary" onClick={() => onAnalyze(text)} disabled={busy || !text.trim()}>
          {busy ? <LoaderCircle className="spin" aria-hidden /> : <RotateCw aria-hidden />} Check again
        </button>
      </div>
      {Boolean(d?.sources?.length) && (
        <Card title="Sources">
          <ul className="sources">
            {d!.sources!.map((s, i) => (
              <li key={i}>
                <a href={s.url} target="_blank" rel="noreferrer">
                  {s.title || s.url} <ExternalLink aria-hidden />
                  <span className="visually-hidden"> (opens in a new tab)</span>
                </a>
                {s.supports && <span className="muted small">{s.supports}</span>}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="card">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="button secondary small"
      disabled={!text.trim()}
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      }}
    >
      {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
      <span aria-live="polite">{copied ? "Copied" : "Copy"}</span>
      <span className="visually-hidden"> — {label}</span>
    </button>
  );
}

// Queues this one job for the browser helper, which fills it in and stops for the person to submit (unless auto-submit is on).
function HelperCard({ job }: { job: Application }) {
  const [state, setState] = useState<"idle" | "busy" | "queued">("idle");
  const [error, setError] = useState("");
  return (
    <section className="card chrome-card" aria-labelledby="helper-title">
      <div>
        <h3 id="helper-title">Fill in with the browser helper</h3>
        <p className="muted small" aria-live="polite">
          {state === "queued" ? (
            <>
              Queued. With Autopilot started, run <code>npm run helper -- once</code> to fill in just the jobs you picked. It stops before Submit so you can check it.
            </>
          ) : job.tailoredResume ? (
            "The helper fills in the form with your tailored resume, cover letter and saved answers, in its own browser window."
          ) : (
            "Write your documents first; the helper uses them."
          )}
        </p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <button
        className="button primary small"
        disabled={state !== "idle" || !job.tailoredResume}
        onClick={async () => {
          setState("busy");
          setError("");
          const { ok, data } = await postJson("/api/automation", { action: "queue", applicationId: job.id });
          if (!ok) {
            setError(data.error || "Couldn’t queue this job.");
            setState("idle");
          } else setState("queued");
        }}
      >
        {state === "busy" ? <LoaderCircle className="spin" aria-hidden /> : state === "queued" ? <Check aria-hidden /> : <ArrowRight aria-hidden />}
        {state === "queued" ? "Queued" : "Fill in this application"}
      </button>
    </section>
  );
}

// Copies a brief for Claude in Chrome and opens the application, so it runs on the person's Claude subscription.
function ChromeCard({ job, d, me }: { job: Application; d: Dossier | null; me: ProfileState | null }) {
  const [copied, setCopied] = useState(false);
  return (
    <section className="card chrome-card" aria-labelledby="chrome-title">
      <div>
        <h3 id="chrome-title">Apply with Claude in Chrome</h3>
        <p className="muted small">
          Copies a brief with your details, answers{job.tailoredResume ? ", tailored resume and cover letter" : " and resume"}, then opens the application. Open
          Claude in Chrome on that page and paste. {job.tailoredResume ? "" : "Write your documents first for a tailored version."}
        </p>
      </div>
      <button
        className="button primary small"
        onClick={async () => {
          await navigator.clipboard.writeText(chromeBrief(job, d, me?.profile || null, me?.answers));
          setCopied(true);
          window.open(job.url, "_blank", "noopener,noreferrer");
          setTimeout(() => setCopied(false), 4000);
        }}
      >
        {copied ? <Check aria-hidden /> : <ClipboardCopy aria-hidden />}
        <span aria-live="polite">{copied ? "Copied — paste into Claude in Chrome" : "Copy brief and open application"}</span>
      </button>
    </section>
  );
}

// The record of an application the helper submitted: when, the confirmation, and every field it filled in.
function SentCard({ job }: { job: Application }) {
  const sub = submissionOf(job)!;
  const when = new Date(sub.submittedAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
  return (
    <section className="card sent-card" aria-labelledby="sent-title">
      <h3 id="sent-title">
        <Check aria-hidden /> Submitted for you · {when}
      </h3>
      {sub.confirmationUrl && (
        <a href={sub.confirmationUrl} target="_blank" rel="noreferrer">
          Employer’s confirmation page <ExternalLink aria-hidden />
          <span className="visually-hidden"> (opens in a new tab)</span>
        </a>
      )}
      {sub.drafted && (
        <p className="small">
          <b>Notes and drafted answers:</b> {sub.drafted}
        </p>
      )}
      <details>
        <summary>Everything it filled in</summary>
        <pre className="sent-fields">{sub.fields}</pre>
      </details>
      <p className="muted small">
        The resume and cover letter it used are in the Documents tab. Screenshots of the form and confirmation are saved on this computer
        in <code>.helper/records</code>.
      </p>
    </section>
  );
}

const BASIS: Record<string, string> = { posting: "From the posted range", company: "From this company’s pay data", market: "From market pay for this role" };

// What to ask for on this job, and why: posted range first, then company data, then the market.
function SalaryCard({ d, job, onChanged, aiEnabled }: { d: Dossier; job: Application; onChanged: () => Promise<void>; aiEnabled: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ask = d.salaryAsk;
  const fmt = (n: number) =>
    `${new Intl.NumberFormat("en-US", { style: "currency", currency: ask?.currency || "USD", maximumFractionDigits: 0 }).format(n)}${ask?.period === "hour" ? " an hour" : " a year"}`;
  async function work() {
    setBusy(true);
    setError("");
    const { ok, data } = await postJson("/api/salary", { id: job.id });
    setBusy(false);
    if (!ok) setError(data.error || "Couldn’t work out a salary.");
    else await onChanged();
  }
  return (
    <Card title="Salary to ask">
      {ask ? (
        <>
          <p className="salary-ask">{fmt(ask.amount)}</p>
          <p className="muted small">
            {BASIS[ask.basis]}. {ask.note}
          </p>
          {ask.sources.length > 0 && (
            <ul className="sources">
              {ask.sources.map((s) => (
                <li key={s.url}>
                  <a href={s.url} target="_blank" rel="noreferrer">
                    {s.title || s.url} <ExternalLink aria-hidden />
                    <span className="visually-hidden"> (opens in a new tab)</span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <p className="muted small">
          {d.salary?.min && d.salary?.max
            ? "The posting lists a pay range. Work out what to ask for at your level."
            : aiEnabled
              ? "No pay range posted. Claude can look up what this company or the market pays for this role (a few cents)."
              : "No pay range posted. Start the helper (your Claude plan) or add an API key to look up market pay."}
        </p>
      )}
      {(d.salary?.min || aiEnabled) && (
        <div className="button-row">
          <button className="button secondary small" onClick={work} disabled={busy}>
            {busy ? <LoaderCircle className="spin" aria-hidden /> : <RotateCw aria-hidden />} {ask ? "Work it out again" : "Work out salary"}
          </button>
        </div>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </Card>
  );
}

const fmtPoints = (n: number) => (Math.round(n * 10) / 10).toString();

// Shows exactly how the match score is worked out, so it never feels arbitrary.
// The match again with the tailored resume and cover letter, next to the original, requirement by requirement.
function DocScoreCard({
  job,
  score,
  onChanged,
  onSeeDocs,
  savedConfirmed,
}: {
  job: Application;
  score: NonNullable<Dossier["docScore"]>;
  onChanged: () => Promise<void>;
  onSeeDocs: () => void;
  savedConfirmed: string[];
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Requirements the person ticks "I've done this" for; the rewrite works them into their real roles.
  const [confirmed, setConfirmed] = useState<string[]>(savedConfirmed);
  const rewritingTask = useTask("documents", job.id);
  const rewriting = rewritingTask?.progress || null;
  const rescoring = useTask("rescore", job.id);
  const changed = JSON.stringify([...confirmed].sort()) !== JSON.stringify([...savedConfirmed].sort());
  async function rewrite() {
    setError("");
    const { ok, data } = await startTask("/api/tailor", { id: job.id, confirmed });
    if (!ok) setError(data.error || "Couldn’t rewrite the documents.");
    else await onChanged();
  }
  const rank: Record<string, number> = { Gap: 0, Partial: 1, Strong: 2 };
  const gain = score.after - score.before;
  const stillMissing = score.items.filter((x) => x.after !== "Strong");
  return (
    <section className="card doc-score" aria-labelledby="doc-score-title">
      <div className="doc-score-head">
        <div>
          <h3 id="doc-score-title">With your tailored documents</h3>
          <p className="muted small">
            Each requirement checked again in your tailored resume, against the same bar as your original score. The cover letter speaks to {score.letterCovers} of {score.total} requirements.
          </p>
        </div>
        <p className="doc-score-numbers" aria-label={`Match went from ${score.before}% to ${score.after}%`}>
          <span className="muted">{score.before}%</span>
          <span aria-hidden>→</span>
          <b>{score.after}%</b>
          {gain !== 0 && <span className={`pill ${gain > 0 ? "strong" : "gap"}`}>{gain > 0 ? `+${gain}` : gain}</span>}
        </p>
      </div>
      {score.stale && (
        <div className="callout warn" role="status">
          You edited the documents since this was checked.{" "}
          <button
            className="text-button inline"
            disabled={busy || Boolean(rescoring)}
            onClick={async () => {
              setBusy(true);
              setError("");
              const { ok, data } = await startTask("/api/tailor", { id: job.id }, "PUT");
              setBusy(false);
              if (!ok) setError(data.error || "Couldn’t check again.");
              else await onChanged();
            }}
          >
            {busy || rescoring ? "Checking…" : "Check again"}
          </button>
        </div>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="table-wrap">
        <table>
          <caption className="visually-hidden">Each requirement in your original resume, your tailored resume and your cover letter</caption>
          <thead>
            <tr>
              <th scope="col">Requirement</th>
              <th scope="col">Original</th>
              <th scope="col">Tailored resume</th>
              <th scope="col">I’ve done this</th>
              <th scope="col">Cover letter</th>
            </tr>
          </thead>
          <tbody>
            {score.items.map((x, i) => {
              const moved = (rank[x.after] ?? 0) - (rank[x.before] ?? 0);
              return (
                <tr key={i}>
                  <th scope="row">
                    {x.requirement}
                    <span className="muted small"> · {x.importance}</span>
                  </th>
                  <td>
                    <span className={`pill ${x.before.toLowerCase()}`}>{VERDICT_LABEL[x.before] || x.before}</span>
                  </td>
                  <td>
                    <span className={`pill ${x.after.toLowerCase()}`}>{VERDICT_LABEL[x.after] || x.after}</span>
                    {moved > 0 && <span className="visually-hidden"> (improved)</span>}
                    {moved < 0 && <span className="small bad-text"> weaker than the original</span>}
                  </td>
                  <td>
                    {(x.after !== "Strong" || confirmed.includes(x.requirement)) && (
                      <label className="check small">
                        <input
                          type="checkbox"
                          checked={confirmed.includes(x.requirement)}
                          onChange={(e) =>
                            setConfirmed((c) => (e.target.checked ? [...c, x.requirement] : c.filter((r) => r !== x.requirement)))
                          }
                        />
                        <span className="visually-hidden">I’ve done this: {x.requirement}</span>
                      </label>
                    )}
                  </td>
                  <td>
                    {x.inLetter ? (
                      <details className="letter-quote">
                        <summary>
                          <Check aria-hidden /> Covered
                        </summary>
                        <q>{x.letterQuote}</q>
                      </details>
                    ) : (
                      <span className="muted small">Not mentioned</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rewriting ? (
        <ProgressView progress={rewriting} title="Rewriting with what you’ve done" />
      ) : (
        (confirmed.length > 0 || changed) && (
          <div className="callout">
            <p>
              {confirmed.length
                ? `Ticked ${confirmed.length}: the rewrite shows each one inside the role where you did it, in general terms, and in the cover letter where it matters. No numbers, tools or names you haven’t given.`
                : "Nothing ticked now; the rewrite will leave those out."}
            </p>
            <div className="button-row">
              <button className="button primary small" disabled={!changed} onClick={rewrite}>
                {changed ? "Rewrite my documents with these" : "Documents include these"}
              </button>
              <button className="text-button inline small" onClick={onSeeDocs}>
                See the documents
              </button>
            </div>
          </div>
        )
      )}
      {stillMissing.length > 0 && (
        <p className="muted small">
          {stillMissing.length} {stillMissing.length === 1 ? "requirement isn’t" : "requirements aren’t"} fully shown yet. Tailoring brings forward
          everything you’ve done that fits, but never invents experience. If you’ve done more than your resume says, tick “I’ve done this”.
        </p>
      )}
    </section>
  );
}

function ScoreBreakdown({ reqs }: { reqs: NonNullable<Dossier["requirements"]> }) {
  const rows = reqs.map((r) => ({ ...r, ...pointsFor({ importance: r.importance || "", verdict: r.verdict || "" }) }));
  const earned = rows.reduce((s, r) => s + r.earned, 0);
  const total = rows.reduce((s, r) => s + r.weight, 0);
  return (
    <details className="card breakdown" open>
      <summary>
        <h3>How the {scoreOf(rows.map((r) => ({ importance: r.importance || "", verdict: r.verdict || "" })))}% is worked out</h3>
      </summary>
      <p className="muted small">
        Each requirement is worth 1.3 points if required, 1 if it’s a core part of the job and 0.6 if preferred. Strong evidence earns
        all of it, partial a little over half, missing none.
      </p>
      <div className="table-wrap">
        <table>
          <caption className="visually-hidden">Score breakdown</caption>
          <thead>
            <tr>
              <th scope="col">Requirement</th>
              <th scope="col">Importance</th>
              <th scope="col">Your resume</th>
              <th scope="col" className="num">
                Points
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id || i}>
                <th scope="row">{r.requirement}</th>
                <td>{r.importance}</td>
                <td>
                  <span className={`pill ${(r.verdict || "").toLowerCase()}`}>{VERDICT_LABEL[r.verdict || ""] || r.verdict}</span>
                </td>
                <td className="num">
                  {fmtPoints(r.earned)} of {fmtPoints(r.weight)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" colSpan={3}>
                Total
              </th>
              <td className="num">
                {fmtPoints(earned)} of {fmtPoints(total)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </details>
  );
}

const ROLE_LABEL: Record<string, string> = { "hiring manager": "Likely hiring manager", recruiter: "Recruiter", peer: "Similar role", leader: "Design leader" };

function channelHref(c: { kind: string; value: string }) {
  if (c.kind === "email") return `mailto:${c.value}`;
  return /^https?:\/\//.test(c.value) ? c.value : `https://${c.value}`;
}

// People at the company and free ways to reach them — no LinkedIn connection or paid InMail needed.
function PeopleCard({ d, job, onChanged, aiEnabled }: { d: Dossier; job: Application; onChanged: () => Promise<void>; aiEnabled: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const found = d.contacts;
  const search = (q: string) => `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(q)}`;
  async function find() {
    setBusy(true);
    setError("");
    const { ok, data } = await postJson("/api/people", { id: job.id });
    setBusy(false);
    if (!ok) setError(data.error || "Couldn’t find people.");
    else await onChanged();
  }
  return (
    <Card title="People worth knowing">
      {found?.people.length ? (
        <>
          {Boolean(found.warnings?.length) && (
            <div className="callout warn" role="status">
              <b>Check the message drafts before sending.</b> These weren’t confirmed by your resume:
              <ul className="list">
                {found.warnings!.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          )}
          {found.emailFormat && (
            <p className="small">
              <b>Work email format:</b> {found.emailFormat}
              {found.emailFormatSource && <span className="muted"> — source: {found.emailFormatSource}</span>}
            </p>
          )}
          <ul className="contacts">
            {found.people.map((p, i) => (
              <li key={i}>
                <div className="contact-head">
                  <b>{p.name}</b>
                  <span className="pill">{ROLE_LABEL[p.role] || p.role}</span>
                </div>
                <span className="muted small">{p.title}</span>
                {p.channels.length > 0 && (
                  <ul className="channels">
                    {p.channels.map((c, j) => (
                      <li key={j}>
                        <a href={channelHref(c)} target={c.kind === "email" ? undefined : "_blank"} rel="noreferrer">
                          {c.label || c.kind}: {c.value}
                          {c.kind !== "email" && <span className="visually-hidden"> (opens in a new tab)</span>}
                        </a>
                        {c.note && <span className="muted small"> — {c.note}</span>}
                      </li>
                    ))}
                  </ul>
                )}
                {p.message && (
                  <details>
                    <summary>Message draft</summary>
                    <p className="draft">{p.message}</p>
                    <CopyButton text={p.message} label={`message to ${p.name}`} />
                  </details>
                )}
                <span className="small links">
                  {!p.channels.some((c) => c.kind === "linkedin") && (
                    <>
                      <a href={search(`${p.name} ${job.company}`)} target="_blank" rel="noreferrer">
                        Search LinkedIn for {p.name}
                      </a>{" "}
                      ·{" "}
                    </>
                  )}
                  {/https?:\/\//.test(p.foundAt) ? (
                    <a className="muted" href={p.foundAt.match(/https?:\/\/[^\s)]+/)![0]} target="_blank" rel="noreferrer">
                      Where this came from<span className="visually-hidden"> (opens in a new tab)</span>
                    </a>
                  ) : (
                    <span className="muted">Found via: {p.foundAt}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="muted small">
          {aiEnabled
            ? "Find the likely hiring manager, the recruiter and people in similar roles — with free ways to reach each of them and a message draft. Free on your Claude plan."
            : "Start the helper (your Claude plan) or add an API key to find people and free ways to reach them. Meanwhile, search LinkedIn:"}
        </p>
      )}
      {!found?.people.length && (
        <p className="small links">
          <a href={search(`${job.company} ${job.role} hiring manager`)} target="_blank" rel="noreferrer">
            Search for the hiring manager
          </a>{" "}
          ·{" "}
          <a href={search(`${job.company} recruiter`)} target="_blank" rel="noreferrer">
            Search for recruiters
          </a>
        </p>
      )}
      {aiEnabled && (
        <div className="button-row">
          <button className="button secondary small" onClick={find} disabled={busy}>
            {busy ? <LoaderCircle className="spin" aria-hidden /> : <RotateCw aria-hidden />} {found ? "Search again" : "Find people"}
          </button>
        </div>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <details className="tips">
        <summary>Free ways to message on LinkedIn without connecting</summary>
        <ul className="list">
          <li>Join a LinkedIn group they’re in — members of the same group can message each other for free.</li>
          <li>People with an “Open Profile” (a Premium setting) accept free messages; look for “Message” instead of “Connect”.</li>
          <li>Follow them and leave a thoughtful comment on a recent post before reaching out — it makes an accepted request far likelier.</li>
          <li>A connection request with a short note (free accounts get a few a month) works best when it mentions the exact role.</li>
        </ul>
      </details>
    </Card>
  );
}
