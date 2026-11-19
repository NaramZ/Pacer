import { database, extUserId } from "../../../lib/automation-auth";

// The extension follows a background task it started.
export async function GET(request: Request) {
  const userId = await extUserId(request);
  if (!userId) return Response.json({ error: "Not connected." }, { status: 401 });
  const id = new URL(request.url).searchParams.get("id") || "";
  const row = await database()
    .prepare("SELECT status,label,progress_json,result_json FROM tasks WHERE id=? AND user_id=?")
    .bind(id, userId)
    .first<{ status: string; label: string; progress_json: string; result_json: string }>();
  if (!row) return Response.json({ error: "Task not found." }, { status: 404 });
  return Response.json({ status: row.status, label: row.label, progress: JSON.parse(row.progress_json || "{}"), result: row.result_json ? JSON.parse(row.result_json) : null });
}
