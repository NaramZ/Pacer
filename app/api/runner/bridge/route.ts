import { database, runnerUserId } from "../../../lib/automation-auth";

// The helper says where it serves Claude Code (the person's Claude plan) on this computer, or that it stopped.
export async function POST(request: Request) {
  const userId = await runnerUserId(request);
  if (!userId) return Response.json({ error: "Invalid runner token." }, { status: 401 });
  const { url, key } = (await request.json()) as { url?: string; key?: string };
  // Only ever this computer.
  const address = /^http:\/\/127\.0\.0\.1:\d{2,5}$/.test(String(url || "")) ? String(url) : "";
  await database().prepare("UPDATE automation_settings SET bridge_url=?,bridge_key=? WHERE user_id=?").bind(address, address ? String(key || "") : "", userId).run();
  return Response.json({ ok: true });
}
