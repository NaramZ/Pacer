import { database, extUserId } from "../../../lib/automation-auth";
import { linkEntries } from "../../../links";
import { ANSWER_FIELDS } from "../../../answers";
import { coverLetterPdfBytes, resumePdfBytes } from "../../../lib/pdf";
import { getAnswers, getProfile, identityOf } from "../../../lib/profile";
import { homeFor } from "../../../lib/standing-experience";
import { salaryForForm } from "../../../lib/salary";

const base64 = (bytes: Uint8Array) => {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

// Everything the extension needs to fill in a form: contact details, links, saved answers and the two documents.
export async function GET(request: Request) {
  const userId = await extUserId(request);
  if (!userId) return Response.json({ error: "Not connected." }, { status: 401 });
  const id = new URL(request.url).searchParams.get("id") || "";
  const [row, profile, answers] = await Promise.all([
    database().prepare("SELECT * FROM applications WHERE id=? AND user_id=?").bind(id, userId).first<Record<string, unknown>>(),
    getProfile(userId),
    getAnswers(userId),
  ]);
  if (!row) return Response.json({ error: "Job not found." }, { status: 404 });
  if (!profile) return Response.json({ error: "Add your details in Profile first." }, { status: 400 });
  const dossier = row.dossier_json ? JSON.parse(String(row.dossier_json)) : {};
  const [firstName, ...rest] = profile.fullName.trim().split(/\s+/);
  const links = linkEntries(profile.links);
  const find = (re: RegExp) => links.find((l) => re.test(`${l.title} ${l.url}`))?.url || "";
  const slug = `${row.company}-${row.role}`.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 60);
  const resume = String(row.tailored_resume || profile.resumeText || "");
  const letter = String(row.cover_letter || "");
  return Response.json({
    job: { company: row.company, role: row.role, location: row.location },
    fields: {
      firstName: firstName || "",
      lastName: rest.join(" "),
      fullName: profile.fullName,
      preferredName: answers.preferredName || firstName || "",
      email: profile.email,
      phone: profile.phone,
      location: homeFor(profile, String(row.location || "")),
      linkedin: find(/linkedin/i),
      github: find(/github/i),
      portfolio: find(/portfolio|website|site|behance|dribbble/i) || links.find((l) => !/linkedin|github/i.test(l.url))?.url || "",
      pronouns: answers.pronouns || "",
    },
    answers: [
      ...ANSWER_FIELDS.filter((f) => answers[f.key]).map((f) => ({ question: f.label, answer: String(answers[f.key]), voluntary: Boolean(f.voluntary) })),
      ...answers.custom.map((c) => ({ question: c.question, answer: c.answer, voluntary: false })),
    ],
    salary: salaryForForm(dossier.salaryAsk),
    resume: { name: `${slug}-Resume.pdf`, base64: base64(resumePdfBytes(resume)) },
    coverLetter: letter ? { name: `${slug}-Cover-Letter.pdf`, base64: base64(coverLetterPdfBytes(letter, String(row.company), String(row.role), identityOf(profile, String(row.location || "")))), text: letter } : null,
  });
}
