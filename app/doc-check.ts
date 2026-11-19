// Fact check for tailored documents: what Claude writes must keep the original's facts, order and sections.

const DATE_RANGE = /\b(?:[A-Z][a-z]{2,8}\.? )?\d{4}\s*[-–—]\s*(?:(?:[A-Z][a-z]{2,8}\.? )?\d{4}|Present|Current|Now)\b/i;
const squash = (s: string) => s.toLowerCase().replace(/[‘’]/g, "'").replace(/[–—]/g, "-").replace(/\s+/g, " ").trim();

// Lists anything in the tailored documents that breaks the rules: changed role lines, reordered roles,
// dropped sections, numbers that aren't in the original, or a cover letter written to the person.
export const SUMMARY_MAX_WORDS = 50;

// The text under the SUMMARY / PROFILE heading, up to the next heading.
export function summaryOf(resume: string) {
  const lines = resume.split("\n");
  const start = lines.findIndex((l) => /^(SUMMARY|PROFILE|PROFESSIONAL SUMMARY|ABOUT( ME)?)$/i.test(l.trim()));
  if (start < 0) return "";
  const end = lines.findIndex((l, i) => i > start && /^[A-Z][A-Z &/]{3,40}$/.test(l.trim()));
  return lines.slice(start + 1, end < 0 ? undefined : end).join(" ").trim();
}

// Bullets under each dated role, keyed by the role's dates.
function bulletsByRole(text: string) {
  const counts = new Map<string, number>();
  let current = "";
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const dates = !line.startsWith("•") && line.match(DATE_RANGE);
    if (dates) {
      current = squash(dates[0]);
      counts.set(current, 0);
    } else if (/^[A-Z][A-Z &/]{3,40}$/.test(line)) current = "";
    else if (current && line.startsWith("•")) counts.set(current, (counts.get(current) || 0) + 1);
  }
  return counts;
}

// Words and habits that make a resume or letter read as machine-written. Anything the person's own resume already says is theirs and fine.
export const STOCK_WORDS =/\b(leverag\w*|spearhead\w*|orchestrat\w*|passionate|passion for|dynamic|seamless\w*|robust|cutting-edge|innovative|synerg\w*|impactful|holistic|track record|results-driven|detail-oriented|thrilled|delve\w*|tapestry|testament|in today's|fast-paced|elevate\w*|utiliz\w*|i am excited|i'm excited|i am writing|eager to)\b/gi;

export function voiceProblems(original: string, resume: string, letter: string) {
  const problems: string[] = [];
  const own = original.toLowerCase().replace(/[‘’]/g, "'");
  const found = new Set<string>();
  for (const text of [resume, letter]) for (const m of text.replace(/[‘’]/g, "'").matchAll(STOCK_WORDS)) if (!own.includes(m[0].toLowerCase())) found.add(m[0].toLowerCase());
  if (found.size) problems.push(`Replace these stock words with plain ones, the way a working designer would say it: ${[...found].slice(0, 6).join(", ")}.`);
  const dashes = (s: string) => (s.match(/—/g) || []).length;
  if (dashes(letter) || dashes(resume) > dashes(original)) problems.push("Remove the em dashes (—). Use a comma, a period or \"and\" instead.");
  if (/\bnot (?:only|just|merely)\b[^.]{0,80}\bbut\b/i.test(letter)) problems.push('Drop the "not only … but" construction in the cover letter; say the thing directly.');
  const ing = resume.split("\n").filter((l) => l.trim().startsWith("•") && (l.match(/\b\w+ing\b/g) || []).length >= 4);
  if (ing.length) problems.push(`Bullets stacked with "-ing" phrases read as machine-written; split or trim them: "${ing[0].slice(0, 70)}…"`);
  return problems;
}

export function documentProblems(original: string, resume: string, letter: string, bullets?: { min: number; max: number }) {
  const problems: string[] = [...voiceProblems(original, resume, letter)];
  const roleLines = original.split("\n").map((l) => l.trim()).filter((l) => DATE_RANGE.test(l) && !l.startsWith("•"));
  const tailored = squash(resume);
  let last = -1;
  for (const line of roleLines) {
    // Compare the parts separated by "|", so spacing and separators may differ but the words may not.
    const parts = line.split("|").map(squash).filter(Boolean);
    // Dates are unique to each role, so they mark where the role sits in the document.
    const anchor = parts.find((p) => /\d{4}/.test(p)) || parts[0];
    const at = tailored.indexOf(anchor);
    if (parts.some((p) => !tailored.includes(p))) problems.push(`Copy this role line exactly as written: "${line}"`);
    else if (at < last) problems.push(`Keep the roles in their original order; the role dated ${anchor} moved.`);
    last = Math.max(last, at);
  }
  const headings = original.split("\n").map((l) => l.trim()).filter((l) => /^[A-Z][A-Z &/]{3,40}$/.test(l));
  for (const h of headings) if (!tailored.includes(squash(h).replace(/^work /, ""))) problems.push(`Keep the "${h}" section.`);
  const known = new Set(original.match(/\d[\d,.]*/g)?.map((n) => n.replace(/[,.]$/, "")) || []);
  const invented = [...new Set(resume.match(/\d[\d,.]*/g)?.map((n) => n.replace(/[,.]$/, "")) || [])].filter((n) => !known.has(n));
  if (invented.length) problems.push(`Remove numbers that aren't in the original resume: ${invented.slice(0, 5).join(", ")}.`);
  if (bullets) {
    const before = bulletsByRole(original);
    for (const [dates, count] of bulletsByRole(resume)) {
      // Only roles that have bullets on the original resume (not education lines).
      if (!before.get(dates)) continue;
      if (count > bullets.max) problems.push(`The role dated ${dates} has ${count} bullets; keep the ${bullets.max} that matter most for this job.`);
      if (count < bullets.min) problems.push(`The role dated ${dates} has only ${count} bullets; give it ${bullets.min} or ${bullets.max}, adding the confirmed requirements that fit it.`);
    }
  }
  const summary = summaryOf(resume);
  const words = summary.split(/\s+/).filter(Boolean).length;
  if (words > SUMMARY_MAX_WORDS)
    problems.push(`The summary is ${words} words; cut it to ${SUMMARY_MAX_WORDS} or fewer: 2–3 short lines of highlights (who they are, their strongest skills for this job, one standout proof point), no story. The details belong in the bullets and the cover letter.`);
  if (/(^|[.;]\s+)(I|I'm|I’m|My)\b/.test(summary)) problems.push("Write the summary without \"I\" or \"my\", like a resume headline (\"Product designer with…\"), not a letter.");
  if (/(^|[.!?]\s+)(your|you['’]ve|you were|you have|you're)\b/i.test(letter)) problems.push("Write the cover letter in the first person (\"I\"), as the candidate — not addressed to them.");
  return problems;
}

// Puts role blocks back in the original resume's order (most recent first) if they were moved.
// A block runs from a role's heading line to the next role or section heading.
export function restoreRoleOrder(original: string, resume: string) {
  const anchors = original
    .split("\n")
    .filter((l) => DATE_RANGE.test(l) && !l.trim().startsWith("•"))
    .map((l) => squash(l.match(DATE_RANGE)![0]));
  const lines = resume.split("\n");
  const isRole = (l: string) => DATE_RANGE.test(l) && !l.trim().startsWith("•");
  const isHeading = (l: string) => /^[A-Z][A-Z &/]{3,40}$/.test(l.trim());
  // Group consecutive role blocks (e.g. the experience section) and sort each group by the original order.
  const out: string[] = [];
  for (let i = 0; i < lines.length; ) {
    if (!isRole(lines[i])) {
      out.push(lines[i++]);
      continue;
    }
    const blocks: string[][] = [];
    while (i < lines.length && !isHeading(lines[i])) {
      if (isRole(lines[i])) blocks.push([]);
      blocks[blocks.length - 1].push(lines[i++]);
    }
    const rank = (b: string[]) => {
      const m = b[0].match(DATE_RANGE);
      const at = m ? anchors.indexOf(squash(m[0])) : -1;
      return at < 0 ? Number.MAX_SAFE_INTEGER : at;
    };
    const sorted = [...blocks].sort((a, b) => rank(a) - rank(b));
    // Keep a blank line between roles.
    sorted.forEach((b, k) => {
      const body = [...b];
      while (body.length && !body[body.length - 1].trim()) body.pop();
      out.push(...body);
      if (k < sorted.length - 1 || i < lines.length) out.push("");
    });
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n");
}
