import { database } from "./automation-auth";

// The same posting reached by different links: tracking parameters, trailing slashes and "www." don't make it a new job.
export function jobKey(url: string) {
  try {
    const u = new URL(url.trim());
    const keep = new URLSearchParams();
    // Job-ID parameters identify the posting; everything else (utm_*, source, ref…) is noise.
    for (const [k, v] of u.searchParams) if (/^(gh_jid|jobid|job_id|id|jid|lever-source-id|ashby_jid|token)$/i.test(k)) keep.set(k.toLowerCase(), v);
    const query = keep.toString();
    return `${u.hostname.replace(/^www\./, "").toLowerCase()}${u.pathname.replace(/\/(apply|application)?\/?$/i, "").toLowerCase()}${query ? `?${query}` : ""}`;
  } catch {
    return "";
  }
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// An application already in My jobs for this posting (same link, or same company and title).
export async function existingApplication(userId: string, job: { url?: string; company?: string; role?: string }) {
  const rows = await database()
    .prepare("SELECT id,url,company,role,tailored_resume FROM applications WHERE user_id=?")
    .bind(userId)
    .all<{ id: string; url: string; company: string; role: string; tailored_resume: string }>();
  const key = job.url ? jobKey(job.url) : "";
  const company = norm(job.company || "");
  const role = norm(job.role || "");
  return (
    (rows.results || []).find(
      (a) => (key && jobKey(a.url || "") === key) || (company && role && norm(a.company || "") === company && norm(a.role || "") === role),
    ) || null
  );
}
