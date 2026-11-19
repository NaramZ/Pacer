import { env } from "cloudflare:workers";
import { database } from "./automation-auth";
import type { Identity } from "./pdf";
import { cleanAnswers, parseAnswers, type Answers } from "../answers";
import { linkList } from "../links";
import { homeFor } from "./standing-experience";

export type Profile = {
  fullName: string;
  email: string;
  phone: string;
  location: string;
  links: string;
  headline: string;
  resumeText: string;
  resumeFileName: string;
  focus: string;
  experience: string;
  secondHome: string;
  secondHomeFor: string;
  everydaySkills: string;
};

const COLUMNS: Record<keyof Profile, string> = {
  fullName: "full_name",
  email: "email",
  phone: "phone",
  location: "location",
  links: "links",
  headline: "headline",
  resumeText: "resume_text",
  resumeFileName: "resume_file_name",
  focus: "focus",
  experience: "experience",
  secondHome: "second_home",
  secondHomeFor: "second_home_for",
  everydaySkills: "everyday_skills",
};

export async function getProfile(userId: string): Promise<Profile | null> {
  const row = await database().prepare("SELECT * FROM profiles WHERE user_id=?").bind(userId).first<Record<string, string>>();
  if (!row) return null;
  return Object.fromEntries(Object.entries(COLUMNS).map(([key, col]) => [key, row[col] || ""])) as Profile;
}

export async function saveProfile(userId: string, profile: Profile) {
  const now = new Date().toISOString();
  const cols = Object.values(COLUMNS);
  const values = Object.keys(COLUMNS).map((key) => String(profile[key as keyof Profile] || "").trim());
  await database()
    .prepare(
      `INSERT INTO profiles (user_id,${cols.join(",")},created_at,updated_at) VALUES (?,${cols.map(() => "?").join(",")},?,?)
       ON CONFLICT(user_id) DO UPDATE SET ${cols.map((c) => `${c}=excluded.${c}`).join(",")},updated_at=excluded.updated_at`,
    )
    .bind(userId, ...values, now, now)
    .run();
}

// A key in .dev.vars wins; otherwise use the one the user saved in the app.
export async function getApiKey(userId: string) {
  if (env.ANTHROPIC_API_KEY) return { key: env.ANTHROPIC_API_KEY, source: "env" as const };
  const row = await database().prepare("SELECT anthropic_api_key FROM profiles WHERE user_id=?").bind(userId).first<{ anthropic_api_key: string }>();
  return row?.anthropic_api_key ? { key: row.anthropic_api_key, source: "saved" as const } : null;
}

export async function setApiKey(userId: string, key: string) {
  const now = new Date().toISOString();
  await database()
    .prepare(
      `INSERT INTO profiles (user_id,anthropic_api_key,created_at,updated_at) VALUES (?,?,?,?)
       ON CONFLICT(user_id) DO UPDATE SET anthropic_api_key=excluded.anthropic_api_key,updated_at=excluded.updated_at`,
    )
    .bind(userId, key.trim(), now, now)
    .run();
}

export function identityOf(p: Profile | null, jobLocation = ""): Identity {
  return {
    name: p?.fullName || "",
    headline: p?.headline || "",
    contact: [p?.email, p?.phone, homeFor(p, jobLocation), ...linkList(p?.links)].filter(Boolean).join(" | "),
  };
}

export async function getAnswers(userId: string): Promise<Answers> {
  const row = await database().prepare("SELECT answers_json FROM profiles WHERE user_id=?").bind(userId).first<{ answers_json: string }>();
  return parseAnswers(row?.answers_json);
}

export async function saveAnswers(userId: string, input: unknown) {
  const answers = cleanAnswers(input);
  const now = new Date().toISOString();
  await database()
    .prepare(
      `INSERT INTO profiles (user_id,answers_json,created_at,updated_at) VALUES (?,?,?,?)
       ON CONFLICT(user_id) DO UPDATE SET answers_json=excluded.answers_json,updated_at=excluded.updated_at`,
    )
    .bind(userId, JSON.stringify(answers), now, now)
    .run();
  return answers;
}

// Saves one answer to "Your own questions", replacing an earlier answer to the same question.
export async function addCustomAnswer(userId: string, question: string, answer: string) {
  const answers = await getAnswers(userId);
  const key = question.trim().toLowerCase();
  const custom = answers.custom.filter((c) => c.question.trim().toLowerCase() !== key);
  return saveAnswers(userId, { ...answers, custom: [...custom, { question: question.trim(), answer: answer.trim() }] });
}

export async function setBudget(userId: string, usd: number) {
  const value = Math.max(0, Math.min(500, Math.round(usd * 100) / 100));
  const now = new Date().toISOString();
  await database()
    .prepare(
      `INSERT INTO profiles (user_id,monthly_budget_usd,created_at,updated_at) VALUES (?,?,?,?)
       ON CONFLICT(user_id) DO UPDATE SET monthly_budget_usd=excluded.monthly_budget_usd,updated_at=excluded.updated_at`,
    )
    .bind(userId, value, now, now)
    .run();
}
