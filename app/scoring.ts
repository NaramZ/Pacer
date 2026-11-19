// How a resume match score is worked out. Shared by the server and the breakdown on each job.
export type Verdict = "Strong" | "Partial" | "Gap";
export type Importance = "Required" | "Preferred" | "Core signal";

export const IMPORTANCE_WEIGHT: Record<Importance, number> = { Required: 1.3, "Core signal": 1, Preferred: 0.6 };
export const VERDICT_CREDIT: Record<Verdict, number> = { Strong: 1, Partial: 0.55, Gap: 0 };

type Scored = { importance: string; verdict: string };

export function pointsFor(r: Scored) {
  const weight = IMPORTANCE_WEIGHT[r.importance as Importance] ?? 1;
  return { weight, earned: weight * (VERDICT_CREDIT[r.verdict as Verdict] ?? 0) };
}

export function scoreOf(reqs: Scored[]) {
  const totals = reqs.map(pointsFor).reduce((t, p) => ({ weight: t.weight + p.weight, earned: t.earned + p.earned }), { weight: 0, earned: 0 });
  return totals.weight ? Math.round((totals.earned / totals.weight) * 100) : 0;
}

// "Strong" needs evidence the resume actually shows. If the explanation admits it can't see any, it's capped.
const NO_EVIDENCE = /not (shown|visible|stated|mentioned|listed|included|evident)|no (direct |explicit |clear )?evidence|can(no|')t (see|tell|confirm|verify)|unable to (see|confirm|verify)|doesn't (show|mention)|does not (show|mention)|isn't (shown|mentioned)|unclear/i;

export function strictVerdict(verdict: Verdict, resumeEvidence: string): Verdict {
  if (verdict === "Strong" && NO_EVIDENCE.test(resumeEvidence)) return "Partial";
  return verdict;
}
