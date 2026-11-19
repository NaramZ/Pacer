import { siteUserId } from "../../../lib/automation-auth";
import { apiErrorMessage, writerFor } from "../../../lib/claude";
import { humanFlags } from "../../../lib/job-analysis";

// A recruiter-style read of the resume in the editor: phrases that sound machine-written, each with a plainer version.
export async function POST(request: Request) {
  const userId = siteUserId();
  try {
    const { resume, original } = (await request.json()) as { resume?: string; original?: string };
    if (!resume?.trim()) return Response.json({ error: "There's no resume text to read." }, { status: 400 });
    const { ai, limitNote } = await writerFor(userId, "documents");
    if (!ai) return Response.json({ error: limitNote || "The read needs your Claude plan (start the helper) or an API key." }, { status: 400 });
    const flags = await humanFlags(ai, String(original || ""), resume.slice(0, 20000), "");
    return Response.json({ flags, notice: limitNote });
  } catch (e) {
    return Response.json({ error: apiErrorMessage(e, "Couldn’t read the resume.") }, { status: 500 });
  }
}
