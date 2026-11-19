// A resume as the app stores it is plain text: name, a contact line, UPPERCASE section headings, roles as
// "Title · Company | Dates | Location" with "• " bullets. This turns that text into sections the editor can
// change, and back into the same text, so edits stay compatible with tailoring, the checks and the PDF export.

export type Entry = { heading: string; bullets: string[] };
export type Section = { title: string; paragraphs: string[]; entries: Entry[] };
export type Resume = { name: string; contact: string; sections: Section[] };

const HEADING = /^[A-Z][A-Z &/]{3,40}$/;
const BULLET = /^[•*-]\s?(.*)$/;

export function parseResume(text: string): Resume {
  const lines = text.replace(/\r/g, "").split("\n").map((l) => l.replace(/\s+$/, ""));
  let i = 0;
  while (i < lines.length && !lines[i].trim()) i++;
  const name = (lines[i++] || "").trim();
  let contact = "";
  if (i < lines.length && lines[i].trim() && !HEADING.test(lines[i].trim())) contact = lines[i++].trim();

  const sections: Section[] = [];
  let section: Section | null = null;
  let entry: Entry | null = null;
  const nextNonBlank = (from: number) => {
    for (let k = from; k < lines.length; k++) if (lines[k].trim()) return lines[k].trim();
    return "";
  };
  for (; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) {
      continue;
    }
    if (HEADING.test(line)) {
      section = { title: line, paragraphs: [], entries: [] };
      sections.push(section);
      entry = null;
      continue;
    }
    if (!section) {
      section = { title: "SUMMARY", paragraphs: [], entries: [] };
      sections.push(section);
    }
    const bullet = line.match(BULLET);
    if (bullet) {
      if (!entry) {
        entry = { heading: "", bullets: [] };
        section.entries.push(entry);
      }
      entry.bullets.push(bullet[1].trim());
    } else if (BULLET.test(nextNonBlank(i + 1)) && !HEADING.test(nextNonBlank(i + 1))) {
      // A line followed by bullets is the heading of a role, project or school.
      entry = { heading: line, bullets: [] };
      section.entries.push(entry);
    } else {
      section.paragraphs.push(line);
      entry = null;
    }
  }
  return { name, contact, sections };
}

export function serializeResume(r: Resume): string {
  const out: string[] = [r.name.trim(), r.contact.trim()];
  for (const s of r.sections) {
    out.push("", s.title.trim().toUpperCase());
    for (const p of s.paragraphs) if (p.trim()) out.push(p.trim());
    s.entries.forEach((e, idx) => {
      // Roles and projects are separated by a blank line; plain bullet lists (skills, languages) stay together.
      if (e.heading.trim()) {
        if (idx > 0 || s.paragraphs.length) out.push("");
        out.push(e.heading.trim());
      }
      for (const b of e.bullets) out.push(`• ${b.trim()}`);
    });
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

// "Product Designer · Studio Name LLC | Feb 2023 - Present | Pittsburgh, PA" (or "Title | Company | Dates | Place") → its parts, for the preview.
export function splitHeading(heading: string) {
  const parts = heading.split("|").map((p) => p.trim()).filter(Boolean);
  const dateAt = parts.findIndex((p, k) => k > 0 && /\b(?:(?:19|20)\d\d|present|current)\b/i.test(p));
  const before = dateAt > 0 ? parts.slice(0, dateAt) : parts.slice(0, 1);
  const after = dateAt > 0 ? parts.slice(dateAt + 1) : parts.slice(1);
  const [title, ...company] = (before[0] || "").split(/\s+[·•]\s+/);
  // "Title | Company | Dates" keeps the company with the title; with no dates, everything after the title is detail.
  const withTitle = [...company, ...before.slice(1)];
  return { title: title || before[0] || "", company: withTitle.join(", "), dates: dateAt > 0 ? parts[dateAt] : "", rest: after.join(" | ") };
}

export const STANDARD_HEADINGS = {
  experience: /^(WORK EXPERIENCE|PROFESSIONAL EXPERIENCE|EXPERIENCE|EMPLOYMENT( HISTORY)?|WORK HISTORY)$/,
  education: /^(EDUCATION|EDUCATION AND TRAINING|ACADEMIC BACKGROUND)$/,
  skills: /^(SKILLS|TECHNICAL SKILLS|CORE SKILLS|SKILLS AND TOOLS|KEY SKILLS)$/,
  summary: /^(SUMMARY|PROFESSIONAL SUMMARY|PROFILE|ABOUT)$/,
};
