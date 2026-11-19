import { database, runnerUserId } from "../../../lib/automation-auth";

// A cheap check the helper makes between steps, so Stop in the app takes effect straight away.
export async function GET(request: Request) {
  const userId = await runnerUserId(request);
  if (!userId) return Response.json({ error: "Invalid runner token." }, { status: 401 });
  const row = await database().prepare("SELECT enabled FROM automation_settings WHERE user_id=?").bind(userId).first<{ enabled: number }>();
  return Response.json({ enabled: Boolean(row?.enabled) });
}
