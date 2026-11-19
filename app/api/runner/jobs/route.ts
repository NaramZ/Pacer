import { database, jsonList, runnerUserId } from "../../../lib/automation-auth";
import { resumePdfBytes, coverLetterPdfBytes } from "../../../lib/pdf";
import { getAnswers, getProfile, identityOf } from "../../../lib/profile";
import { answersForForm } from "../../../answers";
import { salaryForForm } from "../../../lib/salary";
import { homeFor } from "../../../lib/standing-experience";

// "Review": the helper filled the form and is waiting for the person to check it and press submit.
// "Sign in": paused while the person signs in or creates an account on the employer's site.
const allowedStatuses = ["Discovered", "Researching", "Ready", "Applying", "Sign in", "Review", "Submitted", "Skipped", "Needs input", "Failed"];

export async function GET(request: Request) {
  const userId = await runnerUserId(request);
  if (!userId) return Response.json({ error: "Invalid runner token." }, { status: 401 });
  const settings = await database().prepare("SELECT * FROM automation_settings WHERE user_id=?").bind(userId).first<Record<string, unknown>>();
  await database().prepare("UPDATE automation_settings SET last_heartbeat_at=?,updated_at=? WHERE user_id=?").bind(new Date().toISOString(), new Date().toISOString(), userId).run();
  if (new URL(request.url).searchParams.get("queue") === "discovered") {
    const discovered = await database().prepare("SELECT * FROM automation_queue WHERE user_id=? AND status='Discovered' ORDER BY discovered_at ASC LIMIT 30").bind(userId).all();
    return Response.json({ discovered: discovered.results || [] });
  }
  // Jobs you've already applied to (marked in My jobs) leave the queue instead of being filled in again.
  await database()
    .prepare(`UPDATE automation_queue SET status='Submitted',reason='You applied yourself.',updated_at=?
      WHERE user_id=? AND status IN ('Discovered','Ready') AND application_id IN (SELECT id FROM applications WHERE user_id=? AND status!='Saved')`)
    .bind(new Date().toISOString(), userId, userId)
    .run();
  const today = new Date().toISOString().slice(0, 10);
  // The daily limit counts forms filled in today (waiting for review or sent), since the person submits most of them.
  const submitted = await database()
    .prepare("SELECT COUNT(*) AS count FROM automation_queue WHERE user_id=? AND ((status='Submitted' AND submitted_at>=?) OR (status='Review' AND updated_at>=?))")
    .bind(userId, `${today}T00:00:00.000Z`, `${today}T00:00:00.000Z`)
    .first<{count:number}>();
  const next = Number(submitted?.count || 0) >= Number(settings?.daily_limit || 5) ? null : await database().prepare(`SELECT q.*,a.tailored_resume,a.cover_letter,a.dossier_json,a.job_description
    FROM automation_queue q LEFT JOIN applications a ON a.id=q.application_id AND a.user_id=q.user_id
    WHERE q.user_id=? AND q.status IN ('Ready','Applying') ORDER BY q.fit_score DESC,q.discovered_at ASC LIMIT 1`).bind(userId).first<Record<string, unknown>>();
  const profile = await getProfile(userId);
  let prepared = next;
  if (next?.tailored_resume) {
    const resume = resumePdfBytes(String(next.tailored_resume));
    const letter = coverLetterPdfBytes(String(next.cover_letter || ""), String(next.company), String(next.role), identityOf(profile, String(next.location || "")));
    // The job's own location answers "which country"; the salary ask answers pay questions.
    const dossier = (() => { try { return JSON.parse(String(next.dossier_json || "{}")); } catch { return {}; } })();
    prepared = {...next,resume_pdf_base64:toBase64(resume),cover_letter_pdf_base64:toBase64(letter),job_location:String(dossier.location || next.location || ""),salary_note:salaryForForm(dossier.salaryAsk)};
  }
  return Response.json({
    enabled: Boolean(settings?.enabled),
    settings: settings ? { autoSubmit: Boolean(settings.auto_submit), applyEngine: settings.apply_engine === "api" ? "api" : "subscription", minFit: Number(settings.min_fit), dailyLimit: Number(settings.daily_limit), roles: jsonList(settings.roles_json), locations: jsonList(settings.locations_json), excludedTerms: jsonList(settings.excluded_terms_json), sources: jsonList(settings.sources_json) } : null,
    next: prepared,
    // Contact details for filling in application forms.
    profile: profile ? { fullName: profile.fullName, email: profile.email, phone: profile.phone, location: homeFor(profile, String(prepared?.job_location || prepared?.location || "")), links: profile.links, headline: profile.headline } : null,
    // Saved answers to common application questions, as text for the form filler.
    answers: answersForForm(await getAnswers(userId)),
  });
}

function toBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export async function POST(request: Request) {
  const userId = await runnerUserId(request);
  if (!userId) return Response.json({ error: "Invalid runner token." }, { status: 401 });
  const body = await request.json() as Record<string, unknown>;
  const action = String(body.action || "");
  const now = new Date().toISOString();
  if (action === "heartbeat") {
    await database().prepare("UPDATE automation_settings SET last_heartbeat_at=?,updated_at=? WHERE user_id=?").bind(now, now, userId).run();
    return Response.json({ ok: true });
  }
  if (action === "discover") {
    const jobs = Array.isArray(body.jobs) ? body.jobs as Record<string, unknown>[] : [];
    let added = 0;
    for (const job of jobs.slice(0, 100)) {
      const sourceUrl = String(job.sourceUrl || "").trim();
      if (!sourceUrl || !String(job.company || "").trim() || !String(job.role || "").trim()) continue;
      const exists = await database().prepare("SELECT id FROM automation_queue WHERE user_id=? AND source_url=?").bind(userId, sourceUrl).first();
      if (exists) continue;
      await database().prepare(`INSERT INTO automation_queue
        (id,user_id,application_id,company,role,location,source,source_url,application_url,status,fit_score,reason,last_error,confirmation_url,discovered_at,submitted_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(crypto.randomUUID(), userId, "", String(job.company), String(job.role), String(job.location || "Not specified"), String(job.source || "Web"), sourceUrl, String(job.applicationUrl || ""), "Discovered", 0, "Awaiting evidence analysis", "", "", now, "", now).run();
      added++;
    }
    return Response.json({ added });
  }
  if (action === "update") {
    const id = String(body.id || ""), status = String(body.status || "");
    if (!id || !allowedStatuses.includes(status)) return Response.json({ error: "Invalid queue update." }, { status: 400 });
    // Only the fields sent are changed, so a status update doesn't wipe the score or links.
    const text = (key: string) => (typeof body[key] === "string" ? String(body[key]) : null);
    // Each question may come with its multiple-choice options.
    const questions = Array.isArray(body.questions)
      ? JSON.stringify(
          body.questions
            .map((q) => {
              const item = (typeof q === "string" ? { question: q } : q) as { question?: unknown; options?: unknown };
              const options = Array.isArray(item.options) ? item.options.map((o) => String(o).trim().slice(0, 200)).filter(Boolean).slice(0, 20) : [];
              return { question: String(item.question || "").trim().slice(0, 300), options };
            })
            .filter((q) => q.question)
            .slice(0, 20),
        )
      : null;
    await database()
      .prepare(`UPDATE automation_queue SET status=?,reason=COALESCE(?,reason),last_error=COALESCE(?,last_error),confirmation_url=COALESCE(?,confirmation_url),
        application_url=COALESCE(?,application_url),questions_json=COALESCE(?,questions_json),submitted_at=CASE WHEN ?='Submitted' THEN ? ELSE submitted_at END,updated_at=? WHERE id=? AND user_id=?`)
      .bind(status, text("reason"), text("lastError"), text("confirmationUrl"), text("applicationUrl"), questions, status, now, now, id, userId)
      .run();
    // The record of what was sent is kept with the job in My jobs.
    if (body.record && typeof body.record === "object")
      await database()
        .prepare("UPDATE applications SET submission_json=?,updated_at=? WHERE id=(SELECT application_id FROM automation_queue WHERE id=? AND user_id=?) AND user_id=?")
        .bind(JSON.stringify(body.record).slice(0, 200000), now, id, userId, userId)
        .run();
    // A submitted application also moves the job to Applied in My jobs.
    if (status === "Submitted")
      await database()
        .prepare("UPDATE applications SET status='Applied',applied_at=?,updated_at=? WHERE id=(SELECT application_id FROM automation_queue WHERE id=? AND user_id=?) AND user_id=? AND status='Saved'")
        .bind(now.slice(0, 10), now, id, userId, userId)
        .run();
    return Response.json({ ok: true });
  }
  return Response.json({ error: "Unsupported runner action." }, { status: 400 });
}
