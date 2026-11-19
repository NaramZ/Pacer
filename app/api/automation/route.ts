import { database, sha256, siteUserId } from "../../lib/automation-auth";
import { ensureSettings, getPrefs, savePrefs } from "../../lib/search-prefs";
import { addCustomAnswer } from "../../lib/profile";
import { monthlySpend } from "../../lib/claude";

async function present(userId: string, row: Record<string, unknown>) {
  return {
    enabled: Boolean(row.enabled),
    minFit: Number(row.min_fit),
    dailyLimit: Number(row.daily_limit),
    ...(await getPrefs(userId)),
    sources: ["greenhouse", "lever", "ashby"],
    paired: Boolean(row.runner_token_hash),
    autoSubmit: Boolean(row.auto_submit),
    jobLimitUsd: Number(row.job_limit_usd) || 0.75,
    applyEngine: row.apply_engine === "api" ? "api" : "subscription",
    lastHeartbeatAt: String(row.last_heartbeat_at || ""),
  };
}

export async function GET() {
  const userId = siteUserId();
  if (!userId) return Response.json({ error: "Sign in required." }, { status: 401 });
  await ensureSettings(userId);
  const settings = await database().prepare("SELECT * FROM automation_settings WHERE user_id=?").bind(userId).first<Record<string, unknown>>();
  const queue = await database().prepare("SELECT * FROM automation_queue WHERE user_id=? ORDER BY discovered_at DESC LIMIT 80").bind(userId).all();
  const runs = await database().prepare("SELECT * FROM automation_runs WHERE user_id=? ORDER BY started_at DESC LIMIT 20").bind(userId).all();
  return Response.json({ settings: await present(userId, settings || {}), queue: queue.results || [], runs: runs.results || [], usage: await monthlySpend(userId) });
}

export async function PATCH(request: Request) {
  const userId = siteUserId();
  if (!userId) return Response.json({ error: "Sign in required." }, { status: 401 });
  await ensureSettings(userId);
  const body = await request.json() as Record<string, unknown>;
  const minFit = Math.max(50, Math.min(100, Number(body.minFit) || 70));
  const dailyLimit = Math.max(1, Math.min(20, Number(body.dailyLimit) || 5));
  await database().prepare(`UPDATE automation_settings SET min_fit=?,daily_limit=?,updated_at=? WHERE user_id=?`)
    .bind(minFit, dailyLimit, new Date().toISOString(), userId).run();
  // Only the Start/Stop button sends this.
  if (typeof body.enabled === "boolean")
    await database().prepare("UPDATE automation_settings SET enabled=? WHERE user_id=?").bind(body.enabled ? 1 : 0, userId).run();
  // Only changes when the switch itself is sent, so saving other settings can't turn it on or off by accident.
  if (typeof body.autoSubmit === "boolean")
    await database().prepare("UPDATE automation_settings SET auto_submit=? WHERE user_id=?").bind(body.autoSubmit ? 1 : 0, userId).run();
  if (body.applyEngine === "api" || body.applyEngine === "subscription")
    await database().prepare("UPDATE automation_settings SET apply_engine=? WHERE user_id=?").bind(body.applyEngine, userId).run();
  if (body.jobLimitUsd !== undefined)
    await database().prepare("UPDATE automation_settings SET job_limit_usd=? WHERE user_id=?").bind(Math.max(0.1, Math.min(5, Number(body.jobLimitUsd) || 0.75)), userId).run();
  await savePrefs(userId, body);
  const row = await database().prepare("SELECT * FROM automation_settings WHERE user_id=?").bind(userId).first<Record<string, unknown>>();
  return Response.json({ settings: await present(userId, row || {}) });
}

export async function POST(request: Request) {
  const userId = siteUserId();
  if (!userId) return Response.json({ error: "Sign in required." }, { status: 401 });
  await ensureSettings(userId);
  const body = await request.json().catch(() => ({})) as { action?: string; id?: string; question?: string; answer?: string; applicationId?: string };

  // One job the person picked, queued for the helper to fill in next (with its tailored documents).
  if (body.action === "queue") {
    const app = await database().prepare("SELECT * FROM applications WHERE id=? AND user_id=?").bind(body.applicationId || "", userId).first<Record<string, unknown>>();
    if (!app) return Response.json({ error: "Job not found." }, { status: 404 });
    if (!app.tailored_resume) return Response.json({ error: "Write the resume and cover letter first (Documents tab)." }, { status: 400 });
    if (!app.url) return Response.json({ error: "This job has no application link." }, { status: 400 });
    const now = new Date().toISOString();
    // The same job may already be queued (picked before, or found by Autopilot's own search): reuse that entry.
    const existing = await database()
      .prepare("SELECT id,status FROM automation_queue WHERE user_id=? AND (application_id=? OR application_url=? OR source_url=?) ORDER BY (application_id=?) DESC LIMIT 1")
      .bind(userId, app.id, String(app.url), String(app.url), app.id)
      .first<{ id: string; status: string }>();
    if (existing?.status === "Submitted") return Response.json({ error: "This application was already sent." }, { status: 409 });
    if (existing)
      await database()
        .prepare("UPDATE automation_queue SET application_id=?,status='Ready',questions_json='[]',last_error='',ai_cost_usd=0,reason='You picked this job.',updated_at=? WHERE id=? AND user_id=?")
        .bind(app.id, now, existing.id, userId)
        .run();
    else
      await database()
        .prepare(`INSERT INTO automation_queue
          (id,user_id,application_id,company,role,location,source,source_url,application_url,status,fit_score,reason,last_error,confirmation_url,discovered_at,submitted_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .bind(crypto.randomUUID(), userId, app.id, String(app.company), String(app.role), String(app.location || ""), "You picked it", String(app.url), String(app.url), "Ready", Number(app.fit_score || 0) * 10, "You picked this job.", "", "", now, "", now)
        .run();
    return Response.json({ ok: true });
  }

  // Saves the person's answer to a question the helper flagged, and takes it off that job's list.
  if (body.action === "answer") {
    const question = String(body.question || "").trim(), answer = String(body.answer || "").trim();
    if (!question || !answer) return Response.json({ error: "Type an answer first." }, { status: 400 });
    await addCustomAnswer(userId, question, answer);
    const row = await database().prepare("SELECT questions_json FROM automation_queue WHERE id=? AND user_id=?").bind(body.id || "", userId).first<{ questions_json: string }>();
    if (row) {
      const text = (q: unknown) => (typeof q === "string" ? q : String((q as { question?: string })?.question || ""));
      const remaining = (JSON.parse(row.questions_json || "[]") as unknown[]).filter((q) => text(q).trim().toLowerCase() !== question.toLowerCase());
      await database().prepare("UPDATE automation_queue SET questions_json=?,updated_at=? WHERE id=? AND user_id=?").bind(JSON.stringify(remaining), new Date().toISOString(), body.id, userId).run();
    }
    return Response.json({ ok: true });
  }

  // Takes a job out of Autopilot's queue. It isn't found again later (discovery skips links already queued), and My jobs keeps it.
  if (body.action === "remove") {
    await database()
      .prepare("UPDATE automation_queue SET status='Skipped',reason='You removed it from Autopilot.',updated_at=? WHERE id=? AND user_id=? AND status!='Applying'")
      .bind(new Date().toISOString(), body.id || "", userId)
      .run();
    return Response.json({ ok: true });
  }

  // The person applied themselves: the queue and My jobs both say so.
  if (body.action === "applied") {
    const now = new Date().toISOString();
    const row = await database().prepare("SELECT application_id FROM automation_queue WHERE id=? AND user_id=?").bind(body.id || "", userId).first<{ application_id: string }>();
    await database().prepare("UPDATE automation_queue SET status='Submitted',reason='You applied yourself.',submitted_at=?,updated_at=? WHERE id=? AND user_id=?").bind(now, now, body.id || "", userId).run();
    if (row?.application_id)
      await database()
        .prepare("UPDATE applications SET status='Applied',applied_at=CASE WHEN applied_at='' OR status='Saved' THEN ? ELSE applied_at END,updated_at=? WHERE id=? AND user_id=? AND status='Saved'")
        .bind(now.slice(0, 10), now, row.application_id, userId)
        .run();
    return Response.json({ ok: true });
  }

  // Puts a job back in line so the helper tries it again with the new answers.
  if (body.action === "retry") {
    await database()
      .prepare("UPDATE automation_queue SET status='Ready',questions_json='[]',last_error='',ai_cost_usd=0,reason='Trying again with your new answers.',updated_at=? WHERE id=? AND user_id=? AND status IN ('Needs input','Failed','Review','Sign in')")
      .bind(new Date().toISOString(), body.id || "", userId)
      .run();
    return Response.json({ ok: true });
  }

  // A connection code for the browser extension (separate from the helper's, so each can be replaced on its own).
  if (body.action === "pair-extension") {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const token = `njx_${[...bytes].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
    await database().prepare("UPDATE automation_settings SET ext_token_hash=?,updated_at=? WHERE user_id=?").bind(await sha256(token), new Date().toISOString(), userId).run();
    return Response.json({ token });
  }

  if (body.action !== "pair") return Response.json({ error: "Unsupported action." }, { status: 400 });
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = `nja_${[...bytes].map(x => x.toString(16).padStart(2, "0")).join("")}`;
  await database().prepare("UPDATE automation_settings SET runner_token_hash=?,updated_at=? WHERE user_id=?").bind(await sha256(token), new Date().toISOString(), userId).run();
  return Response.json({ token });
}

