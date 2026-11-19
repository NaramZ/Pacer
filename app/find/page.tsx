"use client";
/* eslint-disable react-hooks/set-state-in-effect */
import { FormEvent, KeyboardEvent, useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, Bookmark, Check, ChevronDown, EyeOff, ExternalLink, LoaderCircle, Plus, RotateCw, Trash2, UserRound, X } from "lucide-react";
import Link from "next/link";
import { STATUS_LABEL, postJson, shortDate, type Status } from "../jobs";
import { ProfileSheet, ProfileState } from "../profile-panel";
import { SiteHeader } from "../site-header";
import { JobText } from "../ui";
import { ProgressView, startTask, useTask, useTaskDone, useTasks } from "../progress-view";
import { SUGGESTED } from "./suggested";

type FeedJob = {
  id: string;
  company: string;
  title: string;
  location: string;
  workplace: string;
  url: string;
  salary: string;
  posted_at: string;
  match_score: number;
  status: "new" | "seen" | "added";
  application_id: string;
  first_seen_at: string;
  // Where it is in My jobs: "Saved" means not applied yet.
  app_status: Status | "";
  applied_at: string;
};

type View = { query: string; company: string; workplace: string; posted: string; sort: "match" | "newest" | "company"; hideAdded: boolean };
const DEFAULT_VIEW: View = { query: "", company: "", workplace: "", posted: "", sort: "match", hideAdded: false };
const DAY = 86400000;
const postedTime = (j: FeedJob) => Date.parse(j.posted_at || j.first_seen_at) || 0;

function applyView(jobs: FeedJob[], v: View) {
  const q = v.query.trim().toLowerCase();
  const cutoff = v.posted ? Date.now() - Number(v.posted) * DAY : 0;
  const shown = jobs.filter(
    (j) =>
      (!q || `${j.title} ${j.company} ${j.location}`.toLowerCase().includes(q)) &&
      (!v.company || j.company === v.company) &&
      (!v.workplace || j.workplace === v.workplace) &&
      (!cutoff || postedTime(j) >= cutoff) &&
      (!v.hideAdded || j.status !== "added"),
  );
  const by = {
    match: (a: FeedJob, b: FeedJob) => b.match_score - a.match_score || postedTime(b) - postedTime(a),
    newest: (a: FeedJob, b: FeedJob) => postedTime(b) - postedTime(a),
    company: (a: FeedJob, b: FeedJob) => a.company.localeCompare(b.company) || a.title.localeCompare(b.title),
  }[v.sort];
  return [...shown].sort(by);
}
type Company = { id: string; name: string; ats: string; job_count: number; last_checked_at: string; last_error: string; role_set: string };
type Prefs = { roles: string[]; creativeRoles: string[]; locations: string[]; excludedTerms: string[] };
type Feed = { jobs: FeedJob[]; companies: Company[]; prefs: Prefs };

const ATS: Record<string, string> = {
  greenhouse: "Greenhouse",
  lever: "Lever",
  ashby: "Ashby",
  workday: "Workday",
  workable: "Workable",
  smartrecruiters: "SmartRecruiters",
  bamboohr: "BambooHR",
  recruitee: "Recruitee",
};

export default function FindJobs() {
  const [feed, setFeed] = useState<Feed | null>(null);
  const [me, setMe] = useState<ProfileState | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [view, setView] = useState<View>(DEFAULT_VIEW);

  useEffect(() => {
    fetch("/api/profile")
      .then((r) => r.json() as Promise<ProfileState>)
      .then(setMe)
      .catch(() => setMe({ profile: null, apiKey: null }));
    fetch("/api/feed")
      .then((r) => r.json() as Promise<Feed>)
      .then((d) => {
        setFeed(d);
        // "New" badges show once; the next visit only flags jobs that arrived since.
        if (d.jobs.some((j) => j.status === "new")) postJson("/api/feed", { allSeen: true }, "PATCH");
      })
      .catch(() => setError("Couldn’t load your job feed."));
  }, []);

  async function refresh() {
    setRefreshing(true);
    setError("");
    setAnnouncement("Checking job boards…");
    const { ok, data } = await postJson<Feed & { results: { error?: string }[] }>("/api/feed", {});
    setRefreshing(false);
    if (!ok) {
      setError(data.error || "Couldn’t check the job boards.");
      return;
    }
    setFeed(data);
    const fresh = data.jobs.filter((j) => j.status === "new").length;
    const failed = data.results.filter((r) => r.error).length;
    setAnnouncement(`${fresh ? `${fresh} new ${fresh === 1 ? "job" : "jobs"}.` : "No new jobs."}${failed ? ` ${failed} job board${failed === 1 ? "" : "s"} couldn’t be read.` : ""}`);
    if (fresh) postJson("/api/feed", { allSeen: true }, "PATCH");
  }

  async function savePrefs(prefs: Prefs) {
    setRefreshing(true);
    setError("");
    const { ok, data } = await postJson<Feed>("/api/feed", prefs, "PUT");
    setRefreshing(false);
    if (!ok) {
      setError(data.error || "Couldn’t save.");
      return;
    }
    setFeed(data);
    setAnnouncement(`Updated. ${data.jobs.length} matching ${data.jobs.length === 1 ? "job" : "jobs"}.`);
  }

  // Follows a company and refreshes the feed; used by the link box and the suggestions.
  async function follow(url: string, name?: string): Promise<string | null> {
    const { ok, data } = await postJson<{ companies: Company[]; added: { name: string; total: number; matching: number } }>("/api/companies", { url, name });
    if (!ok) return data.error || "Couldn’t add that company.";
    const fresh = (await (await fetch("/api/feed")).json()) as Feed;
    setFeed((f) => (f ? { ...f, companies: data.companies, jobs: fresh.jobs } : f));
    setAnnouncement(`Following ${data.added.name}. ${data.added.matching} of its ${data.added.total} jobs fit you.`);
    return null;
  }

  async function hide(job: FeedJob) {
    setFeed((f) => f && { ...f, jobs: f.jobs.filter((j) => j.id !== job.id) });
    setAnnouncement(`Hid ${job.title} at ${job.company}.`);
    await postJson("/api/feed", { id: job.id, status: "hidden" }, "PATCH");
  }

  // Checks run in the background, one at a time; the feed refreshes when one finishes, even after leaving and coming back.
  const anyChecking = useTasks().some((t) => t.kind === "check" && t.status === "running");
  const reloadFeed = useCallback(async () => {
    const fresh = (await (await fetch("/api/feed")).json()) as Feed;
    setFeed((f) => (f ? { ...f, jobs: fresh.jobs } : fresh));
  }, []);
  useTaskDone(
    useCallback(
      (t) => {
        if (t.kind === "check") void reloadFeed();
      },
      [reloadFeed],
    ),
  );
  async function check(job: FeedJob) {
    if (anyChecking) return;
    setError("");
    const { ok, data } = await startTask<{ id?: string }>("/api/research", { feedJobId: job.id });
    if (!ok || !data.id) {
      setError(data.error || "Couldn’t check this job.");
      return;
    }
    setAnnouncement(`${job.title} at ${job.company} added to your jobs.`);
  }

  const hasResume = Boolean(me?.profile?.resumeText);
  const shown = useMemo(() => applyView(feed?.jobs || [], view), [feed, view]);
  const companyNames = useMemo(() => [...new Set((feed?.jobs || []).map((j) => j.company))].sort(), [feed]);
  const workplaces = useMemo(() => [...new Set((feed?.jobs || []).map((j) => j.workplace).filter(Boolean))].sort(), [feed]);
  const filtered = JSON.stringify(view) !== JSON.stringify({ ...DEFAULT_VIEW, sort: view.sort });

  const lastChecked = useMemo(() => {
    const times = (feed?.companies || []).map((c) => c.last_checked_at).filter(Boolean).sort();
    return times.length ? times[times.length - 1] : "";
  }, [feed]);

  return (
    <>
      <a className="skip-link" href="#results">
        Skip to jobs
      </a>
      <SiteHeader current="find">
        <button className="button ghost" onClick={() => setProfileOpen(true)} disabled={!me}>
          <UserRound aria-hidden /> <span className="label">{me?.profile?.fullName?.split(" ")[0] || "Profile"}</span>
        </button>
      </SiteHeader>

      <main className="container find">
        <section className="find-hero" aria-labelledby="find-title">
          <p className="kicker">Find jobs · free</p>
          <h1 id="find-title" className="display medium">
            Fresh jobs, <em>straight from the source.</em>
          </h1>
          <p className="lede">
            Follow companies you’d like to work for. We check their job boards and show only the jobs that fit you — no account, no AI,
            no cost.
          </p>
        </section>

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}

        <div className="find-layout">
          <aside className="find-side" aria-label="Search settings">
            <PrefsCard prefs={feed?.prefs} busy={refreshing} onSave={savePrefs} />
            <CompaniesCard
              companies={feed?.companies || []}
              onFollow={follow}
              onChange={(companies, jobs) => setFeed((f) => (f ? { ...f, companies, jobs: jobs ?? f.jobs } : f))}
              onAnnounce={setAnnouncement}
            />
          </aside>

          <section id="results" className="find-results" aria-labelledby="results-title" tabIndex={-1}>
            <div className="results-head">
              <div>
                <h2 id="results-title" className="section-title small">
                  {!feed ? "Jobs" : !feed.companies.length ? "First, follow some companies" : `${feed.jobs.length} ${feed.jobs.length === 1 ? "job fits" : "jobs fit"} you`}
                </h2>
                {lastChecked && <p className="muted small">Last checked {shortDate(lastChecked)}, {new Date(lastChecked).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</p>}
              </div>
              <button className="button secondary" onClick={refresh} disabled={refreshing || !feed?.companies.length}>
                {refreshing ? <LoaderCircle className="spin" aria-hidden /> : <RotateCw aria-hidden />} {refreshing ? "Checking…" : "Check for new jobs"}
              </button>
            </div>

            {!hasResume && me && (
              <p className="callout warn">
                <Link href="/">Add your resume</Link> to see how well you match each job.
              </p>
            )}

            {!feed ? (
              <p className="empty" role="status">
                <LoaderCircle className="spin" aria-hidden /> Loading…
              </p>
            ) : !feed.companies.length ? (
              <div className="state start">
                <p>
                  Jobs come straight from the companies you follow, filtered by what you’re looking for. Tap a few to start, or paste any
                  company’s careers link under “Companies you follow”.
                </p>
                <Suggestions followed={feed.companies} onFollow={follow} />
              </div>
            ) : !feed.jobs.length ? (
              <div className="state">
                <h3>No jobs fit right now</h3>
                <p>
                  None of the {feed.companies.reduce((n, c) => n + c.job_count, 0).toLocaleString()} open jobs at the companies you follow
                  match {feed.prefs.roles.length ? `“${feed.prefs.roles.join("”, “")}”` : "your titles"}
                  {feed.prefs.locations.length ? ` in ${feed.prefs.locations.join(", ")}` : ""}. Try broader titles, more places, or follow
                  more companies.
                </p>
              </div>
            ) : (
              <>
                <Toolbar view={view} onChange={setView} companies={companyNames} workplaces={workplaces} showMatchSort={hasResume} />
                <p className="muted small" role="status">
                  {filtered ? `Showing ${shown.length} of ${feed.jobs.length} jobs` : `${feed.jobs.length} jobs`}
                </p>
                {shown.length ? (
                  <ul className="feed-list">
                    {shown.map((job) => (
                      <FeedRow key={job.id} job={job} showScore={hasResume} locked={anyChecking} onCheck={() => check(job)} onHide={() => hide(job)} />
                    ))}
                  </ul>
                ) : (
                  <div className="state">
                    <h3>No jobs match these filters</h3>
                    <button className="button secondary" onClick={() => setView({ ...DEFAULT_VIEW, sort: view.sort })}>
                      Clear filters
                    </button>
                  </div>
                )}
              </>
            )}
          </section>
        </div>
      </main>

      <p className="visually-hidden" role="status" aria-live="polite">
        {announcement}
      </p>
      {me && <ProfileSheet open={profileOpen} onClose={() => setProfileOpen(false)} state={me} onSaved={setMe} />}
    </>
  );
}

function Toolbar({
  view,
  onChange,
  companies,
  workplaces,
  showMatchSort,
}: {
  view: View;
  onChange: (v: View) => void;
  companies: string[];
  workplaces: string[];
  showMatchSort: boolean;
}) {
  const set = <K extends keyof View>(key: K, value: View[K]) => onChange({ ...view, [key]: value });
  const active = JSON.stringify({ ...view, sort: "match" }) !== JSON.stringify(DEFAULT_VIEW);
  return (
    <div className="toolbar" role="search" aria-label="Filter jobs">
      <div className="toolbar-search">
        <label htmlFor="feed-search" className="visually-hidden">
          Search jobs
        </label>
        <input id="feed-search" type="search" value={view.query} onChange={(e) => set("query", e.target.value)} placeholder="Search title, company or place" />
      </div>
      <Select id="feed-company" label="Company" value={view.company} onChange={(v) => set("company", v)} options={[["", "All companies"], ...companies.map((c) => [c, c] as [string, string])]} />
      <Select
        id="feed-workplace"
        label="Work type"
        value={view.workplace}
        onChange={(v) => set("workplace", v)}
        options={[["", "Any work type"], ...workplaces.map((w) => [w, w] as [string, string])]}
      />
      <Select
        id="feed-posted"
        label="Posted"
        value={view.posted}
        onChange={(v) => set("posted", v)}
        options={[
          ["", "Any time"],
          ["1", "Past day"],
          ["3", "Past 3 days"],
          ["7", "Past week"],
          ["30", "Past month"],
        ]}
      />
      <Select
        id="feed-sort"
        label="Sort by"
        value={view.sort}
        onChange={(v) => set("sort", v as View["sort"])}
        options={[...(showMatchSort ? [["match", "Best match"] as [string, string]] : []), ["newest", "Newest"], ["company", "Company A–Z"]]}
      />
      <label className="check small">
        <input type="checkbox" checked={view.hideAdded} onChange={(e) => set("hideAdded", e.target.checked)} />
        Hide ones in My jobs
      </label>
      {active && (
        <button className="text-button" onClick={() => onChange({ ...DEFAULT_VIEW, sort: view.sort })}>
          Clear filters
        </button>
      )}
    </div>
  );
}

function Select({ id, label, value, onChange, options }: { id: string; label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <div className="status-select toolbar-select">
      <label htmlFor={id} className="visually-hidden">
        {label}
      </label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map(([v, text]) => (
          <option key={v} value={v}>
            {text}
          </option>
        ))}
      </select>
    </div>
  );
}

function FeedRow({
  job,
  showScore,
  locked,
  onCheck,
  onHide,
}: {
  job: FeedJob;
  showScore: boolean;
  locked: boolean;
  onCheck: () => void;
  onHide: () => void;
}) {
  // The free matcher is conservative, so only strong matches get colour; the rest stay neutral rather than alarming.
  const band = job.match_score >= 60 ? "high" : "neutral";
  const task = useTask("check", job.id);
  const checking = Boolean(task);
  const progress = task?.progress || null;
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState<string | null>(null);
  const detailsId = `feed-details-${job.id}`;
  async function toggle() {
    setOpen(!open);
    if (!open && description === null) {
      const r = await fetch(`/api/feed?id=${encodeURIComponent(job.id)}`).catch(() => null);
      const data = r?.ok ? ((await r.json()) as { description: string }) : null;
      setDescription(data?.description || "");
    }
  }
  return (
    <li
      className={`feed-row ${open ? "open" : ""}`}
      // The whole row opens it for mouse users; the title button is the accessible control.
      onClick={(e) => {
        if (!(e.target as HTMLElement).closest("a, button, .feed-details")) toggle();
      }}
    >
      <div className="feed-main">
        <p className="feed-company">
          {job.company}
          {job.status === "new" && <span className="pill q-ready">New</span>}
        </p>
        <h3 className="job-role">
          <button className="feed-toggle" aria-expanded={open} aria-controls={detailsId} onClick={toggle}>
            {job.title}
            <ChevronDown aria-hidden className="chevron" />
          </button>
        </h3>
        <p className="job-meta">{[job.location, job.workplace, job.salary].filter(Boolean).join(" · ")}</p>
        {job.posted_at && <p className="job-sub">Posted {shortDate(job.posted_at)}</p>}
      </div>
      {showScore && (
        <span className={`score score-${band}`}>
          <b>{job.match_score}%</b>
          <span>match</span>
        </span>
      )}
      <div className="feed-actions">
        {job.status === "added" ? (
          job.app_status && job.app_status !== "Saved" ? (
            <Link
              className={`button small ${job.app_status === "Rejected" || job.app_status === "Withdrawn" ? "secondary feed-closed" : "feed-applied"}`}
              href={`/?job=${encodeURIComponent(job.application_id)}`}
              aria-label={`${STATUS_LABEL[job.app_status]}: open ${job.title} in My jobs`}
            >
              {job.app_status === "Rejected" || job.app_status === "Withdrawn" ? <X aria-hidden /> : <Check aria-hidden />}{" "}
              {job.app_status === "Applied" && job.applied_at ? `Applied ${shortDate(job.applied_at)}` : STATUS_LABEL[job.app_status]}
            </Link>
          ) : (
            <Link className="button secondary small" href={`/?job=${encodeURIComponent(job.application_id)}`} aria-label={`Saved, not applied yet: open ${job.title} in My jobs`}>
              <Bookmark aria-hidden /> Saved · not applied
            </Link>
          )
        ) : (
          <button className="button primary small" onClick={onCheck} disabled={locked}>
            {checking ? <LoaderCircle className="spin" aria-hidden /> : <ArrowRight aria-hidden />} {checking ? "Checking…" : "Check my fit"}
            <span className="visually-hidden">
              {" "}
              for {job.title} at {job.company}
            </span>
          </button>
        )}
        <a className="icon-button" href={job.url} target="_blank" rel="noopener noreferrer" aria-label={`Open the ${job.title} posting at ${job.company} (new tab)`}>
          <ExternalLink aria-hidden />
        </a>
        {job.status !== "added" && (
          <button className="icon-button" onClick={onHide} aria-label={`Hide ${job.title} at ${job.company}`}>
            <EyeOff aria-hidden />
          </button>
        )}
      </div>
      {progress && (
        <div className="feed-details">
          <ProgressView progress={progress} title={`Checking your fit for ${job.title}`} />
        </div>
      )}
      {open && (
        <div className="feed-details" id={detailsId}>
          <a className="button secondary small" href={job.url} target="_blank" rel="noopener noreferrer">
            View job posting <ExternalLink aria-hidden />
            <span className="visually-hidden"> (opens in a new tab)</span>
          </a>
          {description === null ? (
            <p className="muted small">
              <LoaderCircle className="spin" aria-hidden /> Loading the description…
            </p>
          ) : description ? (
            <JobText text={description} />
          ) : (
            <p className="muted small">No description saved for this job. Open the posting to read it.</p>
          )}
        </div>
      )}
    </li>
  );
}

function PrefsCard({ prefs, busy, onSave }: { prefs?: Prefs; busy: boolean; onSave: (p: Prefs) => void }) {
  const [draft, setDraft] = useState<Prefs>({ roles: [], creativeRoles: [], locations: [], excludedTerms: [] });
  useEffect(() => {
    if (prefs) setDraft(prefs);
  }, [prefs]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(prefs);
  return (
    <section className="card" aria-labelledby="prefs-title">
      <h2 id="prefs-title" className="card-title">
        What you’re looking for
      </h2>
      <TagInput id="pref-roles" label="Job titles" placeholder="e.g. Registered Nurse" values={draft.roles} onChange={(roles) => setDraft({ ...draft, roles })} />
      <TagInput
        id="pref-creative"
        label="Creative titles (only where marked below)"
        placeholder="e.g. Graphic Designer"
        values={draft.creativeRoles || []}
        onChange={(creativeRoles) => setDraft({ ...draft, creativeRoles })}
      />
      <TagInput id="pref-places" label="Places" placeholder="e.g. Pittsburgh or Remote" values={draft.locations} onChange={(locations) => setDraft({ ...draft, locations })} />
      <TagInput id="pref-skip" label="Skip jobs mentioning" placeholder="e.g. commission only" values={draft.excludedTerms} onChange={(excludedTerms) => setDraft({ ...draft, excludedTerms })} />
      <p className="muted small">Leave titles or places empty to see everything.</p>
      <button className="button primary" onClick={() => onSave(draft)} disabled={busy || !dirty}>
        {busy && <LoaderCircle className="spin" aria-hidden />} Save and update
      </button>
    </section>
  );
}

function TagInput({ id, label, placeholder, values, onChange }: { id: string; label: string; placeholder: string; values: string[]; onChange: (v: string[]) => void }) {
  const [text, setText] = useState("");
  function add() {
    const items = text.split(",").map((x) => x.trim()).filter(Boolean);
    if (!items.length) return;
    onChange([...new Set([...values, ...items])]);
    setText("");
  }
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {values.length > 0 && (
        <ul className="tags" aria-label={`${label} added`}>
          {values.map((v) => (
            <li key={v}>
              {v}
              <button type="button" onClick={() => onChange(values.filter((x) => x !== v))} aria-label={`Remove ${v}`}>
                <X aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="tag-entry">
        <input
          id={id}
          value={text}
          placeholder={placeholder}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e: KeyboardEvent) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
        />
        <button type="button" className="icon-button" onClick={add} disabled={!text.trim()} aria-label={`Add to ${label.toLowerCase()}`}>
          <Plus aria-hidden />
        </button>
      </div>
    </div>
  );
}

function CompaniesCard({
  companies,
  onFollow,
  onChange,
  onAnnounce,
}: {
  companies: Company[];
  onFollow: (url: string, name?: string) => Promise<string | null>;
  onChange: (companies: Company[], jobs?: FeedJob[]) => void;
  onAnnounce: (s: string) => void;
}) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    setBusy(true);
    setError("");
    const problem = await onFollow(url);
    setBusy(false);
    if (problem) setError(problem);
    else setUrl("");
  }

  // "Creative titles" and "Any place" are per-company options (ski resorts, universities, health systems).
  async function setFlag(c: Company, flag: "creative" | "anywhere", on: boolean) {
    onAnnounce(`Updating ${c.name}…`);
    const r = await fetch("/api/companies", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: c.id, [flag]: on }) });
    if (!r.ok) return onAnnounce(`Couldn’t update ${c.name}.`);
    const d = (await r.json()) as { companies: Company[] };
    const feed = (await (await fetch("/api/feed")).json()) as Feed;
    onChange(d.companies, feed.jobs);
    onAnnounce(`Updated ${c.name}.`);
  }

  async function remove(c: Company) {
    if (!window.confirm(`Stop following ${c.name}?`)) return;
    const r = await fetch(`/api/companies?id=${encodeURIComponent(c.id)}`, { method: "DELETE" });
    const d = (await r.json()) as { companies: Company[] };
    const feed = (await (await fetch("/api/feed")).json()) as Feed;
    onChange(d.companies, feed.jobs);
    onAnnounce(`Stopped following ${c.name}.`);
  }

  return (
    <section className="card" aria-labelledby="companies-title">
      <h2 id="companies-title" className="card-title">
        Companies you follow
      </h2>
      <form className="field" onSubmit={add}>
        <label htmlFor="company-url">Add a company</label>
        <div className="tag-entry">
          <input
            id="company-url"
            type="text"
            inputMode="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Careers page link"
            aria-describedby="company-help"
          />
          <button className="icon-button" disabled={busy || !url.trim()} aria-label="Follow this company">
            {busy ? <LoaderCircle className="spin" aria-hidden /> : <Plus aria-hidden />}
          </button>
        </div>
        <p className="muted small" id="company-help">
          Works with companies that post jobs on Greenhouse, Lever, Ashby, Workday, Workable, SmartRecruiters, BambooHR or Recruitee — a careers page, job board or any job posting link.
        </p>
      </form>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {companies.length > 0 && (
        <details className="suggest-more">
          <summary>Suggested companies</summary>
          <Suggestions followed={companies} onFollow={onFollow} />
        </details>
      )}
      {companies.length > 0 && (
        <ul className="companies">
          {companies.map((c) => (
            <li key={c.id}>
              <div>
                <b>{c.name}</b>
                <span className={`small ${c.last_error ? "error-text" : "muted"}`}>
                  {c.last_error || `${c.job_count} open jobs · ${ATS[c.ats] || c.ats}`}
                </span>
                <span className="small muted">
                  <label>
                    <input type="checkbox" checked={(c.role_set || "").split(",").includes("creative")} onChange={(e) => setFlag(c, "creative", e.target.checked)} /> Creative titles
                  </label>{" "}
                  <label>
                    <input type="checkbox" checked={(c.role_set || "").split(",").includes("anywhere")} onChange={(e) => setFlag(c, "anywhere", e.target.checked)} /> Any place
                  </label>
                </span>
              </div>
              <button className="icon-button small" onClick={() => remove(c)} aria-label={`Stop following ${c.name}`}>
                <Trash2 aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Suggestions({ followed, onFollow }: { followed: Company[]; onFollow: (url: string, name?: string) => Promise<string | null> }) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const following = new Set(followed.map((c) => c.name.toLowerCase()));
  return (
    <div className="suggestions">
      {SUGGESTED.map((g) => {
        const left = g.companies.filter((c) => !following.has(c.name.toLowerCase()));
        return (
        <section key={g.group} aria-label={g.group}>
          <div className="suggestion-head">
            <h3 className="kicker">{g.group}</h3>
            {left.length > 1 && (
              <button
                className="text-button"
                disabled={busy !== ""}
                onClick={async () => {
                  setError("");
                  const problems: string[] = [];
                  // One at a time, so each job board is only read once and the list fills in as it goes.
                  for (const c of left) {
                    setBusy(c.name);
                    const problem = await onFollow(c.url, c.name);
                    if (problem) problems.push(`${c.name}: ${problem}`);
                  }
                  setBusy("");
                  if (problems.length) setError(problems.join(" "));
                }}
              >
                Follow all {left.length}
              </button>
            )}
          </div>
          <ul className="chips">
            {g.companies.map((c) => {
              const on = following.has(c.name.toLowerCase());
              return (
                <li key={c.name}>
                  <button
                    className={`chip ${on ? "on" : ""}`}
                    disabled={on || busy !== ""}
                    aria-label={on ? `Following ${c.name}` : `Follow ${c.name}`}
                    onClick={async () => {
                      setBusy(c.name);
                      setError("");
                      const problem = await onFollow(c.url, c.name);
                      setBusy("");
                      if (problem) setError(`${c.name}: ${problem}`);
                    }}
                  >
                    {busy === c.name ? <LoaderCircle className="spin" aria-hidden /> : on ? <Check aria-hidden /> : <Plus aria-hidden />}
                    {c.name}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
        );
      })}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
