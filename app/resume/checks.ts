import { STOCK_WORDS } from "../doc-check";
import { STANDARD_HEADINGS, splitHeading, type Resume } from "./model";

export type Check = { id: string; label: string; status: "pass" | "warn" | "fail"; detail: string };

const OTHER_HEADINGS = /^(PROJECTS|CERTIFICATIONS?|LANGUAGES|AWARDS|HONORS|VOLUNTEER(ING)?|PUBLICATIONS|INTERESTS|LINKS|REFERENCES|LICENSES|ACHIEVEMENTS|PORTFOLIO|TOOLS)$/;
const DATE = /^[A-Z][a-z]{2,8}\.? \d{4}\s*[-–]\s*(?:[A-Z][a-z]{2,8}\.? \d{4}|Present|Current)$/;

// What an applicant tracking system needs to read a resume correctly. These are about format; none can promise a screen is passed.
export function atsChecks(r: Resume, pages: number): Check[] {
  const checks: Check[] = [];
  const titles = r.sections.map((s) => s.title.trim().toUpperCase());
  const has = (re: RegExp) => titles.some((t) => re.test(t));

  checks.push({ id: "layout", label: "One column of real text", status: "pass", detail: "No tables, columns, images or text boxes, so the file reads top to bottom. Every template is built this way." });

  const missing = [!has(STANDARD_HEADINGS.experience) && "Work Experience", !has(STANDARD_HEADINGS.education) && "Education", !has(STANDARD_HEADINGS.skills) && "Skills"].filter(Boolean);
  const odd = titles.filter((t) => !Object.values(STANDARD_HEADINGS).some((re) => re.test(t)) && !OTHER_HEADINGS.test(t));
  checks.push({
    id: "headings",
    label: "Standard section headings",
    status: missing.length ? "fail" : odd.length ? "warn" : "pass",
    detail: missing.length ? `Add: ${missing.join(", ")}. Systems look for these exact headings.` : odd.length ? `Rename or fold in: ${odd.join(", ")}. Plain headings are matched more reliably.` : "Experience, education and skills are all under headings a system recognises.",
  });

  const email = /[\w.+-]+@[\w-]+\.[\w.-]+/.test(r.contact);
  const phone = /\+?\d[\d\s().-]{8,}/.test(r.contact);
  checks.push({
    id: "contact",
    label: "Name and contact details",
    status: r.name && email && phone ? "pass" : "fail",
    detail: r.name && email && phone ? "Name, email and phone are in plain text near the top." : `Missing from the top of the page: ${[!r.name && "name", !email && "email", !phone && "phone"].filter(Boolean).join(", ")}.`,
  });

  const experience = r.sections.filter((s) => STANDARD_HEADINGS.experience.test(s.title.trim().toUpperCase()));
  const roles = experience.flatMap((s) => s.entries).filter((e) => e.heading.trim());
  const badDates = roles.filter((e) => !DATE.test(splitHeading(e.heading).dates)).map((e) => splitHeading(e.heading).title || "a role");
  checks.push({
    id: "dates",
    label: "Dates in one format",
    status: !roles.length ? "warn" : badDates.length ? "warn" : "pass",
    detail: !roles.length ? "No dated roles found under Work Experience." : badDates.length ? `Use "Mon YYYY - Mon YYYY" or "- Present" for: ${badDates.join(", ")}.` : "Every role has a start and end date written the same way.",
  });

  const off = roles.filter((e) => e.bullets.length < 3 || e.bullets.length > 4).map((e) => `${splitHeading(e.heading).title} (${e.bullets.length})`);
  checks.push({
    id: "bullets",
    label: "3 or 4 bullets per role",
    status: off.length ? "warn" : "pass",
    detail: off.length ? `Outside 3 to 4: ${off.join(", ")}.` : "Each role has a scannable number of bullets.",
  });

  const long = roles.flatMap((e) => e.bullets).filter((b) => b.split(/\s+/).length > 35).length;
  checks.push({ id: "long", label: "Bullets that scan quickly", status: long ? "warn" : "pass", detail: long ? `${long} ${long === 1 ? "bullet runs" : "bullets run"} over 35 words. One idea each reads best.` : "No bullet is a paragraph." });

  checks.push({
    id: "length",
    label: "Length",
    status: pages > 2 ? "fail" : "pass",
    detail: pages <= 1 ? "Fits on one page." : pages === 2 ? "Two pages. Fine with several years of experience; trim if it spills just past one." : `${pages} pages. Cut to two at most.`,
  });

  const text = [r.name, r.contact, ...r.sections.flatMap((s) => [s.title, ...s.paragraphs, ...s.entries.flatMap((e) => [e.heading, ...e.bullets])])].join("\n");
  const symbols = [...new Set(text.match(/[\p{So}\p{Cs}\p{Co}←-⇿☀-➿]/gu) || [])];
  checks.push({ id: "symbols", label: "Plain characters only", status: symbols.length ? "warn" : "pass", detail: symbols.length ? `Symbols some systems drop or garble: ${symbols.slice(0, 6).join(" ")}` : "No emoji or decorative symbols." });

  checks.push({ id: "file", label: "Real text in the PDF", status: "pass", detail: "Print to PDF keeps the text selectable, not a picture of it. Use the Download PDF button." });
  return checks;
}

export type VoiceHit = { quote: string; why: string };

// The habits that make writing read as machine-made. These run as you type; the Claude read goes further.
export function voiceHits(r: Resume): VoiceHit[] {
  const hits: VoiceHit[] = [];
  const parts = [r.contact, ...r.sections.flatMap((s) => [...s.paragraphs, ...s.entries.flatMap((e) => [e.heading, ...e.bullets])])];
  const seen = new Set<string>();
  for (const line of parts) {
    for (const m of line.matchAll(new RegExp(STOCK_WORDS.source, "gi"))) {
      if (!seen.has(m[0].toLowerCase())) {
        seen.add(m[0].toLowerCase());
        hits.push({ quote: m[0], why: "Stock word. Say what you did in plain words." });
      }
    }
    if (line.includes("—") && !seen.has("—")) {
      seen.add("—");
      hits.push({ quote: "—", why: "Em dash. Use a comma, a period or “and”." });
    }
    if (/\bnot (?:only|just|merely)\b[^.]{0,80}\bbut\b/i.test(line)) hits.push({ quote: line.slice(0, 80), why: "“Not only … but” is a common machine pattern. Say it directly." });
  }
  for (const b of r.sections.flatMap((s) => s.entries.flatMap((e) => e.bullets))) {
    if ((b.match(/\b\w+ing\b/g) || []).length >= 4) hits.push({ quote: b.slice(0, 80) + (b.length > 80 ? "…" : ""), why: "A stack of “-ing” phrases. Split it or cut it." });
  }
  const starts = r.sections.flatMap((s) => s.entries.flatMap((e) => e.bullets)).map((b) => b.split(/\s+/)[0]?.toLowerCase());
  const repeated = [...new Set(starts.filter((w, i) => w && w.length > 3 && starts.indexOf(w) !== i))];
  if (repeated.length) hits.push({ quote: repeated.slice(0, 3).join(", "), why: "Several bullets start with the same word. Vary the openings." });
  return hits;
}

// Which of a job's keywords the resume already uses.
export function keywordCoverage(text: string, keywords: { term: string }[]) {
  const lower = text.toLowerCase();
  const found = keywords.filter((k) => lower.includes(k.term.toLowerCase()));
  return { found, missing: keywords.filter((k) => !found.includes(k)) };
}

export function wordCount(r: Resume) {
  return [r.name, r.contact, ...r.sections.flatMap((s) => [s.title, ...s.paragraphs, ...s.entries.flatMap((e) => [e.heading, ...e.bullets])])].join(" ").split(/\s+/).filter(Boolean).length;
}

/* ---------- Matching a pasted job description ---------- */

// A skill or requirement the job asks for, with other wording a screener would count as the same thing.
export type KeywordItem = { term: string; importance: "must" | "nice"; alsoCounts: string[]; tip?: string };
export type KeywordStatus = "found" | "related" | "missing";

// Words that mean the same thing to a reader (and, increasingly, to a screening system). The first is the usual name.
const GROUPS: string[][] = [
  ["design system", "design systems", "component library", "design tokens", "pattern library", "style guide"],
  ["user research", "usability testing", "user testing", "user interviews", "customer research", "research"],
  ["prototyping", "prototype", "interactive mockups", "high-fidelity", "low-fidelity", "clickable"],
  ["wireframes", "wireframing", "wireframe", "sketches", "mockups"],
  ["user flows", "journey mapping", "user journeys", "journey map", "task flows", "flows"],
  ["information architecture", "navigation", "site map", "sitemap", "content structure"],
  ["interaction design", "microinteractions", "micro-interactions", "interaction patterns"],
  ["visual design", "visual hierarchy", "typography", "layout", "brand", "ui design", "ui"],
  ["ux design", "ux", "user experience", "product design", "experience design"],
  ["accessibility", "wcag", "a11y", "inclusive design", "screen reader"],
  ["responsive", "responsive design", "mobile-first", "adaptive"],
  ["cross-functional", "stakeholders", "collaborate with engineers", "partner with product", "product managers", "engineering partners"],
  ["handoff", "hand-off", "developer handoff", "specs", "dev handoff", "engineering handoff"],
  ["a/b testing", "experimentation", "experiments", "split testing", "ab testing"],
  ["data-informed", "data-driven", "analytics", "metrics", "quantitative", "kpis"],
  ["agile", "scrum", "sprints", "kanban"],
  ["workshops", "design sprints", "facilitation", "facilitate"],
  ["roadmap", "product strategy", "strategy", "vision", "prioritization", "prioritisation"],
  ["end-to-end", "0-to-1", "zero to one", "from concept to launch", "full lifecycle", "ownership"],
  ["presenting", "communication", "storytelling", "explain design decisions", "design rationale", "present"],
  ["mentoring", "mentorship", "coaching", "design leadership"],
  ["saas", "b2b", "enterprise software", "b2c", "consumer"],
  ["ai", "generative ai", "llm", "machine learning", "ai tools", "prompt", "copilot", "ai-assisted"],
  ["portfolio", "case studies", "case study"],
  ["figma"], ["sketch app"], ["adobe xd"], ["photoshop"], ["illustrator"], ["after effects"], ["framer"], ["principle"], ["invision"], ["miro"], ["figjam"],
  ["storybook"], ["zeroheight"], ["jira"], ["confluence"], ["html"], ["css"], ["javascript"], ["react"], ["typescript"], ["tailwind"], ["webflow"],
  ["amplitude"], ["mixpanel"], ["hotjar"], ["usertesting"], ["maze"], ["dovetail"], ["tableau"], ["looker"], ["sql"], ["python"], ["notion"],
  ["ios"], ["android"], ["mobile"], ["web"], ["dashboard", "dashboards", "data visualization", "data viz"],
];

const STOP = new Set(
  "about above across after again also been being below between both could does doing down during each from further have having here into itself just more most must need only other over same should some such than that their them then there these they this those through under until very want were what when where which while will with within without would your you our the and for are but not all any can had has her him his how its may nor off once out own she too was who why able work working team teams role company experience years year strong ability skills including related".split(" "),
);

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Hyphens and spaces are interchangeable ("end-to-end", "end to end"), and a plural counts as the same word.
const wordRe = (term: string, flags = "i") => new RegExp(`(?<![a-z0-9])${escapeRe(term.toLowerCase()).replace(/[- ]/g, "[-\\s]+")}(?:s|es)?(?![a-z0-9])`, flags);

// Pulls the skills and requirements out of a pasted job description, with no AI: known design and tech terms
// (and what else counts as the same thing), plus the posting's own most repeated words.
export function localKeywords(jd: string): KeywordItem[] {
  const text = jd.toLowerCase();
  if (text.trim().length < 40) return [];
  const niceFrom = text.search(/preferred|nice to have|bonus|a plus|good to have|nice-to-have/);
  const items: (KeywordItem & { weight: number })[] = [];
  const covered = new Set<string>();
  for (const group of GROUPS) {
    const hits = group
      .map((term) => ({ term, matches: [...text.matchAll(wordRe(term, "gi"))].map((m) => m.index ?? 0) }))
      .filter((h) => h.matches.length);
    if (!hits.length) continue;
    const all = hits.flatMap((h) => h.matches);
    const must = niceFrom < 0 || all.some((i) => i < niceFrom);
    for (const term of group) covered.add(term.split(" ")[0]);
    // Shown under the usual name for the skill, whichever wording the posting used.
    items.push({ term: group[0], importance: must ? "must" : "nice", alsoCounts: group.slice(1), weight: all.length, tip: "Use this word if it describes something you have done." });
  }
  // The posting's own repeated words that aren't already covered.
  const counts = new Map<string, number>();
  for (const w of text.match(/[a-z][a-z-]{4,}/g) || []) if (!STOP.has(w) && !covered.has(w)) counts.set(w, (counts.get(w) || 0) + 1);
  for (const [w, n] of [...counts].filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]).slice(0, 6)) {
    items.push({ term: w, importance: "nice", alsoCounts: [], weight: n, tip: "The posting repeats this word." });
  }
  return items
    .sort((a, b) => (a.importance === b.importance ? b.weight - a.weight : a.importance === "must" ? -1 : 1))
    .slice(0, 26)
    .map((item) => ({ term: item.term, importance: item.importance, alsoCounts: item.alsoCounts, tip: item.tip }));
}

// Live status against the resume text as it is now.
export function statusOf(item: KeywordItem, resumeText: string): KeywordStatus {
  if (wordRe(item.term).test(resumeText)) return "found";
  return item.alsoCounts.some((t) => t.trim() && wordRe(t).test(resumeText)) ? "related" : "missing";
}

// Must-haves count double; wording that means the same thing counts most of the way.
export function matchPercent(items: KeywordItem[], resumeText: string) {
  let earned = 0;
  let total = 0;
  for (const item of items) {
    const weight = item.importance === "must" ? 2 : 1;
    total += weight;
    const s = statusOf(item, resumeText);
    earned += weight * (s === "found" ? 1 : s === "related" ? 0.6 : 0);
  }
  return total ? Math.round((earned / total) * 100) : 0;
}

// Claude's equivalents plus the ones this app already knows, so wording like "cross-functional" isn't missed
// when the posting phrases the same skill differently ("Cross-functional partnership").
export function withEquivalents(items: KeywordItem[]): KeywordItem[] {
  return items.map((item) => {
    // Only the requirement's own name decides which known group applies, so a specific tool isn't credited for a loose match.
    const hay = item.term.toLowerCase();
    const extra = GROUPS.filter((g) => g.length > 1 && g.some((t) => t.length > 3 && hay.includes(t.toLowerCase()))).flat();
    const merged = [...new Set([...item.alsoCounts, ...extra])].filter((t) => t.toLowerCase() !== item.term.toLowerCase());
    return { ...item, alsoCounts: merged };
  });
}
