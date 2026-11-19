// Reads public job boards. These APIs are free, need no account, and only learn which company is being checked.

export type Ats = "greenhouse" | "lever" | "ashby" | "workday" | "workable" | "smartrecruiters" | "bamboohr" | "recruitee" | "mcloud" | "successfactors" | "ukg" | "sitemap" | "himalayas" | "jobicy" | "remotive" | "workablejobs";
// Job sites that list many companies' jobs at once, searched by the person's job titles (and places, where the site supports it).
export const JOB_SITES: Ats[] = ["himalayas", "jobicy", "remotive", "workablejobs"];
export type Board = { ats: Ats; token: string };

export type Posting = {
  externalId: string;
  title: string;
  location: string;
  workplace: "Remote" | "Hybrid" | "On-site" | "";
  url: string;
  applyUrl: string;
  salary: string;
  description: string;
  postedAt: string;
  // Only set when the board reports it per posting (Workday).
  company?: string;
};

export const ATS_LABEL: Record<Ats, string> = {
  greenhouse: "Greenhouse",
  lever: "Lever",
  ashby: "Ashby",
  workday: "Workday",
  workable: "Workable",
  smartrecruiters: "SmartRecruiters",
  bamboohr: "BambooHR",
  recruitee: "Recruitee",
  mcloud: "Careers site (m-cloud)",
  successfactors: "SuccessFactors",
  ukg: "UKG Pro",
  sitemap: "Careers site (job pages)",
  himalayas: "Himalayas (remote jobs)",
  jobicy: "Jobicy (remote jobs)",
  remotive: "Remotive (remote jobs)",
  workablejobs: "Workable jobs (small employers, by place)",
};

const PATTERNS: [Ats, RegExp][] = [
  ["greenhouse", /(?:boards|job-boards)(?:\.eu)?\.greenhouse\.io\/(?:embed\/job_board(?:\/js)?\?for=)?([\w-]+)/i],
  ["greenhouse", /boards-api\.greenhouse\.io\/v1\/boards\/([\w-]+)/i],
  ["greenhouse", /greenhouse\.io\/embed\/job_board(?:\/js)?\?(?:[^"'\s]*&)?for=([\w-]+)/i],
  ["lever", /jobs(?:\.eu)?\.lever\.co\/([\w.-]+)/i],
  ["lever", /api(?:\.eu)?\.lever\.co\/v0\/postings\/([\w.-]+)/i],
  ["ashby", /jobs\.ashbyhq\.com\/([\w.%-]+)/i],
  ["ashby", /api\.ashbyhq\.com\/posting-api\/job-board\/([\w.%-]+)/i],
  ["workable", /apply\.workable\.com\/api\/v\d\/(?:widget\/)?accounts\/([\w-]+)/i],
  ["workable", /apply\.workable\.com\/([\w-]+)/i],
  ["workable", /\/\/([\w-]+)\.workable\.com\b/i],
  ["smartrecruiters", /smartrecruiters\.com\/oneclick-ui\/company\/([\w.-]+)/i],
  ["smartrecruiters", /api\.smartrecruiters\.com\/v1\/companies\/([\w.-]+)/i],
  ["smartrecruiters", /(?:jobs|careers)\.smartrecruiters\.com\/([\w.-]+)/i],
  ["bamboohr", /\/\/([\w-]+)\.bamboohr\.com\/(?:careers|jobs)/i],
  ["recruitee", /\/\/([\w-]+)\.recruitee\.com/i],
];
const NOT_TOKENS = new Set(["embed", "v1", "api", "jobs", "job_board", "boards", "j", "www", "apply", "app", "widget", "accounts", "resources", "help", "blog", "oneclick-ui"]);

// Workday boards are identified by host, tenant and site, stored together as "host/tenant/site".
const WORKDAY_JOBS = /\b([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com\/(?:[a-z]{2}-[A-Z]{2}\/)?([\w-]+)/i;
const WORKDAY_SITE = /\b(wd\d+)\.myworkdaysite\.com\/(?:[a-z]{2}-[A-Z]{2}\/)?recruiting\/([\w-]+)\/([\w-]+)/i;

function workdayFromText(text: string): Board | null {
  const a = text.match(WORKDAY_JOBS);
  if (a && a[3].toLowerCase() !== "wday") return { ats: "workday", token: `${a[1]}.${a[2]}.myworkdayjobs.com/${a[1]}/${a[3]}` };
  const b = text.match(WORKDAY_SITE);
  if (b) return { ats: "workday", token: `${b[1]}.myworkdaysite.com/${b[2]}/${b[3]}` };
  return null;
}

export function boardFromText(text: string): Board | null {
  const site = text.match(/\b(himalayas|jobicy|remotive)\.(app|com)\b/i)?.[1]?.toLowerCase();
  if (site) return { ats: site as Ats, token: site };
  if (/\bjobs\.workable\.com\b/i.test(text)) return { ats: "workablejobs", token: "workablejobs" };
  const workday = workdayFromText(text);
  if (workday) return workday;
  // Corporate career sites built on the m-cloud jobs API (UPMC and others) name their company id in the page's script settings.
  const mcloud = text.match(/"org"\s*:\s*"companies\\?\/([0-9a-f]{8}-[0-9a-f-]{27})"/i)?.[1];
  if (mcloud && /m-cloud\.io/i.test(text)) return { ats: "mcloud", token: mcloud.toLowerCase() };
  const ukg = text.match(/(recruiting\d?\.ultipro\.com)\/(\w+)\/JobBoard\/([0-9a-f]{8}-[0-9a-f-]{27})/i);
  if (ukg) return { ats: "ukg", token: `${ukg[1].toLowerCase()}/${ukg[2]}/${ukg[3].toLowerCase()}` };
  for (const [ats, re] of PATTERNS) {
    const token = text.match(re)?.[1];
    if (token && !NOT_TOKENS.has(token.toLowerCase())) return { ats, token: decodeURIComponent(token) };
  }
  return null;
}

async function get(url: string, accept = "application/json", body?: unknown) {
  const controller = new AbortController();
  // Big boards with full descriptions (Greenhouse) can take a while.
  const timer = setTimeout(() => controller.abort(), 45000);
  try {
    const r = await fetch(url, {
      method: body ? "POST" : "GET",
      headers: { Accept: accept, "User-Agent": "Mozilla/5.0 (compatible; JobHunter/1.0)", ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
      redirect: "follow",
    });
    if (r.status === 404) throw new Error("That page wasn’t found — the job or job board may have closed.");
    if (!r.ok) throw new Error(`The job board returned an error (${r.status}).`);
    return r;
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") throw new Error("The job board took too long to answer.");
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// Works with a board link, or with a company careers page that embeds or links to one.
export async function findBoard(input: string): Promise<Board> {
  const direct = boardFromText(input);
  if (direct) return direct;
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
  } catch {
    throw new Error("Paste the company’s careers page link.");
  }
  const html = await get(url.toString(), "text/html")
    .then((r) => r.text())
    .catch(() => "");
  const found = boardFromText(html.slice(0, 3_000_000));
  if (found) return found;
  // Many careers pages load jobs with JavaScript; the board is usually named after the company's domain.
  const site = await guessFromSite(url);
  if (site) return site;
  const guess = await guessFromDomain(url.hostname);
  if (guess) return guess;
  throw new Error("We couldn’t find a job board we can read for that company (Greenhouse, Lever, Ashby, Workday, Workable, SmartRecruiters, BambooHR, Recruitee, UKG, SuccessFactors, or a careers site that lists its jobs in a sitemap). Try the link of one of its job postings.");
}

// Career sites with no recognisable link: SuccessFactors sites share an RSS search, and many others list job pages in a sitemap with structured data.
async function guessFromSite(url: URL): Promise<Board | null> {
  const rss = await get(`${url.origin}/services/rss/job/?locale=en_US&keywords=`, "application/rss+xml")
    .then((r) => r.text())
    .then((x) => /<rss[\s>]/.test(x) && /<item>/.test(x))
    .catch(() => false);
  if (rss) return { ats: "successfactors", token: url.host };
  const robots = await get(`${url.origin}/robots.txt`, "text/plain")
    .then((r) => r.text())
    .catch(() => "");
  const maps = [...new Set([...[...robots.matchAll(/^sitemap:\s*(\S+)/gim)].map((m) => m[1]), `${url.origin}/sitemap.xml`])];
  for (const map of maps) {
    // Real job pages end in a title or id; index pages ("/jobs/") don't.
    const all = (await sitemapUrls(map)).filter((u) => JOB_PATH.test(u) && titleFromUrl(u));
    for (const jobUrl of all.slice(0, 3)) {
      const page = await pageText(jobUrl).catch(() => "");
      // Structured data is the best sign; a long list of job pages with a heading each is good enough.
      if (jobPostingOf(page) || (all.length >= 10 && page.length > 8000 && /<h1[^>]*>[^<]{3,}/i.test(page))) return { ats: "sitemap", token: url.origin };
    }
  }
  return null;
}

const HOST_NOISE = new Set(["www", "careers", "career", "jobs", "job", "apply", "work", "join", "about", "com", "co", "io", "org", "net", "ai", "uk", "us"]);

async function guessFromDomain(hostname: string): Promise<Board | null> {
  const name = hostname.toLowerCase().split(".").find((part) => !HOST_NOISE.has(part));
  if (!name) return null;
  const tries: [Ats, string][] = [
    ["greenhouse", `https://boards-api.greenhouse.io/v1/boards/${name}`],
    ["lever", `https://api.lever.co/v0/postings/${name}?mode=json&limit=1`],
    ["ashby", `https://api.ashbyhq.com/posting-api/job-board/${name}`],
  ];
  for (const [ats, url] of tries) {
    const ok = await get(url)
      .then((r) => r.json() as Promise<Json | Json[]>)
      .then((d) => (Array.isArray(d) ? d.length > 0 : Boolean(d.name || d.jobs)))
      .catch(() => false);
    if (ok) return { ats, token: name };
  }
  return null;
}

/* ---------- Normalising ---------- */

const entities: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " };
const decode = (s: string) =>
  s.replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m) => entities[m] || m).replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));

export function htmlToText(html: string) {
  return decode(
    html
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<h[1-6][^>]*>/gi, "\n## ")
      .replace(/<\/h[1-6]>/gi, "\n")
      .replace(/<li[^>]*>/gi, "\n• ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|ul|ol|li|section)>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function workplaceOf(...hints: (string | boolean | undefined | null)[]): Posting["workplace"] {
  const text = hints.filter((h) => typeof h === "string").join(" ").toLowerCase();
  if (hints.includes(true) || /remote/.test(text)) return /hybrid/.test(text) ? "Hybrid" : "Remote";
  if (/hybrid/.test(text)) return "Hybrid";
  if (/on-?site|in office|in-office/.test(text)) return "On-site";
  return "";
}

type Json = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));

async function greenhouse(token: string) {
  const [meta, list] = await Promise.all([
    get(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}`).then((r) => r.json() as Promise<Json>).catch(() => ({}) as Json),
    get(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs?content=true`).then((r) => r.json() as Promise<{ jobs?: Json[] }>),
  ]);
  const jobs = (list.jobs || []).map((j): Posting => {
    const location = str((j.location as Json | undefined)?.name).trim();
    const description = htmlToText(decode(str(j.content)));
    return {
      externalId: str(j.id),
      title: str(j.title).trim(),
      location,
      workplace: workplaceOf(location, description.slice(0, 600)),
      url: str(j.absolute_url),
      applyUrl: str(j.absolute_url),
      salary: "",
      description,
      postedAt: str(j.first_published || j.updated_at),
    };
  });
  return { name: str(meta.name), jobs };
}

async function lever(token: string) {
  const list = (await (await get(`https://api.lever.co/v0/postings/${encodeURIComponent(token)}?mode=json`)).json()) as Json[];
  const jobs = list.map((j): Posting => {
    const cats = (j.categories || {}) as Json;
    const lists = ((j.lists || []) as Json[]).map((l) => `## ${str(l.text)}\n${htmlToText(str(l.content))}`).join("\n\n");
    const range = j.salaryRange as Json | undefined;
    return {
      externalId: str(j.id),
      title: str(j.text).trim(),
      location: str(cats.location),
      workplace: workplaceOf(str(j.workplaceType), str(cats.location)),
      url: str(j.hostedUrl),
      applyUrl: str(j.applyUrl || j.hostedUrl),
      salary: range?.min ? `${range.currency || ""} ${range.min}–${range.max}${range.interval ? ` ${str(range.interval).replace(/-/g, " ")}` : ""}`.trim() : "",
      description: [str(j.descriptionPlain), lists, str(j.additionalPlain)].filter(Boolean).join("\n\n").trim(),
      postedAt: j.createdAt ? new Date(Number(j.createdAt)).toISOString() : "",
    };
  });
  return { name: "", jobs };
}

async function ashby(token: string) {
  const list = (await (await get(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(token)}?includeCompensation=true`)).json()) as { jobs?: Json[] };
  const jobs = (list.jobs || [])
    .filter((j) => j.isListed !== false)
    .map((j): Posting => ({
      externalId: str(j.id),
      title: str(j.title).trim(),
      location: str(j.location),
      workplace: workplaceOf(str(j.workplaceType), j.isRemote === true, str(j.location)),
      url: str(j.jobUrl),
      applyUrl: str(j.applyUrl || j.jobUrl),
      salary: str((j.compensation as Json | undefined)?.compensationTierSummary),
      description: str(j.descriptionPlain).trim() || htmlToText(str(j.descriptionHtml)),
      postedAt: str(j.publishedAt),
    }));
  return { name: "", jobs };
}

// The titles to search a large board for. "Graphic Designer" and "Graphic Design" are one search, since boards match word stems.
function searchTermsOf(opts: FetchOptions, max = 18) {
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const t of opts.searchTerms || []) {
    const key = t.toLowerCase().replace(/\bdesigners?\b/g, "design").replace(/\s+/g, " ").trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    terms.push(t);
  }
  return terms.length ? terms.slice(0, max) : [""];
}

/* ---------- Small-company systems: Workable, SmartRecruiters, BambooHR, Recruitee ---------- */

type Fetched = { name: string; jobs: Posting[]; total?: number };

// "2026-11-06 17:01:19 UTC" → an ISO date.
function isoDate(text: string) {
  const d = new Date(text.replace(" UTC", "Z").replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

// Boards that list short summaries and need one request per posting for its description (like Workday).
async function withDetails(listed: Json[], idOf: (j: Json) => string, known: Set<string> | undefined, detail: (j: Json) => Promise<Posting>, summary: (j: Json) => Posting) {
  const jobs: Posting[] = [];
  const toFetch = listed.filter((j) => !known?.has(idOf(j))).slice(0, 60);
  for (let i = 0; i < toFetch.length; i += 4) {
    const batch = await Promise.all(toFetch.slice(i, i + 4).map((j) => detail(j).catch(() => null)));
    jobs.push(...batch.filter((j): j is Posting => Boolean(j)));
  }
  // Already-known postings are listed without a description so the feed keeps its stored copy.
  for (const j of listed.filter((j) => known?.has(idOf(j)))) jobs.push(summary(j));
  return jobs;
}

async function workable(token: string): Promise<Fetched> {
  const d = (await (await get(`https://www.workable.com/api/accounts/${encodeURIComponent(token)}?details=true`)).json()) as { name?: string; jobs?: Json[] };
  const jobs = (d.jobs || []).map((j): Posting => {
    const location = [str(j.city), str(j.state), str(j.country)].filter(Boolean).join(", ");
    return {
      externalId: str(j.shortcode),
      title: str(j.title).trim(),
      location,
      workplace: workplaceOf(j.telecommuting === true, location),
      url: str(j.url || j.shortlink),
      applyUrl: str(j.application_url || j.url || j.shortlink),
      salary: "",
      description: htmlToText(str(j.description)),
      postedAt: str(j.published_on || j.created_at),
    };
  });
  return { name: str(d.name), jobs };
}

async function smartrecruiters(token: string, opts: FetchOptions): Promise<Fetched> {
  const api = `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(token)}/postings`;
  const head = (await (await get(`${api}?limit=1`)).json()) as { totalFound?: number; content?: Json[] };
  const name = str((head.content?.[0]?.company as Json | undefined)?.name);
  // Big employers list hundreds of jobs, so search for each wanted title instead of reading everything.
  const terms = searchTermsOf(opts);
  const listings = new Map<string, Json>();
  for (const term of terms) {
    for (let offset = 0; offset < 200; offset += 100) {
      const page = (await (await get(`${api}?limit=100&offset=${offset}&q=${encodeURIComponent(term)}`)).json()) as { content?: Json[] };
      for (const j of page.content || []) listings.set(str(j.id), j);
      if ((page.content?.length || 0) < 100) break;
    }
  }
  const place = (j: Json) => str((j.location as Json | undefined)?.fullLocation).replace(/(,\s*)+/g, ", ").replace(/^,\s*|,\s*$/g, "");
  const wanted = [...listings.values()].filter((j) => !opts.keep || opts.keep(str(j.name), place(j)));
  const summary = (j: Json): Posting => ({ externalId: str(j.id), title: str(j.name).trim(), location: place(j), workplace: "", url: `https://jobs.smartrecruiters.com/${token}/${str(j.id)}`, applyUrl: `https://jobs.smartrecruiters.com/${token}/${str(j.id)}`, salary: "", description: "", postedAt: str(j.releasedDate) });
  const jobs = await withDetails(
    wanted,
    (j) => str(j.id),
    opts.known,
    async (j) => {
      const d = (await (await get(`${api}/${str(j.id)}`)).json()) as Json;
      const sections = (((d.jobAd as Json | undefined)?.sections || {}) as Record<string, Json>) || {};
      const description = ["jobDescription", "qualifications", "additionalInformation"].map((k) => htmlToText(str(sections[k]?.text))).filter(Boolean).join("\n\n");
      const loc = ((d.location || j.location || {}) as Json) || {};
      const location = place({ location: loc });
      return {
        externalId: str(j.id),
        title: str(d.name || j.name).trim(),
        location,
        workplace: workplaceOf(loc.remote === true, loc.hybrid === true ? "hybrid" : "", location),
        url: str(d.postingUrl),
        applyUrl: str(d.applyUrl || d.postingUrl),
        salary: "",
        description,
        postedAt: str(d.releasedDate || j.releasedDate),
        company: str((d.company as Json | undefined)?.name) || name,
      };
    },
    summary,
  );
  return { name, jobs, total: head.totalFound || jobs.length };
}

async function bamboohr(token: string, opts: FetchOptions): Promise<Fetched> {
  const base = `https://${encodeURIComponent(token)}.bamboohr.com/careers`;
  const list = ((await (await get(`${base}/list`)).json()) as { result?: Json[] }).result || [];
  const place = (l: Json | undefined) => [str(l?.city), str(l?.state)].filter(Boolean).join(", ");
  // BambooHR's location types: 0 in the office, 1 remote, 2 hybrid.
  const kind = (type: unknown, remote?: unknown): Posting["workplace"] => (type === "1" || remote === true ? "Remote" : type === "2" ? "Hybrid" : type === "0" ? "On-site" : "");
  const wanted = list.filter((j) => !opts.keep || opts.keep(str(j.jobOpeningName), place(j.location as Json | undefined)));
  const summary = (j: Json): Posting => ({ externalId: str(j.id), title: str(j.jobOpeningName).trim(), location: place(j.location as Json | undefined), workplace: kind(j.locationType, j.isRemote), url: `${base}/${str(j.id)}`, applyUrl: `${base}/${str(j.id)}`, salary: "", description: "", postedAt: "" });
  const jobs = await withDetails(
    wanted,
    (j) => str(j.id),
    opts.known,
    async (j) => {
      const d = ((await (await get(`${base}/${str(j.id)}/detail`)).json()) as { result?: { jobOpening?: Json } }).result?.jobOpening || {};
      const loc = (d.location || j.location) as Json | undefined;
      const location = [place(loc), str(loc?.addressCountry)].filter(Boolean).join(", ");
      return {
        ...summary(j),
        location,
        workplace: kind(d.locationType ?? j.locationType, j.isRemote),
        url: str(d.jobOpeningShareUrl) || `${base}/${str(j.id)}`,
        applyUrl: str(d.jobOpeningShareUrl) || `${base}/${str(j.id)}`,
        salary: str(d.compensation),
        description: htmlToText(str(d.description)),
        postedAt: str(d.datePosted),
      };
    },
    summary,
  );
  return { name: "", jobs, total: list.length };
}

async function recruitee(token: string): Promise<Fetched> {
  const d = (await (await get(`https://${encodeURIComponent(token)}.recruitee.com/api/offers/`)).json()) as { offers?: Json[] };
  const offers = (d.offers || []).filter((o) => !o.status || o.status === "published");
  const jobs = offers.map((o): Posting => {
    const location = str(o.location) || [str(o.city), str(o.state_name), str(o.country)].filter(Boolean).join(", ");
    const pay = o.salary as Json | undefined;
    return {
      externalId: str(o.id),
      title: str(o.title).trim(),
      location,
      workplace: workplaceOf(o.remote === true, o.hybrid === true ? "hybrid" : "", location),
      url: str(o.careers_url),
      applyUrl: str(o.careers_apply_url || o.careers_url),
      salary: pay?.min ? `${str(pay.currency)} ${pay.min}–${pay.max}${pay.period ? ` ${str(pay.period)}` : ""}`.trim() : "",
      description: [htmlToText(str(o.description)), htmlToText(str(o.requirements))].filter(Boolean).join("\n\n"),
      postedAt: isoDate(str(o.published_at)),
    };
  });
  return { name: str(offers[0]?.company_name), jobs };
}

/* ---------- Career sites: m-cloud (UPMC), SuccessFactors (Vail), UKG Pro (Camelback), job pages from a sitemap (Alterra, universities) ---------- */

const pageText = (url: string) => get(url, "text/html").then((r) => r.text());

// The JobPosting a page describes for search engines (schema.org), found at the top of the JSON or inside an @graph.
function jobPostingOf(html: string): Json | null {
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const data = JSON.parse(m[1].trim()) as unknown;
      const nodes = (Array.isArray(data) ? data : [data]).flatMap((n) => (n && typeof n === "object" && Array.isArray((n as Json)["@graph"]) ? ((n as Json)["@graph"] as Json[]) : [n as Json]));
      const hit = nodes.find((n) => n && [n["@type"]].flat().some((t) => str(t) === "JobPosting"));
      if (hit) return hit;
    } catch {
      /* not JSON */
    }
  }
  return null;
}

function postingFromJsonLd(ld: Json, url: string): Posting {
  const places = ([ld.jobLocation].flat().filter(Boolean) as Json[]).map((l) => (l.address || l) as Json);
  const country = (a: Json) => str(a.addressCountry && typeof a.addressCountry === "object" ? (a.addressCountry as Json).name : a.addressCountry);
  const location = [...new Set(places.map((a) => [str(a.addressLocality), str(a.addressRegion), country(a)].filter(Boolean).join(", ")).filter(Boolean))].join(" / ");
  const pay = (ld.baseSalary as Json | undefined)?.value as Json | undefined;
  const org = ld.hiringOrganization as Json | string | undefined;
  return {
    externalId: url,
    title: htmlToText(str(ld.title)).trim(),
    location,
    workplace: workplaceOf(str(ld.jobLocationType).toUpperCase().includes("TELECOMMUTE"), location, str(ld.employmentType)),
    url,
    applyUrl: url,
    salary: pay?.minValue ? `${str((ld.baseSalary as Json).currency)} ${pay.minValue}–${pay.maxValue ?? ""}${pay.unitText ? ` ${str(pay.unitText).toLowerCase()}` : ""}`.trim() : "",
    description: htmlToText(decode(str(ld.description))),
    postedAt: str(ld.datePosted),
    company: typeof org === "string" ? org : str(org?.name) || undefined,
  };
}

async function mcloud(token: string, opts: FetchOptions): Promise<Fetched> {
  const api = `https://jobsapi-google.m-cloud.io/api/job/search?companyName=${encodeURIComponent(`companies/${token}`)}`;
  type Page = { totalHits?: number; searchResults?: { job: Json }[] };
  const total = ((await (await get(`${api}&pageSize=1&offset=0&query=`)).json()) as Page).totalHits || 0;
  const terms = searchTermsOf(opts);
  const found = new Map<string, Json>();
  for (const term of terms) {
    for (let offset = 0; offset < 300; offset += 100) {
      const page = (await (await get(`${api}&pageSize=100&offset=${offset}&query=${encodeURIComponent(term)}`)).json()) as Page;
      for (const r of page.searchResults || []) found.set(str(r.job.id), r.job);
      if ((page.searchResults?.length || 0) < 100) break;
    }
  }
  const jobs = [...found.values()]
    .map((j): Posting => {
      const location = [str(j.primary_city), str(j.primary_state)].filter(Boolean).join(", ");
      return {
        externalId: str(j.id),
        title: str(j.title).trim(),
        location,
        workplace: workplaceOf(str(j.location_type), location),
        url: str(j.url),
        applyUrl: str(j.seo_url || j.url),
        salary: str(j.salary),
        description: htmlToText(str(j.description)),
        postedAt: str(j.open_date),
      };
    })
    .filter((j) => !opts.keep || opts.keep(j.title, j.location));
  const name = str([...found.values()][0]?.company_name).split(/\s+-\s+/)[0];
  return { name, jobs, total };
}

async function successfactors(token: string, opts: FetchOptions): Promise<Fetched> {
  // SuccessFactors career sites share an RSS search. It returns the 20 best matches for a keyword, so each wanted title is its own search.
  const terms = searchTermsOf(opts);
  const items = new Map<string, Posting>();
  for (const term of terms) {
    const xml = await get(`https://${token}/services/rss/job/?locale=en_US&keywords=${encodeURIComponent(term)}`, "application/rss+xml")
      .then((r) => r.text())
      .catch(() => "");
    for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
      const field = (name: string) => decode((m[1].match(new RegExp(`<${name}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${name}>`))?.[1] || "").trim());
      // "Graphic Designer (Stowe, VT, US)": the place is the last bracketed part of the title.
      const bracketed = field("title").match(/^(.*?)\s*\(([^()]*)\)$/);
      const title = bracketed ? bracketed[1] : field("title");
      const location = bracketed ? bracketed[2] : "";
      const url = field("link").replace(/\?.*$/, "");
      if (!title || !url || items.has(url)) continue;
      if (opts.keep && !opts.keep(title, location)) continue;
      items.set(url, { externalId: url, title, location, workplace: "", url, applyUrl: url, salary: "", description: htmlToText(field("description")), postedAt: field("pubDate") ? new Date(field("pubDate")).toISOString() : "" });
    }
  }
  // The RSS description is often thin; the job page carries the full text.
  const jobs = [...items.values()];
  for (let i = 0; i < jobs.length; i += 4) {
    await Promise.all(
      jobs.slice(i, i + 4).map(async (j) => {
        if (j.description.length > 400 || opts.known?.has(j.externalId)) return;
        const page = await pageText(j.url).catch(() => "");
        const ld = jobPostingOf(page);
        if (ld) {
          const full = postingFromJsonLd(ld, j.url);
          j.description = full.description || j.description;
          j.location = j.location || full.location;
          j.workplace = full.workplace;
        } else if (page) {
          j.description = htmlToText(page.slice(0, 60000)).slice(0, 6000);
        }
      }),
    );
  }
  return { name: "", jobs, total: jobs.length };
}

async function ukg(token: string, opts: FetchOptions): Promise<Fetched> {
  const [host, tenant, board] = token.split("/");
  const base = `https://${host}/${tenant}/JobBoard/${board}`;
  const terms = searchTermsOf(opts);
  const found = new Map<string, Json>();
  let total = 0;
  for (const term of terms) {
    for (let skip = 0; skip < 300; skip += 50) {
      const body = {
        opportunitySearch: { Top: 50, Skip: skip, QueryString: term, OrderBy: [{ Value: "postedDateDesc", PropertyName: "PostedDate", Ascending: false }], Filters: [] },
        matchCriteria: { PreferredJobs: [], Criteria: [], SearchCriteria: [] },
      };
      const page = (await (await get(`${base}/JobBoardView/LoadSearchResults`, "application/json", body)).json()) as { opportunities?: Json[]; initialTotalOpportunitiesCount?: number };
      total = Math.max(total, page.initialTotalOpportunitiesCount || 0);
      for (const j of page.opportunities || []) found.set(str(j.Id), j);
      if ((page.opportunities?.length || 0) < 50) break;
    }
  }
  const place = (j: Json) => {
    const a = ((((j.Locations as Json[] | undefined)?.[0] || {}) as Json).Address || {}) as Json;
    return [str(a.City), str((a.State as Json | undefined)?.Code)].filter(Boolean).join(", ");
  };
  const listed = [...found.values()].filter((j) => !opts.keep || opts.keep(str(j.Title), place(j)));
  const link = (j: Json) => `${base}/OpportunityDetail?opportunityId=${str(j.Id)}`;
  const summary = (j: Json): Posting => ({ externalId: str(j.Id), title: str(j.Title).trim(), location: place(j), workplace: "", url: link(j), applyUrl: link(j), salary: "", description: "", postedAt: str(j.PostedDate) });
  const jobs = await withDetails(
    listed,
    (j) => str(j.Id),
    opts.known,
    async (j) => {
      const page = await pageText(link(j));
      const start = page.indexOf("CandidateOpportunityDetail(");
      let detail: Json = {};
      try {
        detail = JSON.parse(page.slice(page.indexOf("{", start), page.indexOf("});", start) + 1)) as Json;
      } catch {
        /* fall back to the short description */
      }
      const description = htmlToText(str(detail.Description) || str(j.BriefDescription));
      return { ...summary(j), description, workplace: workplaceOf(description.slice(0, 600), place(j)) };
    },
    summary,
  );
  // One board is usually one property ("Camelback Resort"), named on its locations.
  const places = new Set([...found.values()].flatMap((j) => ((j.Locations as Json[] | undefined) || []).map((l) => str(l.LocalizedName))).filter(Boolean));
  return { name: places.size === 1 ? [...places][0] : "", jobs, total: total || found.size };
}

// Sitemaps list a career site's job pages, and each page describes its job in structured data (schema.org JobPosting) for search engines.
async function sitemapUrls(url: string, depth = 0): Promise<string[]> {
  const xml = await get(url, "application/xml")
    .then((r) => r.text())
    .catch(() => "");
  const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => decode(m[1]));
  if (!/<sitemapindex/i.test(xml) || depth >= 2) return locs;
  const nested: string[] = [];
  for (const child of locs.slice(0, 40)) nested.push(...(await sitemapUrls(child, depth + 1)));
  return nested;
}

const JOB_PATH = /\/(?:job|jobs|requisition|position|opening)s?\//i;
// "…/job/content-marketing-intern/81825674184008390" or "…/jobs/director-of-marketing-new-york-united-states" → words to compare with wanted titles.
function titleFromUrl(url: string) {
  const parts = new URL(url).pathname.split("/").filter(Boolean).map((p) => decodeURIComponent(p));
  const at = parts.findIndex((p) => /^(jobs?|requisitions?|positions?|openings?)$/i.test(p));
  const slug = parts.slice(at + 1).filter((p) => !/^\d+$/.test(p) && !/^[0-9a-f-]{20,}$/i.test(p)).sort((a, b) => b.length - a.length)[0] || "";
  return slug.replace(/[-_+]+/g, " ").trim();
}

async function sitemapSite(token: string, opts: FetchOptions): Promise<Fetched> {
  const origin = token.replace(/\/+$/, "");
  const robots = await get(`${origin}/robots.txt`, "text/plain")
    .then((r) => r.text())
    .catch(() => "");
  const maps = [...robots.matchAll(/^sitemap:\s*(\S+)/gim)].map((m) => m[1]);
  let urls: string[] = [];
  for (const map of [...new Set([...maps, `${origin}/sitemap.xml`])]) {
    urls = await sitemapUrls(map);
    if (urls.some((u) => JOB_PATH.test(u))) break;
  }
  const listed = [...new Set(urls.filter((u) => JOB_PATH.test(u)))];
  const wanted = listed.filter((u) => !opts.keep || opts.keep(titleFromUrl(u), ""));
  // Without structured data, the place is whatever the path names before "/job/" ("/deer-valley-resort/job/...").
  const placeFromUrl = (u: string) => {
    const parts = new URL(u).pathname.split("/").filter(Boolean);
    const at = parts.findIndex((p) => /^(jobs?|requisitions?|positions?|openings?)$/i.test(p));
    return at > 0 ? prettyName(decodeURIComponent(parts[at - 1])) : "";
  };
  const summary = (u: string): Posting => ({ externalId: u, title: prettyName(titleFromUrl(u)), location: placeFromUrl(u), workplace: "", url: u, applyUrl: u, salary: "", description: "", postedAt: "" });
  const jobs = await withDetails(
    wanted.map((u) => ({ u })),
    (j) => str(j.u),
    opts.known,
    async (j) => {
      const url = str(j.u);
      const page = await pageText(url);
      const ld = jobPostingOf(page);
      if (ld) return postingFromJsonLd(ld, url);
      const heading = htmlToText(page.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || "");
      // The page's main content, without its menus and footer.
      const main = page.match(/<main[\s\S]*?<\/main>/i)?.[0] || page.replace(/<(header|nav|footer|aside)[\s\S]*?<\/\1>/gi, " ");
      return { ...summary(url), title: heading || prettyName(titleFromUrl(url)), description: htmlToText(main.slice(0, 120000)).slice(0, 8000) };
    },
    (j) => summary(str(j.u)),
  );
  return { name: "", jobs: jobs.filter((j) => j.title), total: listed.length };
}

/* ---------- Workday ---------- */

type WorkdayBoard = { host: string; tenant: string; site: string; api: string; publicBase: string };

function workdayParts(token: string): WorkdayBoard {
  const [host, tenant, site] = token.split("/");
  const publicBase = host.endsWith("myworkdaysite.com") ? `https://${host}/recruiting/${tenant}/${site}` : `https://${host}/${site}`;
  return { host, tenant, site, api: `https://${host}/wday/cxs/${tenant}/${site}`, publicBase };
}

// "Posted 5 Days Ago" → an approximate date.
function workdayPostedOn(text: string) {
  const t = text.toLowerCase();
  const days = t.includes("today") ? 0 : t.includes("yesterday") ? 1 : Number(t.match(/(\d+)\+?\s+days?/)?.[1] ?? NaN);
  return Number.isNaN(days) ? "" : new Date(Date.now() - days * 86400000).toISOString();
}

async function workdayDetail(board: WorkdayBoard, externalPath: string, listing: Json): Promise<Posting> {
  const d = (await (await get(`${board.api}${externalPath}`)).json()) as { jobPostingInfo?: Json; hiringOrganization?: Json };
  const info = d.jobPostingInfo || {};
  const description = htmlToText(str(info.jobDescription));
  const location = [str(info.location), ...((info.additionalLocations as string[] | undefined) || [])].filter(Boolean).join(" / ") || str(listing.locationsText);
  return {
    externalId: externalPath,
    title: str(info.title || listing.title).trim(),
    location,
    workplace: workplaceOf(str(info.remoteType), location, description.slice(0, 800)),
    url: str(info.externalUrl) || `${board.publicBase}${externalPath}`,
    applyUrl: `${str(info.externalUrl) || `${board.publicBase}${externalPath}`}/apply`,
    salary: "",
    description,
    postedAt: info.startDate ? new Date(`${str(info.startDate)}T12:00:00Z`).toISOString() : workdayPostedOn(str(listing.postedOn)),
    company: companyName(str(d.hiringOrganization?.name), board.tenant) || prettyName(board.tenant),
  };
}

async function workday(token: string, opts: FetchOptions) {
  const board = workdayParts(token);
  const search = (searchText: string, offset: number, limit = 20) =>
    get(`${board.api}/jobs`, "application/json", { appliedFacets: {}, limit, offset, searchText }).then(
      (r) => r.json() as Promise<{ total?: number; jobPostings?: Json[] }>,
    );
  const first = await search("", 0, 1);
  // The company's real name is only on a posting ("100000 Motorola Solutions, Inc." → "Motorola Solutions").
  const sample = first.jobPostings?.[0]?.externalPath;
  const org = sample
    ? await get(`${board.api}${str(sample)}`)
        .then((r) => r.json() as Promise<{ hiringOrganization?: Json }>)
        .then((d) => companyName(str(d.hiringOrganization?.name), board.tenant))
        .catch(() => "")
    : "";
  // Large employers list thousands of jobs, so search for each wanted title instead of reading everything.
  const terms = searchTermsOf(opts, 12);
  const listings = new Map<string, Json>();
  for (const term of terms) {
    for (let offset = 0; offset < 100; offset += 20) {
      const page = await search(term, offset);
      for (const j of page.jobPostings || []) if (j.externalPath) listings.set(str(j.externalPath), j);
      if (!page.jobPostings?.length || offset + 20 >= (page.total || 0)) break;
    }
  }
  const wanted = [...listings.values()].filter((j) => !opts.keep || opts.keep(str(j.title), str(j.locationsText)));
  // Descriptions need one request each; only fetch ones we don't already have, a few at a time.
  const jobs: Posting[] = [];
  const toFetch = wanted.filter((j) => !opts.known?.has(str(j.externalPath))).slice(0, 60);
  for (let i = 0; i < toFetch.length; i += 4) {
    const batch = await Promise.all(toFetch.slice(i, i + 4).map((j) => workdayDetail(board, str(j.externalPath), j).catch(() => null)));
    jobs.push(...batch.filter((j): j is Posting => Boolean(j)));
  }
  // Already-known postings are listed without a description so the feed keeps its stored copy.
  for (const j of wanted.filter((j) => opts.known?.has(str(j.externalPath)))) {
    jobs.push({
      externalId: str(j.externalPath),
      title: str(j.title),
      location: str(j.locationsText),
      workplace: "",
      url: `${board.publicBase}${str(j.externalPath)}`,
      applyUrl: `${board.publicBase}${str(j.externalPath)}/apply`,
      salary: "",
      description: "",
      postedAt: workdayPostedOn(str(j.postedOn)),
    });
  }
  return { name: org || prettyName(board.tenant), jobs, total: first.total || jobs.length };
}

// Legal entity names vary by country, so keep the leading words that spell the board's short name.
function companyName(legal: string, tenant: string) {
  const words = legal.replace(/^\d+\s+/, "").split(/\s+/);
  let joined = "";
  for (let i = 0; i < words.length; i++) {
    joined += words[i].toLowerCase().replace(/[^a-z0-9]/g, "");
    if (joined === tenant.toLowerCase()) return words.slice(0, i + 1).join(" ").replace(/,$/, "");
    if (joined.length >= tenant.length) break;
  }
  return legal.replace(/^\d+\s+/, "").replace(/,?\s+(inc|llc|ltd|limited|corp|corporation|gmbh)\.?$/i, "").trim();
}

// Reads a single Workday posting from its link (Workday pages are built with JavaScript, so plain fetching finds nothing).
export async function fetchWorkdayPosting(url: string): Promise<Posting | null> {
  const board = workdayFromText(url);
  const path = url.match(/(\/job\/[^?#]+)/)?.[1];
  if (!board || !path) return null;
  return workdayDetail(workdayParts(board.token), path, {});
}

/* ---------- Any board ---------- */

export type FetchOptions = {
  // Titles to search for, used by boards too large to read in full.
  searchTerms?: string[];
  // Cheap pre-filter on title and location before fetching descriptions.
  keep?: (title: string, location: string) => boolean;
  // Postings already stored, whose descriptions needn't be fetched again.
  known?: Set<string>;
  // Remote jobs from job sites are kept only when open to one of these countries (or anywhere).
  countries?: string[];
  // The places the person wants to work (job sites that can search by place look in each, plus remote).
  locations?: string[];
};

/* ---------- Job sites (many companies' remote jobs) ---------- */

const ANYWHERE = /^(|anywhere|worldwide|global|remote)$/i;
const COUNTRY_NAMES: Record<string, string[]> = {
  "united states": ["united states", "usa", "us", "u.s.", "america", "north america", "americas"],
  "united kingdom": ["united kingdom", "uk", "europe", "emea"],
  canada: ["canada", "north america", "americas"],
  spain: ["spain", "europe", "emea", "eu"],
  lebanon: ["lebanon", "middle east", "emea", "mena"],
  japan: ["japan", "apac", "asia"],
  romania: ["romania", "europe", "emea", "eu"],
};
const COUNTRY_CODE: Record<string, string> = { "united states": "US", usa: "US", "united kingdom": "GB", canada: "CA", spain: "ES", lebanon: "LB", japan: "JP", romania: "RO", germany: "DE", france: "FR", portugal: "PT", ireland: "IE", netherlands: "NL" };
// Whether a job's "open to" list includes a country the person can work from.
function openTo(restrictions: string[], countries: string[]) {
  const list = restrictions.map((r) => r.trim().toLowerCase()).filter(Boolean);
  if (!list.length || list.some((r) => ANYWHERE.test(r))) return true;
  const wanted = countries.flatMap((c) => COUNTRY_NAMES[c.trim().toLowerCase()] || [c.trim().toLowerCase()]);
  // Whole words only: "us" must not match inside "Cyprus".
  return list.some((r) => wanted.some((w) => r === w || new RegExp(`(^|[^a-z])${w.replace(/[.]/g, "\\.")}($|[^a-z])`).test(r)));
}

async function jobSite(site: Ats, opts: FetchOptions): Promise<{ name: string; jobs: Posting[]; total: number }> {
  // Workable's search is fuzzy and runs once per place, so a few titles are enough there.
  const terms = [...new Set((opts.searchTerms?.length ? opts.searchTerms : ["product designer"]).map((t) => t.trim()).filter(Boolean))].slice(0, site === "workablejobs" ? 3 : 5);
  const countries = opts.countries?.length ? opts.countries : ["United States"];
  const found = new Map<string, Posting>();
  let total = 0;
  for (const term of terms) {
    const q = encodeURIComponent(term);
    let raw: Record<string, unknown>[] = [];
    try {
      if (site === "himalayas") {
        // 20 jobs a page; paged per country the person can work from (newest first), up to 8 pages each.
        const codes = [...new Set(countries.map((c) => COUNTRY_CODE[c.trim().toLowerCase()]).filter(Boolean))];
        for (const code of codes.length ? codes : ["US"]) {
          for (let page = 1; page <= 8; page++) {
            const batch = ((await (await get(`https://himalayas.app/jobs/api/search?q=${q}&country=${code}&page=${page}&limit=20`)).json()) as { jobs?: Record<string, unknown>[] }).jobs || [];
            raw.push(...batch);
            if (batch.length < 20) break;
          }
        }
      }
      if (site === "jobicy") raw = ((await (await get(`https://jobicy.com/api/v2/remote-jobs?count=100&tag=${q}`)).json()) as { jobs?: Record<string, unknown>[] }).jobs || [];
      if (site === "remotive") raw = ((await (await get(`https://remotive.com/api/remote-jobs?search=${q}&limit=100`)).json()) as { jobs?: Record<string, unknown>[] }).jobs || [];
      if (site === "workablejobs") {
        // Searches every Workable-hosted company at once: once per place the person wants, plus remote. 20 jobs a page, newest first.
        const places = [...(opts.locations || []).filter((l) => l.trim() && !/remote/i.test(l)).map((l) => `location=${encodeURIComponent(l.trim())}`), "workplace=remote"];
        for (const place of places) {
          let pageToken = "";
          for (let page = 0; page < 2; page++) {
            // One place failing shouldn't lose the others.
            const r = await get(`https://jobs.workable.com/api/v1/jobs?query=${q}&${place}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`)
              .then((res) => res.json() as Promise<{ jobs?: Record<string, unknown>[]; nextPageToken?: string }>)
              .catch(() => ({}) as { jobs?: Record<string, unknown>[]; nextPageToken?: string });
            raw.push(...(r.jobs || []));
            pageToken = r.nextPageToken || "";
            if (!pageToken || (r.jobs?.length || 0) < 20) break;
          }
        }
      }
    } catch {
      continue;
    }
    total += raw.length;
    for (const x of raw) {
      const str = (k: string) => String(x[k] ?? "");
      const posting: Posting =
        site === "himalayas"
          ? {
              externalId: str("guid") || str("applicationLink"),
              title: str("title"),
              location: ((x.locationRestrictions as string[]) || []).join(", ") || "Anywhere",
              workplace: "Remote",
              url: str("applicationLink"),
              applyUrl: str("applicationLink"),
              salary: x.minSalary && x.maxSalary ? `${str("currency") === "USD" || !x.currency ? "$" : `${str("currency")} `}${Number(x.minSalary).toLocaleString("en-US")}–${Number(x.maxSalary).toLocaleString("en-US")}` : "",
              description: htmlToText(str("description")),
              postedAt: x.pubDate ? new Date(Number(x.pubDate) * 1000).toISOString() : "",
              company: str("companyName"),
            }
          : site === "jobicy"
            ? {
                externalId: str("id"),
                title: decode(str("jobTitle")),
                location: str("jobGeo") || "Anywhere",
                workplace: "Remote",
                url: str("url"),
                applyUrl: str("url"),
                salary: x.annualSalaryMin && x.annualSalaryMax ? `$${Number(x.annualSalaryMin).toLocaleString("en-US")}–${Number(x.annualSalaryMax).toLocaleString("en-US")}` : "",
                description: htmlToText(str("jobDescription")),
                postedAt: str("pubDate") ? new Date(str("pubDate")).toISOString() : "",
                company: decode(str("companyName")),
              }
            : site === "workablejobs"
              ? {
                  externalId: str("id"),
                  title: str("title"),
                  location: String((x.locations as string[] | undefined)?.[0] ?? "") || [String((x.location as Record<string, unknown> | undefined)?.city ?? ""), String((x.location as Record<string, unknown> | undefined)?.subregion ?? ""), String((x.location as Record<string, unknown> | undefined)?.countryName ?? "")].filter(Boolean).join(", "),
                  workplace: x.workplace === "remote" ? "Remote" : x.workplace === "hybrid" ? "Hybrid" : x.workplace === "on_site" ? "On-site" : "",
                  url: str("url"),
                  applyUrl: str("url"),
                  salary: "",
                  description: htmlToText([str("description"), str("requirementsSection"), str("benefitsSection")].filter(Boolean).join("\n\n")),
                  postedAt: str("created"),
                  company: String((x.company as Record<string, unknown> | undefined)?.title ?? ""),
                }
            : {
                externalId: str("id"),
                title: str("title"),
                location: str("candidate_required_location") || "Anywhere",
                workplace: "Remote",
                url: str("url"),
                applyUrl: str("url"),
                salary: str("salary"),
                description: htmlToText(str("description")),
                postedAt: str("publication_date") ? new Date(str("publication_date")).toISOString() : "",
                company: str("company_name"),
              };
      if (!posting.title || !posting.url || found.has(posting.externalId)) continue;
      if (!openTo(posting.location.split(/,\s*|\s*\/\s*/), countries)) continue;
      if (opts.keep && !opts.keep(posting.title, posting.location)) continue;
      found.set(posting.externalId, posting);
    }
  }
  return { name: ATS_LABEL[site], jobs: [...found.values()], total };
}

export async function fetchBoard({ ats, token }: Board, opts: FetchOptions = {}): Promise<{ name: string; jobs: Posting[]; total: number }> {
  if (JOB_SITES.includes(ats)) return jobSite(ats, opts);
  if (ats === "workday") {
    const result = await workday(token, opts);
    return { ...result, jobs: result.jobs.filter((j) => j.title && j.url) };
  }
  const result: Fetched =
    ats === "greenhouse" ? await greenhouse(token)
    : ats === "lever" ? await lever(token)
    : ats === "workable" ? await workable(token)
    : ats === "smartrecruiters" ? await smartrecruiters(token, opts)
    : ats === "bamboohr" ? await bamboohr(token, opts)
    : ats === "recruitee" ? await recruitee(token)
    : ats === "mcloud" ? await mcloud(token, opts)
    : ats === "successfactors" ? await successfactors(token, opts)
    : ats === "ukg" ? await ukg(token, opts)
    : ats === "sitemap" ? await sitemapSite(token, opts)
    : await ashby(token);
  return { name: result.name || prettyName(token), jobs: result.jobs.filter((j) => j.title && j.url), total: result.total ?? result.jobs.length };
}

export function prettyName(token: string) {
  return token.replace(/[-_.]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
