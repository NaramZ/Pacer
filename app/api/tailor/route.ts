import { database, siteUserId } from "../../lib/automation-auth";
import { apiErrorMessage, writerFor } from "../../lib/claude";
import { factsOf, scoreDocuments } from "../../lib/job-analysis";
import { logisticsMet } from "../../lib/standing-experience";
import { getProfile } from "../../lib/profile";
import { taskResponse, type Work } from "../../lib/progress";
import { writeDocs, type DocsBody } from "../../lib/write-docs";

type Body = DocsBody;

// Runs in the background when the page asks (so it keeps going if the page changes), otherwise answers directly.
export async function POST(request: Request) {
  const userId = siteUserId();
  const body = (await request.json().catch(() => ({}))) as Body;
  const work: Work = async (progress) => {
    const res = await writeDocs(userId, body, progress);
    return { status: res.status, body: await res.json() };
  };
  return taskResponse(request, userId, { kind: "documents", target: String(body.id || ""), label: await labelFor(userId, body.id, "Writing documents") }, work);
}

async function labelFor(userId: string, id: string | undefined, what: string) {
  const row = await database().prepare("SELECT company,role FROM applications WHERE id=? AND user_id=?").bind(id || "", userId).first<{ company: string; role: string }>();
  return row ? `${what}: ${row.role} at ${row.company}` : what;
}

export async function GET(request: Request) {
  const userId = siteUserId();
  const id = new URL(request.url).searchParams.get("id") || "";
  const row = await database().prepare("SELECT tailor_status,tailored_resume,cover_letter FROM applications WHERE id=? AND user_id=?").bind(id, userId).first<Record<string, unknown>>();
  if (!row) return Response.json({ error: "Job not found." }, { status: 404 });
  return Response.json({ status: row.tailor_status, resume: row.tailored_resume, coverLetter: row.cover_letter });
}

export async function PATCH(request: Request) {
  const userId = siteUserId();
  try {
    const { id, resume, coverLetter } = (await request.json()) as { id?: string; resume?: string; coverLetter?: string };
    // Hand edits make the after-tailoring score out of date until it's checked again.
    const row = await database().prepare("SELECT dossier_json,tailored_resume,cover_letter FROM applications WHERE id=? AND user_id=?").bind(id || "", userId).first<{ dossier_json: string; tailored_resume: string; cover_letter: string }>();
    const dossier = row?.dossier_json ? JSON.parse(row.dossier_json) : {};
    if (dossier.docScore) dossier.docScore.stale = true;
    await database()
      .prepare("UPDATE applications SET tailored_resume=?,cover_letter=?,dossier_json=?,updated_at=? WHERE id=? AND user_id=?")
      // A document that isn't sent stays as it was.
      .bind(resume ?? row?.tailored_resume ?? "", coverLetter ?? row?.cover_letter ?? "", JSON.stringify(dossier), new Date().toISOString(), id || "", userId)
      .run();
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "Couldn’t save your documents." }, { status: 500 });
  }
}

// Scores the documents as they are now (after hand edits), without rewriting them.
export async function PUT(request: Request) {
  const userId = siteUserId();
  const body = (await request.json().catch(() => ({}))) as Body;
  return taskResponse(request, userId, { kind: "rescore", target: String(body.id || ""), label: await labelFor(userId, body.id, "Checking the documents") }, async () => {
    const res = await rescore(userId, body.id);
    return { status: res.status, body: await res.json() };
  });
}

async function rescore(userId: string, id: string | undefined) {
  try {
    const row = await database().prepare("SELECT * FROM applications WHERE id=? AND user_id=?").bind(id || "", userId).first<Record<string, unknown>>();
    if (!row?.tailored_resume) return Response.json({ error: "Write the documents first." }, { status: 400 });
    const profile = await getProfile(userId);
    const dossier = row.dossier_json ? JSON.parse(String(row.dossier_json)) : {};
    const { ai, limitNote } = await writerFor(userId, "documents");
    if (!ai) return Response.json({ error: limitNote || "Scoring the documents needs Claude: start the helper, or add an API key." }, { status: 400 });
    const docScore = await scoreDocuments(ai, dossier.requirements || [], profile ? factsOf(profile, dossier.confirmed || []) : "", String(row.tailored_resume), String(row.cover_letter || ""), dossier.confirmed || [], logisticsMet(dossier.requirements || [], String(dossier.location || ""), profile));
    if (!docScore) return Response.json({ error: "Couldn’t score the documents. Try again." }, { status: 422 });
    dossier.docScore = docScore;
    await database().prepare("UPDATE applications SET dossier_json=?,updated_at=? WHERE id=? AND user_id=?").bind(JSON.stringify(dossier), new Date().toISOString(), id, userId).run();
    return Response.json({ docScore, notice: limitNote });
  } catch (e) {
    return Response.json({ error: apiErrorMessage(e, "Couldn’t score the documents.") }, { status: 500 });
  }
}
