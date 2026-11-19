import { database } from "./automation-auth";
import { apiErrorMessage, writerFor } from "./claude";
import { analyzeJob } from "./job-analysis";
import { getProfile } from "./profile";
import { existingApplication } from "./same-job";
import type { Progress } from "./progress";

// Checks a job against the person's resume and saves it to My jobs. Used by "Check my fit" and the browser extension.
const text = (v: unknown, fallback = "") => (typeof v === "string" ? v.trim() : "") || fallback;

function datePlus(days: number) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export type CheckBody = { entry?: string; url?: string; jobDescription?: string; applied?: boolean; retryId?: string; feedJobId?: string; ref?: string };

export async function checkJob(userId: string, body: CheckBody, progress: Progress) {
  let id = "";
  try {
    const profile = await getProfile(userId);
    if (!profile?.resumeText) return Response.json({ error: "Add your resume first so we can compare it with the job." }, { status: 400 });

    id = text(body.retryId);
    const prior = id ? await database().prepare("SELECT * FROM applications WHERE id=? AND user_id=?").bind(id, userId).first<Record<string, unknown>>() : null;
    // A posting from the job feed already has its description, so the listing isn't fetched again.
    const feed = body.feedJobId
      ? await database().prepare("SELECT * FROM feed_jobs WHERE id=? AND user_id=?").bind(body.feedJobId, userId).first<Record<string, string>>()
      : null;
    if (body.feedJobId && !feed) return Response.json({ error: "That posting is no longer in your feed." }, { status: 404 });
    // Already in My jobs (a double click, two tabs, the same posting from another link or location): open that one instead.
    if (feed) {
      const existing =
        (feed.application_id && (await database().prepare("SELECT id FROM applications WHERE id=? AND user_id=?").bind(feed.application_id, userId).first<{ id: string }>())) ||
        (await existingApplication(userId, { url: feed.url, company: feed.company, role: feed.title }));
      if (existing) {
        await database().prepare("UPDATE feed_jobs SET status='added',application_id=? WHERE id=? AND user_id=?").bind(existing.id, feed.id, userId).run();
        return Response.json({ id: existing.id, status: "complete", notice: "This job is already in My jobs." }, { status: 200 });
      }
    }
    const entry = feed ? `${feed.title} at ${feed.company}` : text(prior?.original_entry ?? body.entry);
    const url = feed ? feed.url : text(prior?.url ?? body.url, entry.match(/https?:\/\/\S+/)?.[0] || "");
    const jd = feed ? feed.description : body.jobDescription !== undefined ? text(body.jobDescription) : text(prior?.job_description);
    if (!entry && !url && !jd) return Response.json({ error: "Add a job link or description." }, { status: 400 });

    if (!prior && !feed && url) {
      const existing = await existingApplication(userId, { url });
      if (existing) return Response.json({ id: existing.id, status: "complete", notice: "This job is already in My jobs." }, { status: 200 });
    }
    const now = () => new Date().toISOString();
    if (prior) await database().prepare("UPDATE applications SET research_status='researching',notes='',updated_at=? WHERE id=? AND user_id=?").bind(now(), id, userId).run();

    const { ai, limitNote } = await writerFor(userId, "analysis");
    // A full description is already in hand (the feed, or the page the person is on): no need to load the page again.
    const dossier = await analyzeJob({ entry, url: feed || jd.length > 400 ? "" : url, jd, profile, ai, progress });
    if (!feed && jd.length > 400 && url) dossier.sources = [{ title: "Employer job listing", url, supports: "Title, company, description and location." }];
    if (limitNote) dossier.recommendation = limitNote;
    if (feed) {
      dossier.company = feed.company;
      dossier.title = feed.title;
      dossier.location = feed.location || dossier.location;
      dossier.sources = [{ title: "Employer job listing", url: feed.url, supports: "Title, company, description and location." }];
    }
    const score = dossier.evidenceScore;
    const tier = score >= 75 ? "A" : score >= 55 ? "B" : "C";

    // A pasted description for a job that's already saved (same company and title) updates it instead of adding another.
    if (!prior) {
      const same = await existingApplication(userId, { company: String(dossier.company), role: String(dossier.title) });
      if (same) id = same.id;
    }
    if (prior || id) {
      await database()
        .prepare(
          "UPDATE applications SET company=?,role=?,location=?,tier=?,fit_score=?,research_status='complete',dossier_json=?,job_description=?,notes='',updated_at=? WHERE id=? AND user_id=?",
        )
        .bind(dossier.company, dossier.title, dossier.location, tier, Math.round(score / 10), JSON.stringify(dossier), dossier.jobDescription, now(), id, userId)
        .run();
    } else {
      id = crypto.randomUUID();
      await database()
        .prepare(
          `INSERT INTO applications (id,user_id,company,role,location,source,url,tier,fit_score,status,applied_at,follow_up_at,portfolio_lead,resume_version,contact,notes,original_entry,created_at,updated_at,research_status,research_response_id,dossier_json,tailor_status,tailor_response_id,tailored_resume,cover_letter,job_description)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .bind(
          id, userId, dossier.company, dossier.title, dossier.location, feed ? "Job feed" : url ? "Job link" : "Pasted description", url, tier, Math.round(score / 10),
          body.applied ? "Applied" : "Saved", datePlus(0), datePlus(7), "", "Base", "", "", entry, now(), now(), "complete", "",
          JSON.stringify(dossier), "", "", "", "", dossier.jobDescription,
        )
        .run();
    }
    if (feed) await database().prepare("UPDATE feed_jobs SET status='added',application_id=? WHERE id=? AND user_id=?").bind(id, feed.id, userId).run();
    return Response.json({ id, status: "complete", dossier }, { status: 201 });
  } catch (e) {
    const message = apiErrorMessage(e, "Couldn’t read this job.");
    if (id)
      await database()
        .prepare("UPDATE applications SET research_status='error',notes=?,updated_at=? WHERE id=? AND user_id=?")
        .bind(message, new Date().toISOString(), id, userId)
        .run()
        .catch(() => undefined);
    return Response.json({ error: message, status: "error" }, { status: 422 });
  }
}

