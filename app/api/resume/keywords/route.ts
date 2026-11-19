import { siteUserId } from "../../../lib/automation-auth";
import { apiErrorMessage, writerFor } from "../../../lib/claude";
import { jobKeywords } from "../../../lib/job-analysis";

// The skills and requirements in a pasted job description, read by meaning, for the resume editor's match.
export async function POST(request: Request) {
  const userId = siteUserId();
  try {
    const { jobDescription } = (await request.json()) as { jobDescription?: string };
    if (!jobDescription || jobDescription.trim().length < 40) return Response.json({ error: "Paste the job description first." }, { status: 400 });
    const { ai, limitNote } = await writerFor(userId, "documents");
    if (!ai) return Response.json({ error: limitNote || "This needs your Claude plan (start the helper) or an API key." }, { status: 400 });
    const keywords = await jobKeywords(ai, jobDescription);
    if (!keywords.length) return Response.json({ error: "Couldn’t find requirements in that text. Paste the full posting." }, { status: 422 });
    return Response.json({ keywords, notice: limitNote });
  } catch (e) {
    return Response.json({ error: apiErrorMessage(e, "Couldn’t read the job description.") }, { status: 500 });
  }
}
