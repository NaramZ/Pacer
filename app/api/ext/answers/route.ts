import { z } from "zod/v4";
import { database, extUserId } from "../../../lib/automation-auth";
import { apiErrorMessage, AGENT_MODEL, writerFor } from "../../../lib/claude";
import { answersForForm } from "../../../answers";
import { getAnswers, getProfile } from "../../../lib/profile";
import { salaryForForm } from "../../../lib/salary";
import { linksForForm } from "../../../links";
import { homeFor } from "../../../lib/standing-experience";

type Question = { id: string; label: string; kind: string; options?: string[]; required?: boolean };

const AnswersSchema = z.object({ answers: z.array(z.object({ id: z.string(), value: z.string() })) });

const SYSTEM = `You answer the questions on a job application form for the person, from what they've told you. For each question (by its number, as "id") give the value to enter (the person reviews every answer before submitting), or "" where the rules below say so.
Rules:
- Use the facts given first: contact details, saved answers, resume, cover letter and the job. Never change contact details, employers, schools or dates.
- Saved answers count whenever a question means the same thing, however it's worded.
- Multiple choice: the value must be exactly one of that question's options; pick the one that means the same as the person's answer. Checkbox questions that should be ticked: "true".
- Voluntary demographic questions (gender, race, veteran, disability, sexual orientation): use the saved answer; if there isn't one, the option that declines to answer; if no option declines, "".
- "Which country are you applying to work in?": the job location's country.
- "Have you worked here before?" / "Were you referred?": No, unless the resume or saved answers say so for this company.
- Salary: use the figure given for this job; never go lower; if none is given, "".
- Open-ended and behavioral questions ("Why us?", "Walk me through your mobile experience", "A time you deviated from your process", "Smallest and largest team you've been on"): always answer, never "". 3–5 sentences in the first person, a short STAR story built from the resume or cover letter where possible, answered confidently (don't open by saying they lack the experience).
- Cover letter text fields: the cover letter as given.
- Questions the resume doesn't cover (experience it doesn't show, a specific yes/no, years of experience): the person reviews every answer before submitting, so write a plausible placeholder for a mid-level product designer rather than "". Never fill licenses, certifications, government IDs, legal or criminal-history questions, or dates: "" for those.`;

// The questions the extension couldn't fill from the profile alone, answered in one go.
export async function POST(request: Request) {
  const userId = await extUserId(request);
  if (!userId) return Response.json({ error: "Not connected." }, { status: 401 });
  try {
    const { id, questions } = (await request.json().catch(() => ({}))) as { id?: string; questions?: Question[] };
    const list = (questions || []).filter((q) => q?.id && q?.label).slice(0, 60);
    if (!list.length) return Response.json({ answers: [] });
    const [row, profile, saved] = await Promise.all([
      database().prepare("SELECT * FROM applications WHERE id=? AND user_id=?").bind(id || "", userId).first<Record<string, unknown>>(),
      getProfile(userId),
      getAnswers(userId),
    ]);
    if (!row || !profile) return Response.json({ error: "Job not found." }, { status: 404 });
    const { ai, limitNote } = await writerFor(userId, "apply");
    if (!ai) return Response.json({ answers: [], notice: limitNote || "Start the helper (or add an API key) so Claude can answer the form’s own questions." });
    const dossier = row.dossier_json ? JSON.parse(String(row.dossier_json)) : {};
    const r = await ai.ask({
      model: AGENT_MODEL,
      maxTokens: 6000,
      effort: "low",
      system: SYSTEM,
      schema: AnswersSchema,
      messages: [
        {
          role: "user",
          content: `<job>${row.role} at ${row.company} · ${row.location || "location not stated"}</job>
<person>Name: ${profile.fullName} · Email: ${profile.email} · Phone: ${profile.phone} · Location: ${homeFor(profile, String(row.location || ""))} · Links: ${linksForForm(profile.links)}</person>
<salary>${salaryForForm(dossier.salaryAsk) || "No figure worked out."}</salary>
<saved_answers>
${answersForForm(saved) || "None."}
</saved_answers>
<resume>
${row.tailored_resume || profile.resumeText}
</resume>
<cover_letter>
${row.cover_letter || ""}
</cover_letter>
<questions>
${list.map((q, i) => `${i + 1}. ${q.label}${q.required ? " (required)" : ""} [${q.kind}]${q.options?.length ? ` options: ${q.options.slice(0, 60).join(" | ")}` : ""}`).join("\n")}
</questions>`,
        },
      ],
    });
    // Questions go to Claude numbered 1, 2, 3…; the answers are mapped back to the extension's own field ids.
    const answers = (r.data?.answers || [])
      .map((a) => ({ id: list[Number(String(a.id).replace(/\D/g, "")) - 1]?.id, value: a.value }))
      .filter((a): a is { id: string; value: string } => Boolean(a.id));
    return Response.json({ answers, notice: limitNote });
  } catch (e) {
    return Response.json({ error: apiErrorMessage(e, "Couldn’t answer the form’s questions.") }, { status: 500 });
  }
}
