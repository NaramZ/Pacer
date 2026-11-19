import { database, runnerUserId } from "../../../lib/automation-auth";
import { refreshFeed } from "../../../lib/feed";
import { employerLink } from "../../../lib/employer-link";
import { getPrefs } from "../../../lib/search-prefs";

const BLOCKED = /himalayas\.app|jobicy\.com/i;
// Jobs already looked up on the employer's own board, so each is only tried once.
const looked = new Set<string>();

// Autopilot discovery reads the free job feed (followed companies' public job boards) instead of a paid web search.
export async function POST(request: Request) {
  const userId = await runnerUserId(request);
  if (!userId) return Response.json({ error: "Invalid runner token." }, { status: 401 });
  const settings = await database().prepare("SELECT enabled FROM automation_settings WHERE user_id=?").bind(userId).first<{ enabled: number }>();
  if (!settings?.enabled) return Response.json({ jobs: [], paused: true });

  await refreshFeed(userId);

  // Himalayas and Jobicy jobs: use the employer's own posting when there is one (best matches first).
  const blocked = await database()
    .prepare(
      `SELECT id, company, title FROM feed_jobs f
       WHERE f.user_id=? AND f.status IN ('new','seen')
         AND (COALESCE(NULLIF(f.apply_url,''),f.url) LIKE '%himalayas.app%' OR COALESCE(NULLIF(f.apply_url,''),f.url) LIKE '%jobicy.com%')
       ORDER BY f.match_score DESC LIMIT 300`,
    )
    .bind(userId)
    .all<{ id: string; company: string; title: string }>();
  const todo = (blocked.results || []).filter((j) => !looked.has(j.id)).slice(0, 300);
  for (let i = 0; i < todo.length; i += 6) {
    await Promise.all(
      todo.slice(i, i + 6).map(async (j) => {
        looked.add(j.id);
        const link = await employerLink(j.company, j.title);
        if (link && !BLOCKED.test(link)) await database().prepare("UPDATE feed_jobs SET apply_url=? WHERE id=?").bind(link, j.id).run();
      }),
    );
  }
  // "Pittsburgh, PA" → "pittsburgh"; a remote-only first choice doesn't count as a place.
  const first = (await getPrefs(userId)).locations.find((l) => !/remote/i.test(l)) || "";
  const home = first.split(",")[0].trim().toLowerCase();
  const rows = await database()
    .prepare(
      `SELECT f.* FROM feed_jobs f
       WHERE f.user_id=?1 AND f.status IN ('new','seen')
         -- Himalayas shows a "verify you are human" check to automated browsers, and Jobicy hides the apply link behind
         -- a sign-in; those jobs are only applied to here when the employer's own posting was found.
         AND COALESCE(NULLIF(f.apply_url,''),f.url) NOT LIKE '%himalayas.app%'
         AND COALESCE(NULLIF(f.apply_url,''),f.url) NOT LIKE '%jobicy.com%'
         AND NOT EXISTS (SELECT 1 FROM automation_queue q WHERE q.user_id=f.user_id AND q.source_url=f.url)
       -- The person's first place first, then remote, then everything else (big companies included), best match first within each.
       ORDER BY CASE WHEN ?2 <> '' AND instr(lower(f.location), ?2) > 0 THEN 0 WHEN lower(f.location||' '||f.workplace) LIKE '%remote%' THEN 1 ELSE 2 END,
         f.match_score DESC, f.posted_at DESC LIMIT 20`,
    )
    .bind(userId, home)
    .all<Record<string, string>>();
  const jobs = (rows.results || []).map((f) => ({
    company: f.company,
    role: f.title,
    location: f.location,
    source: "Company job board",
    sourceUrl: f.url,
    applicationUrl: f.apply_url || f.url,
    postedDate: f.posted_at,
  }));
  return Response.json({ jobs });
}
