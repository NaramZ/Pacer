import { database, runnerUserId } from "../../../lib/automation-auth";
import { writerFor } from "../../../lib/claude";
import { analyzeJob, createDocuments } from "../../../lib/job-analysis";
import { getAnswers, getProfile } from "../../../lib/profile";
import { existingApplication } from "../../../lib/same-job";
import { levelFits } from "../../../lib/feed";
import { salaryAsk } from "../../../lib/salary";

export async function POST(request: Request) {
  const userId = await runnerUserId(request);
  if (!userId) return Response.json({ error: "Invalid runner token." }, { status: 401 });
  const {id} = await request.json() as {id?:string};
  const queue = await database().prepare("SELECT * FROM automation_queue WHERE id=? AND user_id=?").bind(String(id || ""), userId).first<Record<string, unknown>>();
  if (!queue) return Response.json({ error: "Queue item not found." }, { status: 404 });
  const settings = await database().prepare("SELECT min_fit FROM automation_settings WHERE user_id=?").bind(userId).first<{min_fit:number}>();
  const applicationUrl = String(queue.application_url || ""), sourceUrl = String(queue.source_url || "");
  const host = (()=>{try{return new URL(applicationUrl).hostname.toLowerCase()}catch{return""}})();
  if (!applicationUrl || /(^|\.)(linkedin|indeed)\.com$/.test(host)) {
    await database().prepare("UPDATE automation_queue SET status='Needs input',reason='Direct employer application URL not verified',updated_at=? WHERE id=? AND user_id=?").bind(new Date().toISOString(), id, userId).run();
    return Response.json({ status:"Needs input", reason:"Direct employer application URL not verified" });
  }
  // A title above or below the person's level is skipped before any Claude work.
  const level = (await getAnswers(userId)).level;
  if (!levelFits(String(queue.role || ""), level)) {
    const reason = `Not your level (${level || "set it in Profile → Answers"})`;
    await database().prepare("UPDATE automation_queue SET status='Skipped',reason=?,updated_at=? WHERE id=? AND user_id=?").bind(reason, new Date().toISOString(), id, userId).run();
    return Response.json({ status: "Skipped", reason });
  }
  try {
    await database().prepare("UPDATE automation_queue SET status='Researching',updated_at=? WHERE id=? AND user_id=?").bind(new Date().toISOString(), id, userId).run();
    const profile = await getProfile(userId);
    if (!profile?.resumeText) throw new Error("Add your resume in Profile before running Autopilot.");
    // Jobs found in the feed already have their full description; use it instead of loading the page again (slow sites time out).
    const saved = await database()
      .prepare("SELECT description FROM feed_jobs WHERE user_id=? AND (url=? OR apply_url=? OR url=?) AND description!='' LIMIT 1")
      .bind(userId, sourceUrl, applicationUrl, applicationUrl)
      .first<{ description: string }>();
    const dossier = await analyzeJob({ entry: `${queue.role} at ${queue.company}`, url: saved ? "" : applicationUrl, jd: saved?.description || "", profile, ai: (await writerFor(userId, "analysis")).ai });
    if (saved) dossier.sources = [{ title: "Employer job listing", url: sourceUrl || applicationUrl, supports: "Title, company, description and location." }];
    const score = Math.max(0, Math.min(100, Number(dossier.evidenceScore) || 0));
    const minFit = Number(settings?.min_fit || 70), now = new Date().toISOString();
    if (score < minFit || dossier.analysisConfidence === "Preliminary") {
      const reason = dossier.analysisConfidence === "Preliminary" ? "Full qualifications could not be verified" : `${score}% evidence match is below the ${minFit}% minimum`;
      await database().prepare("UPDATE automation_queue SET status='Skipped',fit_score=?,reason=?,updated_at=? WHERE id=? AND user_id=?").bind(score, reason, now, id, userId).run();
      return Response.json({status:"Skipped",score,reason});
    }
    // The same job already in My jobs (added by hand, or found again): reuse it and its documents instead of adding a copy.
    const existing = await existingApplication(userId, { url: applicationUrl, company: String(dossier.company), role: String(dossier.title) });
    const documents = existing?.tailored_resume
      ? null
      : await createDocuments({ dossier, profile, ai: (await writerFor(userId, "documents")).ai });
    const applicationId = existing?.id || crypto.randomUUID();
    // Free when the posting lists pay. Otherwise it's only looked up if the form actually asks (few do).
    const ask = await salaryAsk(dossier, await getAnswers(userId), null).catch(() => null);
    if (existing) {
      // Another listing of this same job (a second location, say) is already queued, filled in or sent: don't do it twice.
      const other = await database()
        .prepare("SELECT id FROM automation_queue WHERE user_id=? AND application_id=? AND id!=? AND status IN ('Ready','Applying','Review','Submitted') LIMIT 1")
        .bind(userId, existing.id, id)
        .first<{ id: string }>();
      if (other) {
        await database().prepare("UPDATE automation_queue SET status='Skipped',fit_score=?,reason=?,updated_at=? WHERE id=? AND user_id=?").bind(score, "Same job as another listing already in Autopilot", now, id, userId).run();
        return Response.json({ status: "Skipped", score, reason: "Same job as another listing already in Autopilot" });
      }
      if (documents)
        await database()
          .prepare("UPDATE applications SET tailor_status='complete',tailored_resume=?,cover_letter=?,dossier_json=?,updated_at=? WHERE id=? AND user_id=?")
          .bind(documents.tailoredResume, documents.coverLetter, JSON.stringify({ ...dossier, resumeChanges: documents.resumeChanges, docWarnings: documents.warnings, docScore: documents.docScore, confirmed: documents.confirmed, assumed: documents.assumed || [], docTarget: documents.docTarget, salaryAsk: ask }), now, existing.id, userId)
          .run();
      await database().prepare("UPDATE automation_queue SET application_id=?,status='Ready',fit_score=?,reason=?,updated_at=? WHERE id=? AND user_id=?").bind(existing.id,score,"Already in My jobs; using it",now,id,userId).run();
      return Response.json({status:"Ready",score,applicationId:existing.id});
    }
    const dossierWithChanges = { ...dossier, resumeChanges: documents!.resumeChanges, docWarnings: documents!.warnings, docScore: documents!.docScore, confirmed: documents!.confirmed, assumed: documents!.assumed || [], docTarget: documents!.docTarget, salaryAsk: ask };
    await database().prepare(`INSERT INTO applications (id,user_id,company,role,location,source,url,tier,fit_score,status,applied_at,follow_up_at,portfolio_lead,resume_version,contact,notes,original_entry,created_at,updated_at,research_status,research_response_id,dossier_json,tailor_status,tailor_response_id,tailored_resume,cover_letter,job_description) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(applicationId,userId,dossier.company,dossier.title,dossier.location,String(queue.source||"Automated discovery"),applicationUrl,score>=80?"A":"B",Math.round(score/10),"Saved","",new Date(Date.now()+7*86400000).toISOString().slice(0,10),"","Automated","",`Discovered from ${sourceUrl}`,`${queue.role} at ${queue.company}`,now,now,"complete","",JSON.stringify(dossierWithChanges),"complete","",documents!.tailoredResume,documents!.coverLetter,dossier.jobDescription).run();
    await database().prepare("UPDATE automation_queue SET application_id=?,status='Ready',fit_score=?,reason=?,updated_at=? WHERE id=? AND user_id=?").bind(applicationId,score,"Passed evidence and source checks",now,id,userId).run();
    return Response.json({status:"Ready",score,applicationId});
  } catch (error) {
    const message = error instanceof Error ? error.message : "Analysis failed.";
    await database().prepare("UPDATE automation_queue SET status='Failed',last_error=?,updated_at=? WHERE id=? AND user_id=?").bind(message,new Date().toISOString(),id,userId).run();
    return Response.json({error:message},{status:422});
  }
}

