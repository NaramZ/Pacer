import { database, siteUserId } from "../../lib/automation-auth";

type Row = { id: string; kind: string; target: string; label: string; status: string; progress_json: string; result_json: string; created_at: string; updated_at: string };

const shape = (r: Row) => ({
  id: r.id,
  kind: r.kind,
  target: r.target,
  label: r.label,
  status: r.status,
  progress: JSON.parse(r.progress_json || "{}"),
  result: r.result_json ? JSON.parse(r.result_json) : null,
  createdAt: r.created_at,
});

// Running tasks, and finished ones the person hasn't seen yet (so the page can say "ready" wherever they are).
export async function GET(request: Request) {
  const userId = siteUserId();
  const id = new URL(request.url).searchParams.get("id");
  if (id) {
    const row = await database().prepare("SELECT * FROM tasks WHERE id=? AND user_id=?").bind(id, userId).first<Row>();
    return row ? Response.json(shape(row)) : Response.json({ error: "Task not found." }, { status: 404 });
  }
  // A task still "running" long after its last update was cut off (the app restarted); it's shown as failed.
  const stale = new Date(Date.now() - 12 * 60 * 1000).toISOString();
  await database()
    .prepare(`UPDATE tasks SET status='error',result_json=? WHERE user_id=? AND status='running' AND updated_at<?`)
    .bind(JSON.stringify({ status: 500, body: { error: "This stopped before it finished (the app restarted). Try again." } }), userId, stale)
    .run();
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const rows = await database()
    .prepare("SELECT * FROM tasks WHERE user_id=? AND (status='running' OR (seen=0 AND updated_at>?)) ORDER BY created_at DESC LIMIT 20")
    .bind(userId, since)
    .all<Row>();
  return Response.json({ tasks: (rows.results || []).map(shape) });
}

// Marks a finished task as seen, so it drops out of the list.
export async function PATCH(request: Request) {
  const userId = siteUserId();
  const { id } = (await request.json()) as { id?: string };
  await database().prepare("UPDATE tasks SET seen=1 WHERE id=? AND user_id=? AND status!='running'").bind(id || "", userId).run();
  return Response.json({ ok: true });
}
