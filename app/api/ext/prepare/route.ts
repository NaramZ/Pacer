import { database, extUserId } from "../../../lib/automation-auth";
import { checkJob } from "../../../lib/check-job";
import { phases, taskResponse } from "../../../lib/progress";
import { existingApplication, jobKey } from "../../../lib/same-job";
import { writeDocs } from "../../../lib/write-docs";

// From the extension, on a job page: check the fit and write the tailored documents, as one background task.
// A job already prepared (same link, or same company and title) is used as it is.
export async function POST(request: Request) {
  const userId = await extUserId(request);
  if (!userId) return Response.json({ error: "Not connected." }, { status: 401 });
  const { url, title, text, refresh } = (await request.json().catch(() => ({}))) as { url?: string; title?: string; text?: string; refresh?: boolean };
  const pageText = String(text || "").slice(0, 40000);
  if (!url) return Response.json({ error: "Open the job’s page first." }, { status: 400 });
  // An application-only page (Lever's /apply, Ashby's /application) has no description: the posting itself is read instead.
  const postingUrl = pageText.length < 600 ? url.replace(/\/(apply|application)\/?(\?.*)?$/i, "") : url;

  const existing = await existingApplication(userId, { url });
  if (existing?.tailored_resume && !refresh) return Response.json({ applicationId: existing.id, ready: true });

  const label = `Preparing: ${String(title || "this job").slice(0, 80)}`;
  // The page always asks for a background task, so it keeps going after the extension's panel closes.
  const asTask = new Request(request.url, { method: "POST", headers: { prefer: "respond-async" } });
  return taskResponse(asTask, userId, { kind: "prepare", target: jobKey(url) || url, label }, async (progress) => {
    const phase = phases(progress);
    let applicationId = existing?.id || "";
    if (!applicationId) {
      const res = await checkJob(userId, { entry: String(title || ""), url: postingUrl, jobDescription: pageText.length >= 600 ? pageText : undefined, ref: url }, phase("check-"));
      const body = (await res.json()) as { id?: string; error?: string };
      if (!res.ok || !body.id) return { status: res.status || 422, body };
      applicationId = body.id;
    }
    const docs = await writeDocs(userId, { id: applicationId }, phase("docs-"));
    const docsBody = (await docs.json()) as { error?: string };
    if (!docs.ok) return { status: docs.status, body: { ...docsBody, applicationId } };
    await database().prepare("UPDATE applications SET source=CASE WHEN source='' THEN 'Browser extension' ELSE source END WHERE id=? AND user_id=?").bind(applicationId, userId).run();
    return { status: 200, body: { applicationId, ready: true } };
  });
}
