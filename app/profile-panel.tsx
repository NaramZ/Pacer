"use client";
/* eslint-disable react-hooks/set-state-in-effect */
import { ChangeEvent, DragEvent, FormEvent, useEffect, useState } from "react";
import { Check, FileText, LoaderCircle, Plus, Upload, X } from "lucide-react";
import { ANSWER_FIELDS, DEFAULT_ANSWERS, type Answers } from "./answers";
import { guessTitle, linkEntries, linkList, serializeLinks, type LinkEntry } from "./links";
import { postJson } from "./jobs";
import { RESUME_ACCEPT, contactFromResume, readResumeFile } from "./resume-import";
import { Sheet } from "./ui";

export type ProfileData = {
  fullName: string;
  email: string;
  phone: string;
  location: string;
  links: string;
  headline: string;
  resumeText: string;
  resumeFileName: string;
  focus: string;
  experience: string;
  secondHome: string;
  secondHomeFor: string;
  everydaySkills: string;
};
export type ApiKeyInfo = { source: "env" | "saved"; hint: string } | null;
export type Usage = { spent: number; budget: number; byFeature: { feature: string; label: string; cost: number; calls: number }[] };
export type ProfileState = { profile: ProfileData | null; apiKey: ApiKeyInfo; answers?: Answers; usage?: Usage };

export const EMPTY_PROFILE: ProfileData = { fullName: "", email: "", phone: "", location: "", links: "", headline: "", resumeText: "", resumeFileName: "", focus: "", experience: "", secondHome: "", secondHomeFor: "", everydaySkills: "" };

export function identityOf(p: ProfileData | null) {
  return {
    name: p?.fullName || "",
    headline: p?.headline || "",
    contact: [p?.email, p?.phone, p?.location, ...linkList(p?.links)].filter(Boolean).join(" | "),
  };
}

async function saveProfile(body: Partial<ProfileData> & { apiKey?: string; answers?: Answers; monthlyBudgetUsd?: number }) {
  const { ok, data } = await postJson<ProfileState>("/api/profile", body, "PUT");
  if (!ok) throw new Error(data.error || "Couldn’t save.");
  return data;
}

/* ---------- Picking a resume file ---------- */

function ResumeDrop({ onText, compact = false }: { onText: (text: string, fileName: string, atsWarning: string) => void; compact?: boolean }) {
  const [reading, setReading] = useState(false);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);

  async function read(file?: File | null) {
    if (!file) return;
    setReading(true);
    setError("");
    try {
      const read = await readResumeFile(file);
      onText(read.text, file.name, read.atsWarning);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn’t read that file.");
    } finally {
      setReading(false);
    }
  }

  return (
    <div className={`drop ${dragging ? "dragging" : ""} ${compact ? "compact" : ""}`}
      onDragOver={(e: DragEvent) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e: DragEvent) => {
        e.preventDefault();
        setDragging(false);
        read(e.dataTransfer.files[0]);
      }}
    >
      <input
        id={compact ? "resume-file-compact" : "resume-file"}
        type="file"
        accept={RESUME_ACCEPT}
        className="visually-hidden"
        onChange={(e: ChangeEvent<HTMLInputElement>) => {
          read(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <label htmlFor={compact ? "resume-file-compact" : "resume-file"} className={`button ${compact ? "secondary" : "primary large"}`}>
        {reading ? <LoaderCircle className="spin" aria-hidden /> : <Upload aria-hidden />}
        {reading ? "Reading…" : compact ? "Replace with a file" : "Choose your resume"}
      </label>
      {!compact && <p className="muted small">PDF, Word (.docx) or text. Or drop it here. It stays on your computer.</p>}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/* ---------- First run ---------- */

export function ResumeStep({ onSaved }: { onSaved: (s: ProfileState) => void }) {
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState("");
  const [atsWarning, setAtsWarning] = useState("");
  const [contact, setContact] = useState({ fullName: "", email: "", phone: "", links: "", headline: "" });
  const [pasting, setPasting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function got(resume: string, name: string, warning = "") {
    setText(resume);
    setFileName(name);
    setAtsWarning(warning);
    setContact(contactFromResume(resume));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (text.trim().length < 200) {
      setError("That looks too short to be a resume. Paste the whole thing.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      onSaved(await saveProfile({ ...contact, resumeText: text, resumeFileName: fileName }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn’t save.");
      setSaving(false);
    }
  }

  const ready = text.trim().length > 0;

  return (
    <div className="onboard">
      <p className="step-label">Step 1 of 1</p>
      <h2 className="display small">Start with your resume.</h2>
      <p className="lede">We compare every job with it and use it to write your documents. You only do this once.</p>

      {!ready && !pasting && (
        <>
          <ResumeDrop onText={got} />
          <button type="button" className="text-button" onClick={() => setPasting(true)}>
            Paste the text instead
          </button>
        </>
      )}

      {(ready || pasting) && (
        <form className="stack onboard-form" onSubmit={submit}>
          {atsWarning && <AtsNote text={atsWarning} />}
          {fileName && (
            <p className="file-chip">
              <FileText aria-hidden /> {fileName}
              <button type="button" className="icon-button small" aria-label="Choose a different file" onClick={() => got("", "")}>
                <X aria-hidden />
              </button>
            </p>
          )}
          <div className="form-grid">
            <Field id="ob-name" label="Your name" value={contact.fullName} onChange={(v) => setContact({ ...contact, fullName: v })} autoComplete="name" />
            <Field id="ob-email" label="Email" type="email" value={contact.email} onChange={(v) => setContact({ ...contact, email: v })} autoComplete="email" />
          </div>
          <div className="field">
            <label htmlFor="ob-resume">Resume text</label>
            <p className="muted small" id="ob-resume-help">
              {fileName ? "Check that it came through correctly. You can fix anything here." : "Paste your whole resume."}
            </p>
            <textarea id="ob-resume" aria-describedby="ob-resume-help" rows={14} value={text} onChange={(e) => setText(e.target.value)} />
          </div>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="button-row">
            <button className="button primary large" disabled={saving || !text.trim()}>
              {saving ? <LoaderCircle className="spin" aria-hidden /> : <Check aria-hidden />} Save and continue
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

/* ---------- Profile panel ---------- */

export function ProfileSheet({
  open,
  onClose,
  state,
  onSaved,
  claudeInChrome,
  onClaudeInChrome,
}: {
  open: boolean;
  onClose: () => void;
  state: ProfileState;
  onSaved: (s: ProfileState) => void;
  claudeInChrome?: boolean;
  onClaudeInChrome?: (on: boolean) => void;
}) {
  const [p, setP] = useState<ProfileData>(state.profile || EMPTY_PROFILE);
  const [atsWarning, setAtsWarning] = useState("");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState<"" | "profile" | "key">("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (open) {
      setP(state.profile || EMPTY_PROFILE);
      setKey("");
      setError("");
      setNotice("");
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  async function run(kind: "profile" | "key", body: Parameters<typeof saveProfile>[0], message: string) {
    setBusy(kind);
    setError("");
    setNotice("");
    try {
      onSaved(await saveProfile(body));
      setNotice(message);
      if (kind === "key") setKey("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn’t save.");
    } finally {
      setBusy("");
    }
  }

  const set = (field: keyof ProfileData) => (v: string) => setP({ ...p, [field]: v });

  return (
    <Sheet open={open} onClose={onClose} labelledBy="profile-title" className="profile-sheet">
      <div className="sheet-head">
        <div>
          <p className="kicker">Profile</p>
          <h2 id="profile-title" className="display medium">
            You, <em>on paper.</em>
          </h2>
          <p className="muted">Used to match jobs and to fill in your documents. Stored only on this computer.</p>
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
      <p className="notice" role="status">
        {notice}
      </p>

      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          run("profile", p, "Profile saved.");
        }}
      >
        <section className="card">
          <h3>Contact details</h3>
          <div className="form-grid">
            <Field id="pf-name" label="Full name" value={p.fullName} onChange={set("fullName")} autoComplete="name" />
            <Field id="pf-headline" label="Headline" hint="e.g. Registered Nurse" value={p.headline} onChange={set("headline")} />
            <Field id="pf-email" label="Email" type="email" value={p.email} onChange={set("email")} autoComplete="email" />
            <Field id="pf-phone" label="Phone" type="tel" value={p.phone} onChange={set("phone")} autoComplete="tel" />
            <Field id="pf-location" label="City" value={p.location} onChange={set("location")} autoComplete="address-level2" />
          </div>
          <LinksField value={p.links} onChange={set("links")} />
          <div className="form-grid">
            <Field
              id="pf-second-home"
              label="Another address you can use (optional)"
              hint="e.g. Jersey City, NJ"
              value={p.secondHome}
              onChange={set("secondHome")}
            />
            <Field
              id="pf-second-home-for"
              label="Use it for jobs in"
              hint="Places, separated by commas, e.g. New York, Brooklyn, NY"
              value={p.secondHomeFor}
              onChange={set("secondHomeFor")}
            />
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <h3>Resume</h3>
            <ResumeDrop
              compact
              onText={(text, fileName, warning) => {
                setP({ ...p, resumeText: text, resumeFileName: fileName });
                setAtsWarning(warning);
              }}
            />
          </div>
          {atsWarning && <AtsNote text={atsWarning} />}
          <div className="field">
            <label htmlFor="pf-resume" className="visually-hidden">
              Resume text
            </label>
            <textarea id="pf-resume" rows={16} value={p.resumeText} onChange={(e) => set("resumeText")(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="pf-focus">What should your resume and cover letter emphasize?</label>
            <textarea
              id="pf-focus"
              rows={3}
              aria-describedby="pf-focus-help"
              value={p.focus}
              placeholder="e.g. Lead with my hospital telemetry experience and precepting new nurses."
              onChange={(e) => set("focus")(e.target.value)}
            />
            <p className="muted small" id="pf-focus-help">
              The projects, skills or stories you want every application to lean on. Tailored documents put these first.
            </p>
          </div>
          <div className="field">
            <label htmlFor="pf-experience">Things you’ve done that aren’t on your resume</label>
            <textarea
              id="pf-experience"
              rows={5}
              aria-describedby="pf-experience-help"
              value={p.experience}
              placeholder="e.g. At my last job I tracked sign-up conversion in Mixpanel and redesigned the pricing page."
              onChange={(e) => set("experience")(e.target.value)}
            />
            <p className="muted small" id="pf-experience-help">
              True details a job might ask about: tools, results, responsibilities. Tailored documents can use them as facts. You can also
              add them from a job’s Resume match tab, next to what it’s missing.
            </p>
          </div>
          <div className="field">
            <label className="check">
              <input
                type="checkbox"
                aria-describedby="pf-everyday-help"
                checked={p.everydaySkills === "on"}
                onChange={(e) => set("everydaySkills")(e.target.checked ? "on" : "")}
              />{" "}
              Count the everyday skills of my profession as mine
            </label>
            <p className="muted small" id="pf-everyday-help">
              When a job asks for the ordinary parts of your work that your resume doesn’t spell out, tailored documents treat them as
              true. Years, degrees, licences, languages and specialist fields still show as gaps.
            </p>
          </div>
        </section>

        <div className="button-row">
          <button className="button primary" disabled={busy !== ""}>
            {busy === "profile" && <LoaderCircle className="spin" aria-hidden />} Save profile
          </button>
        </div>
      </form>

      <AnswersCard initial={state.answers || DEFAULT_ANSWERS} open={open} onSaved={onSaved} />

      <section className="card" aria-labelledby="ai-title">
        <h3 id="ai-title">Smarter matching (optional)</h3>
        <p className="muted small">
          Without a key, Pacer does a free word-by-word match. With your own Anthropic API key, Claude reads each job properly
          (about 1¢), writes tailored documents (about 2¢) and powers Autopilot. Anthropic bills you directly, and your resume and the
          job text are sent to them to do this; nothing is sent anywhere without a key.
        </p>
        {state.apiKey ? (
          <div className="key-status">
            <p>
              <Check aria-hidden /> Key added <span className="muted">(ending {state.apiKey.hint})</span>
            </p>
            {state.apiKey.source === "saved" ? (
              <button className="button secondary small" disabled={busy !== ""} onClick={() => run("key", { apiKey: "" }, "Key removed.")}>
                Remove key
              </button>
            ) : (
              <p className="muted small">Set in .dev.vars.</p>
            )}
          </div>
        ) : (
          <>
            <ol className="steps">
              <li>
                Sign up at{" "}
                <a href="https://console.anthropic.com" target="_blank" rel="noreferrer">
                  console.anthropic.com
                  <span className="visually-hidden"> (opens in a new tab)</span>
                </a>
                .
              </li>
              <li>In Billing, add a small amount of credit — $5 goes a long way here.</li>
              <li>Also in Billing, set a monthly spend limit. It’s a second safety net on top of the one below.</li>
              <li>In Settings → API keys, create a key, copy it, and paste it here.</li>
            </ol>
            <form
              className="key-form"
              onSubmit={(e) => {
                e.preventDefault();
                run("key", { apiKey: key }, "Key saved. New jobs will use Claude.");
              }}
            >
              <div className="field">
                <label htmlFor="pf-key">Anthropic API key</label>
                <input id="pf-key" type="password" autoComplete="off" spellCheck={false} aria-describedby="pf-key-help" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-ant-…" />
                <p className="muted small" id="pf-key-help">
                  It stays on this computer. The app only ever shows its last four characters.
                </p>
              </div>
              <button className="button secondary" disabled={busy !== "" || !key.trim()}>
                {busy === "key" && <LoaderCircle className="spin" aria-hidden />} Save key
              </button>
            </form>
          </>
        )}
        {onClaudeInChrome && (
          <div className="spend">
            <h4>Claude Pro or Max?</h4>
            <label className="check">
              <input type="checkbox" checked={Boolean(claudeInChrome)} onChange={(e) => onClaudeInChrome(e.target.checked)} />
              Show “Apply with Claude in Chrome” on jobs
            </label>
            <p className="muted small">
              Claude in Chrome fills the form on your subscription while you watch, at no API cost. Only shown in this browser.
            </p>
          </div>
        )}
        <ExtensionCard />
        {state.usage && <SpendCard usage={state.usage} onSave={(usd) => run("key", { monthlyBudgetUsd: usd }, `Monthly limit set to $${usd.toFixed(2)}.`)} busy={busy !== ""} />}
      </section>
    </Sheet>
  );
}

// The browser extension fills in forms on job pages you find yourself, with this app's documents and answers.
function ExtensionCard() {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  return (
    <div className="spend">
      <h4>Browser extension</h4>
      <p className="muted small">
        For jobs you find yourself: open the job’s page, click the Pacer icon, and it prepares a tailored resume and cover letter, then fills in
        the form. You check it and press Submit. Works in Vivaldi, Chrome, Edge and Brave.
      </p>
      <ol className="steps small">
        <li>
          Open <code>vivaldi://extensions</code> (or <code>chrome://extensions</code>) and turn on Developer mode.
        </li>
        <li>
          Choose <b>Load unpacked</b> and pick the <code>extension</code> folder inside <code>Job-Hunter</code>.
        </li>
        <li>Create a connection code below and paste it into the extension.</li>
      </ol>
      {code ? (
        <div className="field">
          <label htmlFor="ext-code">Connection code</label>
          <div className="tag-entry">
            <input id="ext-code" readOnly value={code} onFocus={(e) => e.target.select()} />
            <button
              type="button"
              className="button secondary small"
              onClick={async () => {
                await navigator.clipboard.writeText(code);
                setCopied(true);
              }}
            >
              {copied ? <Check aria-hidden /> : null} {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="muted small">Shown once. A new code replaces the old one.</p>
        </div>
      ) : (
        <button
          type="button"
          className="button secondary small"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const { ok, data } = await postJson<{ token?: string }>("/api/automation", { action: "pair-extension" });
            setBusy(false);
            if (ok && data.token) setCode(data.token);
          }}
        >
          {busy && <LoaderCircle className="spin" aria-hidden />} Create connection code
        </button>
      )}
    </div>
  );
}

function Field({
  id,
  label,
  hint,
  value,
  onChange,
  type = "text",
  autoComplete,
}: {
  id: string;
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  autoComplete?: string;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} type={type} value={value} autoComplete={autoComplete} aria-describedby={hint ? `${id}-hint` : undefined} onChange={(e) => onChange(e.target.value)} />
      {hint && (
        <p className="muted small" id={`${id}-hint`}>
          {hint}
        </p>
      )}
    </div>
  );
}

/* ---------- Saved answers ---------- */

function AnswersCard({ initial, open, onSaved }: { initial: Answers; open: boolean; onSaved: (s: ProfileState) => void }) {
  const [a, setA] = useState<Answers>(initial);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setA(initial);
      setNotice("");
      setError("");
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const custom = a.custom.filter((c) => c.question.trim() && c.answer.trim());
      const next = await saveProfile({ answers: { ...a, custom } });
      onSaved(next);
      setA(next.answers || a);
      setNotice("Answers saved. The helper will use them on every application.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn’t save.");
    } finally {
      setBusy(false);
    }
  }

  const setCustom = (i: number, key: "question" | "answer", value: string) =>
    setA({ ...a, custom: a.custom.map((c, j) => (j === i ? { ...c, [key]: value } : c)) });
  const renderField = (f: (typeof ANSWER_FIELDS)[number]) => (
    <div className="field" key={f.key}>
      <label htmlFor={`ans-${f.key}`}>{f.label}</label>
      {f.options ? (
        <div className="status-select">
          <select id={`ans-${f.key}`} value={a[f.key]} onChange={(e) => setA({ ...a, [f.key]: e.target.value })} aria-describedby={f.hint ? `ans-${f.key}-hint` : undefined}>
            {!f.voluntary && <option value="">Ask me each time</option>}
            {f.options.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <input id={`ans-${f.key}`} value={a[f.key]} placeholder={f.placeholder} onChange={(e) => setA({ ...a, [f.key]: e.target.value })} aria-describedby={f.hint ? `ans-${f.key}-hint` : undefined} />
      )}
      {f.hint && (
        <p className="muted small" id={`ans-${f.key}-hint`}>
          {f.hint}
        </p>
      )}
    </div>
  );

  return (
    <form className="card" aria-labelledby="answers-title" onSubmit={save}>
      <h3 id="answers-title">Answers for applications</h3>
      <p className="muted small">
        Most applications ask the same questions. Answer them once and the helper fills them in for you. Anything left as “Ask me each
        time” is flagged for you to answer.
      </p>
      <div className="form-grid">{ANSWER_FIELDS.filter((f) => !f.voluntary).map(renderField)}</div>

      <fieldset className="fieldset">
        <legend>Voluntary questions</legend>
        <p className="muted small">
          Employers ask these for equal-opportunity reporting. They’re optional and never affect a decision; “Decline to self-identify” is
          always fine.
        </p>
        <div className="form-grid">{ANSWER_FIELDS.filter((f) => f.voluntary).map(renderField)}</div>
      </fieldset>

      <fieldset className="fieldset">
        <legend>Your own questions</legend>
        <p className="muted small">For anything else that keeps coming up, like “Do you have a driver’s license?”</p>
        {a.custom.length > 0 && (
          <ul className="custom-answers">
            {a.custom.map((c, i) => (
              <li key={i}>
                <div className="field">
                  <label htmlFor={`cq-${i}`}>Question</label>
                  <input id={`cq-${i}`} value={c.question} onChange={(e) => setCustom(i, "question", e.target.value)} />
                </div>
                <div className="field">
                  <label htmlFor={`ca-${i}`}>Your answer</label>
                  <input id={`ca-${i}`} value={c.answer} onChange={(e) => setCustom(i, "answer", e.target.value)} />
                </div>
                <button
                  type="button"
                  className="icon-button small"
                  aria-label={`Remove question ${c.question || i + 1}`}
                  onClick={() => setA({ ...a, custom: a.custom.filter((_, j) => j !== i) })}
                >
                  <X aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
        <button
          type="button"
          className="button secondary small"
          disabled={a.custom.length >= 40}
          onClick={() => {
            setA({ ...a, custom: [...a.custom, { question: "", answer: "" }] });
            setTimeout(() => document.getElementById(`cq-${a.custom.length}`)?.focus(), 0);
          }}
        >
          <Plus aria-hidden /> Add a question
        </button>
      </fieldset>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <p className="notice" role="status">
        {notice}
      </p>
      <div className="button-row">
        <button className="button primary" disabled={busy}>
          {busy && <LoaderCircle className="spin" aria-hidden />} Save answers
        </button>
      </div>
    </form>
  );
}

/* ---------- Spending ---------- */

const money = (n: number) => (n > 0 && n < 0.01 ? "under 1¢" : `$${n.toFixed(2)}`);

export function SpendMeter({ usage }: { usage: Usage }) {
  const share = usage.budget > 0 ? Math.min(1, usage.spent / usage.budget) : 1;
  const reached = usage.spent >= usage.budget;
  return (
    <div className={`meter ${reached ? "reached" : share >= 0.8 ? "near" : ""}`}>
      <p>
        <b>{money(usage.spent)}</b> spent this month of your <b>${usage.budget.toFixed(2)}</b> limit
        {reached && <span className="meter-note"> — limit reached; AI features are paused until the 1st.</span>}
      </p>
      <div className="meter-track" aria-hidden>
        <span style={{ width: `${Math.round(share * 100)}%` }} />
      </div>
    </div>
  );
}

function SpendCard({ usage, onSave, busy }: { usage: Usage; onSave: (usd: number) => void; busy: boolean }) {
  const [limit, setLimit] = useState(String(usage.budget));
  useEffect(() => setLimit(String(usage.budget)), [usage.budget]);
  return (
    <div className="spend">
      <h4>Spending</h4>
      <SpendMeter usage={usage} />
      {usage.byFeature.length > 0 && (
        <ul className="spend-list">
          {usage.byFeature.map((f) => (
            <li key={f.feature}>
              <span>
                {f.label} <span className="muted">({f.calls} {f.calls === 1 ? "call" : "calls"})</span>
              </span>
              <b>{money(f.cost)}</b>
            </li>
          ))}
        </ul>
      )}
      <form
        className="key-form"
        onSubmit={(e) => {
          e.preventDefault();
          onSave(Number(limit));
        }}
      >
        <div className="field">
          <label htmlFor="pf-limit">Monthly limit (US dollars)</label>
          <input id="pf-limit" type="number" min={0} max={500} step={1} inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value)} aria-describedby="pf-limit-help" />
          <p className="muted small" id="pf-limit-help">
            Once it’s reached, reading jobs and writing documents switch to the free versions and Autopilot pauses. Set 0 to turn AI off.
          </p>
        </div>
        <button className="button secondary" disabled={busy || limit === String(usage.budget) || !Number.isFinite(Number(limit))}>
          Save limit
        </button>
      </form>
    </div>
  );
}

function LinksField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const fromValue = () => {
    const e = linkEntries(value);
    return e.length ? e : [{ title: "", url: "" }];
  };
  const [rows, setRows] = useState<LinkEntry[]>(fromValue);
  useEffect(() => setRows(fromValue()), [value]); // eslint-disable-line react-hooks/exhaustive-deps
  const commit = (next: LinkEntry[]) => {
    setRows(next);
    onChange(serializeLinks(next));
  };
  const edit = (i: number, patch: Partial<LinkEntry>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <fieldset className="fieldset links-field">
      <legend>Links</legend>
      <p className="muted small">Give each link a name so it lands in the right box on forms — e.g. LinkedIn, Portfolio, Case study.</p>
      <ul className="link-rows">
        {rows.map((r, i) => (
          <li key={i}>
            <div className="field">
              <label htmlFor={`pf-link-title-${i}`}>Name</label>
              <input
                id={`pf-link-title-${i}`}
                value={r.title}
                placeholder={guessTitle(r.url) || "e.g. Portfolio"}
                onChange={(e) => edit(i, { title: e.target.value })}
                onBlur={() => commit(rows)}
              />
            </div>
            <div className="field">
              <label htmlFor={`pf-link-${i}`}>Link</label>
              <input
                id={`pf-link-${i}`}
                type="url"
                inputMode="url"
                autoComplete="url"
                value={r.url}
                placeholder="e.g. linkedin.com/in/yourname"
                onChange={(e) => edit(i, { url: e.target.value })}
                onBlur={() => commit(rows.map((row, j) => (j === i && !row.title && guessTitle(row.url) ? { ...row, title: guessTitle(row.url) } : row)))}
              />
            </div>
            {rows.length > 1 && (
              <button type="button" className="icon-button small" aria-label={`Remove link ${r.title || i + 1}`} onClick={() => commit(rows.filter((_, j) => j !== i))}>
                <X aria-hidden />
              </button>
            )}
          </li>
        ))}
      </ul>
      {rows.length < 6 && (
        <button type="button" className="button secondary small" onClick={() => setRows([...rows, { title: "", url: "" }])}>
          <Plus aria-hidden /> Add another link
        </button>
      )}
    </fieldset>
  );
}

function AtsNote({ text }: { text: string }) {
  return (
    <p className="callout warn" role="status">
      <b>Heads up: some application systems will misread this PDF.</b> {text.replace(/^Your PDF/, "It")}
    </p>
  );
}
