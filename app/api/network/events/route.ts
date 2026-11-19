import { database, siteUserId } from "../../../lib/automation-auth";
import { apiErrorMessage, writerFor } from "../../../lib/claude";
import { findAndSaveEvents, listEvents, mergePlaces, type SearchProgress } from "../../../lib/network";
import { getPrefs } from "../../../lib/search-prefs";

const STATUSES = new Set(["new", "going", "maybe", "skipped", "went", "missed"]);

export async function GET() {
  return Response.json({ events: await listEvents(siteUserId()) });
}

// "find": searches the web for design events in the person's places (their job-search places plus online) and saves the real ones.
// "add": an event the person found themselves.
export async function POST(request: Request) {
  const userId = siteUserId();
  const body = (await request.json().catch(() => ({}))) as Record<string, string | string[] | boolean | undefined>;
  try {
    if (body.action === "add") {
      const title = String(body.title || "").trim();
      const startsAt = String(body.startsAt || "").trim();
      if (!title || !/^\d{4}-\d{2}-\d{2}/.test(startsAt)) return Response.json({ error: "Add a name and a date." }, { status: 400 });
      const stamp = new Date().toISOString();
      await database()
        .prepare("INSERT INTO network_events (id,user_id,title,starts_at,ends_at,city,venue,url,organizer,kind,cost,summary,status,verified,source,created_at,updated_at) VALUES (?,?,?,?,'',?,'',?,'',?,'','','going',0,'manual',?,?)")
        .bind(crypto.randomUUID(), userId, title, startsAt, String(body.city || ""), String(body.url || ""), String(body.kind || "").slice(0, 40), stamp, stamp)
        .run();
      return Response.json({ events: await listEvents(userId) });
    }
    if (body.action !== "find") return Response.json({ error: "Unknown action." }, { status: 400 });
    const { ai, limitNote } = await writerFor(userId, "networking");
    if (!ai) return Response.json({ error: limitNote || "Finding events needs your Claude plan (start the helper) or an API key." }, { status: 400 });
    const asked = Array.isArray(body.places) ? body.places.map(String).filter(Boolean) : [];
    const places = mergePlaces(asked.length ? asked : [...(await getPrefs(userId)).locations.filter((l) => !/remote/i.test(l)), "Online"]).slice(0, 8);
    // With "stream", the page gets one line of JSON per step, then the final result, so it can show what's happening.
    if (body.stream) {
      const enc = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          // If the tab is closed or reloaded, stop sending but let the search finish and save what it finds.
          let open = true;
          const send = (x: SearchProgress | Record<string, unknown>) => {
            if (!open) return;
            try {
              controller.enqueue(enc.encode(`${JSON.stringify(x)}\n`));
            } catch {
              open = false;
            }
          };
          send({ type: "places", places });
          try {
            const result = await findAndSaveEvents(userId, ai, places, send);
            send({ type: "result", events: await listEvents(userId), result, places, notice: limitNote });
          } catch (e) {
            send({ type: "error", error: apiErrorMessage(e, "Couldn’t search for events.") });
          }
          if (open) try { controller.close(); } catch { /* the tab went away */ }
        },
      });
      return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-cache, no-transform" } });
    }
    const result = await findAndSaveEvents(userId, ai, places);
    return Response.json({ events: await listEvents(userId), result, places, notice: limitNote });
  } catch (e) {
    return Response.json({ error: apiErrorMessage(e, "Couldn’t search for events.") }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const userId = siteUserId();
  const { id, status, notes } = (await request.json().catch(() => ({}))) as { id?: string; status?: string; notes?: string };
  if (!id || (status !== undefined && !STATUSES.has(status)) || (status === undefined && typeof notes !== "string")) return Response.json({ error: "Unknown event or status." }, { status: 400 });
  const stamp = new Date().toISOString();
  if (status) await database().prepare("UPDATE network_events SET status=?,updated_at=? WHERE id=? AND user_id=?").bind(status, stamp, id, userId).run();
  if (typeof notes === "string") await database().prepare("UPDATE network_events SET notes=?,updated_at=? WHERE id=? AND user_id=?").bind(notes.slice(0, 4000), stamp, id, userId).run();
  return Response.json({ events: await listEvents(userId) });
}

export async function DELETE(request: Request) {
  const userId = siteUserId();
  const id = new URL(request.url).searchParams.get("id") || "";
  await database().prepare("DELETE FROM network_events WHERE id=? AND user_id=?").bind(id, userId).run();
  return Response.json({ events: await listEvents(userId) });
}
