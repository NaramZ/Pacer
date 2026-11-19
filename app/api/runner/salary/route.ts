import { database, runnerUserId } from "../../../lib/automation-auth";
import { apiErrorMessage, writerFor } from "../../../lib/claude";
import { getAnswers } from "../../../lib/profile";
import { salaryAsk, salaryForForm } from "../../../lib/salary";

// Called by the helper only when an application form asks about salary and none was worked out yet.
export async function POST(request: Request) {
  const userId = await runnerUserId(request);
  if (!userId) return Response.json({ error: "Invalid runner token." }, { status: 401 });
  try {
    const { id } = (await request.json()) as { id?: string };
    const row = await database()
      .prepare("SELECT a.id,a.dossier_json FROM automation_queue q JOIN applications a ON a.id=q.application_id AND a.user_id=q.user_id WHERE q.id=? AND q.user_id=?")
      .bind(String(id || ""), userId)
      .first<{ id: string; dossier_json: string }>();
    if (!row) return Response.json({ error: "Job not found." }, { status: 404 });
    const dossier = row.dossier_json ? JSON.parse(row.dossier_json) : {};
    const { ai } = await writerFor(userId, "salary");
    const ask = dossier.salaryAsk || (await salaryAsk(dossier, await getAnswers(userId), ai));
    if (!ask) return Response.json({ error: ai ? "No pay data found for this role." : "No AI budget left to look up pay." }, { status: 422 });
    dossier.salaryAsk = ask;
    await database().prepare("UPDATE applications SET dossier_json=?,updated_at=? WHERE id=? AND user_id=?").bind(JSON.stringify(dossier), new Date().toISOString(), row.id, userId).run();
    return Response.json({ note: salaryForForm(ask) });
  } catch (e) {
    return Response.json({ error: apiErrorMessage(e, "Couldn’t work out a salary.") }, { status: 500 });
  }
}
