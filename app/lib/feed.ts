import { database } from "./automation-auth";
import { fetchBoard, type Ats, type Posting } from "./job-boards";
import { quickMatch, stem } from "./job-analysis";
import { getAnswers, getProfile } from "./profile";
import { getPrefs, type SearchPrefs } from "./search-prefs";

export type Company = {
  id: string;
  name: string;
  ats: Ats;
  token: string;
  careers_url: string;
  job_count: number;
  last_checked_at: string;
  last_error: string;
  // Comma-separated options: "creative" also looks for the person's creative titles here; "anywhere" ignores their places (ski resorts are in mountain towns).
  role_set: string;
};

const TITLE_FILLER = new Set(["and", "of", "the", "for", "a", "an", "in", "to", "at", "with"]);
const titleTokens = (s: string) =>
  s
    .toLowerCase()
    .split(/[^a-z0-9+#]+/)
    .filter((t) => t && !TITLE_FILLER.has(t))
    .map(stem);

// Short words must match exactly ("UX", "RN"); longer ones match the start of a word, so "Design" finds "Designer".
export function titleFits(title: string, prefs: SearchPrefs) {
  if (!prefs.roles.length) return true;
  const words = titleTokens(title);
  const has = (t: string) => words.some((w) => w === t || (t.length >= 4 && w.startsWith(t)));
  return prefs.roles.some((role) => titleTokens(role).every(has));
}

const STATES: Record<string, string> = {
  alabama: "al", alaska: "ak", arizona: "az", arkansas: "ar", california: "ca", colorado: "co", connecticut: "ct", delaware: "de",
  florida: "fl", georgia: "ga", hawaii: "hi", idaho: "id", illinois: "il", indiana: "in", iowa: "ia", kansas: "ks", kentucky: "ky",
  louisiana: "la", maine: "me", maryland: "md", massachusetts: "ma", michigan: "mi", minnesota: "mn", mississippi: "ms", missouri: "mo",
  montana: "mt", nebraska: "ne", nevada: "nv", "new hampshire": "nh", "new jersey": "nj", "new mexico": "nm", "new york": "ny",
  "north carolina": "nc", "north dakota": "nd", ohio: "oh", oklahoma: "ok", oregon: "or", pennsylvania: "pa", "rhode island": "ri",
  "south carolina": "sc", "south dakota": "sd", tennessee: "tn", texas: "tx", utah: "ut", vermont: "vt", virginia: "va",
  washington: "wa", "west virginia": "wv", wisconsin: "wi", wyoming: "wy",
};
// Other ways job boards write a place: "NYC", "Hoboken, NJ", "Barcelona" for Spain.
const PLACE_ALIASES: Record<string, string[]> = {
  "new york": ["nyc", "brooklyn", "manhattan"],
  "new jersey": ["jersey city", "hoboken", "princeton"],
  "san francisco": ["sf bay", "bay area"],
  "united states": ["usa", "u.s.", "us"],
  "united kingdom": ["uk", "london", "manchester", "edinburgh"],
  spain: ["españa", "madrid", "barcelona", "valencia", "sevilla", "seville", "málaga", "malaga", "bilbao"],
  portugal: ["lisbon", "lisboa", "porto"],
  germany: ["deutschland", "berlin", "munich", "münchen", "hamburg"],
  france: ["paris"],
  netherlands: ["amsterdam"],
  ireland: ["dublin"],
  canada: ["toronto", "vancouver", "montreal"],
};

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const hasWord = (text: string, word: string) => new RegExp(`(^|[^\\p{L}])${escape(word)}($|[^\\p{L}])`, "u").test(text);

function placeFits(where: string, wanted: string) {
  const place = wanted.toLowerCase().split(/[,—–]/)[0].trim();
  if (place.length < 2) return false;
  const state = STATES[place];
  return (
    where.includes(place) ||
    (PLACE_ALIASES[place] || []).some((alias) => hasWord(where, alias)) ||
    // "Hoboken, NJ", "(NJ)", or Workday's "NJ - Newark".
    Boolean(state && new RegExp(`(,\\s*|\\()${state}\\b|(^|[\\s/])${state}\\s+-\\s`).test(where))
  );
}

// Titles that don't fit the person's saved experience level (Profile → Answers). "Senior / Staff" counts as senior.
const ABOVE_SENIOR = /\b(staff|principal|lead|distinguished|founding)\b/i;
// Managing people is a different job, whatever the seniority word.
const MANAGES = /\b(head|director|vp|vice president|manager|chief)\b/i;
// Internships and student programs; early-career and junior roles are fine from mid level down.
const STUDENT = /\b(intern|internship|apprentice|apprenticeship|student|co-?op)\b/i;

export function levelFits(title: string, level: string) {
  const t = title.toLowerCase();
  const senior = /\bsenior\b|\bsr\.?\b/.test(t);
  switch (level) {
    case "Entry level":
      return !STUDENT.test(t) && !ABOVE_SENIOR.test(t) && !MANAGES.test(t) && !senior;
    case "Mid level":
    case "Senior":
      // Early career through senior: staff, principal and lead titles are skipped unless the title also offers a senior level; manager titles always are.
      return !STUDENT.test(t) && !MANAGES.test(t) && (!ABOVE_SENIOR.test(t) || senior);
    case "Lead or manager":
      return !STUDENT.test(t);
    default:
      return true;
  }
}

// Years of experience a posting asks for ("5+ years of product design", "at least 6 years", "7-10 years in UX").
// Only counts mentions next to design or product work, and takes the largest, since that's the bar screeners hold to.
export function yearsAsked(description: string) {
  const text = description.toLowerCase().replace(/\s+/g, " ");
  let most = 0;
  for (const m of text.matchAll(/(?:at least |minimum of |min\.? )?(\d{1,2})\s*(?:\+|plus|or more|-\s*\d{1,2}|–\s*\d{1,2}|to \d{1,2})?\s*(?:\+\s*)?years?/g)) {
    const n = Number(m[1]);
    const near = text.slice(Math.max(0, m.index! - 80), m.index! + m[0].length + 80);
    const after = text.slice(m.index! + m[0].length, m.index! + m[0].length + 70);
    // Ages ("18 years of age", sometimes misspelled), and alternatives to the main requirement ("10 years of trade experience will also be considered") aren't the bar.
    const before = text.slice(Math.max(0, m.index! - 40), m.index!);
    const notTheBar = /^\s*(?:old|ago|[a-z]f age|and (?:over|older)|or (?:over|older))/.test(after) || /also be considered|be substituted|in lieu/.test(after) || /equivalent|in lieu|substitut/.test(before);
    if (n >= 1 && n <= 15 && /design|ux|product|interaction|experience/.test(near) && !notTheBar) most = Math.max(most, n);
  }
  return most;
}

// The person has about two years in-house plus freelance work since 2023; postings asking for more than this get screened out.
export const MAX_YEARS_ASKED = 5;

// A job fits when its title contains every word of one wanted title, it's at the person's level, it's in a wanted place, and it has no excluded words.
export function fitsPrefs(p: Pick<Posting, "title" | "location" | "workplace" | "description">, prefs: SearchPrefs, level = "") {
  if (!titleFits(p.title, prefs) || !levelFits(p.title, level)) return false;
  if (level !== "Lead or manager" && yearsAsked(p.description || "") > MAX_YEARS_ASKED) return false;
  if (prefs.locations.length) {
    const where = `${p.location} ${p.workplace}`.toLowerCase();
    const ok = prefs.locations.some((loc) =>
      loc.toLowerCase().includes("remote") ? p.workplace === "Remote" || where.includes("remote") : placeFits(where, loc),
    );
    if (!ok) return false;
  }
  const haystack = `${p.title}\n${p.description}`.toLowerCase();
  return !prefs.excludedTerms.some((term) => term && haystack.includes(term.toLowerCase()));
}

export async function listCompanies(userId: string) {
  const rows = await database().prepare("SELECT * FROM companies WHERE user_id=? ORDER BY name COLLATE NOCASE").bind(userId).all<Company>();
  return rows.results || [];
}

async function refreshCompany(userId: string, company: Company, basePrefs: SearchPrefs, resume: string, startedAt: string, level: string, countries: string[]) {
  const db = database();
  const flags = new Set(company.role_set.split(",").filter(Boolean));
  // Ski resorts, universities and the like are also searched for the person's creative titles, and some in any place.
  const prefs: SearchPrefs = {
    ...basePrefs,
    roles: flags.has("creative") ? [...new Set([...basePrefs.roles, ...basePrefs.creativeRoles])] : basePrefs.roles,
    locations: flags.has("anywhere") ? [] : basePrefs.locations,
  };
  try {
    const stored = await db.prepare("SELECT id FROM feed_jobs WHERE user_id=? AND company_id=?").bind(userId, company.id).all<{ id: string }>();
    const known = new Set((stored.results || []).map((r) => r.id.slice(company.id.length + 1)));
    const { jobs, total } = await fetchBoard(
      { ats: company.ats, token: company.token },
      { searchTerms: prefs.roles, keep: (title) => titleFits(title, prefs) && levelFits(title, level), known, countries, locations: prefs.locations },
    );
    // A posting listed without a description is one already stored that passed the filters before.
    const matching = jobs.filter((j) => (j.description ? fitsPrefs(j, prefs, level) : known.has(j.externalId) && levelFits(j.title, level)));
    // Batched so a large company doesn't make hundreds of separate writes.
    const statements = matching.map((j) =>
      db
        .prepare(
          `INSERT INTO feed_jobs (id,user_id,company_id,company,title,location,workplace,url,apply_url,salary,description,posted_at,match_score,status,application_id,first_seen_at,last_seen_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'new','',?,?)
           ON CONFLICT(id) DO UPDATE SET title=excluded.title,url=excluded.url,apply_url=CASE WHEN (excluded.apply_url LIKE '%himalayas.app%' OR excluded.apply_url LIKE '%jobicy.com%') AND feed_jobs.apply_url NOT LIKE '%himalayas.app%' AND feed_jobs.apply_url NOT LIKE '%jobicy.com%' AND feed_jobs.apply_url<>'' THEN feed_jobs.apply_url ELSE excluded.apply_url END,last_seen_at=excluded.last_seen_at,
             location=CASE WHEN excluded.description='' THEN feed_jobs.location ELSE excluded.location END,
             workplace=CASE WHEN excluded.description='' THEN feed_jobs.workplace ELSE excluded.workplace END,
             salary=CASE WHEN excluded.description='' THEN feed_jobs.salary ELSE excluded.salary END,
             description=CASE WHEN excluded.description='' THEN feed_jobs.description ELSE excluded.description END,
             posted_at=CASE WHEN excluded.description='' THEN feed_jobs.posted_at ELSE excluded.posted_at END,
             match_score=CASE WHEN excluded.description='' THEN feed_jobs.match_score ELSE excluded.match_score END`,
        )
        .bind(
          `${company.id}:${j.externalId}`, userId, company.id, j.company || company.name, j.title, j.location, j.workplace, j.url, j.applyUrl, j.salary,
          j.description, j.postedAt, quickMatch(j.description, resume), startedAt, startedAt,
        ),
    );
    for (let i = 0; i < statements.length; i += 50) await db.batch(statements.slice(i, i + 50));
    // Postings that closed, or no longer fit the preferences, leave the feed unless the person already saved them.
    await db
      .prepare("DELETE FROM feed_jobs WHERE user_id=? AND company_id=? AND last_seen_at<? AND status!='added'")
      .bind(userId, company.id, startedAt)
      .run();
    await db
      .prepare("UPDATE companies SET job_count=?,last_checked_at=?,last_error='' WHERE id=? AND user_id=?")
      .bind(total, startedAt, company.id, userId)
      .run();
    return { company: company.name, total, matching: matching.length };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Couldn’t read this job board.";
    await db.prepare("UPDATE companies SET last_checked_at=?,last_error=? WHERE id=? AND user_id=?").bind(startedAt, message, company.id, userId).run();
    return { company: company.name, total: 0, matching: 0, error: message };
  }
}

export async function refreshFeed(userId: string, onlyCompanyId?: string) {
  const [companies, prefs, profile, answers] = await Promise.all([listCompanies(userId), getPrefs(userId), getProfile(userId), getAnswers(userId)]);
  const targets = onlyCompanyId ? companies.filter((c) => c.id === onlyCompanyId) : companies;
  // Remote jobs from job sites must be open to a country the person can work in, or one they named as a place.
  const countries = [...new Set([...answers.authorized.split(/,\s*/), ...prefs.locations].map((c) => c.trim()).filter((c) => c && !/remote/i.test(c)))];
  const startedAt = new Date().toISOString();
  const results = [];
  // A few at a time keeps things quick without hammering any job board.
  for (let i = 0; i < targets.length; i += 4) {
    results.push(...(await Promise.all(targets.slice(i, i + 4).map((c) => refreshCompany(userId, c, prefs, profile?.resumeText || "", startedAt, answers.level, countries)))));
  }
  return results;
}
