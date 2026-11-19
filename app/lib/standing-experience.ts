// Standing rules the person sets in Profile for their documents: a second address for jobs in certain places,
// and whether the everyday skills of their profession count as theirs. Every job is held to an 87% match.
import type { Requirement } from "./job-analysis";

export const TARGET_MATCH = 87;

export type Homes = { location?: string; secondHome?: string; secondHomeFor?: string };

/* ---------- A second address, for jobs in the places the person chose ---------- */

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// "New York, Brooklyn, NY": names match as words; a two-letter code matches as a state (", NY").
export function usesSecondHome(p: Homes | null | undefined, jobLocation: string) {
  if (!p?.secondHome?.trim() || !jobLocation) return false;
  return (p.secondHomeFor || "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .some((t) => (/^[A-Z]{2}$/.test(t) ? new RegExp(`,\\s*${t}\\b`, "i") : new RegExp(`\\b${escape(t)}\\b`, "i")).test(jobLocation));
}

// The location to give an employer: the second address for jobs in its places, otherwise what's saved.
export function homeFor(p: Homes | null | undefined, jobLocation: string) {
  return usesSecondHome(p, jobLocation) ? String(p?.secondHome).trim() : p?.location || "";
}

// Swaps the place in the resume's contact line ("Product Designer | Pittsburgh, PA | +1 … | email") for those jobs.
export function withHome(resume: string, jobLocation: string, p: Homes | null | undefined) {
  if (!usesSecondHome(p, jobLocation)) return resume;
  const home = String(p?.secondHome).trim();
  const lines = resume.split("\n");
  const at = lines.findIndex((l, i) => i > 0 && i < 5 && l.includes(" | ") && /@|\d{3}/.test(l));
  if (at < 0) return resume;
  const parts = lines[at].split(" | ");
  const place = parts.findIndex((p) => /^[A-Za-z][A-Za-z .'-]+,\s*[A-Z]{2}(?:\b.*)?$/.test(p.trim()));
  if (place >= 0) parts[place] = home;
  else parts.splice(1, 0, home);
  lines[at] = parts.join(" | ");
  return lines.join("\n");
}

// Showing up in an office is a matter of where they live, not experience: with an address near the job, office requirements are met.
export function logisticsMet(reqs: Requirement[], jobLocation: string, p: Homes | null | undefined) {
  if (!usesSecondHome(p, jobLocation)) return [];
  return reqs.filter((r) => /in-?office|on-?site|hybrid|commut|local|relocat/i.test(`${r.requirement} ${r.jobEvidence}`) && !/\d+\s*\+?\s*years?/i.test(r.jobEvidence)).map((r) => r.requirement);
}

/* ---------- The everyday skills of their profession (Profile setting, off unless they turn it on) ---------- */

// Things a posting can ask for that no one can claim on someone's behalf: how long, which degree, which licence, which language.
const GATES = /\b(?:\d+\s*\+?\s*(?:-\s*\d+\s*)?years?|years? of|degree|bachelor|master'?s|ph\.?d|certif|licen[sc]e|clearance|citizen|authori[sz]ation|visa|sponsor|fluen|bilingual|native speaker|language|relocat|on-?site|in-?office|travel|salary|compensation|equity)/i;
// Whole fields and specialist crafts, where claiming experience is a different matter from "does product design".
const SPECIALIST = /\b(health|healthcare|medical|clinical|hipaa|fintech|banking|payments?|regulat\w*|compliance|government|defen[cs]e|legal|insurance|crypto|blockchain|automotive|aerospace|biotech|pharma|machine learning|llm|3d|ar|vr|motion|after effects|animation|video|illustrat\w*|brand identity|print|game|gaming)\b/i;
// Requirements the person's standing statement covers: whatever the job asks of someone in their profession that the resume doesn't show yet.
// Gates (years, degrees, languages, relocation) and specialist fields are left alone, so they show up as real gaps.
export function standingConfirmations(reqs: Requirement[]) {
  return reqs
    .filter((r) => r.verdict !== "Strong")
    .filter((r) => {
      const label = r.requirement;
      // A job's quote may mention years in passing; it only gates the requirement when the requirement is about experience itself.
      const evidence = /experience|senior|track record|background|tenure/i.test(label) ? r.jobEvidence : "";
      return !GATES.test(`${label} ${evidence}`) && !SPECIALIST.test(`${label} ${r.jobEvidence}`);
    })
    .map((r) => r.requirement.trim())
    .filter(Boolean);
}
