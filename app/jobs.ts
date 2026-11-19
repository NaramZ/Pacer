export type Status =
  | "Saved"
  | "Applied"
  | "Screen"
  | "Interview"
  | "Final"
  | "Offer"
  | "Rejected"
  | "Withdrawn";

export const STATUSES: Status[] = ["Saved", "Applied", "Screen", "Interview", "Final", "Offer", "Rejected", "Withdrawn"];

export const STATUS_LABEL: Record<Status, string> = {
  Saved: "Saved",
  Applied: "Applied",
  Screen: "Phone screen",
  Interview: "Interviewing",
  Final: "Final round",
  Offer: "Offer",
  Rejected: "Rejected",
  Withdrawn: "Withdrawn",
};

export type Person = {
  name?: string | null;
  title?: string | null;
  relationship?: string | null;
  linkedin?: string | null;
  email?: string | null;
  emailIsPublic?: boolean;
  sourceUrl?: string | null;
};

export type Requirement = {
  id?: string;
  requirement: string;
  category?: string;
  importance?: string;
  jobEvidence?: string;
  resumeEvidence?: string;
  verdict?: string;
  suggestedAddition?: string;
  matchedTerm?: string;
};

export type ResumeChange = { section: string; before: string; after: string; why: string; jobSignal: string };

export type Keyword = { term: string; label: string; category: string; inResume: boolean; priority: string; verdict: string };

export type Dossier = {
  analysisVersion?: number;
  analyzedWith?: "claude" | "basic";
  company?: string;
  title?: string;
  location?: string;
  workArrangement?: string;
  summary?: string;
  rolePriorities?: string[];
  analysisConfidence?: string;
  descriptionWarning?: string;
  jobDescription?: string;
  keywords?: string[];
  keywordAnalysis?: Keyword[];
  salary?: {
    min?: number | null;
    max?: number | null;
    currency?: string | null;
    period?: string | null;
    type?: string | null;
    confidence?: string | null;
    notes?: string | null;
  };
  requirements?: Requirement[];
  strengths?: string[];
  gaps?: string[];
  evidenceScore?: number;
  scoreExplanation?: string;
  strongestAngle?: string;
  biggestRisk?: string;
  recommendation?: string;
  resumeChanges?: ResumeChange[];
  people?: Person[];
  sources?: { title?: string; url?: string; supports?: string }[];
  nextSteps?: string[];
  portfolioLead?: string;
  outreachAngle?: string;
  docWarnings?: string[];
  // Requirements the person ticked "I've done this" for, plus the everyday product-design work their standing statement covers.
  confirmed?: string[];
  // The part of `confirmed` added by the standing statement rather than ticked on this job.
  assumed?: string[];
  // Whether the match with these documents reached the target, and what's still short if not.
  docTarget?: { target: number; met: boolean; short: string[] };
  // The match again with the tailored resume and cover letter (graded side by side with the original).
  docScore?: {
    before: number;
    after: number;
    letterCovers: number;
    total: number;
    at: string;
    stale?: boolean;
    items: { requirement: string; importance: string; before: string; after: string; evidence: string; inLetter: boolean; letterQuote: string }[];
  };
  contacts?: {
    emailFormat: string;
    emailFormatSource: string;
    foundAt: string;
    warnings?: string[];
    people: {
      name: string;
      title: string;
      role: string;
      foundAt: string;
      channels: { kind: string; label: string; value: string; note: string }[];
      message: string;
    }[];
  };
  salaryAsk?: {
    amount: number;
    low: number;
    high: number;
    currency: string;
    period: "year" | "hour";
    basis: "posting" | "company" | "market";
    sources: { title: string; url: string }[];
    note: string;
  };
};

export type Application = {
  id: string;
  company: string;
  role: string;
  location: string;
  source: string;
  url: string;
  fitScore: number;
  status: Status;
  appliedAt: string;
  followUpAt: string;
  createdAt: string;
  updatedAt?: string;
  notes?: string;
  researchStatus?: string;
  dossierJson?: string;
  tailoredResume?: string;
  coverLetter?: string;
  jobDescription?: string;
  submissionJson?: string;
};

// What the helper sent when it submitted an application for the person.
export type Submission = {
  submittedAt: string;
  confirmationUrl: string;
  applicationUrl: string;
  fields: string;
  drafted: string;
  documents: { label: string; path: string }[];
  screenshots: string[];
};

export function submissionOf(a: Application): Submission | null {
  try {
    return a.submissionJson ? JSON.parse(a.submissionJson) : null;
  } catch {
    return null;
  }
}

export function dossierOf(a: Application): Dossier | null {
  try {
    return a.dossierJson ? JSON.parse(a.dossierJson) : null;
  } catch {
    return null;
  }
}

export function isResearching(a: Application) {
  return ["researching", "formatting"].includes(a.researchStatus || "");
}

export function matchScore(a: Application): number | null {
  if (a.researchStatus !== "complete") return null;
  return dossierOf(a)?.evidenceScore ?? a.fitScore * 10;
}

export function salaryText(d: Dossier | null) {
  const s = d?.salary;
  if (!s) return "";
  const f = (n?: number | null) =>
    n ? new Intl.NumberFormat("en-US", { style: "currency", currency: s.currency || "USD", maximumFractionDigits: 0 }).format(n) : "";
  const per = s.period ? ` per ${s.period}` : "";
  const range = s.min && s.max ? `${f(s.min)}–${f(s.max)}` : f(s.min || s.max);
  return range ? `${range}${per}` : "";
}

export function shortDate(value: string) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(
    new Date(value.length === 10 ? `${value}T12:00:00` : value),
  );
}

export function isoToday() {
  return new Date().toISOString().slice(0, 10);
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function postJson<T>(url: string, body: unknown, method = "POST") {
  const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = (await r.json().catch(() => ({}))) as T & { error?: string };
  return { ok: r.ok, data };
}
