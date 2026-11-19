import { database } from "./automation-auth";
import { apiErrorMessage, writerFor } from "./claude";
import { createDocuments } from "./job-analysis";
import { getProfile } from "./profile";
import type { Progress } from "./progress";

// Writes and checks the tailored resume and cover letter for a saved job. Used by "Write my documents" and the browser extension.
export type DocsBody = { id?: string; confirmed?: string[] };

export async function writeDocs(userId: string, { id, confirmed }: DocsBody, progress: Progress) {
  try {
    const row = await database().prepare("SELECT * FROM applications WHERE id=? AND user_id=?").bind(id || "", userId).first<Record<string, unknown>>();
    if (!row) return Response.json({ error: "Job not found." }, { status: 404 });
    const profile = await getProfile(userId);
    if (!profile?.resumeText) return Response.json({ error: "Add your resume first." }, { status: 400 });

    const dossier = row.dossier_json ? JSON.parse(String(row.dossier_json)) : {};
    // Requirements the person ticked "I've done this" for, on this job; kept for the next rewrite too.
    if (Array.isArray(confirmed)) dossier.confirmed = confirmed.map(String).map((c) => c.trim()).filter(Boolean).slice(0, 20);
    const { ai, limitNote } = await writerFor(userId, "documents");
    const result = await createDocuments({ dossier, profile, ai, progress });
    dossier.resumeChanges = result.resumeChanges;
    dossier.docWarnings = result.warnings;
    dossier.docScore = result.docScore;
    // What the person's standing statement covered on this job, and whether the match reached the target.
    if (result.confirmed) dossier.confirmed = result.confirmed;
    dossier.assumed = result.assumed || [];
    dossier.docTarget = result.docTarget;
    await database()
      .prepare("UPDATE applications SET tailor_status='complete',tailored_resume=?,cover_letter=?,dossier_json=?,updated_at=? WHERE id=? AND user_id=?")
      .bind(result.tailoredResume, result.coverLetter, JSON.stringify(dossier), new Date().toISOString(), id, userId)
      .run();
    return Response.json({ status: "complete", resume: result.tailoredResume, coverLetter: result.coverLetter, resumeChanges: result.resumeChanges, notice: limitNote });
  } catch (e) {
    return Response.json({ error: apiErrorMessage(e, "Couldn’t write the documents.") }, { status: 500 });
  }
}

