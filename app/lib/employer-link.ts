// Job sites like Himalayas and Jobicy block automated browsers, but most of their jobs are also posted on the
// employer's own Greenhouse, Lever or Ashby board. This finds that posting so Autopilot can apply there directly.
type Json = Record<string, unknown>;

const LEGAL = /\b(inc|llc|ltd|limited|corp|corporation|co|company|gmbh|plc|technologies|technology|labs|group|hq)\b\.?/g;
const norm = (s: string) => s.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();

function slugs(company: string) {
  const base = norm(company.replace(/\(.*?\)/g, ""));
  const short = base.replace(LEGAL, " ").replace(/\s+/g, " ").trim();
  return [...new Set([short.replace(/ /g, ""), short.replace(/ /g, "-"), base.replace(/ /g, ""), base.replace(/ /g, "-")])].filter((s) => s.length > 1);
}

async function json(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const r = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 (compatible; JobHunter/1.0)" }, signal: controller.signal });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

type Listing = { title: string; url: string };

// Each company's board is fetched once per run of the app.
const boards = new Map<string, Promise<Listing[]>>();

function board(slug: string): Promise<Listing[]> {
  if (!boards.has(slug)) {
    boards.set(
      slug,
      (async () => {
        const gh = (await json(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`)) as { jobs?: Json[] } | null;
        if (gh?.jobs?.length) return gh.jobs.map((j) => ({ title: String(j.title || ""), url: String(j.absolute_url || "") }));
        const lv = (await json(`https://api.lever.co/v0/postings/${slug}?mode=json`)) as Json[] | null;
        if (Array.isArray(lv) && lv.length) return lv.map((j) => ({ title: String(j.text || ""), url: String(j.applyUrl || j.hostedUrl || "") }));
        const ab = (await json(`https://api.ashbyhq.com/posting-api/job-board/${slug}`)) as { jobs?: Json[] } | null;
        if (ab?.jobs?.length) return ab.jobs.filter((j) => j.isListed !== false).map((j) => ({ title: String(j.title || ""), url: String(j.applyUrl || j.jobUrl || "") }));
        return [];
      })(),
    );
  }
  return boards.get(slug)!;
}

// The same job: identical titles, or one title containing the other (boards add "(Remote)" or a team name).
function sameTitle(a: string, b: string) {
  const x = norm(a.replace(/\(.*?\)/g, ""));
  const y = norm(b.replace(/\(.*?\)/g, ""));
  return x === y || (x.length > 12 && y.length > 12 && (x.includes(y) || y.includes(x)));
}

export async function employerLink(company: string, title: string): Promise<string | null> {
  for (const slug of slugs(company)) {
    const jobs = await board(slug);
    if (!jobs.length) continue;
    const hit = jobs.find((j) => norm(j.title) === norm(title)) || jobs.find((j) => sameTitle(j.title, title));
    return hit?.url || null;
  }
  return null;
}
