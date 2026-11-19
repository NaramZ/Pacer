"use client";
/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowRight, ArrowUp, Download, LoaderCircle, Plus, Save, Sparkles, Trash2, X } from "lucide-react";
import { SiteHeader } from "../site-header";
import { postJson } from "../jobs";
import { startTask } from "../progress-view";
import { parseResume, serializeResume, splitHeading, type Resume, type Section } from "./model";
import { atsChecks, localKeywords, matchPercent, statusOf, voiceHits, withEquivalents, wordCount, type KeywordItem } from "./checks";
import { ACCENTS, DEFAULT_LOOK, PAGE, TEMPLATES, type Look } from "./templates";
import "./resume.css";

type Source = { id: string; label: string };
type Flag = { quote: string; why: string; plainer: string };

const PAD = 52.8; // 0.55in, the margin used on screen and in print
const NEW_SECTIONS: Record<string, Section> = {
  SUMMARY: { title: "SUMMARY", paragraphs: ["Two or three lines on who you are and what you do best."], entries: [] },
  "WORK EXPERIENCE": { title: "WORK EXPERIENCE", paragraphs: [], entries: [{ heading: "Job Title · Company | Mon YYYY - Present | City, ST", bullets: ["What you did and what came of it."] }] },
  PROJECTS: { title: "PROJECTS", paragraphs: [], entries: [{ heading: "Project name · Your role", bullets: ["What you made and what came of it."] }] },
  EDUCATION: { title: "EDUCATION", paragraphs: [], entries: [{ heading: "Degree | School | Year", bullets: [] }] },
  SKILLS: { title: "SKILLS", paragraphs: [], entries: [{ heading: "", bullets: ["Design: Figma, Prototyping"] }] },
  CERTIFICATIONS: { title: "CERTIFICATIONS", paragraphs: [], entries: [{ heading: "", bullets: ["Certification name"] }] },
  LANGUAGES: { title: "LANGUAGES", paragraphs: [], entries: [{ heading: "", bullets: ["English (Native)"] }] },
};

async function getJson<T>(url: string): Promise<T | null> {
  try {
    return (await (await fetch(url)).json()) as T;
  } catch {
    return null;
  }
}

function store(key: string, value?: string): string | null {
  try {
    if (value === undefined) return window.localStorage.getItem(key);
    if (value === "") window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* private window or blocked storage: the editor still works */
  }
  return null;
}

function Grow({ value, onChange, className = "re-text", label }: { value: string; onChange: (v: string) => void; className?: string; label: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  // Grows with the text, and re-measures when the column's width changes the wrapping.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let width = 0;
    const fit = () => {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight + 2}px`;
      width = el.clientWidth;
    };
    fit();
    const ro = new ResizeObserver(() => el.clientWidth !== width && fit());
    ro.observe(el);
    return () => ro.disconnect();
  }, [value]);
  return <textarea ref={ref} rows={1} className={className} value={value} aria-label={label} onChange={(e) => onChange(e.target.value)} />;
}

type AppList = { id: string; company: string; role: string; tailoredResume?: string }[];
function sourcesFrom(apps: AppList | { applications?: AppList } | null): Source[] {
  const list = (Array.isArray(apps) ? apps : apps?.applications) || [];
  return [{ id: "base", label: "My resume (every job starts from this one)" }, ...list.filter((a) => a.tailoredResume).map((a) => ({ id: a.id, label: `${a.company} · ${a.role}` }))];
}

export default function ResumeEditor() {
  const [baseText, setBaseText] = useState("");
  const [sources, setSources] = useState<Source[]>([{ id: "base", label: "My resume (every job starts from this one)" }]);
  const [sourceId, setSourceId] = useState("base");
  const [resume, setResume] = useState<Resume>({ name: "", contact: "", sections: [] });
  const [savedText, setSavedText] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [tab, setTab] = useState<"sections" | "text">("sections");
  const [raw, setRaw] = useState("");
  const [look, setLook] = useState<Look>(DEFAULT_LOOK);
  const [zoom, setZoom] = useState<"fit" | "100">("fit");
  const [scale, setScale] = useState(1);
  const [paperHeight, setPaperHeight] = useState(PAGE.height);
  const [flags, setFlags] = useState<Flag[] | null>(null);
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState("");
  const [jd, setJd] = useState("");
  const [claudeItems, setClaudeItems] = useState<KeywordItem[] | null>(null);
  const [matching, setMatching] = useState(false);
  const [matchError, setMatchError] = useState("");
  const [tailoring, setTailoring] = useState("");
  const [tailorError, setTailorError] = useState("");
  // What the tailoring pipeline reported for the job being edited: its match, the 87% target, and the skills it added.
  const [docInfo, setDocInfo] = useState<{ after: number; target: number; met: boolean; short: string[]; assumed: string[] } | null>(null);
  const [restored, setRestored] = useState(false);
  const coverLetter = useRef("");
  const stage = useRef<HTMLDivElement>(null);
  const paper = useRef<HTMLElement>(null);

  const text = useMemo(() => serializeResume(resume), [resume]);
  const dirty = text !== savedText;

  /* ---------- Loading ---------- */

  useEffect(() => {
    const saved = store("resume-editor:look");
    if (saved) {
      try {
        setLook({ ...DEFAULT_LOOK, ...(JSON.parse(saved) as Partial<Look>) });
      } catch {
        /* ignore a damaged saved look */
      }
    }
    (async () => {
      const [profile, apps] = await Promise.all([
        getJson<{ profile?: { resumeText?: string } }>("/api/profile"),
        getJson<{ id: string; company: string; role: string; tailoredResume?: string }[] | { applications?: { id: string; company: string; role: string; tailoredResume?: string }[] }>("/api/applications"),
      ]);
      const base = String(profile?.profile?.resumeText || "");
      setBaseText(base);
      setSources(sourcesFrom(apps));
      loadSource("base", base);
    })();
  }, []);

  function loadSource(id: string, base: string) {
    setLoading(true);
    setFlags(null);
    setReadError("");
    setMessage("");
    (async () => {
      let source = base;
      let posting = "";
      if (id !== "base") {
        const r = await getJson<{ resume?: string; coverLetter?: string }>(`/api/tailor?id=${encodeURIComponent(id)}`);
        source = String(r?.resume || "");
        coverLetter.current = String(r?.coverLetter || "");
        const d = await getJson<{ dossier?: { jobDescription?: string; docScore?: { after: number }; docTarget?: { target: number; met: boolean; short: string[] }; assumed?: string[] } }>(`/api/research?id=${encodeURIComponent(id)}`);
        posting = String(d?.dossier?.jobDescription || "");
        const dossier = d?.dossier;
        setDocInfo(dossier?.docScore ? { after: dossier.docScore.after, target: dossier.docTarget?.target ?? 87, met: dossier.docTarget?.met ?? dossier.docScore.after >= 87, short: dossier.docTarget?.short || [], assumed: dossier.assumed || [] } : null);
      } else {
        setDocInfo(null);
      }
      // A pasted description is remembered for each resume; a saved job's own description fills it in the first time.
      setJd(store(`resume-editor:jd:${id}`) ?? posting);
      setClaudeItems(null);
      setMatchError("");
      const clean = serializeResume(parseResume(source));
      const draft = store(`resume-editor:draft:${id}`);
      const useDraft = Boolean(draft && draft !== clean);
      const start = useDraft ? (draft as string) : clean;
      setSavedText(clean);
      setRestored(useDraft);
      const parsed = parseResume(start);
      setResume(parsed);
      setRaw(serializeResume(parsed));
      setLoading(false);
    })();
  }

  // Unsaved edits survive a reload.
  useEffect(() => {
    if (loading) return;
    store(`resume-editor:draft:${sourceId}`, dirty ? text : "");
  }, [text, dirty, sourceId, loading]);

  useEffect(() => {
    store("resume-editor:look", JSON.stringify(look));
  }, [look]);

  /* ---------- Fitting the page to the window ---------- */

  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const fit = () => setScale(zoom === "100" ? 1 : Math.min(1, Math.max(0.35, (el.clientWidth - 40) / PAGE.width)));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [zoom]);

  useEffect(() => {
    const el = paper.current;
    if (!el) return;
    const measure = () => setPaperHeight(el.offsetHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [loading]);

  const contentH = PAGE.height - PAD * 2;
  const pages = Math.max(1, Math.ceil((paperHeight - PAD * 2) / contentH - 0.02));

  /* ---------- Editing ---------- */

  const edit = (fn: (draft: Resume) => void) =>
    setResume((r) => {
      const next = structuredClone(r);
      fn(next);
      return next;
    });

  const move = <T,>(list: T[], from: number, to: number) => {
    if (to < 0 || to >= list.length) return;
    const [item] = list.splice(from, 1);
    list.splice(to, 0, item);
  };

  async function save() {
    setSaving(true);
    setMessage("");
    const clean = serializeResume(resume);
    const { ok, data } =
      sourceId === "base" ? await postJson<{ error?: string }>("/api/profile", { resumeText: clean }, "PUT") : await postJson<{ error?: string }>("/api/tailor", { id: sourceId, resume: clean, coverLetter: coverLetter.current }, "PATCH");
    setSaving(false);
    if (!ok) return setMessage(data.error || "Couldn’t save. Try again.");
    setSavedText(clean);
    if (sourceId === "base") setBaseText(clean);
    store(`resume-editor:draft:${sourceId}`, "");
    setRestored(false);
    setMessage(sourceId === "base" ? "Saved. New tailored resumes will start from this." : "Saved to this job.");
  }

  // Throws away the unsaved edits (and the draft kept for them) and shows the saved resume again.
  function discard() {
    store(`resume-editor:draft:${sourceId}`, "");
    loadSource(sourceId, baseText);
  }

  function print() {
    const before = document.title;
    document.title = `${resume.name || "Resume"} Resume`.trim();
    window.print();
    setTimeout(() => (document.title = before), 500);
  }

  async function readLikeARecruiter() {
    setReading(true);
    setReadError("");
    const r = await fetch("/api/resume/review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resume: text, original: sourceId === "base" ? "" : baseText }),
    });
    const d = (await r.json().catch(() => ({}))) as { flags?: Flag[]; error?: string };
    setReading(false);
    if (!r.ok) return setReadError(d.error || "Couldn’t read the resume.");
    setFlags(d.flags || []);
  }

  // The same pipeline as a saved job: read the posting, then write the resume and cover letter with the standing skills,
  // 3 to 4 bullets, human voice and the 87% target. The result is saved to My jobs and opened here to edit.
  async function tailorToJob() {
    if (dirty && !window.confirm("Your unsaved edits aren't included: the tailored resume starts from your saved base resume. Continue?")) return;
    setTailorError("");
    const status = await getJson<{ state?: string }>("/api/claude-status");
    if (!status || status.state === "fallback-free") return setTailorError("Tailoring needs your Claude plan (start the helper) or an API key.");
    setTailoring("Reading the job…");
    const read = await startTask<{ id?: string }>("/api/research", { entry: "", url: "", jobDescription: jd, applied: false, ref: `paste-${Date.now()}` });
    if (!read.ok || !read.data.id) {
      setTailoring("");
      return setTailorError(read.data.error || "Couldn’t read that job description.");
    }
    setTailoring("Writing your resume…");
    const wrote = await startTask<{ status?: string }>("/api/tailor", { id: read.data.id });
    if (!wrote.ok) {
      setTailoring("");
      return setTailorError(wrote.data.error || "Couldn’t write the resume.");
    }
    const id = read.data.id;
    store(`resume-editor:jd:${id}`, "");
    setSources(sourcesFrom(await getJson<AppList>("/api/applications")));
    setSourceId(id);
    loadSource(id, baseText);
    setTailoring("");
    setMessage("Tailored and saved to My jobs. Edit it here, then Save.");
  }

  function changeJd(value: string) {
    setJd(value);
    setClaudeItems(null);
    store(`resume-editor:jd:${sourceId}`, value);
  }

  // Claude reads the posting by meaning: what it really asks for, and which other words count as the same thing.
  async function sharpenKeywords() {
    setMatching(true);
    setMatchError("");
    const r = await fetch("/api/resume/keywords", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobDescription: jd }) });
    const d = (await r.json().catch(() => ({}))) as { keywords?: KeywordItem[]; error?: string };
    setMatching(false);
    if (!r.ok || !d.keywords) return setMatchError(d.error || "Couldn’t read the job description.");
    setClaudeItems(withEquivalents(d.keywords));
  }

  function applyFlag(f: Flag) {
    if (text.includes(f.quote)) setResume(parseResume(text.replace(f.quote, f.plainer)));
    setFlags((list) => (list || []).filter((x) => x !== f));
  }

  /* ---------- Checks ---------- */

  const ats = useMemo(() => atsChecks(resume, pages), [resume, pages]);
  const voice = useMemo(() => voiceHits(resume), [resume]);
  const keywordItems = useMemo(() => claudeItems ?? localKeywords(jd), [claudeItems, jd]);
  const matchStatuses = useMemo(() => keywordItems.map((k) => statusOf(k, text)), [keywordItems, text]);
  const matchScore = useMemo(() => matchPercent(keywordItems, text), [keywordItems, text]);
  const missingMust = keywordItems.filter((k, i) => k.importance === "must" && matchStatuses[i] === "missing").map((k) => k.term);
  const flaggedWords = voice.map((v) => v.quote.toLowerCase()).filter((q) => q.length > 1 && q !== "—");
  const bulletFlagged = (b: string) => flaggedWords.some((w) => b.toLowerCase().includes(w)) || b.includes("—");
  const words = wordCount(resume);

  const pageStyle = { "--accent": look.accent } as React.CSSProperties;

  return (
    <>
      <SiteHeader current="resume" />
      <div className="re-page">
        <div className="re-bar">
          <h1>Resume editor</h1>
          <label className="visually-hidden" htmlFor="re-source">
            Which resume
          </label>
          <select
            id="re-source"
            value={sourceId}
            onChange={(e) => {
              setSourceId(e.target.value);
              loadSource(e.target.value, baseText);
            }}
          >
            {sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
          <span className={`re-state ${dirty ? "dirty" : ""}`} role="status">
            {message || (dirty ? "Unsaved changes" : restored ? "" : "All changes saved")}
            {restored && dirty && " (restored your unsaved edits)"}
          </span>
          <span className="grow" />
          {dirty && (
            <button className="button" onClick={discard} disabled={loading || saving}>
              <X aria-hidden /> Discard changes
            </button>
          )}
          <button className="button primary" onClick={save} disabled={saving || loading || !dirty}>
            {saving ? <LoaderCircle className="spin" aria-hidden /> : <Save aria-hidden />} Save
          </button>
          <button className="button" onClick={print} disabled={loading}>
            <Download aria-hidden /> Download PDF
          </button>
        </div>

        <div className="re-shell">
          {/* ---------- Edit ---------- */}
          <div className="re-col re-edit">
            <div className="re-tabs" role="tablist" aria-label="How to edit">
              <button role="tab" aria-selected={tab === "sections"} onClick={() => setTab("sections")}>
                Sections
              </button>
              <button
                role="tab"
                aria-selected={tab === "text"}
                onClick={() => {
                  setRaw(text);
                  setTab("text");
                }}
              >
                Plain text
              </button>
            </div>

            {loading ? (
              <p className="re-note">
                <LoaderCircle className="spin" aria-hidden /> Loading…
              </p>
            ) : tab === "text" ? (
              <div className="re-field">
                <label htmlFor="re-raw">Resume text</label>
                <textarea
                  id="re-raw"
                  className="re-text re-raw"
                  value={raw}
                  spellCheck
                  onChange={(e) => {
                    setRaw(e.target.value);
                    setResume(parseResume(e.target.value));
                  }}
                />
                <p className="re-note">Headings in capitals, roles as “Title · Company | Dates | Place”, bullets starting with “• ”.</p>
              </div>
            ) : (
              <>
                <div className="re-field">
                  <label htmlFor="re-name">Name</label>
                  <input id="re-name" className="re-input" value={resume.name} onChange={(e) => edit((r) => void (r.name = e.target.value))} />
                </div>
                <div className="re-field">
                  <label htmlFor="re-contact">Headline and contact line</label>
                  <Grow value={resume.contact} label="Headline and contact line" onChange={(v) => edit((r) => void (r.contact = v.replace(/\n/g, " ")))} />
                  <p className="re-note">Keep it on one line, parts separated by “ | ”.</p>
                </div>

                {resume.sections.map((s, si) => (
                  <section className="re-sec" key={si} aria-label={s.title}>
                    <div className="re-sec-head">
                      <input className="re-input" value={s.title} aria-label="Section heading" onChange={(e) => edit((r) => void (r.sections[si].title = e.target.value.toUpperCase()))} />
                      <button className="re-icon" aria-label="Move section up" disabled={si === 0} onClick={() => edit((r) => move(r.sections, si, si - 1))}>
                        <ArrowUp />
                      </button>
                      <button className="re-icon" aria-label="Move section down" disabled={si === resume.sections.length - 1} onClick={() => edit((r) => move(r.sections, si, si + 1))}>
                        <ArrowDown />
                      </button>
                      <button className="re-icon" aria-label={`Delete ${s.title}`} onClick={() => window.confirm(`Delete the ${s.title} section?`) && edit((r) => void r.sections.splice(si, 1))}>
                        <Trash2 />
                      </button>
                    </div>

                    {(s.paragraphs.length > 0 || s.entries.length === 0) && (
                      <Grow value={s.paragraphs.join("\n")} label={`${s.title} text`} onChange={(v) => edit((r) => void (r.sections[si].paragraphs = v.split("\n")))} />
                    )}

                    {s.entries.map((e, ei) => (
                      <div className="re-entry" key={ei}>
                        {e.heading !== "" && (
                          <div className="re-bullet">
                            <Grow value={e.heading} label="Role, project or school line" className="re-text" onChange={(v) => edit((r) => void (r.sections[si].entries[ei].heading = v.replace(/\n/g, " ")))} />
                            <button className="re-icon" aria-label="Delete this entry" onClick={() => edit((r) => void r.sections[si].entries.splice(ei, 1))}>
                              <Trash2 />
                            </button>
                          </div>
                        )}
                        {e.bullets.map((b, bi) => (
                          <div className={`re-bullet ${bulletFlagged(b) ? "flag" : ""}`} key={bi}>
                            <Grow value={b} label={`Bullet ${bi + 1}`} onChange={(v) => edit((r) => void (r.sections[si].entries[ei].bullets[bi] = v.replace(/\n/g, " ")))} />
                            <button className="re-icon" aria-label="Delete this bullet" onClick={() => edit((r) => void r.sections[si].entries[ei].bullets.splice(bi, 1))}>
                              <X />
                            </button>
                          </div>
                        ))}
                        <button className="re-add" onClick={() => edit((r) => void r.sections[si].entries[ei].bullets.push(""))}>
                          <Plus aria-hidden /> Add a bullet
                        </button>
                      </div>
                    ))}
                    {s.entries.some((e) => e.heading) && (
                      <button className="re-add" onClick={() => edit((r) => void r.sections[si].entries.push({ heading: "Title · Company | Mon YYYY - Mon YYYY | City, ST", bullets: [""] }))}>
                        <Plus aria-hidden /> Add a role or entry
                      </button>
                    )}
                  </section>
                ))}

                <div className="re-label" style={{ marginBottom: 6 }}>
                  Add a section
                </div>
                <div className="re-addbar">
                  {Object.keys(NEW_SECTIONS)
                    .filter((k) => !resume.sections.some((s) => s.title === k))
                    .map((k) => (
                      <button key={k} className="re-add" onClick={() => edit((r) => void r.sections.push(structuredClone(NEW_SECTIONS[k])))}>
                        <Plus aria-hidden /> {k[0] + k.slice(1).toLowerCase()}
                      </button>
                    ))}
                </div>
              </>
            )}
          </div>

          {/* ---------- Page ---------- */}
          <div className="re-stage" ref={stage}>
            <div className="re-zoom">
              <span>
                {pages} {pages === 1 ? "page" : "pages"} · {words} words
              </span>
              <button aria-pressed={zoom === "fit"} onClick={() => setZoom("fit")}>
                Fit
              </button>
              <button aria-pressed={zoom === "100"} onClick={() => setZoom("100")}>
                100%
              </button>
            </div>
            <div style={{ width: PAGE.width * scale, height: Math.max(PAGE.height, paperHeight) * scale, flex: "none" }}>
              <div className="re-sheet" style={{ zoom: scale }}>
                <article ref={paper} className={`re-paper rt-${look.template} sz-${look.size} sp-${look.spacing}`} style={pageStyle} aria-label="Resume preview">
                  <header className="rp-head">
                    <h1>{resume.name}</h1>
                    {resume.contact && <p className="rp-contact">{resume.contact}</p>}
                  </header>
                  {resume.sections.map((s, si) => (
                    <section className="rp-section" key={si}>
                      <h2>{s.title}</h2>
                      {s.paragraphs.filter((p) => p.trim()).map((p, i) => (
                        <p className="rp-p" key={i}>
                          {p}
                        </p>
                      ))}
                      {s.entries.map((e, ei) => {
                        const h = e.heading ? splitHeading(e.heading) : null;
                        return (
                          <div className="rp-entry" key={ei}>
                            {h && (
                              <div className="rp-role">
                                <div className="rp-role-main">
                                  {h.title}
                                  {h.company && <span> | {h.company}</span>}
                                </div>
                                {(h.dates || h.rest) && <div className="rp-role-meta">{[h.dates, h.rest].filter(Boolean).join(" | ")}</div>}
                              </div>
                            )}
                            {e.bullets.length > 0 && (
                              <ul>
                                {e.bullets.map((b, bi) => {
                                  const label = b.match(/^([^:]{2,32}):\s+(.+)$/);
                                  return <li key={bi}>{label ? (<><b>{label[1]}:</b> {label[2]}</>) : b}</li>;
                                })}
                              </ul>
                            )}
                          </div>
                        );
                      })}
                    </section>
                  ))}
                  <div className="re-breaks" aria-hidden>
                    {Array.from({ length: pages - 1 }, (_, k) => (
                      <span key={k} style={{ top: PAD + contentH * (k + 1) }} />
                    ))}
                  </div>
                </article>
              </div>
            </div>
          </div>

          {/* ---------- Look and checks ---------- */}
          <div className="re-col re-side">
            <h2>Template</h2>
            <div className="re-tpls">
              {TEMPLATES.map((t) => (
                <button key={t.id} className="re-tpl" aria-pressed={look.template === t.id} onClick={() => setLook({ ...look, template: t.id, accent: look.accent === DEFAULT_LOOK.accent || TEMPLATES.some((x) => x.defaultAccent === look.accent) ? t.defaultAccent : look.accent })}>
                  <div className={`re-thumb ${t.id === "classic" || t.id === "executive" ? "center" : ""}`} style={{ "--tc": t.defaultAccent } as React.CSSProperties} aria-hidden>
                    <i className="n" />
                    <i style={{ width: "70%" }} />
                    <i className="h" />
                    <i />
                    <i style={{ width: "85%" }} />
                    <i className="h" />
                    <i style={{ width: "75%" }} />
                  </div>
                  <b>{t.name}</b>
                  <span>{t.note}</span>
                </button>
              ))}
            </div>

            <h2>Look</h2>
            <div className="re-label" style={{ marginBottom: 6 }}>
              Text size
            </div>
            <div className="re-seg">
              {(["small", "medium", "large"] as const).map((s) => (
                <button key={s} aria-pressed={look.size === s} onClick={() => setLook({ ...look, size: s })}>
                  {s[0].toUpperCase() + s.slice(1)}
                </button>
              ))}
            </div>
            <div className="re-label" style={{ marginBottom: 6 }}>
              Spacing
            </div>
            <div className="re-seg">
              {(["tight", "normal", "roomy"] as const).map((s) => (
                <button key={s} aria-pressed={look.spacing === s} onClick={() => setLook({ ...look, spacing: s })}>
                  {s[0].toUpperCase() + s.slice(1)}
                </button>
              ))}
            </div>
            <div className="re-label" style={{ marginBottom: 6 }}>
              Accent colour
            </div>
            <div className="re-swatches">
              {ACCENTS.map((c) => (
                <button key={c} className="re-swatch" style={{ background: c }} aria-label={`Accent ${c}`} aria-pressed={look.accent === c} onClick={() => setLook({ ...look, accent: c })} />
              ))}
            </div>

            <h2>Match to a job</h2>
            <div className="re-field">
              <label htmlFor="re-jd" className="visually-hidden">
                Job description
              </label>
              <textarea id="re-jd" className="re-text" rows={5} placeholder="Paste the job description here" value={jd} onChange={(e) => changeJd(e.target.value)} />
            </div>
            <button className="button primary" onClick={tailorToJob} disabled={tailoring !== "" || loading || jd.trim().length < 80}>
              {tailoring ? <LoaderCircle className="spin" aria-hidden /> : <ArrowRight aria-hidden />} {tailoring || "Tailor to this job"}
            </button>
            {tailorError && (
              <p className="form-error" role="alert">
                {tailorError}
              </p>
            )}
            <p className="re-note" style={{ marginTop: 6 }}>
              Writes a tailored resume and cover letter for this posting (your standing skills, 3 to 4 bullets a role, human voice, the 87% target), saves the job to My jobs, and opens the result here to edit. Takes a couple of minutes.
            </p>
            {docInfo && (
              <div className="re-doc">
                <div className="re-score">
                  <b>{docInfo.after}%</b>
                  <span>tailored match · target {docInfo.target}% {docInfo.met ? "met" : "not met"}</span>
                </div>
                {!docInfo.met && docInfo.short.length > 0 && <p className="re-note">Still short on: {docInfo.short.join("; ")}. These are usually years of experience or a specific field.</p>}
                {docInfo.assumed.length > 0 && (
                  <details>
                    <summary className="re-note">
                      {docInfo.assumed.length} {docInfo.assumed.length === 1 ? "skill" : "skills"} added from your own experience. Be ready to talk through them.
                    </summary>
                    <ul className="re-note" style={{ paddingLeft: 18 }}>
                      {docInfo.assumed.map((a) => (
                        <li key={a}>{a}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            )}
            {keywordItems.length > 0 ? (
              <>
                <div className="re-score">
                  <b>{matchScore}%</b>
                  <span>keyword match{claudeItems ? " (Claude’s read)" : ""}</span>
                </div>
                <div className="re-track" aria-hidden>
                  <i style={{ width: `${matchScore}%` }} />
                </div>
                <p className="re-note">65 to 80% is a common target. Cover the must-haves first.</p>
                {(["must", "nice"] as const).map((level) => {
                  const rows = keywordItems.map((k, i) => ({ k, s: matchStatuses[i] })).filter((r) => r.k.importance === level);
                  if (!rows.length) return null;
                  return (
                    <div key={level}>
                      <div className="re-label" style={{ margin: "10px 0 6px" }}>
                        {level === "must" ? "Must-haves" : "Nice to have"}
                      </div>
                      <div className="re-chips">
                        {rows.map(({ k, s: status }) => {
                          const via = k.alsoCounts.find((t) => t.trim() && text.toLowerCase().includes(t.toLowerCase()));
                          return (
                            <span key={k.term} className={`re-chip ${status === "found" ? "ok" : status === "related" ? "rel" : "miss"}`} title={status === "related" && via ? `Covered by “${via}”` : status === "missing" ? k.tip : "In your resume"}>
                              {k.term}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
                <p className="re-note" style={{ marginTop: 10 }}>
                  Green is in your resume, blue is covered by related wording, orange isn’t there.
                  {missingMust.length > 0 && ` Not yet covered: ${missingMust.join(", ")}. Add these only where they are true of your work.`}
                </p>
              </>
            ) : (
              <p className="re-note">{jd.trim().length >= 40 ? "No skills found in that text. Paste the whole posting." : "Paste a posting to see which of its skills your resume covers. Equivalent wording counts."}</p>
            )}
            <button className="button" onClick={sharpenKeywords} disabled={matching || loading || jd.trim().length < 40} style={{ marginTop: 6 }}>
              {matching ? <LoaderCircle className="spin" aria-hidden /> : <Sparkles aria-hidden />} Sharper keywords (Claude)
            </button>
            {matchError && (
              <p className="form-error" role="alert">
                {matchError}
              </p>
            )}

            <h2>Applicant tracking check</h2>
            {ats.map((c) => (
              <div className="re-check" key={c.id}>
                <span className={`re-dot ${c.status}`} aria-label={c.status === "pass" ? "Passed" : c.status === "warn" ? "Worth a look" : "Fix this"} />
                <div>
                  <b>{c.label}</b>
                  <span className="d">{c.detail}</span>
                </div>
              </div>
            ))}
            <p className="re-note" style={{ marginTop: 8 }}>
              This checks the format systems need. No tool can promise a screen is passed; the words still have to match the job.
            </p>

            <h2>Reads like a person</h2>
            {voice.length === 0 ? (
              <p className="re-note">No stock phrases, em dashes or stacked “-ing” lines found.</p>
            ) : (
              voice.map((v, i) => (
                <div className="re-flag" key={i}>
                  <q>{v.quote}</q>
                  <span className="why">{v.why}</span>
                </div>
              ))
            )}
            <button className="button" onClick={readLikeARecruiter} disabled={reading || loading} style={{ marginTop: 6 }}>
              {reading ? <LoaderCircle className="spin" aria-hidden /> : <Sparkles aria-hidden />} Read it like a recruiter
            </button>
            {readError && (
              <p className="form-error" role="alert">
                {readError}
              </p>
            )}
            {flags && flags.length === 0 && <p className="re-note">Claude found nothing that reads as machine-written.</p>}
            {flags?.map((f, i) => (
              <div className="re-flag" key={i} style={{ marginTop: 8 }}>
                <q>{f.quote}</q>
                <span className="why">{f.why}</span>
                <span className="plain">{f.plainer}</span>
                <button className="button" style={{ marginTop: 6 }} onClick={() => applyFlag(f)}>
                  Use this wording
                </button>
              </div>
            ))}
            <p className="re-note" style={{ marginTop: 8 }}>
              AI detectors are guesses and nobody can promise a result. These checks catch the phrasing they key on; reading it aloud is the best test.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
