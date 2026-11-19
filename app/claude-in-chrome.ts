// "Apply with Claude in Chrome": for Claude Pro/Max subscribers who'd rather have Claude in Chrome fill the form
// on their subscription while they watch. The app writes the brief; the person pastes it into Claude in Chrome.
import { answersForForm, type Answers } from "./answers";
import type { Application, Dossier } from "./jobs";
import type { ProfileData } from "./profile-panel";
import { linksForForm } from "./links";

const KEY = "jh.claudeInChrome";

// A per-browser preference, so it only appears for the person who turned it on.
export function chromeEnabled() {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function setChromeEnabled(on: boolean) {
  try {
    if (on) localStorage.setItem(KEY, "1");
    else localStorage.removeItem(KEY);
  } catch {}
}

export function chromeBrief(job: Application, d: Dossier | null, profile: ProfileData | null, answers: Answers | undefined) {
  const resume = job.tailoredResume || profile?.resumeText || "";
  return `Please fill in this job application for me in the current tab. I'm right here watching.

Job: ${job.role} at ${job.company}
Job location: ${job.location || "not stated"}
Application page: ${job.url}
${d?.salaryAsk ? `Salary to ask: ${d.salaryAsk.amount.toLocaleString("en-US", { style: "currency", currency: d.salaryAsk.currency || "USD", maximumFractionDigits: 0 })}${d.salaryAsk.period === "hour" ? " an hour" : " a year"} (${d.salaryAsk.note})` : "Salary: if asked, stop and ask me."}

About me:
Name: ${profile?.fullName || ""}
Email: ${profile?.email || ""}
Phone: ${profile?.phone || ""}
Location: ${profile?.location || ""}
Links: ${linksForForm(profile?.links)}

My saved answers to common questions:
${(answers && answersForForm(answers)) || "None saved."}

Rules:
- Only use the facts in this message. Never invent anything. If a required question isn't covered, leave it and tell me.
- For voluntary demographic questions without a saved answer, choose "decline to answer".
- "Which country are you applying to work in?": use the job location's country; if several, order them by my saved country preference.
- If the form asks for a resume or cover letter file, stop and tell me so I can attach it myself.
- If it asks me to sign in or create an account, stop and let me do it, then carry on.
- Stop at CAPTCHAs, identity checks or anything asking for payment or ID numbers.
- Do NOT press the final submit button. When everything is filled, tell me what you entered so I can check it and submit.

My resume${job.tailoredResume ? " (tailored for this job)" : ""}:
${resume}
${job.coverLetter ? `\nMy cover letter:\n${job.coverLetter}\n` : ""}${d?.strongestAngle ? `\nWhat to lead with for this job: ${d.strongestAngle}\n` : ""}`;
}
