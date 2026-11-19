import { database, siteUserId } from "../../lib/automation-auth";
import { listCompanies, refreshFeed } from "../../lib/feed";
import { fetchBoard, findBoard, ATS_LABEL } from "../../lib/job-boards";

const MAX_COMPANIES = 200;

export async function GET() {
  return Response.json({ companies: await listCompanies(siteUserId()) });
}

export async function POST(request: Request) {
  const userId = siteUserId();
  const { url, name, creative, anywhere } = (await request.json()) as { url?: string; name?: string; creative?: boolean; anywhere?: boolean };
  if (!url?.trim()) return Response.json({ error: "Paste a careers page or job board link." }, { status: 400 });
  try {
    const existing = await listCompanies(userId);
    if (existing.length >= MAX_COMPANIES) return Response.json({ error: `You can follow up to ${MAX_COMPANIES} companies.` }, { status: 400 });
    const board = await findBoard(url.trim());
    const dupe = existing.find((c) => c.ats === board.ats && c.token.toLowerCase() === board.token.toLowerCase());
    if (dupe) return Response.json({ error: `You already follow ${dupe.name}.` }, { status: 409 });

    // Reading the board once confirms it exists and gives us the company's name.
    const { name: boardName, total } = await fetchBoard(board, { keep: () => false });
    const id = crypto.randomUUID();
    await database()
      .prepare("INSERT INTO companies (id,user_id,name,ats,token,careers_url,job_count,last_checked_at,last_error,role_set,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
      .bind(id, userId, name?.trim() || boardName, board.ats, board.token, url.trim(), total, "", "", [creative && "creative", anywhere && "anywhere"].filter(Boolean).join(","), new Date().toISOString())
      .run();
    const [result] = await refreshFeed(userId, id);
    return Response.json(
      { companies: await listCompanies(userId), added: { name: name?.trim() || boardName, via: ATS_LABEL[board.ats], ...result } },
      { status: 201 },
    );
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Couldn’t add that company." }, { status: 422 });
  }
}

// Turns "also look for my creative titles here" and "in any place" on or off for a company, then re-reads its board.
export async function PATCH(request: Request) {
  const userId = siteUserId();
  const { id, creative, anywhere } = (await request.json()) as { id?: string; creative?: boolean; anywhere?: boolean };
  const company = id ? (await listCompanies(userId)).find((c) => c.id === id) : undefined;
  if (!company || (typeof creative !== "boolean" && typeof anywhere !== "boolean")) return Response.json({ error: "Unknown company." }, { status: 400 });
  const flags = new Set(company.role_set.split(",").filter(Boolean));
  for (const [flag, on] of [["creative", creative], ["anywhere", anywhere]] as const) {
    if (on === true) flags.add(flag);
    if (on === false) flags.delete(flag);
  }
  await database().prepare("UPDATE companies SET role_set=? WHERE user_id=? AND id=?").bind([...flags].join(","), userId, company.id).run();
  await refreshFeed(userId, company.id);
  return Response.json({ companies: await listCompanies(userId) });
}

export async function DELETE(request: Request) {
  const userId = siteUserId();
  const id = new URL(request.url).searchParams.get("id") || "";
  await database().batch([
    database().prepare("DELETE FROM feed_jobs WHERE user_id=? AND company_id=? AND status!='added'").bind(userId, id),
    database().prepare("DELETE FROM companies WHERE user_id=? AND id=?").bind(userId, id),
  ]);
  return Response.json({ companies: await listCompanies(userId) });
}
