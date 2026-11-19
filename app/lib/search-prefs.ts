import { database, jsonList } from "./automation-auth";

// What the person is looking for. Shared by the job feed and Autopilot.
// creativeRoles are extra titles looked for only at companies marked "creative" (ski resorts, universities, health systems).
export type SearchPrefs = { roles: string[]; creativeRoles: string[]; locations: string[]; excludedTerms: string[] };

export const DEFAULT_PREFS: SearchPrefs = { roles: [], creativeRoles: [], locations: [], excludedTerms: ["unpaid", "commission only"] };

export async function ensureSettings(userId: string) {
  const now = new Date().toISOString();
  await database()
    .prepare(
      `INSERT OR IGNORE INTO automation_settings
       (user_id,enabled,min_fit,daily_limit,roles_json,locations_json,excluded_terms_json,sources_json,runner_token_hash,last_heartbeat_at,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .bind(userId, 0, 70, 5, "[]", "[]", JSON.stringify(DEFAULT_PREFS.excludedTerms), JSON.stringify(["greenhouse", "lever", "ashby"]), "", "", now, now)
    .run();
}

export async function getPrefs(userId: string): Promise<SearchPrefs> {
  await ensureSettings(userId);
  const row = await database().prepare("SELECT roles_json,creative_roles_json,locations_json,excluded_terms_json FROM automation_settings WHERE user_id=?").bind(userId).first<Record<string, unknown>>();
  return {
    roles: jsonList(row?.roles_json),
    creativeRoles: jsonList(row?.creative_roles_json),
    locations: jsonList(row?.locations_json),
    excludedTerms: jsonList(row?.excluded_terms_json),
  };
}

const clean = (v: unknown) => (Array.isArray(v) ? v.map(String).map((x) => x.trim()).filter(Boolean).slice(0, 30) : null);

// Only the lists present in `body` change; the others keep their saved values.
export async function savePrefs(userId: string, body: Record<string, unknown>) {
  const current = await getPrefs(userId);
  const next: SearchPrefs = {
    roles: clean(body.roles) ?? current.roles,
    creativeRoles: clean(body.creativeRoles) ?? current.creativeRoles,
    locations: clean(body.locations) ?? current.locations,
    excludedTerms: clean(body.excludedTerms) ?? current.excludedTerms,
  };
  await database()
    .prepare("UPDATE automation_settings SET roles_json=?,creative_roles_json=?,locations_json=?,excluded_terms_json=?,updated_at=? WHERE user_id=?")
    .bind(JSON.stringify(next.roles), JSON.stringify(next.creativeRoles), JSON.stringify(next.locations), JSON.stringify(next.excludedTerms), new Date().toISOString(), userId)
    .run();
  return next;
}
