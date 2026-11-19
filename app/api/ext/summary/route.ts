import { database, extUserId } from "../../../lib/automation-auth";

// The fit at a glance for the extension: the match, the match with the tailored documents, and what's missing.
export async function GET(request: Request) {
  const userId = await extUserId(request);
  if (!userId) return Response.json({ error: "Not connected." }, { status: 401 });
  const id = new URL(request.url).searchParams.get("id") || "";
  const row = await database().prepare("SELECT company,role,location,status,dossier_json FROM applications WHERE id=? AND user_id=?").bind(id, userId).first<Record<string, string>>();
  if (!row) return Response.json({ error: "Job not found." }, { status: 404 });
  const d = row.dossier_json ? JSON.parse(row.dossier_json) : {};
  const reqs = (d.requirements || []) as { requirement: string; verdict: string; importance: string }[];
  const after = new Map(((d.docScore?.items || []) as { requirement: string; after: string }[]).map((x) => [x.requirement, x.after]));
  const count = (v: string) => reqs.filter((r) => r.verdict === v).length;
  return Response.json({
    company: row.company,
    role: row.role,
    location: row.location,
    status: row.status,
    score: Number(d.evidenceScore) || 0,
    scoreAfter: d.docScore?.after ?? null,
    letterCovers: d.docScore ? `${d.docScore.letterCovers} of ${d.docScore.total}` : "",
    strong: count("Strong"),
    partial: count("Partial"),
    missing: count("Gap"),
    total: reqs.length,
    // The requirements still not shown after tailoring, most important first.
    gaps: reqs
      .filter((r) => (after.get(r.requirement) || r.verdict) === "Gap")
      .sort((a, b) => (a.importance === "Required" ? -1 : 0) - (b.importance === "Required" ? -1 : 0))
      .slice(0, 4)
      .map((r) => `${r.requirement}${r.importance === "Required" ? " (required)" : ""}`),
    recommendation: String(d.recommendation || ""),
    salary: d.salaryAsk ? `${d.salaryAsk.currency === "USD" || !d.salaryAsk.currency ? "$" : ""}${Number(d.salaryAsk.amount).toLocaleString("en-US")}${d.salaryAsk.period === "hour" ? "/hr" : ""}` : "",
    warnings: (d.docWarnings || []).length,
  });
}
