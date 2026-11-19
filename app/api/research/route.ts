import { database, siteUserId } from "../../lib/automation-auth";
import { checkJob, type CheckBody } from "../../lib/check-job";
import { taskResponse } from "../../lib/progress";

const text = (v: unknown, fallback = "") => (typeof v === "string" ? v.trim() : "") || fallback;

type Body = CheckBody;

// Runs in the background when the page asks (so it keeps going if the page changes), otherwise answers directly.
export async function POST(request: Request) {
  const userId = siteUserId();
  const body = (await request.json().catch(() => ({}))) as Body;
  const target = text(body.feedJobId) || text(body.retryId) || text(body.url) || text(body.ref);
  const job = body.feedJobId
    ? await database().prepare("SELECT title AS role,company FROM feed_jobs WHERE id=? AND user_id=?").bind(body.feedJobId, userId).first<{ role: string; company: string }>()
    : body.retryId
      ? await database().prepare("SELECT role,company FROM applications WHERE id=? AND user_id=?").bind(body.retryId, userId).first<{ role: string; company: string }>()
      : null;
  const label = job ? `Checking your fit: ${job.role} at ${job.company}` : "Checking your fit";
  return taskResponse(request, userId, { kind: "check", target, label }, async (progress) => {
    const res = await checkJob(userId, body, progress);
    return { status: res.status, body: await res.json() };
  });
}

export async function GET(request: Request) {
  const userId = siteUserId();
  const id = new URL(request.url).searchParams.get("id") || "";
  const row = await database().prepare("SELECT * FROM applications WHERE id=? AND user_id=?").bind(id, userId).first<Record<string, unknown>>();
  if (!row) return Response.json({ error: "Job not found." }, { status: 404 });
  return Response.json({ application: row, dossier: row.dossier_json ? JSON.parse(String(row.dossier_json)) : null, status: row.research_status });
}
