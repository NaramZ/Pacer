// Saved answers to questions that come up on most job applications.
// Shared by the Profile panel, the server and the browser helper (so: plain, erasable TypeScript only).

export type CustomAnswer = { question: string; answer: string };

export type Answers = {
  preferredName: string;
  pronouns: string;
  countries: string;
  authorized: string;
  sponsorship: string;
  over18: string;
  level: string;
  salaryFloor: string;
  startDate: string;
  relocate: string;
  workType: string;
  howHeard: string;
  previousEmployers: string;
  nonCompete: string;
  governmentOfficial: string;
  languages: string;
  acknowledgements: string;
  gender: string;
  ethnicity: string;
  veteran: string;
  disability: string;
  sexualOrientation: string;
  transgender: string;
  custom: CustomAnswer[];
};

export const DECLINE = "Decline to self-identify";

export const DEFAULT_ANSWERS: Answers = {
  preferredName: "",
  pronouns: "",
  countries: "",
  authorized: "",
  sponsorship: "",
  over18: "",
  level: "",
  salaryFloor: "",
  startDate: "",
  relocate: "",
  workType: "",
  howHeard: "Company website",
  previousEmployers: "",
  nonCompete: "",
  governmentOfficial: "",
  languages: "",
  acknowledgements: "",
  gender: DECLINE,
  ethnicity: DECLINE,
  veteran: DECLINE,
  disability: DECLINE,
  sexualOrientation: DECLINE,
  transgender: DECLINE,
  custom: [],
};

type Field = { key: Exclude<keyof Answers, "custom">; label: string; hint?: string; options?: string[]; placeholder?: string; voluntary?: boolean };

// Ordered by how often they appeared across 145 real applications (Greenhouse, Lever, Ashby).
export const ANSWER_FIELDS: Field[] = [
  {
    key: "countries",
    label: "Countries you’d work in, most preferred first",
    placeholder: "e.g. United States, Canada",
    hint: "Each application is answered with the job’s own location; this only sets the order when a job lists several countries.",
  },
  {
    key: "authorized",
    label: "Countries you can work in without visa sponsorship",
    placeholder: "e.g. United States, Canada",
    hint: "Work authorization and sponsorship questions are answered per job: in these countries you’re authorized and need no sponsorship; anywhere else, you’re not authorized and would need sponsorship.",
  },
  { key: "over18", label: "Are you 18 or older?", options: ["Yes", "No"] },
  {
    key: "level",
    label: "Your experience level",
    options: ["Entry level", "Mid level", "Senior", "Lead or manager"],
    hint: "Salary is worked out for each job from its posted range or market data for the role and area, pitched at this level.",
  },
  { key: "salaryFloor", label: "Lowest salary you’d accept (optional)", placeholder: "e.g. $70,000 a year", hint: "Salary answers never go below this." },
  { key: "startDate", label: "When can you start?", placeholder: "e.g. Immediately, or two weeks after an offer" },
  { key: "relocate", label: "Willing to relocate?", options: ["Yes", "No", "Open to discuss"] },
  { key: "workType", label: "Preferred way of working", options: ["Any", "Remote", "Hybrid", "On-site"] },
  { key: "howHeard", label: "How did you hear about the job?", placeholder: "e.g. Company website" },
  {
    key: "previousEmployers",
    label: "Companies you’ve worked for before",
    placeholder: "e.g. UPMC, Target",
    hint: "For “Have you worked here before?” Anything not listed is answered No.",
  },
  { key: "preferredName", label: "Preferred first name", placeholder: "Only if different from your legal name" },
  {
    key: "acknowledgements",
    label: "Required privacy notices and acknowledgements",
    options: ["Tick them for me; I’ll review before submitting", "List them for me to tick myself"],
    hint: "About a third of applications ask you to confirm you’ve read a privacy notice or policy.",
  },
  { key: "pronouns", label: "Pronouns", options: ["She/her", "He/him", "They/them", "Prefer not to say"] },
  { key: "nonCompete", label: "Are you bound by a non-compete or non-solicitation agreement?", options: ["No", "Yes"] },
  { key: "languages", label: "Languages you speak fluently", placeholder: "e.g. English, Spanish" },
  { key: "governmentOfficial", label: "Are you, or were you in the last five years, a government official?", options: ["No", "Yes"] },
  { key: "gender", label: "Gender", voluntary: true, options: [DECLINE, "Woman", "Man", "Non-binary"] },
  {
    key: "ethnicity",
    label: "Race or ethnicity",
    voluntary: true,
    options: [
      DECLINE,
      "Hispanic or Latino",
      "White",
      "Black or African American",
      "Asian",
      "Middle Eastern or North African",
      "Native Hawaiian or Other Pacific Islander",
      "American Indian or Alaska Native",
      "Two or more races",
    ],
  },
  { key: "veteran", label: "Veteran status", voluntary: true, options: [DECLINE, "I am not a protected veteran", "I am a protected veteran"] },
  { key: "disability", label: "Disability status", voluntary: true, options: [DECLINE, "No, I do not have a disability", "Yes, I have a disability"] },
  {
    key: "sexualOrientation",
    label: "Sexual orientation",
    voluntary: true,
    options: [DECLINE, "Heterosexual or straight", "Gay", "Lesbian", "Bisexual", "Queer", "Asexual", "Pansexual", "Not listed"],
  },
  { key: "transgender", label: "Do you identify as transgender?", voluntary: true, options: [DECLINE, "No", "Yes"] },
];

// Keeps only known fields, trimmed, so nothing unexpected is stored or sent to a form.
export function cleanAnswers(input: unknown): Answers {
  const raw = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const text = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const out = { ...DEFAULT_ANSWERS };
  for (const f of ANSWER_FIELDS) if (raw[f.key] !== undefined) out[f.key] = text(raw[f.key]);
  out.custom = (Array.isArray(raw.custom) ? raw.custom : [])
    .map((c) => ({ question: text((c as CustomAnswer)?.question, 300), answer: text((c as CustomAnswer)?.answer, 1000) }))
    .filter((c) => c.question && c.answer)
    .slice(0, 40);
  return out;
}

export function parseAnswers(json: string | null | undefined): Answers {
  try {
    return cleanAnswers(JSON.parse(json || "{}"));
  } catch {
    return { ...DEFAULT_ANSWERS };
  }
}

// The answers as plain text for the application filler; blank ones are left out so they're asked about instead.
export function answersForForm(a: Answers) {
  const lines = ANSWER_FIELDS.filter((f) => a[f.key]).map((f) => `- ${f.label}${f.voluntary ? " (voluntary)" : ""} → ${a[f.key]}`);
  // Authorization depends on where the job is, so the rule goes with the list.
  if (a.authorized)
    lines.push(
      `- "Are you authorized to work in [the job's country]?" → Yes only if that country is one of: ${a.authorized}; otherwise No.`,
      `- "Will you now or in the future need visa sponsorship?" → No if the job's country is one of: ${a.authorized}; otherwise Yes.`,
    );
  for (const c of a.custom) lines.push(`- ${c.question} → ${c.answer}`);
  return lines.join("\n");
}
