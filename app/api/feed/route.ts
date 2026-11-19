import { database, siteUserId } from "../../lib/automation-auth";
import { listCompanies, refreshFeed } from "../../lib/feed";
import { getPrefs, savePrefs } from "../../lib/search-prefs";

const STATUSES = new Set(["new", "seen", "hidden"]);

async function payload(userId: string) {
  const [jobs, companies, prefs] = await Promise.all([
    database()
      .prepare(
        `SELECT f.id,f.company_id,f.company,f.title,f.location,f.workplace,f.url,f.apply_url,f.salary,f.posted_at,f.match_score,f.status,f.application_id,f.first_seen_at,
           COALESCE(a.status,'') AS app_status, COALESCE(a.applied_at,'') AS applied_at
         FROM feed_jobs f LEFT JOIN applications a ON a.id=f.application_id AND a.user_id=f.user_id
         WHERE f.user_id=? AND f.status!='hidden' ORDER BY (f.status='new') DESC, f.match_score DESC, f.posted_at DESC LIMIT 500`,
      )
      .bind(userId)
      .all(),
    listCompanies(userId),
    getPrefs(userId),
  ]);
  return { jobs: jobs.results || [], companies, prefs };
}

export async function GET(request: Request) {
  const userId = siteUserId();
  // One job's full description, loaded when its row is opened.
  const id = new URL(request.url).searchParams.get("id");
  if (id) {
    const row = await database().prepare("SELECT description FROM feed_jobs WHERE id=? AND user_id=?").bind(id, userId).first<{ description: string }>();
    return row ? Response.json({ description: row.description }) : Response.json({ error: "Job not found." }, { status: 404 });
  }
  return Response.json(await payload(userId));
}

// Checks every followed company's job board for new postings.
export async function POST() {
  const userId = siteUserId();
  const results = await refreshFeed(userId);
  return Response.json({ ...(await payload(userId)), results });
}

// Saves what the person is looking for, then rebuilds the feed with it.
export async function PUT(request: Request) {
  const userId = siteUserId();
  await savePrefs(userId, (await request.json()) as Record<string, unknown>);
  // Stored postings were filtered with the old preferences, so they're re-read with the new ones.
  await database().prepare("DELETE FROM feed_jobs WHERE user_id=? AND status IN ('new','seen')").bind(userId).run();
  const results = await refreshFeed(userId);
  return Response.json({ ...(await payload(userId)), results });
}

export async function PATCH(request: Request) {
  const userId = siteUserId();
  const { id, status, allSeen } = (await request.json()) as { id?: string; status?: string; allSeen?: boolean };
  if (allSeen) {
    await database().prepare("UPDATE feed_jobs SET status='seen' WHERE user_id=? AND status='new'").bind(userId).run();
    return Response.json({ ok: true });
  }
  if (!id || !status || !STATUSES.has(status)) return Response.json({ error: "Unknown job or status." }, { status: 400 });
  await database().prepare("UPDATE feed_jobs SET status=? WHERE id=? AND user_id=? AND status!='added'").bind(status, id, userId).run();
  return Response.json({ ok: true });
}
