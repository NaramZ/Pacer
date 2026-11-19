import { guessTitle } from "./links";

// Reads a resume file in the browser. Nothing is uploaded and no AI is used, so it's free and private.

export const RESUME_ACCEPT = ".pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain";

export type ResumeRead = { text: string; atsWarning: string };

export async function readResumeFile(file: File): Promise<ResumeRead> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf") || file.type === "application/pdf") return readPdf(file);
  if (name.endsWith(".doc") && !name.endsWith(".docx")) throw new Error("Old .doc files can’t be read. Save it as .docx or PDF, or paste the text.");
  const text = name.endsWith(".docx") ? await readDocx(file) : tidy(await file.text());
  return { text, atsWarning: "" };
}

export const ATS_WARNING =
  "Your PDF stores its text out of reading order, so some application systems (ATS) will read it jumbled — headings in one place, bullet points in another. The resumes Pacer creates don’t have this problem. To fix your own file, export it from Word or Google Docs, or in Figma order the text layers top to bottom as they’re read.";

// Some ATS read a PDF's text in the order it's stored. If that order differs a lot from the order on the page,
// they'll see it jumbled. Checks how many lines come out of sequence when read as stored.
export function outOfOrder(stored: string, lines: string[]) {
  const flat = stored.replace(/\s+/g, " ");
  let last = -1;
  let wrong = 0;
  let checked = 0;
  for (const line of lines) {
    const probe = line.replace(/^•\s*/, "").replace(/\s+/g, " ").slice(0, 25);
    if (probe.length < 12) continue;
    const at = flat.indexOf(probe);
    if (at < 0) continue;
    checked++;
    if (at < last) wrong++;
    last = at;
  }
  return checked >= 5 && wrong / checked > 0.15;
}

async function readPdf(file: File): Promise<ResumeRead> {
  const [pdfjs, worker] = await Promise.all([import("pdfjs-dist"), import("pdfjs-dist/build/pdf.worker.min.mjs?url")]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const pages: string[] = [];
  let stored = "";
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    const items: PdfItem[] = [];
    for (const it of content.items) {
      if ("str" in it && it.str) {
        items.push({ str: it.str, x: it.transform[4], y: it.transform[5], width: it.width, height: it.height || 10 });
        stored += `${it.str}${it.hasEOL ? "\n" : ""}`;
      }
    }
    pages.push(textFromItems(items));
  }
  const text = tidy(pages.join("\n\n"));
  if (text.length < 200) throw new Error("This PDF looks like a scanned image, so its text can’t be read. Paste the text instead.");
  return { text, atsWarning: outOfOrder(stored, text.split("\n")) ? ATS_WARNING : "" };
}

export type PdfItem = { str: string; x: number; y: number; width: number; height: number };

// Rebuilds reading order from where text sits on the page. Many design tools (Figma, InDesign) store text in
// layer order, so reading it as stored puts every heading first and every bullet after.
export function textFromItems(items: PdfItem[]) {
  // Blank items are dropped; word spacing is worked out from the gaps instead.
  const words = items.filter((it) => it.str.trim()).sort((a, b) => b.y - a.y || a.x - b.x);
  // Group into lines: items within a couple of points vertically share a line.
  const lines: PdfItem[][] = [];
  for (const it of words) {
    const line = lines.find((l) => Math.abs(l[0].y - it.y) <= Math.max(2, it.height * 0.3));
    if (line) line.push(it);
    else lines.push([it]);
  }
  lines.sort((a, b) => b[0].y - a[0].y);

  type Line = { text: string; startX: number; textX: number; right: number; y: number; height: number; bullet: boolean };
  const built: Line[] = lines.map((l) => {
    l.sort((a, b) => a.x - b.x);
    let text = "";
    let end = -Infinity;
    for (const it of l) {
      const gap = it.x - end;
      // A wide gap is a separate column, like dates aligned to the right; a small one is a word break.
      if (text && gap > 30) text = `${text.trimEnd()} | `;
      else if (text && gap > 1.2 && !/\s$/.test(text) && !/^\s/.test(it.str)) text += " ";
      text += it.str;
      end = it.x + it.width;
    }
    text = text.replace(/\s+/g, " ").trim();
    const bullet = /^[•●▪◦‣∙·-]\s*/.test(text) && l.length > 1;
    const textItem = bullet ? l.find((it) => !/^[•●▪◦‣∙·-]\s*$/.test(it.str.trim())) || l[0] : l[0];
    return { text: bullet ? text.replace(/^[•●▪◦‣∙·-]\s*/, "• ") : text, startX: l[0].x, textX: textItem.x, right: end, y: l[0].y, height: Math.max(...l.map((it) => it.height)), bullet };
  });

  const maxRight = Math.max(...built.map((l) => l.right));
  const out: string[] = [];
  let prev: Line | null = null;
  for (const line of built) {
    if (!line.text) continue;
    if (prev) {
      const gap = prev.y - line.y;
      // A full-width line followed by one at the same indent is one paragraph that wrapped.
      const wrapped = prev.right >= maxRight * 0.8 && Math.abs(line.startX - prev.textX) < 3 && !line.bullet && gap <= prev.height * 1.8;
      if (wrapped) {
        out[out.length - 1] = `${out[out.length - 1]} ${line.text}`;
        prev = { ...line, textX: prev.textX };
        continue;
      }
      if (gap > prev.height * 2.2) out.push("");
    }
    out.push(line.text);
    prev = line;
  }
  return out.join("\n");
}

async function readDocx(file: File) {
  const mammoth = await import("mammoth");
  const { value } = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
  return tidy(value);
}

function tidy(text: string) {
  return text
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Best-effort contact details so the person only has to check them.
export function contactFromResume(text: string) {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const first = lines[0] || "";
  const email = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/)?.[0] || "";
  const phone = text.match(/(?:\+?\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/)?.[0] || "";
  // Links are looked for with the email address removed, so a portfolio on the same domain as the email still counts.
  const links = [...new Set(text.replace(email, " ").match(/(?:https?:\/\/)?(?:www\.)?(?:linkedin\.com\/in\/[\w-]+|github\.com\/[\w-]+|[\w-]+\.(?:com|io|dev|design|me|co)(?:\/[\w-]*)?)/gi) || [])]
    .filter((l) => !l.includes("@"))
    .slice(0, 5)
    .map((url) => (guessTitle(url) ? `${guessTitle(url)}: ${url}` : url))
    .join("\n");
  const fullName = first.split(/\s+/).length <= 5 && !/@|\d/.test(first) ? first.split(/[|·,]/)[0].trim() : "";
  const second = (lines[1] || "").split(/[|·]/)[0].trim();
  const headline = second && second.split(/\s+/).length <= 5 && !/@|\d|www|\.com/i.test(second) ? second : "";
  return { fullName, email, phone, links, headline };
}
