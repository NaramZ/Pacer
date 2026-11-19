import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { applications } from "../../../db/schema";
import { database, siteUserId } from "../../lib/automation-auth";

const allowedStatuses = ["Saved", "Applied", "Screen", "Interview", "Final", "Offer", "Rejected", "Withdrawn"];

function unauthorized() { return siteUserId() ? null : Response.json({ error: "Sign in required." }, { status: 401 }); }

function errorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "Unexpected error";
  if (message.includes("no such table")) return "The tracker database is not ready yet.";
  return "The tracker could not save that. Your text is still here—please try again.";
}

export async function GET() {
  const denied = unauthorized(); if (denied) return denied;
  try {
    const rows = await getDb().select().from(applications).where(eq(applications.userId, siteUserId())).orderBy(desc(applications.appliedAt), desc(applications.createdAt));
    return Response.json({ applications: rows });
  } catch (error) {
    return Response.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const denied = unauthorized(); if (denied) return denied;
  try {
    const body = await request.json() as Record<string, unknown>;
    const company = String(body.company || "").trim();
    const role = String(body.role || "").trim();
    if (!company || !role) return Response.json({ error: "Company and role are required." }, { status: 400 });
    const now = new Date().toISOString();
    const record = {
      id: crypto.randomUUID(), userId: siteUserId(), company, role,
      location: String(body.location || "Not specified"), source: String(body.source || "Not specified"), url: String(body.url || ""),
      tier: ["A", "B", "C"].includes(String(body.tier)) ? String(body.tier) : "B",
      fitScore: Math.max(1, Math.min(10, Number(body.fitScore) || 7)),
      status: allowedStatuses.includes(String(body.status)) ? String(body.status) : "Applied",
      appliedAt: String(body.appliedAt || now.slice(0, 10)), followUpAt: String(body.followUpAt || now.slice(0, 10)),
      portfolioLead: String(body.portfolioLead || ""), resumeVersion: String(body.resumeVersion || "Product"),
      contact: String(body.contact || ""), notes: String(body.notes || ""), originalEntry: String(body.originalEntry || ""), createdAt: now, updatedAt: now,
    };
    const [created] = await getDb().insert(applications).values(record).returning();
    return Response.json({ application: created }, { status: 201 });
  } catch (error) {
    return Response.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const denied = unauthorized(); if (denied) return denied;
  try {
    const body = await request.json() as Record<string, unknown>;
    const id = String(body.id || "");
    if (!id) return Response.json({ error: "Application id is required." }, { status: 400 });
    const updates: Record<string, string | number> = { updatedAt: new Date().toISOString() };
    const textFields = ["company", "role", "location", "source", "url", "tier", "status", "appliedAt", "followUpAt", "portfolioLead", "resumeVersion", "contact", "notes"];
    for (const field of textFields) if (body[field] !== undefined) updates[field] = String(body[field]);
    if (body.fitScore !== undefined) updates.fitScore = Math.max(1, Math.min(10, Number(body.fitScore) || 7));
    const [updated] = await getDb().update(applications).set(updates).where(and(eq(applications.id, id), eq(applications.userId, siteUserId()))).returning();
    if (!updated) return Response.json({ error: "Application not found." }, { status: 404 });
    // Applied (or further along) by hand: Autopilot mustn't fill it in again.
    if (typeof body.status === "string" && body.status !== "Saved")
      await database()
        .prepare("UPDATE automation_queue SET status='Submitted',reason='You applied yourself.',updated_at=? WHERE application_id=? AND user_id=? AND status NOT IN ('Submitted','Applying')")
        .bind(new Date().toISOString(), id, siteUserId())
        .run();
    return Response.json({ application: updated });
  } catch (error) {
    return Response.json({ error: errorMessage(error) }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const denied = unauthorized(); if (denied) return denied;
  try {
    const id = new URL(request.url).searchParams.get("id") || "";
    await getDb().delete(applications).where(and(eq(applications.id, id), eq(applications.userId, siteUserId())));
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: errorMessage(error) }, { status: 500 });
  }
}
