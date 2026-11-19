import { database, siteUserId } from "../../lib/automation-auth";
import { apiErrorMessage, writerFor } from "../../lib/claude";
import { findPeople } from "../../lib/people";
import { factsOf, verifyDocuments } from "../../lib/job-analysis";
import { getProfile } from "../../lib/profile";

// Finds people worth contacting at the company for one job, with free ways to reach them.
export async function POST(request: Request) {
  const userId = siteUserId();
  try {
    const { id } = (await request.json()) as { id?: string };
    const row = await database().prepare("SELECT * FROM applications WHERE id=? AND user_id=?").bind(id || "", userId).first<Record<string, string>>();
    if (!row) return Response.json({ error: "Job not found." }, { status: 404 });
    // Your Claude plan (through the helper) when it's running; otherwise the API key, if you allow that.
    const { ai, limitNote } = await writerFor(userId, "people");
    if (!ai) return Response.json({ error: limitNote || "Finding people needs your Claude plan (start the helper) or an API key." }, { status: 400 });
    const profile = await getProfile(userId);
    const result = await findPeople(
      ai,
      { title: row.role, company: row.company, location: row.location, url: row.url },
      { name: profile?.fullName || "", focus: profile?.focus || "", headline: profile?.headline || "", resume: profile?.resumeText || "" },
    );
    if (!result) return Response.json({ error: "Couldn’t find people this time. Try again." }, { status: 422 });
    // The message drafts get the same fact check as the documents; anything unsupported is shown, not hidden.
    const drafts = result.people.map((p) => `To ${p.name}: ${p.message}`).join("\n\n");
    if (drafts && profile?.resumeText) result.warnings = await verifyDocuments(ai, factsOf(profile), "", drafts);
    const dossier = row.dossier_json ? JSON.parse(row.dossier_json) : {};
    dossier.contacts = result;
    await database().prepare("UPDATE applications SET dossier_json=?,updated_at=? WHERE id=? AND user_id=?").bind(JSON.stringify(dossier), new Date().toISOString(), id, userId).run();
    return Response.json({ contacts: result, notice: limitNote });
  } catch (e) {
    return Response.json({ error: apiErrorMessage(e, "Couldn’t find people.") }, { status: 500 });
  }
}
