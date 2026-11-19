import { database, siteUserId } from "../../lib/automation-auth";
import { apiErrorMessage, writerFor } from "../../lib/claude";
import { getAnswers } from "../../lib/profile";
import { salaryAsk } from "../../lib/salary";

// Works out what salary to ask for on one job and saves it with the job.
export async function POST(request: Request) {
  const userId = siteUserId();
  try {
    const { id } = (await request.json()) as { id?: string };
    const row = await database().prepare("SELECT dossier_json FROM applications WHERE id=? AND user_id=?").bind(id || "", userId).first<{ dossier_json: string }>();
    if (!row) return Response.json({ error: "Job not found." }, { status: 404 });
    const dossier = row.dossier_json ? JSON.parse(row.dossier_json) : {};
    const { ai, limitNote } = await writerFor(userId, "salary");
    const ask = await salaryAsk(dossier, await getAnswers(userId), ai);
    if (!ask)
      return Response.json(
        { error: limitNote || (ai ? "Couldn’t find pay data for this role." : "The posting has no pay range. Add an API key in Profile to look up market pay.") },
        { status: 422 },
      );
    dossier.salaryAsk = ask;
    await database().prepare("UPDATE applications SET dossier_json=?,updated_at=? WHERE id=? AND user_id=?").bind(JSON.stringify(dossier), new Date().toISOString(), id, userId).run();
    return Response.json({ salaryAsk: ask });
  } catch (e) {
    return Response.json({ error: apiErrorMessage(e, "Couldn’t work out a salary.") }, { status: 500 });
  }
}
