import { database, extUserId } from "../../../lib/automation-auth";

// The person submitted the form the extension filled: My jobs (and Autopilot) say so.
export async function POST(request: Request) {
  const userId = await extUserId(request);
  if (!userId) return Response.json({ error: "Not connected." }, { status: 401 });
  const { id } = (await request.json().catch(() => ({}))) as { id?: string };
  const now = new Date().toISOString();
  await database()
    .prepare("UPDATE applications SET status='Applied',applied_at=?,updated_at=? WHERE id=? AND user_id=? AND status='Saved'")
    .bind(now.slice(0, 10), now, id || "", userId)
    .run();
  await database()
    .prepare("UPDATE automation_queue SET status='Submitted',reason='You submitted it.',submitted_at=?,updated_at=? WHERE application_id=? AND user_id=? AND status NOT IN ('Submitted','Applying')")
    .bind(now, now, id || "", userId)
    .run();
  return Response.json({ ok: true });
}
