import { env } from "cloudflare:workers";

export function database() {
  if (!env.DB) throw new Error("Database unavailable.");
  return env.DB;
}

// Single-user local app: no sign-in, every record belongs to this id.
export const LOCAL_USER_ID = "local";

export function siteUserId() {
  return LOCAL_USER_ID;
}

export async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function runnerUserId(request: Request) {
  const header = request.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return "";
  const hash = await sha256(token);
  const row = await database().prepare("SELECT user_id FROM automation_settings WHERE runner_token_hash=?").bind(hash).first<{user_id:string}>();
  return row?.user_id || "";
}

export function jsonList(value: unknown, fallback: string[] = []) {
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : fallback;
  } catch {
    return fallback;
  }
}


// The browser extension authenticates with its own connection code.
export async function extUserId(request: Request) {
  const header = request.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return "";
  const row = await database().prepare("SELECT user_id FROM automation_settings WHERE ext_token_hash=?").bind(await sha256(token)).first<{ user_id: string }>();
  return row?.user_id || "";
}
