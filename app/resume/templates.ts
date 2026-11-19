// Resume templates. Every one is a single column of real text with standard headings, so an applicant tracking
// system reads it in order: the styles change type, spacing and rules, never the structure.

export type TemplateId = "classic" | "modern" | "compact" | "executive" | "minimal" | "bold";

export type Template = { id: TemplateId; name: string; note: string; defaultAccent: string };

export const TEMPLATES: Template[] = [
  { id: "classic", name: "Classic", note: "Serif, centered header, ruled headings", defaultAccent: "#1d1d1b" },
  { id: "modern", name: "Modern", note: "Clean sans, accent headings", defaultAccent: "#2b3cf0" },
  { id: "compact", name: "Compact", note: "Dense, fits more on one page", defaultAccent: "#1d1d1b" },
  { id: "executive", name: "Executive", note: "Serif, spaced small caps", defaultAccent: "#7a1f2b" },
  { id: "minimal", name: "Minimal", note: "Light, airy, no rules", defaultAccent: "#444444" },
  { id: "bold", name: "Bold", note: "Strong name, accent side bars", defaultAccent: "#0f766e" },
];

export const ACCENTS = ["#1d1d1b", "#2b3cf0", "#0f766e", "#7a1f2b", "#b45309", "#6d28d9"];

export type Look = { template: TemplateId; accent: string; size: "small" | "medium" | "large"; spacing: "tight" | "normal" | "roomy" };

export const DEFAULT_LOOK: Look = { template: "modern", accent: "#2b3cf0", size: "medium", spacing: "normal" };

export const PAGE = { width: 816, height: 1056 }; // US Letter at 96 dpi
