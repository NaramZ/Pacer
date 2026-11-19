import { z } from "zod/v4";
import { AGENT_MODEL, type Writer } from "./claude";

export type Channel = { kind: "email" | "linkedin" | "website" | "social" | "other"; label: string; value: string; note: string };
export type Contact = { name: string; title: string; role: "hiring manager" | "recruiter" | "peer" | "leader"; foundAt: string; channels: Channel[]; message: string };
export type PeopleResult = { people: Contact[]; emailFormat: string; emailFormatSource: string; foundAt: string; warnings?: string[] };

const PROMPT = `Find people at this company who are worth contacting about this job, and free ways to reach them without a LinkedIn connection or paid InMail.

Look for, in this order: the likely hiring manager (who leads the team this role sits on), the recruiter for the role (often named in the posting or on LinkedIn), and one or two people in a similar role at the company. Up to 5 people.

Search widely, with several different searches, for example: "{COMPANY} head of design", "{COMPANY} design manager", "{COMPANY} product designer", "{COMPANY} design recruiter", "site:linkedin.com/in {COMPANY} product design", "{COMPANY} design team", "{COMPANY} design blog" or Medium posts by its designers, conference or podcast speaker pages, Dribbble, ADPList and the company's About or Team page. For a small company, the founder or CEO is usually the hiring manager. Aim for at least 3 people when the company has that many people publicly listed; never pad with someone you couldn't confirm.

For each person, list every free way to reach them that is publicly listed: work email if published; their personal website or contact form; X, Bluesky, Mastodon, Dribbble, Behance, GitHub or ADPList profiles; their LinkedIn URL. Also find the company's work email format if it's publicly documented (for example "first.last@company.com" from a press page or an email-format directory) and cite where.

Rules:
- Only use professional information people or their company have published. Never personal phone numbers, home addresses or personal email accounts.
- A work email built from the company's format is allowed only when the format is documented; mark it as a guess in "note".
- Never guess a profile or website address. Only list links you actually found; if you only know the name, list no LinkedIn link.
- Every person needs "foundAt": the page where you confirmed they work there and their role.
- For each person write a short, warm message under 90 words from the candidate: why this role, one concrete proof point from what they asked to emphasize, and a light ask (a quick question or 15-minute chat). No flattery, no "I hope this finds you well".
- Don't say they've already applied; write as someone interested in the role.
- Every fact about the candidate in a message must come from their resume below, in its own words' meaning — for example "foundational designer" never becomes "founded", and nothing is "solo" unless the resume says so.

If no format is documented, emailFormat and emailFormatSource are empty strings.`;

const PeopleSchema = z.object({
  emailFormat: z.string(),
  emailFormatSource: z.string(),
  people: z.array(
    z.object({
      name: z.string(),
      title: z.string(),
      role: z.enum(["hiring manager", "recruiter", "peer", "leader"]),
      foundAt: z.string(),
      channels: z.array(z.object({ kind: z.enum(["email", "linkedin", "website", "social", "other"]), label: z.string(), value: z.string(), note: z.string() })),
      message: z.string(),
    }),
  ),
});

// Runs on the person's Claude plan (Claude Code's web search) when the helper is running, otherwise the API's.
export async function findPeople(
  ai: Writer,
  job: { title: string; company: string; location: string; url: string },
  candidate: { name: string; focus: string; headline: string; resume: string },
): Promise<PeopleResult | null> {
  const r = await ai.ask({
    model: AGENT_MODEL,
    maxTokens: 6000,
    effort: "low",
    search: 10,
    system: "You find people at a company worth contacting about a job, and write short, honest outreach messages from the candidate.",
    schema: PeopleSchema,
    messages: [
      {
        role: "user",
        content: `${PROMPT.replaceAll("{COMPANY}", job.company)}

Job: ${job.title} at ${job.company}${job.location ? ` (${job.location})` : ""}
Posting: ${job.url || "not available"}
Candidate: ${candidate.name}, ${candidate.headline || "job seeker"}
What they want to emphasize: ${candidate.focus || "their most relevant experience"}

<candidate_resume>
${candidate.resume}
</candidate_resume>`,
      },
    ],
  });
  if (!r.data) return null;
  const people = r.data.people
    .filter((p) => p?.name && p?.foundAt)
    .slice(0, 5)
    // Links the search couldn't confirm are dropped; only guessed work emails may stay, labelled as guesses.
    .map((p) => ({
      ...p,
      channels: (p.channels || [])
        .filter((c) => c?.value)
        .filter((c) => c.kind === "email" || !/unverified|not (been )?confirmed|guess|likely|may be|might be|could be/i.test(`${c.note} ${c.label}`))
        .slice(0, 8),
    }));
  return { people, emailFormat: r.data.emailFormat || "", emailFormatSource: r.data.emailFormatSource || "", foundAt: new Date().toISOString() };
}
