import { z } from "zod/v4";
import { database, siteUserId } from "../../../lib/automation-auth";
import { AGENT_MODEL, apiErrorMessage, writerFor } from "../../../lib/claude";
import { CONTACT_STATUSES, importPeopleFromJobs, listContacts } from "../../../lib/network";

const day = (offset = 0) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const text = (v: unknown, max = 2000) => (typeof v === "string" ? v.trim().slice(0, max) : "");

const MetSchema = z.object({
  people: z.array(z.object({ name: z.string(), title: z.string(), company: z.string(), link: z.string(), notes: z.string() })),
});

export async function GET() {
  return Response.json({ contacts: await listContacts(siteUserId()) });
}

// "import": brings in the people found on job pages. "add": someone the person met or found themselves.
export async function POST(request: Request) {
  const userId = siteUserId();
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  if (body.action === "import") {
    const added = await importPeopleFromJobs(userId);
    return Response.json({ added, contacts: await listContacts(userId) });
  }
  // "read": Claude turns messy notes from an event into a list of people. Nothing is saved until the person checks it.
  if (body.action === "read") {
    const notes = text(body.text, 12000);
    if (!notes) return Response.json({ error: "Paste your notes first." }, { status: 400 });
    try {
      const { ai, limitNote } = await writerFor(userId, "networking");
      if (!ai) return Response.json({ error: limitNote || "Reading notes needs your Claude plan (start the helper) or an API key." }, { status: 400 });
      const r = await ai.ask({
        model: AGENT_MODEL,
        maxTokens: 4000,
        effort: "low",
        system: "You turn someone's quick notes from a networking event into a tidy list of the people they met. Use only what the notes say; never invent a name, job, company or link.",
        schema: MetSchema,
        messages: [
          {
            role: "user",
            content: `Split these notes into one entry per person met.\n- name: as written (first name only is fine).\n- title: what they do, or "".\n- company: where they work or study, or "".\n- link: a LinkedIn, website or handle if one is written, or "".\n- notes: everything else about that person, in the writer's own words, kept short.\nSkip anyone who is only mentioned in passing and wasn't met.\n\nNotes:\n${notes}`,
          },
        ],
      });
      return Response.json({ people: r.data?.people || [] });
    } catch (e) {
      return Response.json({ error: apiErrorMessage(e, "Couldn’t read the notes.") }, { status: 500 });
    }
  }
  // "bulk": several people met at the same place and time.
  if (body.action === "bulk") {
    const list = (Array.isArray(body.people) ? body.people : []).slice(0, 60) as Record<string, unknown>[];
    const stamp = new Date().toISOString();
    const db = database();
    const rows = list
      .map((p) => ({ name: text(p.name, 120), title: text(p.title, 160), company: text(p.company, 160), link: text(p.link, 300), notes: text(p.notes) }))
      .filter((p) => p.name);
    if (!rows.length) return Response.json({ error: "Add at least one name." }, { status: 400 });
    await db.batch(
      rows.map((p) =>
        db
          .prepare("INSERT INTO contacts (id,user_id,name,title,company,role,channels_json,notes,met_event_id,met_on,met_where,status,created_at,updated_at) VALUES (?,?,?,?,?,'other',?,?,?,?,?,'to contact',?,?)")
          .bind(crypto.randomUUID(), userId, p.name, p.title, p.company, JSON.stringify(p.link ? [{ kind: "other", label: "Link", value: p.link, note: "" }] : []), p.notes, text(body.metEventId, 80), text(body.metOn, 10), text(body.metWhere, 200), stamp, stamp),
      ),
    );
    return Response.json({ added: rows.length, contacts: await listContacts(userId) });
  }
  if (body.action !== "add") return Response.json({ error: "Unknown action." }, { status: 400 });
  const name = text(body.name, 120);
  if (!name) return Response.json({ error: "Add a name." }, { status: 400 });
  const stamp = new Date().toISOString();
  const link = text(body.link, 300);
  await database()
    .prepare("INSERT INTO contacts (id,user_id,name,title,company,role,channels_json,notes,met_event_id,met_on,met_where,status,created_at,updated_at) VALUES (?,?,?,?,?,'other',?,?,?,?,?,'to contact',?,?)")
    .bind(crypto.randomUUID(), userId, name, text(body.title, 160), text(body.company, 160), JSON.stringify(link ? [{ kind: "other", label: "Link", value: link, note: "" }] : []), text(body.notes), text(body.metEventId, 80), text(body.metOn, 10), text(body.metWhere, 200), stamp, stamp)
    .run();
  return Response.json({ contacts: await listContacts(userId) });
}

// Status changes keep the follow-up dates sensible: a first message sets a follow-up 5 days out; closing clears it.
export async function PATCH(request: Request) {
  const userId = siteUserId();
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const id = text(body.id, 80);
  const row = await database().prepare("SELECT * FROM contacts WHERE id=? AND user_id=?").bind(id, userId).first<Record<string, string>>();
  if (!row) return Response.json({ error: "Contact not found." }, { status: 404 });
  const next = { ...row };
  if (typeof body.status === "string") {
    if (!(CONTACT_STATUSES as readonly string[]).includes(body.status)) return Response.json({ error: "Unknown status." }, { status: 400 });
    if (body.status === "contacted" && row.status !== "contacted") {
      next.last_contact_at = day();
      if (body.nextFollowUpAt === undefined) next.next_follow_up_at = day(5);
    }
    if (body.status === "closed" || body.status === "referred") next.next_follow_up_at = "";
    next.status = body.status;
  }
  for (const [key, col] of [
    ["nextFollowUpAt", "next_follow_up_at"],
    ["meetingAt", "meeting_at"],
    ["lastContactAt", "last_contact_at"],
    ["notes", "notes"],
    ["message", "message"],
    ["metEventId", "met_event_id"],
    ["metOn", "met_on"],
    ["metWhere", "met_where"],
    ["name", "name"],
    ["title", "title"],
    ["company", "company"],
  ] as const) {
    if (typeof body[key] === "string") next[col] = text(body[key]);
  }
  await database()
    .prepare("UPDATE contacts SET status=?,last_contact_at=?,next_follow_up_at=?,meeting_at=?,notes=?,message=?,met_event_id=?,met_on=?,met_where=?,name=?,title=?,company=?,updated_at=? WHERE id=? AND user_id=?")
    .bind(next.status, next.last_contact_at, next.next_follow_up_at, next.meeting_at, next.notes, next.message, next.met_event_id, next.met_on, next.met_where, next.name || row.name, next.title, next.company, new Date().toISOString(), id, userId)
    .run();
  return Response.json({ contacts: await listContacts(userId) });
}

export async function DELETE(request: Request) {
  const userId = siteUserId();
  const id = new URL(request.url).searchParams.get("id") || "";
  await database().prepare("DELETE FROM contacts WHERE id=? AND user_id=?").bind(id, userId).run();
  return Response.json({ contacts: await listContacts(userId) });
}
