"use client";
/* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, ArrowUpRight, LoaderCircle, Search, Sparkles, UserRound } from "lucide-react";
import { AutomationPanel } from "./automation-panel";
import { JobSheet } from "./job-sheet";
import { ProfileSheet, ProfileState, ResumeStep, identityOf } from "./profile-panel";
import { SiteHeader } from "./site-header";
import { ProgressView, startTask, useTask, useTaskDone } from "./progress-view";
import { chromeEnabled, setChromeEnabled } from "./claude-in-chrome";
import { OnThePlayhead, Track, TrackEvent, WaitingList, trackHeadline, useToday } from "./track";
import {
  Application,
  STATUS_LABEL,
  STATUSES,
  Status,
  dossierOf,
  isResearching,
  isoToday,
  matchScore,
  postJson,
  shortDate,
  sleep,
} from "./jobs";

const FILTERS = [
  { id: "all", label: "All", match: () => true },
  { id: "saved", label: "Saved", match: (s: Status) => s === "Saved" },
  { id: "active", label: "In progress", match: (s: Status) => ["Applied", "Screen", "Interview", "Final"].includes(s) },
  { id: "offer", label: "Offers", match: (s: Status) => s === "Offer" },
  { id: "closed", label: "Closed", match: (s: Status) => ["Rejected", "Withdrawn"].includes(s) },
] as const;
type FilterId = (typeof FILTERS)[number]["id"];

export default function Home() {
  const [apps, setApps] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [entry, setEntry] = useState("");
  const [jd, setJd] = useState("");
  const [showJd, setShowJd] = useState(false);
  const [applied, setApplied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterId>("all");
  const [autopilotOpen, setAutopilotOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [me, setMe] = useState<ProfileState | null>(null);
  const [claudeInChrome, setClaudeInChrome] = useState(false);
  const [events, setEvents] = useState<TrackEvent[]>([]);
  const today = useToday();

  async function load() {
    const r = await fetch("/api/applications");
    const d = (await r.json()) as { error?: string; applications?: Application[] };
    if (!r.ok) throw new Error(d.error || "Could not load your jobs.");
    setApps(d.applications || []);
    return d.applications || [];
  }

  useEffect(() => {
    setClaudeInChrome(chromeEnabled());
    fetch("/api/network/events")
      .then((r) => r.json() as Promise<{ events?: TrackEvent[] }>)
      .then((d) => setEvents(d.events || []))
      .catch(() => undefined);
    fetch("/api/profile")
      .then((r) => r.json() as Promise<ProfileState>)
      .then(setMe)
      .catch(() => setMe({ profile: null, apiKey: null }));
    load()
      .then((rows) => {
        rows.filter(isResearching).forEach((a) => pollResearch(a.id));
        // Links from the job feed open the job straight away.
        const wanted = new URLSearchParams(window.location.search).get("job");
        if (wanted && rows.some((a) => a.id === wanted)) setSelectedId(wanted);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  async function pollResearch(id: string) {
    for (let i = 0; i < 240; i++) {
      await sleep(i ? 3000 : 500);
      const r = await fetch(`/api/research?id=${id}`);
      const d = (await r.json()) as { error?: string; status?: string };
      if (!r.ok) {
        setError(d.error || "Research failed.");
        await load();
        return;
      }
      if (d.status === "complete" || d.status === "error") {
        const rows = await load();
        const fresh = rows.find((a) => a.id === id);
        if (fresh) setAnnouncement(d.status === "complete" ? `${fresh.role} at ${fresh.company} is ready.` : "Research stopped. Open the job to retry.");
        return;
      }
    }
  }

  // The pasted job is checked in the background; its progress shows here, and the list refreshes when any task finishes.
  // Claude works with an API key, or with the person's own Claude plan while the helper runs.
  const [planReady, setPlanReady] = useState(false);
  useEffect(() => {
    fetch("/api/claude-status")
      .then((r) => r.json() as Promise<{ state?: string }>)
      .then((s) => setPlanReady(s.state === "subscription"))
      .catch(() => undefined);
  }, []);
  const [pendingRef, setPendingRef] = useState("");
  const pending = useTask("check", pendingRef);
  useTaskDone(
    useCallback(() => {
      void load();
    }, []),
  );
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!entry.trim() && !jd.trim()) return;
    setBusy(true);
    setError("");
    setAnnouncement("Reading the job and checking it against your resume…");
    const url = entry.match(/https?:\/\/\S+/)?.[0]?.replace(/[),.]$/, "") || "";
    const ref = url || `paste-${Date.now()}`;
    setPendingRef(ref);
    const { ok, data } = await startTask<{ id?: string }>("/api/research", { entry, url, jobDescription: jd, applied, ref });
    setPendingRef("");
    setBusy(false);
    if (!ok || !data.id) {
      setError(data.error || "Could not read that job. Try pasting the description instead.");
      setShowJd(true);
      return;
    }
    await load();
    setEntry("");
    setJd("");
    setShowJd(false);
    setSelectedId(data.id);
    pollResearch(data.id);
  }

  async function updateStatus(a: Application, status: Status) {
    const appliedAt = status !== "Saved" && a.status === "Saved" ? isoToday() : a.appliedAt;
    setApps((v) => v.map((x) => (x.id === a.id ? { ...x, status, appliedAt } : x)));
    setAnnouncement(`${a.company} moved to ${STATUS_LABEL[status]}.`);
    await postJson("/api/applications", { id: a.id, status, appliedAt }, "PATCH");
  }

  async function removeApplication(a: Application) {
    if (!window.confirm(`Delete ${a.role} at ${a.company}? This can't be undone.`)) return;
    const r = await fetch(`/api/applications?id=${encodeURIComponent(a.id)}`, { method: "DELETE" });
    if (!r.ok) {
      setError("Could not delete that job.");
      return;
    }
    setApps((v) => v.filter((x) => x.id !== a.id));
    setSelectedId(null);
    setAnnouncement(`Deleted ${a.role} at ${a.company}.`);
  }

  const visible = useMemo(() => {
    const rule = FILTERS.find((f) => f.id === filter)!;
    const q = search.trim().toLowerCase();
    return apps.filter((a) => rule.match(a.status) && `${a.company} ${a.role}`.toLowerCase().includes(q));
  }, [apps, filter, search]);

  const counts = useMemo(
    () => Object.fromEntries(FILTERS.map((f) => [f.id, apps.filter((a) => f.match(a.status)).length])) as Record<FilterId, number>,
    [apps],
  );

  const stats = useMemo(
    () => ({
      applied: apps.filter((a) => a.status !== "Saved").length,
      talking: apps.filter((a) => ["Screen", "Interview", "Final", "Offer"].includes(a.status)).length,
      offers: apps.filter((a) => a.status === "Offer").length,
    }),
    [apps],
  );

  const selected = apps.find((a) => a.id === selectedId) || null;

  return (
    <>
      <a className="skip-link" href="#jobs">
        Skip to all your jobs
      </a>
      <SiteHeader current="jobs">
        <button className="button ghost" onClick={() => setAutopilotOpen(true)}>
          <Sparkles aria-hidden /> <span className="label">Autopilot</span>
        </button>
        <button className="button ghost" onClick={() => setProfileOpen(true)} disabled={!me}>
          <UserRound aria-hidden /> <span className="label">{me?.profile?.fullName?.split(" ")[0] || "Profile"}</span>
        </button>
      </SiteHeader>

      <main>
        <section className="container tk-top" aria-labelledby="hero-title">
            <h1 id="hero-title" className="tk-title">
              {loading || !today ? "Loading your track…" : trackHeadline(apps, events, today)}
            </h1>

            {me && !me.profile?.resumeText ? (
              <ResumeStep onSaved={setMe} />
            ) : (
            <>
            {me && !me.apiKey && apps.length > 0 && (
              <p className="hint-line">
                Using the free basic match.{" "}
                <button className="text-button inline" onClick={() => setProfileOpen(true)}>
                  Add an API key
                </button>{" "}
                for a real read of each job (about 1–2¢ each).
              </p>
            )}
            <form className="capture" onSubmit={submit}>
              <label htmlFor="job-input" className="visually-hidden">
                Job link or a short note about the job
              </label>
              <div className="capture-row">
                <input
                  id="job-input"
                  type="text"
                  inputMode="url"
                  autoComplete="off"
                  value={entry}
                  onChange={(e) => setEntry(e.target.value)}
                  placeholder="Paste a job link"
                  aria-describedby="capture-help"
                />
                <button className="button primary large" disabled={busy || (!entry.trim() && !jd.trim())}>
                  {busy ? <LoaderCircle className="spin" aria-hidden /> : <ArrowRight aria-hidden />}
                  {busy ? "Reading…" : "Check my fit"}
                </button>
              </div>
              {pending && <ProgressView progress={pending.progress} title="Checking your fit" />}
              {showJd && (
                <div className="field">
                  <label htmlFor="jd-input">Job description</label>
                  <textarea
                    id="jd-input"
                    value={jd}
                    onChange={(e) => setJd(e.target.value)}
                    rows={6}
                    placeholder="Paste the full job description"
                  />
                </div>
              )}
              <div className="capture-options" id="capture-help">
                <button type="button" className="text-button" aria-expanded={showJd} onClick={() => setShowJd(!showJd)}>
                  {showJd ? "Hide description" : "No link? Paste the description"}
                </button>
                <label className="check">
                  <input type="checkbox" checked={applied} onChange={(e) => setApplied(e.target.checked)} />
                  I’ve already applied
                </label>
              </div>
            </form>
            </>
            )}
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
        </section>

        <div className="container">
          {today && !loading && (
            <>
              <Track apps={apps} events={events} today={today} onOpen={setSelectedId} />
              <section className="tk-below" aria-label="What to do next">
                <OnThePlayhead apps={apps} events={events} today={today} onOpen={setSelectedId} />
                <WaitingList
                  apps={apps}
                  onOpen={setSelectedId}
                  onShowAll={() => {
                    setFilter("saved");
                    document.getElementById("jobs")?.focus();
                    document.getElementById("jobs")?.scrollIntoView({ behavior: "smooth" });
                  }}
                />
              </section>
            </>
          )}
        </div>

        <section id="jobs" className="container jobs" aria-labelledby="jobs-title" tabIndex={-1}>
          <div className="jobs-head">
            <div>
              <h2 id="jobs-title" className="section-title">
                All your jobs
              </h2>
              {apps.length > 0 && (
                <p className="stats">
                  <span>
                    <b>{stats.applied}</b> applied
                  </span>
                  <span>
                    <b>{stats.talking}</b> talking to you
                  </span>
                  <span>
                    <b>{stats.offers}</b> {stats.offers === 1 ? "offer" : "offers"}
                  </span>
                </p>
              )}
            </div>
            {apps.length > 4 && (
              <div className="search">
                <Search aria-hidden />
                <label htmlFor="job-search" className="visually-hidden">
                  Search your jobs
                </label>
                <input
                  id="job-search"
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search"
                />
              </div>
            )}
          </div>

          {apps.length > 0 && (
            <div className="filters" role="group" aria-label="Show jobs">
              {FILTERS.map((f) => (
                <button key={f.id} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
                  {f.label} <span aria-hidden>{counts[f.id]}</span>
                  <span className="visually-hidden">({counts[f.id]} jobs)</span>
                </button>
              ))}
            </div>
          )}

          {loading ? (
            <p className="empty" role="status">
              <LoaderCircle className="spin" aria-hidden /> Loading your jobs…
            </p>
          ) : apps.length === 0 ? (
            <div className="empty-state">
              <p className="display small">Nothing here yet.</p>
              <p>{me?.profile?.resumeText ? "Paste your first job link above." : "Add your resume above, then paste your first job."}</p>
            </div>
          ) : visible.length === 0 ? (
            <p className="empty">No jobs match. Try another filter.</p>
          ) : (
            <ul className="job-list">
              {visible.map((a) => (
                <JobRow key={a.id} job={a} onOpen={() => setSelectedId(a.id)} onStatus={(s) => updateStatus(a, s)} />
              ))}
            </ul>
          )}
        </section>
      </main>

      <footer className="site-footer container">
        <p>Everything runs on your computer. Your data stays with you.</p>
      </footer>

      <p className="visually-hidden" role="status" aria-live="polite">
        {announcement}
      </p>

      <JobSheet
        job={selected}
        onClose={() => setSelectedId(null)}
        onDelete={removeApplication}
        onStatus={updateStatus}
        onChanged={async () => {
          await load();
        }}
        onResearch={pollResearch}
        identity={identityOf(me?.profile || null)}
        aiEnabled={Boolean(me?.apiKey) || planReady}
        me={me}
        claudeInChrome={claudeInChrome}
      />
      <AutomationPanel open={autopilotOpen} onClose={() => setAutopilotOpen(false)} />
      {me && (
        <ProfileSheet
          open={profileOpen}
          onClose={() => setProfileOpen(false)}
          state={me}
          onSaved={setMe}
          claudeInChrome={claudeInChrome}
          onClaudeInChrome={(on) => {
            setChromeEnabled(on);
            setClaudeInChrome(on);
          }}
        />
      )}
    </>
  );
}

function JobRow({ job, onOpen, onStatus }: { job: Application; onOpen: () => void; onStatus: (s: Status) => void }) {
  const original = matchScore(job);
  const d = dossierOf(job);
  const researching = isResearching(job);
  // Once the tailored documents are written, the list shows the match with them (the original resume's score is on hover).
  const withDocs = original !== null && d?.docScore && !d.docScore.stale ? d.docScore.after : null;
  const score = withDocs ?? original;
  const band = score === null ? "none" : score >= 75 ? "high" : score >= 55 ? "mid" : "low";
  return (
    <li className="job-row">
      <span className="monogram" aria-hidden>
        {researching ? <LoaderCircle className="spin" /> : job.company.slice(0, 1).toUpperCase()}
      </span>
      <button className="job-open" onClick={onOpen}>
        <span className="job-role">{job.role}</span>
        <span className="job-meta">
          {job.company}
          {job.location && job.location !== "Not specified" ? ` · ${job.location}` : ""}
          {d?.workArrangement && d.workArrangement !== "Not specified" ? ` · ${d.workArrangement}` : ""}
        </span>
        <span className="job-sub">
          {researching
            ? "Reading the listing…"
            : job.researchStatus === "error"
              ? "Couldn’t read the listing — open to fix"
              : job.status === "Saved"
                ? `Saved ${shortDate(job.createdAt)}`
                : `Applied ${shortDate(job.appliedAt)}`}
        </span>
      </button>
      <span className={`score score-${band}`} title={withDocs !== null ? `With your tailored resume. Your original resume: ${original}%` : undefined}>
        {score === null ? (
          <span className="visually-hidden">No match score yet</span>
        ) : (
          <>
            <b>{score}%</b>
            <span>{withDocs !== null ? "new resume" : "match"}</span>
          </>
        )}
      </span>
      <div className="status-select">
        <label htmlFor={`status-${job.id}`} className="visually-hidden">
          Status for {job.role} at {job.company}
        </label>
        <select id={`status-${job.id}`} value={job.status} onChange={(e) => onStatus(e.target.value as Status)}>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </div>
      <ArrowUpRight className="row-arrow" aria-hidden />
    </li>
  );
}
