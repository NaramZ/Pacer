import { z } from "zod/v4";
import { AGENT_MODEL, WRITING_MODEL, type Writer } from "./claude";
import { EXPECT, noProgress, type Progress } from "./progress";

// The resume and cover letter go to real employers, so they use the model that sticks to the facts best.
const DOCS_MODEL = AGENT_MODEL;
import { fetchWorkdayPosting } from "./job-boards";
import type { Profile } from "./profile";
import { linkList } from "../links";
import { documentProblems, restoreRoleOrder } from "../doc-check";
import { TARGET_MATCH, homeFor, logisticsMet, standingConfirmations, withHome } from "./standing-experience";

// Bump when the dossier shape changes.
export const ANALYSIS_VERSION = 3;

// Keeps a single job read to a few thousand tokens even for very long postings.
const MAX_DESCRIPTION_CHARS = 30000;

import { scoreOf, strictVerdict, type Importance, type Verdict } from "../scoring";

export type Requirement = {
  id: string;
  requirement: string;
  category: string;
  importance: Importance;
  jobEvidence: string;
  resumeEvidence: string;
  verdict: Verdict;
  suggestedAddition: string;
};

type JobData = {
  title: string;
  company: string;
  location: string;
  description: string;
  workArrangement: string;
  salary: {
    min: number | null;
    max: number | null;
    currency: string;
    period: string;
    type: string;
    confidence: string;
    notes: string;
  };
};

/* ---------- Reading the job page ---------- */

const entities: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " };
const decode = (s: string) =>
  s.replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m) => entities[m] || m).replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
const stripTags = (s: string) =>
  s
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ");
const plain = (s: string) => decode(stripTags(s).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
const structured = (s: string) =>
  decode(
    stripTags(s)
      .replace(/<h[1-6][^>]*>/gi, "\n## ")
      .replace(/<\/h[1-6]>/gi, "\n")
      .replace(/<li[^>]*>/gi, "\n• ")
      .replace(/<\/li>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|ul|ol|section)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\n\s*\n\s*\n+/g, "\n\n")
      .trim(),
  );

function findPosting(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const x of value) {
      const hit = findPosting(x);
      if (hit) return hit;
    }
    return null;
  }
  const o = value as Record<string, unknown>;
  if (o["@type"] === "JobPosting") return o;
  for (const x of Object.values(o)) {
    const hit = findPosting(x);
    if (hit) return hit;
  }
  return null;
}

function organizationName(v: unknown) {
  return typeof v === "string" ? v : typeof v === "object" && v ? String((v as Record<string, unknown>).name || "") : "";
}

function locationName(v: unknown): string {
  if (Array.isArray(v)) return v.map(locationName).filter(Boolean).join(" / ");
  if (!v || typeof v !== "object") return "";
  const a = ((v as Record<string, unknown>).address || {}) as Record<string, unknown>;
  return [a.addressLocality, a.addressRegion, a.addressCountry].filter(Boolean).join(", ");
}

function salaryFrom(data: Record<string, unknown>, description: string): JobData["salary"] {
  const b = (data.baseSalary || {}) as Record<string, unknown>;
  const v = (b.value || {}) as Record<string, unknown>;
  let min = Number(v.minValue) || null;
  let max = Number(v.maxValue) || null;
  let confidence = "Employer listing";
  let period = String(v.unitText || "year").toLowerCase();
  if (!min && !max) {
    const m = description.match(/\$\s?([\d,.]+)\s*(k)?\s*(?:-|–|to)\s*\$?\s?([\d,.]+)\s*(k)?(?:\s*(?:per|an|a|\/)\s*(hour|hr|year|yr|annum))?/i);
    const toNumber = (n: string, k?: string) => Number(n.replace(/,/g, "")) * (k ? 1000 : 1);
    if (m && toNumber(m[1], m[2]) >= 7) {
      min = toNumber(m[1], m[2]);
      max = toNumber(m[3], m[4]);
      period = /^h/i.test(m[5] || "") || max < 500 ? "hour" : "year";
      confidence = "From the job description";
    }
  }
  return {
    min,
    max,
    currency: String(b.currency || "USD"),
    period,
    type: "Base salary",
    confidence: min || max ? confidence : "Not found",
    notes: min || max ? "" : "No salary was listed.",
  };
}

async function fetchJob(url: string) {
  if (!url) return { html: "", posting: null as Record<string, unknown> | null };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; JobHunter/1.0)", Accept: "text/html,application/xhtml+xml" },
      redirect: "follow",
      signal: controller.signal,
    });
    if (!r.ok) throw new Error(`The job page returned an error (${r.status}).`);
    const html = (await r.text()).slice(0, 3_000_000);
    for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
      try {
        const hit = findPosting(JSON.parse(decode(m[1])));
        if (hit) return { html, posting: hit };
      } catch {}
    }
    return { html, posting: null };
  } finally {
    clearTimeout(timer);
  }
}

function descriptionValue(jd: string, data: Record<string, unknown> | null, html: string) {
  const supplied = jd.trim();
  let listing = String(data?.description || "").trim();
  // No structured posting: fall back to the page's main text.
  if (!listing && html) listing = structured(html.match(/<main[\s\S]*?<\/main>/i)?.[0] || html.match(/<body[\s\S]*?<\/body>/i)?.[0] || "");
  const raw = supplied.length >= listing.length ? supplied : listing;
  return /<[a-z][\s\S]*>/i.test(raw) ? structured(raw) : raw.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
}

function derive(entry: string, url: string, jd: string, data: Record<string, unknown> | null, html: string): JobData {
  const description = descriptionValue(jd, data, html);
  const pageTitle = plain(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "");
  const noteTitle = entry.replace(/https?:\/\/\S+/g, "").match(/^\s*(.+?)\s+at\s+/i)?.[1];
  const title = String(data?.title || noteTitle || pageTitle.split(/[|–-]/)[0].trim() || "");
  const host = (() => {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return "";
    }
  })();
  const company =
    organizationName(data?.hiringOrganization) ||
    entry.replace(/https?:\/\/\S+/g, "").match(/\bat\s+([A-Z][\w .&'-]+?)\s*$/m)?.[1]?.trim() ||
    "";
  const location = locationName(data?.jobLocation) || String(data?.jobLocationType || (/remote/i.test(description) ? "Remote" : ""));
  const workArrangement = /hybrid|telecommut|days per week/i.test(description)
    ? "Hybrid"
    : /remote/i.test(String(data?.jobLocationType || "") + description)
      ? "Remote"
      : /on.?site|in office/i.test(description)
        ? "On-site"
        : "Not specified";
  return {
    title,
    company: company || (host.includes("myworkdayjobs") ? host.split(".")[0] : ""),
    location,
    description,
    workArrangement,
    salary: salaryFrom(data || {}, description),
  };
}

/* ---------- Scoring ---------- */

function explain(reqs: Requirement[]) {
  const n = (v: Verdict) => reqs.filter((r) => r.verdict === v).length;
  return `Your resume clearly shows ${n("Strong")} of ${reqs.length} things this job asks for, partly shows ${n("Partial")}, and doesn't show ${n("Gap")}.`;
}

/* ---------- Free analysis: word overlap, works for any profession ---------- */

const STOP = new Set(
  (
    "a about above across after again all also an and any are as at be been being best both but by can candidate candidates company could day days do does each etc every experience few for from get good great has have help high how if in including into is it its join just key level like looking make may more most must need needs new not of on one or other our out over own part per plus position preferred required requirement requirements responsibilities qualifications role same should so some strong such take team than that the their them then there these they this those three through to two under up us using very want way we well what when where which while who will with within work working world would year years you your able ability skills skill knowledge understanding related relevant excellent ensure support based time opportunity hour hours schedule pay range full part"
  ).split(" "),
);
const stem = (w: string) =>
  w.length > 4 ? w.replace(/ies$/, "y").replace(/(ations?|ions?|ates?|ated|ating|ing|ed|es|s)$/, "") : w;
const words = (text: string) =>
  (text.toLowerCase().match(/[a-z][a-z0-9+#./-]*[a-z0-9+#]|[a-z]/g) || []).filter((w) => w.length >= 3 && !STOP.has(w));

const REQUIREMENT_CUE =
  /(experience|proficien|knowledge of|familiar|ability to|skills? in|degree|certif|background in|expertise|understanding of|track record|comfortable|fluen|license|years)/i;

function candidateLines(description: string) {
  const all = description
    .split(/\n+|(?<=[.!?])\s+(?=[A-Z])/)
    .map((raw) => ({ bullet: /^\s*[•*\-–]\s/.test(raw), text: raw.replace(/^[#•*\-–\s]+/, "").trim() }))
    .filter((l) => l.text.length >= 25 && l.text.length <= 320);
  // Bulleted lines are the real duties and requirements; fall back to sentences for prose postings.
  const bullets = all.filter((l) => l.bullet).map((l) => l.text);
  return bullets.length >= 4 ? bullets : all.map((l) => l.text);
}

function basicAnalysis(job: JobData, resume: string) {
  const resumeLines = resume.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const resumeStems = new Set(words(resume).map(stem));
  const lines = candidateLines(job.description);
  const reqLines = lines.filter((l) => REQUIREMENT_CUE.test(l));
  // Qualifications first, then responsibilities, so both are covered.
  const picked = [...reqLines.slice(0, 7), ...lines.filter((l) => !reqLines.includes(l))].slice(0, 10);
  const evidenceLines = resumeLines.filter((l) => !/^[A-Z][A-Z &/]{3,40}$/.test(l));
  const resumeLower = resume.toLowerCase();

  const requirements: Requirement[] = [];
  picked.forEach((line, i) => {
    const terms = [...new Set(words(line))];
    if (terms.length < 2) return;
    const hit = terms.filter((t) => resumeStems.has(stem(t)));
    const missing = terms.filter((t) => !resumeStems.has(stem(t)));
    const ratio = hit.length / terms.length;
    // Names, tools and acronyms (Epic, PCCN, Excel) matter more than ordinary words.
    const keyTerms = [...new Set(line.slice(1).match(/\b(?:[A-Z]{2,}[A-Za-z0-9+#]*|[A-Z][a-z]+[A-Z]?\w*)\b/g) || [])].filter((t) => !STOP.has(t.toLowerCase()));
    const keyHits = keyTerms.filter((t) => resumeLower.includes(t.toLowerCase()));
    let verdict: Verdict = ratio >= 0.6 ? "Strong" : ratio >= 0.3 ? "Partial" : "Gap";
    if (verdict === "Gap" && keyHits.length) verdict = "Partial";
    if (verdict === "Partial" && keyTerms.length && keyHits.length === keyTerms.length && ratio >= 0.2) verdict = "Strong";
    const best = evidenceLines
      .map((l) => ({ l, n: words(l).filter((w) => hit.some((h) => stem(h) === stem(w))).length }))
      .sort((a, b) => b.n - a.n)[0];
    requirements.push({
      id: `r${i}`,
      requirement: line.length > 110 ? `${line.slice(0, 107)}…` : line,
      category: REQUIREMENT_CUE.test(line) ? "Qualification" : "Responsibility",
      importance: /required|must|minimum/i.test(line) ? "Required" : /preferred|bonus|nice to have|plus/i.test(line) ? "Preferred" : "Core signal",
      jobEvidence: line,
      resumeEvidence: best && best.n > 0 ? best.l : "Not shown in your resume.",
      verdict,
      suggestedAddition: verdict === "Strong" ? "" : `If it’s true, mention ${missing.slice(0, 4).join(", ")}.`,
    });
  });

  const counts = new Map<string, { word: string; n: number }>();
  for (const w of words(job.description)) {
    const s = stem(w);
    const c = counts.get(s);
    counts.set(s, { word: c?.word || w, n: (c?.n || 0) + 1 });
  }
  const keywordAnalysis = [...counts.entries()]
    .filter(([, c]) => c.n >= 2)
    .sort((a, b) => b[1].n - a[1].n)
    .slice(0, 14)
    .map(([s, c]) => ({ term: c.word, verdict: resumeStems.has(s) ? "Strong" : "Gap" }));

  const strong = requirements.find((r) => r.verdict === "Strong");
  const gap = requirements.find((r) => r.verdict === "Gap");
  return {
    analysisConfidence: "Basic",
    summary: "",
    rolePriorities: lines.filter((l) => !REQUIREMENT_CUE.test(l)).slice(0, 4),
    requirements,
    keywordAnalysis,
    strongestAngle: strong ? `Your resume already speaks to: ${strong.requirement}` : "",
    biggestRisk: gap ? `Not shown in your resume: ${gap.requirement}` : "",
    recommendation:
      "This is a basic word match. Add your Anthropic API key in Profile for a real read of the job and tailored documents (about 1–2¢ per job).",
    nextSteps: [
      "Check each item in Resume match and make sure your resume says it in the job’s own words — only if it’s true.",
      "Write your documents, then review them before you apply.",
    ],
    outreachAngle: "",
  };
}

/* ---------- Claude analysis ---------- */

const verdictEnum = z.enum(["Strong", "Partial", "Gap"]);
const AnalysisSchema = z.object({
  company: z.string(),
  title: z.string(),
  location: z.string(),
  workArrangement: z.enum(["Remote", "Hybrid", "On-site", "Not specified"]),
  summary: z.string(),
  rolePriorities: z.array(z.string()),
  requirements: z.array(
    z.object({
      requirement: z.string(),
      category: z.string(),
      importance: z.enum(["Required", "Preferred", "Core signal"]),
      jobEvidence: z.string(),
      resumeEvidence: z.string(),
      verdict: verdictEnum,
      suggestedAddition: z.string(),
    }),
  ),
  keywords: z.array(z.object({ term: z.string(), verdict: verdictEnum })),
  strongestAngle: z.string(),
  biggestRisk: z.string(),
  recommendation: z.string(),
  nextSteps: z.array(z.string()),
  outreachAngle: z.string(),
  descriptionComplete: z.boolean(),
});

const ANALYSIS_SYSTEM = `You compare one job posting with one person's resume for a free job-search assistant used by people who are out of work. Be honest, specific and kind. Write to the person in second person, in plain language and short sentences.

Rules:
- requirements: 6 to 12 items, most important first, covering required qualifications, core responsibilities and the experience level. requirement is a short label (under 10 words). jobEvidence quotes the posting.
- resumeEvidence states only what the resume actually shows. If it shows nothing relevant, write "Not shown in your resume."
- verdict: be strict. Strong only when the resume states it directly with a concrete example (a named project, role or result). Partial when the resume shows something related or only implies it. Gap when it shows nothing. If you can't see the evidence in the resume text itself (for example it would be in a portfolio you can't open), it is not Strong.
- suggestedAddition: for Partial or Gap, one resume bullet the person could add only if it is true, with [brackets] for specifics you don't know. For Strong, how to make the existing evidence more visible. Never invent experience.
- keywords: 8 to 15 concrete skills, tools or terms from the posting, with how well the resume shows each.
- summary: one sentence on what the job really is. rolePriorities: 3 to 5 things the person would actually be doing.
- strongestAngle: what to lead with. biggestRisk: the main gap a recruiter would notice. recommendation: apply, apply after specific changes, or skip, and why, in one or two sentences.
- nextSteps: 2 to 4 concrete actions. outreachAngle: one sentence to open a message to someone at the company.
- company, title, location: from the posting; use an empty string if unknown.
- descriptionComplete: false if the posting looks cut off or is missing its qualifications.`;

async function aiAnalysis(job: JobData, resume: string, ai: Writer, note: string) {
  const description = job.description.slice(0, MAX_DESCRIPTION_CHARS);
  const response = await ai.ask({
    model: WRITING_MODEL,
    maxTokens: 4000,
    system: ANALYSIS_SYSTEM,
    messages: [
      {
        role: "user",
        content: `<posting>
Title: ${job.title || "unknown"}
Company: ${job.company || "unknown"}
Location: ${job.location || "unknown"}
Note from the user: ${note || "none"}

${description}
</posting>

<resume>
${resume}
</resume>`,
      },
    ],
    schema: AnalysisSchema,
  });
  const a = response.data;
  if (!a) throw new Error("Claude didn’t return a readable analysis. Try again.");
  return {
    company: a.company || job.company,
    title: a.title || job.title,
    location: a.location || job.location,
    workArrangement: a.workArrangement !== "Not specified" ? a.workArrangement : job.workArrangement,
    analysisConfidence: a.descriptionComplete ? "Full description" : "Preliminary",
    descriptionComplete: a.descriptionComplete,
    summary: a.summary,
    rolePriorities: a.rolePriorities,
    requirements: a.requirements.map((r, i) => ({ id: `r${i}`, ...r, verdict: strictVerdict(r.verdict, r.resumeEvidence) })),
    keywordAnalysis: a.keywords,
    strongestAngle: a.strongestAngle,
    biggestRisk: a.biggestRisk,
    recommendation: a.recommendation,
    nextSteps: a.nextSteps,
    outreachAngle: a.outreachAngle,
  };
}

/* ---------- Public entry points ---------- */

export async function analyzeJob({
  entry,
  url,
  jd,
  profile,
  ai,
  progress = noProgress,
}: {
  entry: string;
  url: string;
  jd: string;
  profile: Profile;
  ai: Writer | null;
  progress?: Progress;
}) {
  const engine = ai ? ai.via : "free";
  progress.plan(engine, [
    { key: "read", label: jd ? "Reading the job description" : "Reading the job posting", expect: EXPECT.read[engine] },
    { key: "compare", label: ai ? "Comparing every requirement with your resume" : "Matching the job’s words with your resume", expect: EXPECT.compare[engine] },
    { key: "save", label: "Scoring and saving", expect: 1 },
  ]);
  progress.start("read");
  let html = "";
  let posting: Record<string, unknown> | null = null;
  let fetchError = "";
  let workday: Awaited<ReturnType<typeof fetchWorkdayPosting>> = null;
  try {
    workday = await fetchWorkdayPosting(url);
    if (!workday) ({ html, posting } = await fetchJob(url));
  } catch (e) {
    fetchError = e instanceof Error ? e.message : "The job page couldn’t be read.";
  }
  const job = derive(entry, url, jd || workday?.description || "", posting, html);
  if (workday) {
    job.company = workday.company || job.company;
    job.title = job.title || workday.title;
    job.location = workday.location || job.location;
    if (workday.workplace) job.workArrangement = workday.workplace;
  }
  if (job.description.length < 80)
    throw new Error(`${fetchError || "The listing didn’t show its description."} Paste the job description and try again.`);
  progress.done("read");
  progress.start("compare");
  const result = ai ? await aiAnalysis(job, profile.resumeText, ai, entry.replace(/https?:\/\/\S+/g, "").trim()) : basicAnalysis(job, profile.resumeText);
  progress.done("compare");
  progress.start("save");
  const company = ("company" in result && result.company) || job.company || "Unknown company";
  const title = ("title" in result && result.title) || job.title || "Untitled role";
  const requirements = result.requirements as Requirement[];
  const hasQualifications = /qualifications?|requirements?|what (?:you|we) (?:bring|need|look for)|you have|your experience/i.test(job.description);
  const complete = "descriptionComplete" in result ? result.descriptionComplete : hasQualifications;
  const q = (s: string) => `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(s)}`;

  return {
    ...result,
    analysisVersion: ANALYSIS_VERSION,
    analyzedWith: ai ? "claude" : "basic",
    company,
    title,
    location: ("location" in result && result.location) || job.location || "Not specified",
    workArrangement: ("workArrangement" in result && result.workArrangement) || job.workArrangement,
    jobDescription: job.description,
    descriptionWarning: complete
      ? job.description.length > MAX_DESCRIPTION_CHARS
        ? "This listing is very long, so only the first part was read."
        : ""
      : "The listing looks incomplete or has no qualifications section, so this is an early estimate. Paste the full description for a reliable score.",
    postingStatus: fetchError || "Read from the employer’s listing.",
    salary: job.salary,
    evidenceScore: scoreOf(requirements),
    scoreExplanation: explain(requirements),
    keywords: (result.keywordAnalysis as { term: string }[]).map((k) => k.term),
    people: [
      { name: "Find the hiring manager", title: `${title} hiring manager at ${company}`, relationship: "LinkedIn search", linkedin: q(`${company} ${title} manager`) },
      { name: "Find the recruiter", title: `Recruiter at ${company}`, relationship: "LinkedIn search", linkedin: q(`${company} recruiter`) },
    ],
    sources: url ? [{ title: "Employer job listing", url, supports: "Title, company, description, location and any listed salary." }] : [],
  };
}

export type Dossier = Awaited<ReturnType<typeof analyzeJob>>;

/* ---------- Tailored documents ---------- */

const DocsSchema = z.object({
  resume: z.string(),
  coverLetter: z.string(),
  changes: z.array(z.object({ section: z.string(), before: z.string(), after: z.string(), why: z.string(), jobSignal: z.string() })),
});

const VerifySchema = z.object({ issues: z.array(z.object({ quote: z.string(), problem: z.string() })) });

const VERIFY_SYSTEM = `You fact-check a tailored resume and cover letter against the person's original resume, plus any extra experience they confirmed themselves (both count as true). List every claim neither supports, word for word:
- added durations, speeds or frequencies ("in weeks", "daily");
- numbers attached to something different (the original's "three interaction rules" becoming "three journeys");
- new tools, people, teams, outcomes, responsibilities or details (e.g. "alongside engineers" where the original doesn't say so);
- changed titles, companies, dates or degrees;
- in the cover letter, claims about how they worked that the resume doesn't state ("I studied how users…", "stayed involved through launch", "no rework"), and new effects of their work ("made compliance transparent").
- any personal history with the company or its product ("I've been a user for years", "I've long admired") and any colleagues or duties the resume doesn't mention ("PMs", "roadmap"): these are new facts, not enthusiasm.
Where the person confirms they have done something, a general description of it inside a fitting role is supported; flag only specifics they didn't give (numbers, tools, names, results).
Where the facts say the person also lives somewhere else, either place in the contact line is true.
The person decides which of their roles a confirmed requirement belongs to, so placing it in any role (including the role's company or its project) is NOT a new fact. Ordinary audiences and settings that come with the work (engineers, founders, stakeholders, "the team", "the dashboard", "the platform") are not new facts either, and neither is calling the portfolio on their resume a portfolio. Flag a confirmed requirement only when the wording adds a number, a named tool, a named person or company, or a concrete result that nobody gave.
Naming the skill a stated fact clearly demonstrates is allowed and not a new fact: "ran an online shop that sold 280 orders in its first year" may become "ran a small product business end to end, selling 280 orders in year one", and "built the design system" may say it "kept product decisions consistent". Flag it only when the wording adds a specific the facts don't contain (a number, tool, metric, team, title, result or scope) or claims more than the fact shows.
Check every sentence of the cover letter as strictly as every resume bullet. Rephrasing with equivalent words ("layout" for "interface", "workflows" for "journeys") is fine, as is reordering and summarizing; so is enthusiasm about the job and saying how stated experience fits it. Only flag new facts or changed meaning. If everything is supported, return no issues.`;

export async function verifyDocuments(ai: Writer, original: string, resume: string, letter: string) {
  const r = await ai.ask({
    // The documents matter most, and Haiku missed soft embellishments, so the check uses the writing model.
    model: DOCS_MODEL,
    maxTokens: 4000,
    system: VERIFY_SYSTEM,
    messages: [{ role: "user", content: `<original_resume>\n${original}\n</original_resume>\n\n<tailored_resume>\n${resume}\n</tailored_resume>\n\n<cover_letter>\n${letter}\n</cover_letter>` }],
    schema: VerifySchema,
    effort: "medium",
  });
  return (r.data?.issues || []).map((i) => `“${i.quote}” — ${i.problem}`);
}

/* ---------- Keywords from a pasted job description ---------- */

const KeywordsSchema = z.object({
  keywords: z.array(z.object({ term: z.string(), importance: z.enum(["must", "nice"]), alsoCounts: z.array(z.string()), tip: z.string() })),
});

const KEYWORDS_SYSTEM = `You read a job description the way a modern resume-screening system does: by meaning, not by exact words. List the 12 to 22 skills, tools, responsibilities and qualifications the posting asks for, most important first. For each one:
- term: the usual short name for it (two to four words);
- importance: "must" when it is required or central to the job, "nice" when it is preferred or a bonus;
- alsoCounts: up to 6 other words or phrases a recruiter would accept as showing the same thing (synonyms, specific tools, related wording);
- tip: one short sentence on how someone who has really done this could show it on a resume. Never suggest claiming something untrue.
Skip company boilerplate, benefits and generic traits like "team player".`;

// What a posting really asks for, with the other wording that counts, so a resume can be checked against it as it is edited.
export async function jobKeywords(ai: Writer, jobDescription: string) {
  const r = await ai.ask({
    model: DOCS_MODEL,
    maxTokens: 3000,
    system: KEYWORDS_SYSTEM,
    messages: [{ role: "user", content: `<job_description>\n${jobDescription.slice(0, 12000)}\n</job_description>` }],
    schema: KeywordsSchema,
    effort: "low",
  });
  return (r.data?.keywords || []).filter((k) => k.term.trim()).slice(0, 26);
}

/* ---------- Does it read like a person wrote it? ---------- */

const HumanSchema = z.object({ flagged: z.array(z.object({ quote: z.string(), why: z.string(), plainer: z.string() })) });

const HUMAN_SYSTEM = `You are a recruiter who screens applications for text a tool wrote, and you've read thousands of them. Read the resume and cover letter. List at most 5 phrases or sentences that a recruiter would genuinely suspect. Return fewer rather than more; plain, specific wording is fine. Signs:
- stock phrases and buzzwords; abstract nouns where a person would say what happened;
- bullets that all share one shape, or sentences of the same length and rhythm in a row;
- lists of exactly three things, "not only … but also", and paragraphs that end by summing themselves up;
- smooth, vague claims with no detail, and filler transitions;
- long chains of "-ing" phrases.
Quote each one word for word, say why in a few words, and give a plainer version that keeps the facts exactly the same (add no new fact, number, tool or name) and is clearly different from the original wording. Skip anything you can't improve. Ignore wording that is already in the person's own original resume. If the text reads as a person wrote it, return nothing.`;

type HumanFlag = z.infer<typeof HumanSchema>["flagged"][number];

// Phrases a recruiter would suspect, to be rewritten before the person sees them.
export async function humanFlags(ai: Writer, original: string, resume: string, letter: string): Promise<HumanFlag[]> {
  const r = await ai.ask({
    model: DOCS_MODEL,
    maxTokens: 3000,
    system: HUMAN_SYSTEM,
    messages: [{ role: "user", content: `<original_resume>\n${original}\n</original_resume>\n\n<resume>\n${resume}\n</resume>\n\n<cover_letter>\n${letter}\n</cover_letter>` }],
    schema: HumanSchema,
    effort: "low",
  });
  // Only real suggestions: a "plainer" version identical to the original isn't one.
  return (r.data?.flagged || []).filter((f) => f.quote.trim() && f.plainer.trim() && f.plainer.trim() !== f.quote.trim());
}

const flagText = (f: HumanFlag) => `Reads as machine-written: “${f.quote}” (${f.why}). Say it more like this: “${f.plainer}”`;

/* ---------- The match again, with the new documents ---------- */

const DocScoreSchema = z.object({
  results: z.array(
    z.object({ index: z.number(), verdict: verdictEnum, resumeEvidence: z.string(), inLetter: z.boolean(), letterQuote: z.string() }),
  ),
});

const DOC_SCORE_SYSTEM = `You check whether a tailored resume and cover letter improve on the original resume for a job. Each requirement comes with how the original resume was already judged, and why. For every requirement (by its index):
- verdict for the tailored resume, held to exactly the same bar as the original: keep the original verdict unless the tailored resume shows concrete evidence the original judgement didn't see (then move it up), or the specific evidence the original judgement cites has been removed from the tailored resume (only then move it down; name what was removed). A concrete fact that shows part of a requirement (sales numbers or hours saved for business impact, for example) makes it at least Partial. Bringing forward a real fact that genuinely demonstrates the requirement counts as evidence (an online shop that sold 280 orders in its first year is evidence of commercial results); generic rewording without such a fact doesn't change a verdict. Strong needs a concrete example (a named project, role or result) stated in the resume itself.
- resumeEvidence: the tailored resume's own words that support it, or what's still missing.
- inLetter: true only if the cover letter clearly speaks to this requirement; letterQuote: that sentence, word for word, or "".
Return one result per requirement.`;

export type DocScore = {
  before: number;
  after: number;
  letterCovers: number;
  total: number;
  at: string;
  stale?: boolean;
  items: { requirement: string; importance: string; before: Verdict; after: Verdict; evidence: string; inLetter: boolean; letterQuote: string }[];
};

// Scores the tailored documents the same way the original resume was scored, so the two numbers compare.
// `vouched` are requirements the person says they have done: once the resume states one, it counts as met, since their word is the evidence.
// `met` are requirements that are true of their situation (an office in New York, with their New Jersey address).
export async function scoreDocuments(ai: Writer, reqs: Requirement[], original: string, resume: string, letter: string, vouched: string[] = [], met: string[] = []): Promise<DocScore | null> {
  if (!reqs.length) return null;
  const r = await ai.ask({
    model: WRITING_MODEL,
    maxTokens: 4000,
    system: DOC_SCORE_SYSTEM,
    messages: [
      {
        role: "user",
        content: `<requirements>\n${reqs
          .map((q, i) => `${i}. ${q.requirement} (${q.importance})\n   The job says: ${q.jobEvidence}\n   Original resume: ${q.verdict} — ${q.resumeEvidence}`)
          .join("\n")}\n</requirements>\n\n<original_resume>\n${original}\n</original_resume>\n\n<tailored_resume>\n${resume}\n</tailored_resume>\n\n<cover_letter>\n${letter}\n</cover_letter>`,
      },
    ],
    schema: DocScoreSchema,
  });
  if (!r.data) return null;
  const byIndex = new Map(r.data.results.map((x) => [x.index, x]));
  const items = reqs.map((q, i) => {
    const x = byIndex.get(i);
    // "Before" is the job's own analysis, so the numbers match the Resume match score above.
    const before = q.verdict;
    let after = x ? strictVerdict(x.verdict, x.resumeEvidence) : q.verdict;
    if (met.includes(q.requirement)) after = "Strong";
    else if (vouched.includes(q.requirement) && x && x.verdict !== "Gap") after = "Strong";
    // A requirement only drops when the re-check names evidence the rewrite took out; otherwise it's the two
    // checks grading the same words differently, and the original verdict stands.
    const rank = { Gap: 0, Partial: 1, Strong: 2 } as const;
    if (rank[after] < rank[before] && !/\b(removed|dropped|cut|no longer|was deleted|taken out|left out of the tailored)\b/i.test(x?.resumeEvidence || "")) after = before;
    return { requirement: q.requirement, importance: q.importance, before, after, evidence: x?.resumeEvidence || q.resumeEvidence, inLetter: Boolean(x?.inLetter), letterQuote: x?.letterQuote || "" };
  });
  return {
    before: scoreOf(reqs),
    after: scoreOf(items.map((x) => ({ importance: x.importance, verdict: x.after }))),
    letterCovers: items.filter((x) => x.inLetter).length,
    total: items.length,
    at: new Date().toISOString(),
    items,
  };
}

const DOCS_SYSTEM = `You tailor a person's resume and write their cover letter for one job. The person is out of work; their documents must be truthful and read as if a real working designer wrote them in an evening, not as if a tool produced them.

Voice, for both documents (this matters as much as the facts):
- Plain, specific words a designer would actually use. Mix short sentences with the odd longer one. Say the thing once.
- Resume bullets start with a plain past-tense verb (Designed, Built, Ran, Rebuilt, Led, Wrote), carry one idea, and run about 15 to 25 words. Never chain three or more "-ing" phrases ("applying X, explaining Y, and partnering Z"); split it or cut it.
- Never use: leverage, spearhead, orchestrate, passionate, dynamic, seamless, robust, cutting-edge, innovative, synergy, impactful, holistic, track record, results-driven, detail-oriented, thrilled, eager to, delve, tapestry, testament, fast-paced, elevate, utilize. No em dashes (—) anywhere; use a comma, a period or "and".
- No "not only … but also", no lists of exactly three adjectives, no closing sentence that sums the paragraph up, and don't repeat the job title and company name more than once or twice.
- Use the job's own words for the skills it asks for, but write the sentence around them the way you'd explain your work to a colleague.

Resume rules:
- Keep every fact true. Copy each role's heading line (title, company, dates, location) exactly as written. Keep roles in their original order (most recent first). Keep every section, including education, certifications and languages.
- Never add tools, metrics, numbers, titles, employers or results that are not in the original, and keep each number attached to what it measures (for example "280 organic sales" stays sales, never products). The only experience you may add beyond the original is what the person confirmed (the extra experience and the confirmed requirements below), described in general terms. You may rephrase, reorder bullets within a role, trim and emphasize.
- The resume should leave no requirement of this job unanswered. For every confirmed requirement, write a bullet or part of a bullet in the job's own words, as work the person did in that role.
- Every role that has bullets gets 3 or 4 bullets, no fewer and no more: the original bullets first, then bullets that show the confirmed requirements in the real role where each most plausibly happened. When there are too many, combine related ones and keep what matters most for this job.
- Start every bullet from the original bullet's own wording. Shape it into STAR order in one line — the context, the action (a strong past-tense verb for past roles), then the result the original states — but add nothing: no new effects, lessons, collaborators, durations, speeds or responsibilities. If the original bullet has no result, it gets none.
- Keep each fact inside the bullet it came from; don't move a detail from one project into another.
- Lead with what this job cares about, using the job's own words where the resume already supports them.
- Close gaps honestly. For each requirement the resume doesn't show yet, look through everything the person has done (their resume and the extra experience they confirmed) for facts that genuinely demonstrate it, and bring those forward in the job's own language: in the summary, a bullet, or the skills section. For example, an online shop that sold 280 orders in its first year shows running a product commercially and caring about sales results; say so. You may name the skill a fact clearly demonstrates. You may not add numbers, tools, metrics, titles, employers, teams or results that aren't in their facts, or claim more than a fact shows. If nothing they've done supports a requirement, leave it out.
- The summary is 2 or 3 short lines, 50 words at most: a headline of highlights, not a paragraph. Who they are, the strongest skills this job wants, and at most one standout proof point, with no "I" or "my". Keep it about the length of the original or shorter; swap highlights in, never pile them on. Stories and project details go in the bullets and the cover letter.
- If the person says what to emphasize, give those projects the strongest, most detailed bullets and name them briefly in the summary. Never move a role out of date order to do it.
- Plain text format: line 1 is the full name; line 2 is the headline, then contact details, separated by " | " (headline | place | phone | email | links); each section heading in UPPERCASE on its own line; each role as "Title · Company | Dates | Location"; bullets start with "• ".

Cover letter rules:
- Written by the person, in the first person ("I"), addressed to the hiring team. Never address the person as "you". Contractions are fine ("I've", "I'd"). Open with the work or the job itself, never with "I am writing" or "I am excited".
- 3 or 4 short paragraphs, under 300 words. Warm, direct and specific to this company and role. No clichés such as "I am writing to express my interest". No address header. End with "Best," and the person's name.
- The middle is one or two short STAR stories from the resume — the situation, what they did, and the result — each tied to something this job needs. Use the projects the person asked to emphasize as those stories.
- Every factual sentence must be something the resume or their confirmed extra experience states (naming the skill a fact demonstrates is fine). Speak to the job's key requirements where their facts support it. Don't describe how they worked or what they learned unless the resume says it; the only additions allowed are why they want this job and how their stated experience fits it. Never state what the person likes, prefers or enjoys unless the resume says so ("I like designing interfaces with no pattern to copy"); the reason for applying must come from the job posting itself (what the product or team does). Never invent a personal history with the company or its product ("I've used Duolingo for years", "I've long admired", "as a customer"), and never add colleagues, teams or planning work the resume doesn't mention ("working with PMs", "the roadmap").

changes: up to 6 of the most meaningful resume edits, quoting the exact before and after text, why it helps, and the job signal it answers.`;

// The resume plus the extra experience the person confirmed; the lowercase label keeps it from reading as a resume section.
export function factsOf(profile: Pick<Profile, "resumeText" | "experience" | "secondHome">, confirmed: string[] = []) {
  const more = profile.experience?.trim();
  const done = confirmed.length ? `\n\nThe person confirms they have done these, in their real roles (general facts, no specific numbers, tools or names):\n${confirmed.map((c) => `• ${c}`).join("\n")}` : "";
  const home = profile.secondHome?.trim() ? `\n\nThe person also lives in ${profile.secondHome.trim()}.` : "";
  return `${profile.resumeText}${home}${more ? `\n\nMore experience the person confirmed (not on the resume):\n${more}` : ""}${done}`;
}

export async function createDocuments({
  dossier,
  profile,
  ai,
  progress = noProgress,
}: {
  dossier: Record<string, unknown>;
  profile: Profile;
  ai: Writer | null;
  progress?: Progress;
}) {
  const engine = ai ? ai.via : "free";
  const rounds = ai?.via === "subscription" ? 2 : 1;
  const reqs = (Array.isArray(dossier.requirements) ? dossier.requirements : []) as Requirement[];
  // When the person says so in Profile, the everyday skills of their profession are theirs, so the requirements they cover count as confirmed on every job.
  const assumed = profile.everydaySkills === "on" ? standingConfirmations(reqs) : [];
  const confirmed = [...new Set([...(Array.isArray(dossier.confirmed) ? dossier.confirmed : []).map(String), ...assumed])];

  progress.plan(engine, [
    { key: "write", label: ai ? "Writing your tailored resume and cover letter" : "Preparing a cover letter template", expect: EXPECT.write[engine] },
    ...(ai
      ? [
          { key: "check", label: "Fact-checking every claim against your original resume", expect: EXPECT.check[engine] },
          ...Array.from({ length: rounds }, (_, i) => ({ key: `fix${i + 1}`, label: `Fixing what the check found${rounds > 1 ? ` (round ${i + 1})` : ""}`, expect: EXPECT.fix[engine] + EXPECT.check[engine] })),
        ]
      : []),
    ...(ai && reqs.length ? [{ key: "score", label: "Re-scoring your match with the new resume and cover letter", expect: EXPECT.compare[engine] }] : []),
    { key: "save", label: "Saving", expect: 1 },
  ]);
  progress.start("write");
  const company = String(dossier.company || "the company");
  const title = String(dossier.title || "this role");

  if (!ai) {
    const top = reqs.find((r) => r.verdict === "Strong")?.requirement.replace(/[.;]$/, "");
    const name = profile.fullName || "";
    return {
      tailoredResume: profile.resumeText,
      warnings: [] as string[],
      coverLetter: `Hello ${company} team,

I’d like to be considered for the ${title} role.

[Add one or two sentences on a result you’re proud of${top ? ` that shows “${top}”` : " that matters for this job"}.]

[Add a sentence on why ${company} specifically.]

I’d welcome the chance to talk.

Best,
${name}`,
      resumeChanges: [],
    };
  }

  const brief = reqs
    .slice(0, 12)
    .map((r) => `- ${r.requirement} (${r.importance}; your resume: ${r.verdict}) — job says: "${r.jobEvidence}"`)
    .join("\n");
  const request = [
    {
      role: "user" as const,
        content: `<job>
${title} at ${company}
What matters most:
${brief}
${dossier.strongestAngle ? `Lead with: ${dossier.strongestAngle}` : ""}
</job>

<person>
What to emphasize: ${profile.focus || "no preference; choose what fits this job best"}
Name: ${profile.fullName}
Headline: ${profile.headline || "(none given; take it from the resume)"}
Contact: ${[profile.email, profile.phone, homeFor(profile, String(dossier.location || "")), ...linkList(profile.links)].filter(Boolean).join(" | ")}
</person>

<resume>
${profile.resumeText}
</resume>${profile.experience?.trim() ? `\n\n<more_experience confirmed_by_the_person="true">\n${profile.experience.trim()}\n</more_experience>` : ""}${
        confirmed.length
          ? `\n\n<confirmed_requirements>\nThe person confirms they have done each of these, although the resume doesn't say so. Show every one in the resume, inside the real role where it most plausibly happened (a bullet or part of one), and in the summary or skills where it fits; mention the most important ones in the cover letter. Describe what they did in general terms that fit that role. Don't add numbers, tools, metrics, names or results they haven't given.\n${confirmed.map((c) => `- ${c}`).join("\n")}\n</confirmed_requirements>`
          : ""
      }`,
    },
  ];
  const response = await ai.ask({
    model: DOCS_MODEL,
    // Room for the model's own thinking as well as both documents.
    maxTokens: 16000,
    schema: DocsSchema,
    effort: "medium",
    system: DOCS_SYSTEM,
    messages: request,
  });
  if (!response.data) throw new Error(`Claude didn’t return readable documents (${response.stop}). Try again.`);
  progress.done("write");
  progress.start("check");
  const jobPlace = String(dossier.location || "");
  const polish = (resume: string) => withHome(restoreRoleOrder(profile.resumeText, resume), jobPlace, profile);
  // 3 or 4 bullets a role once there is confirmed experience to draw on.
  const bullets = confirmed.length ? { min: 3, max: 4 } : undefined;
  let d: z.infer<typeof DocsSchema> = { ...response.data, resume: polish(response.data.resume) };

  // Two checks: structure in code (roles, order, sections, numbers, voice) and claims by a separate reader.
  // Anything either finds goes back for one fix.
  // Everything the person has told us is true: their resume, the extra experience they confirmed, and the requirements they ticked.
  const facts = factsOf(profile, confirmed);
  let problems = [...documentProblems(facts, d.resume, d.coverLetter, bullets), ...(await verifyDocuments(ai, facts, d.resume, d.coverLetter)), ...(await humanFlags(ai, facts, d.resume, d.coverLetter).then((f) => f.map(flagText)).catch(() => [] as string[]))];
  progress.done("check");
  let warnings: string[] = [];
  // On the person's Claude subscription an extra fix round costs nothing but time, so it gets two.
  for (let round = 0; round < rounds && problems.length; round++) {
    progress.start(`fix${round + 1}`, `Fixing ${problems.length} ${problems.length === 1 ? "thing" : "things"} the check found${rounds > 1 ? ` (round ${round + 1})` : ""}`);
    const retry: { data: z.infer<typeof DocsSchema> | null } = await ai.ask({
      model: DOCS_MODEL,
      maxTokens: 16000,
      system: DOCS_SYSTEM,
      messages: [
        ...request,
        { role: "assistant", content: JSON.stringify(d) },
        { role: "user", content: `Fix these problems and return the full documents again:\n${problems.map((p) => `- ${p}`).join("\n")}` },
      ],
      schema: DocsSchema,
      effort: "medium",
    });
    if (retry.data) d = { ...retry.data, resume: polish(retry.data.resume) };
    const left = documentProblems(facts, d.resume, d.coverLetter, bullets);
    // Wrong facts, roles or sections stop here; a summary that's still long is shown as a warning instead.
    const fatal = left.filter((p) => !/summary/i.test(p));
    if (fatal.length && round === rounds - 1) throw new Error(`The tailored documents didn’t pass the fact check (${fatal[0]}). Try again, or edit them by hand.`);
    // Whatever the reader still flags after the last round is shown to the person rather than hidden.
    const unsupported = await verifyDocuments(ai, facts, d.resume, d.coverLetter);
    const stillMachine = await humanFlags(ai, facts, d.resume, d.coverLetter).then((f) => f.map(flagText)).catch(() => [] as string[]);
    warnings = [...left.filter((p) => /summary/i.test(p)), ...unsupported];
    problems = [...left, ...unsupported, ...stillMachine];
    progress.done(`fix${round + 1}`);
  }
  for (let round = 0; round < rounds; round++) progress.skip(`fix${round + 1}`);
  // A last read for anything a recruiter would suspect. Its plainer wording goes in if the fact check still passes; otherwise the person sees the flags.
  const suspect = await humanFlags(ai, facts, d.resume, d.coverLetter).catch(() => [] as HumanFlag[]);
  if (suspect.length) {
    const swap = (text: string) => suspect.reduce((t, f) => (t.includes(f.quote) ? t.replace(f.quote, f.plainer) : t), text);
    const candidate = { ...d, resume: polish(swap(d.resume)), coverLetter: swap(d.coverLetter) };
    // The plainer wording goes in as long as it adds no new problem to the ones the draft already has.
    const problemsOf = async (x: { resume: string; coverLetter: string }) => [...documentProblems(facts, x.resume, x.coverLetter, bullets).filter((p) => !/summary/i.test(p)), ...(await verifyDocuments(ai, facts, x.resume, x.coverLetter))];
    const [before, after] = [(await problemsOf(d)).length, (await problemsOf(candidate)).length];
    if (after <= before) d = candidate;
    else warnings = [...warnings, ...suspect.map(flagText)];
  }
  progress.start("score");
  // A failed re-score shouldn't lose the documents; it just isn't shown.
  const docScore = await scoreDocuments(ai, reqs, facts, d.resume, d.coverLetter, confirmed, logisticsMet(reqs, jobPlace, profile)).catch(() => null);
  progress.done("score");
  // Every job is held to the target; when honest tailoring can't reach it, say what's still short.
  const docTarget = docScore
    ? {
        target: TARGET_MATCH,
        met: docScore.after >= TARGET_MATCH,
        short: docScore.items.filter((i) => i.after !== "Strong" && i.importance !== "Preferred").map((i) => i.requirement).slice(0, 5),
      }
    : undefined;
  return { tailoredResume: d.resume, coverLetter: d.coverLetter, resumeChanges: d.changes, warnings, docScore, docTarget, confirmed, assumed };
}


// Free, instant resume match for a job description; used to rank the job feed.
export function quickMatch(description: string, resume: string) {
  if (!resume.trim() || !description.trim()) return 0;
  const job = { title: "", company: "", location: "", description, workArrangement: "", salary: salaryFrom({}, "") };
  return scoreOf(basicAnalysis(job, resume).requirements);
}

// Shared with the job feed's title matching.
export { stem, words };
