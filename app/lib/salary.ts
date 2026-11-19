import type { Answers } from "../answers";
import { z } from "zod/v4";
import { WRITING_MODEL, type Writer } from "./claude";

export type SalaryAsk = {
  amount: number;
  low: number;
  high: number;
  currency: string;
  period: "year" | "hour";
  basis: "posting" | "company" | "market";
  sources: { title: string; url: string }[];
  note: string;
};

// How far up a range to ask, by experience level. Company-specific data is pitched a notch higher.
const LEVEL_POINT: Record<string, number> = { "Entry level": 0.35, "Mid level": 0.65, Senior: 0.8, "Lead or manager": 0.9 };

function pointFor(level: string, basis: SalaryAsk["basis"]) {
  const base = LEVEL_POINT[level] ?? LEVEL_POINT["Mid level"];
  return Math.min(0.95, basis === "company" ? base + 0.1 : base);
}

function roundPay(n: number, period: SalaryAsk["period"]) {
  return period === "hour" ? Math.round(n) : Math.round(n / 1000) * 1000;
}

// "$70k", "70,000 a year" → 70000.
export function parseMoney(text: string) {
  const m = text.replace(/,/g, "").match(/(\d+(?:\.\d+)?)\s*(k)?/i);
  return m ? Number(m[1]) * (m[2] ? 1000 : 1) : 0;
}

function choose(low: number, high: number, currency: string, period: SalaryAsk["period"], basis: SalaryAsk["basis"], answers: Answers) {
  const floor = parseMoney(answers.salaryFloor || "");
  const raw = low + (high - low) * pointFor(answers.level, basis);
  return { amount: Math.max(roundPay(raw, period), floor), low, high, currency, period, basis };
}

const money = (n: number, currency: string, period: string) =>
  `${new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "USD", maximumFractionDigits: 0 }).format(n)}${period === "hour" ? "/hr" : ""}`;

const SEARCH_PROMPT = `Find what this job pays. Search for, in order of preference:
1. Pay data for this exact company and a similar role (their other job postings with pay ranges, Levels.fyi, Glassdoor, H-1B salary records).
2. Otherwise, the market pay range for this role and experience level in this location.
Ignore junior or intern figures unless the person is entry level. Use null for figures you didn't find.`;

type SearchResult = {
  companyLow: number | null;
  companyHigh: number | null;
  marketLow: number | null;
  marketHigh: number | null;
  currency: string;
  period: "year" | "hour";
  sources: { title: string; url: string }[];
};

const PaySchema = z.object({
  companyLow: z.number().nullable(),
  companyHigh: z.number().nullable(),
  marketLow: z.number().nullable(),
  marketHigh: z.number().nullable(),
  currency: z.string(),
  period: z.enum(["year", "hour"]),
  sources: z.array(z.object({ title: z.string(), url: z.string() })),
});

// Pulling pay figures out of search results is simple reading, so the cheapest model does it, on the person's plan when it can.
async function searchPay(ai: Writer, title: string, company: string, location: string, level: string): Promise<SearchResult | null> {
  const r = await ai.ask({
    model: WRITING_MODEL,
    maxTokens: 3000,
    search: 3,
    system: "You look up what a job pays.",
    schema: PaySchema,
    messages: [{ role: "user", content: `${SEARCH_PROMPT}\n\nRole: ${title}\nCompany: ${company}\nLocation: ${location || "not stated"}\nExperience level: ${level || "Mid level"}` }],
  });
  return r.data;
}

type DossierLike = { title?: unknown; company?: unknown; location?: unknown; salary?: { min?: number | null; max?: number | null; currency?: string | null; period?: string | null } };

// Works out what to ask for on this job: posted range first, then company data, then the market.
export async function salaryAsk(dossier: DossierLike, answers: Answers, ai: Writer | null): Promise<SalaryAsk | null> {
  const d = { title: String(dossier.title || ""), company: String(dossier.company || ""), location: String(dossier.location || "") };
  const posted = dossier.salary;
  if (posted?.min && posted?.max) {
    const period = posted.period === "hour" ? "hour" : "year";
    const pick = choose(posted.min, posted.max, posted.currency || "USD", period, "posting", answers);
    return {
      ...pick,
      sources: [],
      note: `The posting lists ${money(posted.min, pick.currency, period)}–${money(posted.max, pick.currency, period)}; asking toward the upper-middle for your level.`,
    };
  }
  if (!ai) return null;
  const found = await searchPay(ai, d.title, d.company, d.location, answers.level);
  if (!found) return null;
  const currency = found.currency || "USD";
  const period = found.period === "hour" ? "hour" : "year";
  const sources = (found.sources || []).filter((s) => s?.url).slice(0, 4);
  if (found.companyLow && found.companyHigh) {
    const pick = choose(found.companyLow, found.companyHigh, currency, period, "company", answers);
    return { ...pick, sources, note: `${d.company || "The company"} pays about ${money(found.companyLow, currency, period)}–${money(found.companyHigh, currency, period)} for similar roles; asking on the higher side.` };
  }
  if (found.marketLow && found.marketHigh) {
    const pick = choose(found.marketLow, found.marketHigh, currency, period, "market", answers);
    return { ...pick, sources, note: `No company figures found. The market range for this role${d.location ? ` in ${d.location}` : ""} is ${money(found.marketLow, currency, period)}–${money(found.marketHigh, currency, period)}.` };
  }
  return null;
}

export function salaryForForm(s: SalaryAsk | null | undefined) {
  if (!s) return "";
  const high = s.period === "hour" ? Math.round(s.amount * 1.1) : Math.round((s.amount * 1.1) / 1000) * 1000;
  return `Salary to ask for this job: ${money(s.amount, s.currency, s.period)}${s.period === "year" ? " a year" : ""}. If a range is asked for, give ${money(s.amount, s.currency, s.period)}–${money(high, s.currency, s.period)}. (${s.note})`;
}
