import { siteUserId } from "../../lib/automation-auth";
import { monthlySpend } from "../../lib/claude";
import { getAnswers, getApiKey, getProfile, Profile, saveAnswers, saveProfile, setApiKey, setBudget } from "../../lib/profile";

const FIELDS: (keyof Profile)[] = ["fullName", "email", "phone", "location", "links", "headline", "resumeText", "resumeFileName", "focus", "experience", "secondHome", "secondHomeFor", "everydaySkills"];
const MAX_RESUME_CHARS = 60000;

// The API key itself never leaves the server; the page only learns whether one is set.
async function payload(userId: string) {
  const [profile, key, answers, usage] = await Promise.all([getProfile(userId), getApiKey(userId), getAnswers(userId), monthlySpend(userId)]);
  return { profile, apiKey: key ? { source: key.source, hint: `…${key.key.slice(-4)}` } : null, answers, usage };
}

export async function GET() {
  return Response.json(await payload(siteUserId()));
}

export async function PUT(request: Request) {
  const userId = siteUserId();
  const body = (await request.json()) as Partial<Profile> & { apiKey?: string; answers?: unknown; monthlyBudgetUsd?: number };
  if (body.monthlyBudgetUsd !== undefined) {
    if (!Number.isFinite(Number(body.monthlyBudgetUsd))) return Response.json({ error: "Enter an amount in dollars." }, { status: 400 });
    await setBudget(userId, Number(body.monthlyBudgetUsd));
  }
  if (body.answers !== undefined) await saveAnswers(userId, body.answers);
  if (body.apiKey !== undefined) {
    const key = body.apiKey.trim();
    if (key && !key.startsWith("sk-ant-")) return Response.json({ error: "That doesn’t look like an Anthropic API key. It starts with “sk-ant-”." }, { status: 400 });
    await setApiKey(userId, key);
  }
  if (FIELDS.some((f) => body[f] !== undefined)) {
    const current = (await getProfile(userId)) || ({} as Profile);
    const next = Object.fromEntries(FIELDS.map((f) => [f, String(body[f] ?? current[f] ?? "")])) as Profile;
    if (next.resumeText.length > MAX_RESUME_CHARS) return Response.json({ error: "That resume is too long. Paste just the resume text." }, { status: 400 });
    await saveProfile(userId, next);
  }
  return Response.json(await payload(userId));
}
