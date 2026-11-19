import { database, siteUserId } from "../../lib/automation-auth";
import { bridgeHealth, liveBridge } from "../../lib/claude";
import { getApiKey } from "../../lib/profile";
import { ensureSettings } from "../../lib/search-prefs";

// Which Claude the app is using right now, for the indicator in the header.
export async function GET() {
  const userId = siteUserId();
  await ensureSettings(userId);
  const [row, bridge, key, health] = await Promise.all([
    database().prepare("SELECT apply_engine,api_fallback FROM automation_settings WHERE user_id=?").bind(userId).first<{ apply_engine: string; api_fallback: number }>(),
    liveBridge(userId),
    getApiKey(userId),
    bridgeHealth(userId),
  ]);
  const engine = row?.apply_engine === "api" ? "api" : "subscription";
  const state = engine === "api" ? "api" : bridge ? "subscription" : row?.api_fallback && key ? "fallback-api" : "fallback-free";
  // The helper is running but its Claude Code can't be used (not installed, or signed out): say so rather than "helper off".
  const problem = engine === "subscription" && !bridge && health.running ? health.message || "Claude Code isn’t ready on this computer." : "";
  return Response.json({ state, apiFallback: Boolean(row?.api_fallback), hasKey: Boolean(key), problem });
}

// Whether to use the API key when the helper is off.
export async function PATCH(request: Request) {
  const userId = siteUserId();
  const { apiFallback } = (await request.json()) as { apiFallback?: boolean };
  await database().prepare("UPDATE automation_settings SET api_fallback=? WHERE user_id=?").bind(apiFallback ? 1 : 0, userId).run();
  return GET();
}
