import { extUserId } from "../../../lib/automation-auth";
import { bridgeHealth } from "../../../lib/claude";
import { getProfile } from "../../../lib/profile";

// The extension checks it's connected, and whose app this is.
export async function GET(request: Request) {
  const userId = await extUserId(request);
  if (!userId) return Response.json({ error: "Not connected. Create a connection code in the app (Profile → Browser extension)." }, { status: 401 });
  const [profile, health] = await Promise.all([getProfile(userId), bridgeHealth(userId)]);
  return Response.json({ ok: true, name: profile?.fullName || "", hasResume: Boolean(profile?.resumeText), subscription: health.ready });
}
