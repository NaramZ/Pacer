// Profile links are stored one per line as "Title: address" (the title is optional).
// Older entries used " | " or commas between links, so those split too.
export type LinkEntry = { title: string; url: string };

const TITLED = /^([^:/]{1,60}):\s+(\S+)$/;

export function linkEntries(links: string | null | undefined): LinkEntry[] {
  return (links || "")
    .split(/\n|\s\|\s|,\s*/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const m = line.match(TITLED);
      return m ? { title: m[1].trim(), url: m[2] } : { title: "", url: line };
    });
}

export function linkList(links: string | null | undefined): string[] {
  return linkEntries(links).map((l) => l.url);
}

export function serializeLinks(entries: LinkEntry[]) {
  return entries
    .filter((e) => e.url.trim())
    .map((e) => (e.title.trim() ? `${e.title.trim().replace(/:/g, "")}: ${e.url.trim()}` : e.url.trim()))
    .join("\n");
}

// A sensible title for well-known sites, used when the person hasn't given one.
export function guessTitle(url: string) {
  const u = url.toLowerCase();
  if (u.includes("linkedin.")) return "LinkedIn";
  if (u.includes("github.")) return "GitHub";
  if (u.includes("behance.")) return "Behance";
  if (u.includes("dribbble.")) return "Dribbble";
  return "";
}

// For application forms: "LinkedIn: …; Portfolio: …" so each link lands in the right field.
export function linksForForm(links: string | null | undefined) {
  return linkEntries(links)
    .map((l) => `${l.title || guessTitle(l.url) || "Website"}: ${l.url}`)
    .join("; ");
}
