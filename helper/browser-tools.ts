// Carries out Claude's browser toolset actions in a real, visible browser window with Playwright.
// Pages are read as text (element refs) rather than screenshots, which is far cheaper per step.
import path from "node:path";
import type { BrowserContext, Frame, Locator, Page } from "playwright-core";
import { bestOption, normalize, OTHER, OTHER_OK, searchTerms } from "./options.ts";

// Text boxes that usually suggest matches as you type.
const SUGGESTS = /location|city|address|town|school|university|college|institution|company|employer|country|state|region/i;

type Json = Record<string, unknown>;
type ImageBlock = { type: "image"; source: { type: "base64"; media_type: "image/jpeg"; data: string } };
type StateBlock = { type: "browser_state"; tabs: { tab_id: string; title: string; url: string; active: boolean }[]; state_changes?: Json[] };
export type ToolContent = string | (ImageBlock | StateBlock | { type: "text"; text: string })[];

type Target = { type: "ref"; ref: string } | { type: "coordinate"; x: number; y: number };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const between = (min: number, max: number) => Math.round(min + Math.random() * (max - min));
// Unhurried, human pacing between actions; this is about being a polite visitor, not hiding automation.
const pause = () => sleep(between(350, 1100));

const KEY_NAMES: Record<string, string> = {
  ctrl: "Control", control: "Control", cmd: "Meta", command: "Meta", meta: "Meta", super: "Meta", win: "Meta",
  alt: "Alt", option: "Alt", shift: "Shift", return: "Enter", enter: "Enter", esc: "Escape", escape: "Escape",
  tab: "Tab", backspace: "Backspace", delete: "Delete", space: "Space", up: "ArrowUp", down: "ArrowDown",
  left: "ArrowLeft", right: "ArrowRight", pageup: "PageUp", page_up: "PageUp", pagedown: "PageDown", page_down: "PageDown",
  home: "Home", end: "End",
};
const keyName = (k: string) => KEY_NAMES[k.toLowerCase()] || (k.length === 1 ? k : k[0].toUpperCase() + k.slice(1));
const chord = (combo: string) => combo.split("+").map(keyName).join("+");

// Runs inside each frame: labels interactive elements with stable refs and describes them as text.
function describePage(args: { start: number; filter: string; within: string | null }) {
  let n = args.start;
  const lines: string[] = [];
  const INTERACTIVE =
    "a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button],[role=link],[role=checkbox],[role=radio],[role=combobox],[role=option],[role=tab],[role=menuitem],[role=switch],[role=textbox],[role=listbox],[contenteditable=true]";
  const visible = (el: Element) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const fileInput = el instanceof HTMLInputElement && el.type === "file";
    // Decoy inputs custom dropdowns keep for validation (hidden from people and screen readers) are skipped.
    if (el.getAttribute("aria-hidden") === "true" || (el.getAttribute("tabindex") === "-1" && Number(cs.opacity) === 0)) return false;
    return (fileInput || (r.width > 0 && r.height > 0)) && cs.visibility !== "hidden" && cs.display !== "none";
  };
  const clean = (s: string | null | undefined, max = 90) => (s || "").replace(/\s+/g, " ").trim().slice(0, max);
  const nameOf = (el: Element) => {
    const aria = el.getAttribute("aria-label");
    if (aria) return clean(aria);
    const by = el.getAttribute("aria-labelledby");
    if (by) return clean(by.split(" ").map((id) => document.getElementById(id)?.textContent).join(" "));
    const labels = (el as HTMLInputElement).labels;
    if (labels?.length) {
      // Only the label's visible words, without the text of a field or suggestion list it wraps.
      let text = (labels[0] as HTMLElement).innerText || "";
      labels[0].querySelectorAll("select,textarea,[role=listbox],[class*=dropdown],[class*=suggest],[class*=autocomplete],ul").forEach((c) => {
        const inner = (c as HTMLElement).innerText;
        if (inner) text = text.replace(inner, " ");
      });
      text = clean(text.replace(/[✱*]\s*$/, "").replace(/\s*[✱]\s*/g, " "));
      if (text) return text;
    }
    const ph = el.getAttribute("placeholder") || el.getAttribute("title") || el.getAttribute("alt");
    if (ph) return clean(ph);
    // An unlabelled dropdown is named by its question, not by its list of options.
    if (el.tagName === "SELECT") return questionOf(el) || clean(el.getAttribute("name"));
    return clean((el as HTMLElement).innerText || el.getAttribute("value") || el.getAttribute("name"));
  };
  // The question a field answers when its own name doesn't say (Ashby's "Start typing...", bare Yes/No buttons, radio groups).
  const questionOf = (el: Element) => {
    const legend = el.closest("fieldset")?.querySelector("legend");
    if (legend?.textContent?.trim()) return clean(legend.textContent, 140);
    const group = el.closest("[role=radiogroup],[role=group]");
    if (group) {
      const g = group.getAttribute("aria-label") || (group.getAttribute("aria-labelledby") || "").split(" ").map((id) => document.getElementById(id)?.textContent || "").join(" ");
      if (g.trim()) return clean(g, 140);
    }
    let branch: Element = el;
    for (let up = 0; up < 5 && branch.parentElement; up++) {
      const parent: Element = branch.parentElement;
      for (const child of [...parent.children]) {
        if (child === branch) break;
        if (child.matches(INTERACTIVE) || child.querySelector(INTERACTIVE)) continue;
        const text = clean((child as HTMLElement).innerText, 140);
        if (text && text.length > 3) return text;
      }
      branch = parent;
    }
    return "";
  };
  const GENERIC = /^(start typing|select|select\.\.\.|choose|choose\.\.\.|search|type here|yes|no|)$/i;
  const roleOf = (el: Element) => {
    const explicit = el.getAttribute("role");
    if (explicit) return explicit;
    const tag = el.tagName;
    if (tag === "A") return "link";
    if (tag === "BUTTON" || tag === "SUMMARY") return "button";
    if (tag === "SELECT") return "combobox";
    if (tag === "TEXTAREA") return "textbox";
    if (tag === "INPUT") {
      const t = (el as HTMLInputElement).type;
      if (t === "checkbox" || t === "radio") return t;
      if (t === "submit" || t === "button" || t === "reset") return "button";
      if (t === "file") return "file-upload";
      return "textbox";
    }
    return el.hasAttribute("contenteditable") ? "textbox" : tag.toLowerCase();
  };
  let lastQuestion = "";
  const describe = (el: Element) => {
    let ref = el.getAttribute("data-jh-ref");
    if (!ref) {
      ref = `ref_${n++}`;
      el.setAttribute("data-jh-ref", ref);
    }
    const role = roleOf(el);
    const name = nameOf(el);
    const bits = [`${role} "${name}"`];
    if (GENERIC.test(name.replace(/\.+$/, "").trim()) || role === "radio" || (role === "checkbox" && name.split(" ").length <= 4)) {
      const question = questionOf(el);
      // Said once per group of options, not on every one.
      if (question && question !== name && question !== lastQuestion) bits.push(`for "${question}"`);
      lastQuestion = question;
    }
    const input = el as HTMLInputElement;
    if (input.required || el.getAttribute("aria-required") === "true") bits.push("(required)");
    if (input.disabled) bits.push("(disabled)");
    if ((input.type === "checkbox" || input.type === "radio") && input.checked) bits.push("(checked)");
    if (el.getAttribute("aria-checked") === "true") bits.push("(checked)");
    if (el.tagName === "SELECT") {
      const select = el as unknown as HTMLSelectElement;
      bits.push(`value="${clean(select.selectedOptions[0]?.text, 60)}"`);
      bits.push(`options: ${[...select.options].slice(0, 25).map((o) => clean(o.text, 40)).join(" | ")}`);
    } else if (input.type === "password") {
      // Password values are never read out.
      bits.push("(password — the person types this)");
    } else if ((el.tagName === "INPUT" && !["checkbox", "radio", "file", "submit", "button"].includes(input.type)) || el.tagName === "TEXTAREA") {
      if (input.value) bits.push(`value="${clean(input.value, 80)}"`);
    } else if (input.type === "file" && input.files?.length) {
      bits.push(`files: ${[...input.files].map((f) => f.name).join(", ")}`);
    }
    return `${bits.join(" ")} [${ref}]`;
  };

  const root = args.within ? document.querySelector(`[data-jh-ref="${args.within}"]`) : document.body;
  if (!root) return { lines: args.within ? [`No element ${args.within} on this page.`] : [], next: n };
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  for (let node = walker.currentNode as Element | null; node; node = walker.nextNode() as Element | null) {
    if (!visible(node)) continue;
    if (node.matches(INTERACTIVE)) lines.push(describe(node));
    else if (args.filter === "all" && /^(H[1-6]|LEGEND|LABEL|P|LI)$/.test(node.tagName)) {
      const text = clean((node as HTMLElement).innerText, 160);
      if (text && !node.querySelector(INTERACTIVE)) lines.push(`${node.tagName.startsWith("H") ? "heading" : "text"} "${text}"`);
    }
  }
  return { lines, next: n };
}

export class BrowserTools {
  private tabs = new Map<string, Page>();
  private activeTab = "";
  private tabCounter = 0;
  private refCounter = 1;
  private refFrames = new Map<string, Frame>();
  private stateChanges: Json[] = [];
  private context: BrowserContext;
  private allowedFiles: string[];

  constructor(context: BrowserContext, allowedFiles: string[]) {
    this.context = context;
    this.allowedFiles = allowedFiles;
    // A field that can't be clicked fails in 10 seconds instead of hanging for 30.
    context.setDefaultTimeout(10000);
    context.on("page", (page) => this.track(page, true));
  }

  private track(page: Page, opened: boolean) {
    for (const [id, p] of this.tabs) if (p === page) return id;
    const id = `tab-${++this.tabCounter}`;
    this.tabs.set(id, page);
    this.activeTab = id;
    if (opened) this.stateChanges.push({ type: "tab_opened", tab_id: id });
    page.on("close", () => {
      this.tabs.delete(id);
      if (this.activeTab === id) this.activeTab = [...this.tabs.keys()].pop() || "";
    });
    return id;
  }

  async open(url: string) {
    const page = this.context.pages().find((p) => p.url() === "about:blank") || (await this.context.newPage());
    this.track(page, false);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await sleep(1200);
    return page;
  }

  page(tabId?: unknown) {
    const id = typeof tabId === "string" && tabId ? tabId : this.activeTab;
    const page = this.tabs.get(id);
    if (!page) throw new Error(`No open tab ${id || ""}.`.trim());
    return page;
  }

  private state(): StateBlock {
    const block: StateBlock = {
      type: "browser_state",
      tabs: [...this.tabs].map(([id, p]) => ({ tab_id: id, title: "", url: p.url(), active: id === this.activeTab })),
    };
    if (this.stateChanges.length) block.state_changes = this.stateChanges.splice(0, 200);
    return block;
  }

  private async withTitles(block: StateBlock) {
    for (const tab of block.tabs) tab.title = await this.tabs.get(tab.tab_id)!.title().catch(() => "");
    return block;
  }

  private locate(ref: string): Locator {
    const frame = this.refFrames.get(ref);
    if (!frame) throw new Error(`Unknown element ${ref}. Read the page again to get fresh refs.`);
    return frame.locator(`[data-jh-ref="${ref}"]`).first();
  }

  private async readPage(page: Page, filter: string, within: string | null) {
    const out: string[] = [];
    for (const frame of page.frames()) {
      if (within && this.refFrames.get(within) !== frame) continue;
      const result = await frame.evaluate(describePage, { start: this.refCounter, filter, within }).catch(() => null);
      if (!result) continue;
      this.refCounter = result.next;
      for (const line of result.lines) {
        const ref = line.match(/\[(ref_\d+)\]$/)?.[1];
        if (ref) this.refFrames.set(ref, frame);
      }
      if (result.lines.length) out.push(...(frame === page.mainFrame() ? [] : [`--- inside embedded frame ${frame.url().slice(0, 80)} ---`]), ...result.lines);
    }
    const text = out.join("\n") || "The page has no readable elements yet. Try wait, then read_page again.";
    return text.length > 50000 ? `${text.slice(0, 50000)}\n… (cut off; use read_page with ref to read a smaller part)` : text;
  }

  private async point(page: Page, target: Target) {
    if (target.type === "coordinate") return { x: target.x, y: target.y };
    const loc = this.locate(target.ref);
    await loc.scrollIntoViewIfNeeded({ timeout: 8000 });
    const box = await loc.boundingBox();
    if (!box) throw new Error(`Element ${target.ref} isn't visible.`);
    return { x: box.x + box.width * between(35, 65) / 100, y: box.y + box.height * between(35, 65) / 100 };
  }

  private async click(page: Page, target: Target, opts: { button?: "left" | "right" | "middle"; clickCount?: number; modifiers?: string }) {
    const { x, y } = await this.point(page, target);
    const mods = opts.modifiers ? opts.modifiers.split("+").map(keyName) : [];
    await page.mouse.move(x, y, { steps: between(8, 18) });
    await sleep(between(80, 220));
    for (const m of mods) await page.keyboard.down(m);
    await page.mouse.click(x, y, { button: opts.button || "left", clickCount: opts.clickCount || 1, delay: between(40, 110) });
    for (const m of mods.reverse()) await page.keyboard.up(m);
    await sleep(between(500, 1000));
  }

  private async image(buffer: Buffer): Promise<ImageBlock[]> {
    return [{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: buffer.toString("base64") } }];
  }

  private async focusedIsPassword(page: Page) {
    for (const frame of page.frames()) {
      const isPassword = await frame.evaluate(() => (document.activeElement as HTMLInputElement | null)?.type === "password").catch(() => false);
      if (isPassword) return true;
    }
    return false;
  }

  // True when any open tab shows a visible password field, i.e. a sign-in or create-account page.
  async signInShowing() {
    for (const page of this.context.pages()) {
      for (const frame of page.frames()) {
        const found = await frame
          .evaluate(() =>
            [...document.querySelectorAll("input[type=password]")].some((el) => {
              const r = el.getBoundingClientRect();
              return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
            }),
          )
          .catch(() => false);
        if (found) return page;
      }
    }
    return null;
  }

  // Suggestions that appear under a text box as you type, whatever the site builds them from.
  private async pickSuggestion(page: Page, loc: Locator, ref: string, value: string) {
    const frame = this.refFrames.get(ref) ?? page.mainFrame();
    const first = normalize(value).split(" ")[0];
    let found: { labels: string[]; ids: number[] } = { labels: [], ids: [] };
    // Some sites look places up on a server and take several seconds.
    for (let waited = 0; waited < 8000; waited += 400) {
      await sleep(400);
      found = await loc.evaluate((input, first) => {
        const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
        let box: Element | null = input;
        for (let up = 0; up < 4 && box?.parentElement; up++) box = box.parentElement;
        const listIds = (input.getAttribute("aria-controls") || input.getAttribute("aria-owns") || "").split(" ").filter(Boolean);
        const pools = [box, ...listIds.map((id) => input.ownerDocument.getElementById(id))].filter(Boolean) as Element[];
        const labels: string[] = [];
        const ids: number[] = [];
        let n = 0;
        for (const pool of pools)
          for (const el of pool.querySelectorAll("[role=option], li, div, span, a")) {
            n++;
            const h = el as HTMLElement;
            if (el === input || el.contains(input) || el.children.length > 2) continue;
            const text = (h.innerText || "").trim();
            if (!text || text.length > 120 || !norm(text).includes(first)) continue;
            const r = h.getBoundingClientRect();
            if (!r.width || !r.height || getComputedStyle(h).visibility === "hidden") continue;
            h.setAttribute("data-jh-suggest", String(n));
            labels.push(text.replace(/\s+/g, " "));
            ids.push(n);
          }
        return { labels, ids };
      }, first);
      if (found.labels.length) break;
    }
    const i = bestOption(found.labels, value);
    if (i < 0) return "";
    await frame.locator(`[data-jh-suggest="${found.ids[i]}"]`).first().click();
    await sleep(between(250, 600));
    return `Typed "${value}" and chose the suggestion "${found.labels[i]}".`;
  }

  // The field's visible label, for deciding when "Other" is a fair answer.
  private async labelOf(loc: Locator) {
    return loc
      .evaluate((el) => {
        const by = el.getAttribute("aria-labelledby");
        const fromIds = by ? by.split(/\s+/).map((id) => el.ownerDocument.getElementById(id)?.textContent || "").join(" ") : "";
        const forLabel = el.id ? el.ownerDocument.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent || "" : "";
        return `${el.getAttribute("aria-label") || ""} ${fromIds} ${forLabel}`.trim();
      })
      .catch(() => "");
  }

  // Custom dropdowns and type-to-search boxes. Tries the value and its other names ("US", "Pittsburgh"),
  // picks the option that means the same thing, and uses "Other" for schools and the like when nothing fits.
  private async chooseOption(page: Page, loc: Locator, ref: string, value: string): Promise<string> {
    const frame = this.refFrames.get(ref) ?? page.mainFrame();
    const options = frame.locator("[role=option]:visible");
    const isInput = await loc.evaluate((el) => el instanceof HTMLInputElement || el.getAttribute("contenteditable") === "true");
    const selectAll = process.platform === "darwin" ? "Meta+A" : "Control+A";
    const readOptions = async (ms: number) => {
      for (let waited = 0; waited < ms && !(await options.count()); waited += 250) await sleep(250);
      await sleep(250); // let a search finish narrowing the list
      return (await options.allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim());
    };
    const open = async () => {
      if (!(await loc.evaluate((el) => el.getAttribute("aria-expanded") === "true").catch(() => false))) await loc.click();
      await sleep(250);
    };
    // Typing goes to whatever has focus: the box itself, or the search field a flag/country picker opens.
    const type = async (text: string) => {
      await open();
      await page.keyboard.press(selectAll).catch(() => undefined);
      await page.keyboard.press("Backspace").catch(() => undefined);
      if (text) await page.keyboard.type(text, { delay: between(25, 60) });
    };
    const pick = async (labels: string[], i: number) => {
      await options.nth(i).click();
      await sleep(between(250, 600));
      return `Chose "${labels[i]}".`;
    };

    // Short lists: pick straight from what's showing, without typing.
    await open();
    let labels = await readOptions(1500);
    // Before typing, only an exact match counts: long lists only show their first entries.
    let i = bestOption(labels, value, 95);
    if (i >= 0) return pick(labels, i);

    const tried: string[] = [];
    for (const term of searchTerms(value)) {
      await type(term);
      labels = await readOptions(4000);
      tried.push(term);
      i = bestOption(labels, value);
      if (i >= 0) return pick(labels, i);
    }

    // Not listed: schools, degrees and employers take "Other".
    if (OTHER_OK.test(await this.labelOf(loc))) {
      await type("Other");
      labels = await readOptions(3000);
      i = labels.findIndex((l) => OTHER.test(normalize(l)));
      if (i < 0) {
        await type("");
        labels = await readOptions(2000);
        i = labels.findIndex((l) => OTHER.test(normalize(l)));
      }
      if (i >= 0) return `"${value}" isn't listed, so chose "${labels[i]}". ${await pick(labels, i)}`;
    }

    // Nothing fits: show the real choices so the right one can be picked.
    await type("");
    labels = await readOptions(2000);
    if (!isInput) await page.keyboard.press("Escape").catch(() => undefined);
    await page.keyboard.press("Escape").catch(() => undefined);
    return labels.length
      ? `No option matches "${value}" (searched: ${tried.join(", ")}). The options are: ${labels.slice(0, 120).join(" | ")}. Call form_input again with one of them.`
      : `No options appeared for "${value}" (searched: ${tried.join(", ")}). Read this part of the page to see how the field works.`;
  }

  // Runs one member tool. Throws on failure so the caller can mark it as an error.
  async run(name: string, input: Json): Promise<ToolContent> {
    const page = ["new_tab", "list_tabs", "switch_tab", "close_tab"].includes(name) ? null : this.page(input.tab_id);
    const target = input.target as Target | undefined;
    if (page && name !== "read_page" && name !== "find" && name !== "get_page_text" && name !== "screenshot") await pause();

    switch (name) {
      case "navigate": {
        const url = String(input.url || "");
        if (url === "back") await page!.goBack({ waitUntil: "domcontentloaded" });
        else if (url === "forward") await page!.goForward({ waitUntil: "domcontentloaded" });
        else await page!.goto(/^https?:\/\//.test(url) ? url : `https://${url}`, { waitUntil: "domcontentloaded", timeout: 45000 });
        await sleep(1000);
        return [{ type: "text", text: `Now on "${await page!.title()}" (${page!.url()})` }, await this.withTitles(this.state())];
      }
      case "read_page":
        return this.readPage(page!, String(input.filter || "all"), typeof input.ref === "string" ? input.ref : null);
      case "find": {
        const query = String(input.query || "").toLowerCase();
        const all = (await this.readPage(page!, "all", null)).split("\n");
        const hits = all.filter((l) => l.toLowerCase().includes(query)).slice(0, 20);
        return hits.length ? hits.join("\n") : `Nothing on the page matches "${input.query}".`;
      }
      case "get_page_text": {
        const parts = [];
        for (const frame of page!.frames()) parts.push(await frame.evaluate(() => document.body?.innerText || "").catch(() => ""));
        const text = parts.join("\n\n").trim();
        return text.slice(0, 50000) || "The page has no text.";
      }
      case "screenshot":
        return this.image(await page!.screenshot({ type: "jpeg", quality: 60 }));
      case "zoom": {
        const [x0, y0, x1, y1] = (input.region as number[]) || [];
        return this.image(await page!.screenshot({ type: "jpeg", quality: 80, clip: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } }));
      }
      case "left_click":
        await this.click(page!, target!, { modifiers: input.modifiers as string | undefined });
        return this.stateChanges.length ? [{ type: "text", text: "Clicked." }, await this.withTitles(this.state())] : "Clicked.";
      case "right_click":
        await this.click(page!, target!, { button: "right" });
        return "Right-clicked.";
      case "middle_click":
        await this.click(page!, target!, { button: "middle" });
        return "Middle-clicked.";
      case "double_click":
        await this.click(page!, target!, { clickCount: 2 });
        return "Double-clicked.";
      case "triple_click":
        await this.click(page!, target!, { clickCount: 3 });
        return "Triple-clicked.";
      case "hover": {
        const { x, y } = await this.point(page!, target!);
        await page!.mouse.move(x, y, { steps: between(8, 18) });
        return "Hovering.";
      }
      case "type":
        if (await this.focusedIsPassword(page!)) throw new Error("That's a password field. Passwords are only ever typed by the person.");
        await page!.keyboard.type(String(input.text ?? ""), { delay: between(25, 70) });
        return "Typed.";
      case "key": {
        const times = Math.min(Number(input.repeat) || 1, 100);
        for (let i = 0; i < times; i++) for (const combo of String(input.text || "").split(/\s+/).filter(Boolean)) await page!.keyboard.press(chord(combo));
        return "Pressed.";
      }
      case "hold_key": {
        const key = chord(String(input.text || ""));
        await page!.keyboard.down(key);
        await sleep(Math.min(Number(input.duration) || 1, 10) * 1000);
        await page!.keyboard.up(key);
        return "Held.";
      }
      case "wait":
        await sleep(Math.min(Number(input.duration) || 1, 10) * 1000);
        return "Waited.";
      case "scroll": {
        const { x, y } = target ? await this.point(page!, target) : { x: 640, y: 400 };
        const amount = (Number(input.scroll_amount) || 3) * 100;
        const dir = String(input.scroll_direction || "down");
        await page!.mouse.move(x, y, { steps: 6 });
        await page!.mouse.wheel(dir === "left" ? -amount : dir === "right" ? amount : 0, dir === "up" ? -amount : dir === "down" ? amount : 0);
        await sleep(500);
        return "Scrolled.";
      }
      case "scroll_to":
        await this.locate((target as { ref: string }).ref).scrollIntoViewIfNeeded({ timeout: 8000 });
        return "Scrolled into view.";
      case "form_input": {
        const loc = this.locate((target as { ref: string }).ref);
        const value = input.value;
        const kind = await loc.evaluate((el) =>
          el.tagName === "SELECT"
            ? "select"
            : el.getAttribute("role") === "combobox" || el.hasAttribute("aria-autocomplete") || (el.hasAttribute("aria-haspopup") && el.getAttribute("aria-haspopup") !== "false")
              ? "combobox"
              : el instanceof HTMLInputElement
                ? el.type
                : el.hasAttribute("contenteditable")
                  ? "editable"
                  : "text",
        );
        if (kind === "password") throw new Error("That's a password field. Passwords are only ever typed by the person.");
        await loc.scrollIntoViewIfNeeded({ timeout: 8000 });
        if (kind === "combobox") return this.chooseOption(page!, loc, (target as { ref: string }).ref, String(value ?? ""));
        if (kind === "select") {
          // Native dropdowns: match the option's wording ("US" for "United States"), falling back to "Other" where that makes sense.
          const opts = await loc.evaluate((el) => [...(el as unknown as HTMLSelectElement).options].map((o) => o.label || o.text));
          let i = bestOption(opts, String(value));
          if (i < 0 && OTHER_OK.test(await this.labelOf(loc))) i = opts.findIndex((o) => OTHER.test(normalize(o)));
          if (i < 0) return `No option matches "${value}". The options are: ${opts.filter(Boolean).slice(0, 120).join(" | ")}. Call form_input again with one of them.`;
          await loc.selectOption({ index: i });
          await sleep(between(250, 600));
          return `Chose "${opts[i]}".`;
        } else if (kind === "checkbox" || kind === "radio") {
          await loc.setChecked(Boolean(value));
        } else {
          const text = String(value ?? "");
          await loc.click();
          await loc.fill("");
          // Short answers are typed key by key; long ones (cover letters) are pasted in one go.
          if (text.length <= 160) await loc.pressSequentially(text, { delay: between(25, 60) });
          else await loc.fill(text);
          // Location, school and company boxes often suggest matches as you type (Lever, Workday, Google Places); pick the right one.
          if (text.length <= 80 && SUGGESTS.test(`${await this.labelOf(loc)} ${await loc.evaluate((el) => `${el.id} ${el.getAttribute("name")} ${el.className}`)}`)) {
            const chosen = await this.pickSuggestion(page!, loc, (target as { ref: string }).ref, text);
            if (chosen) return chosen;
          }
        }
        await sleep(between(250, 600));
        return "Filled in.";
      }
      case "file_upload": {
        const paths = ((input.paths as string[]) || []).map((p) => path.resolve(p));
        const blocked = paths.filter((p) => !this.allowedFiles.includes(p));
        if (!paths.length || blocked.length) throw new Error(`Only these files can be uploaded: ${this.allowedFiles.join(", ")}`);
        const loc = this.locate((target as { ref: string }).ref);
        // The ref is often the visible "Attach" button or label (Lever, many careers sites), not the hidden file input.
        // Use the input it belongs to, or else click it and answer the file picker.
        const isInput = await loc.evaluate((el) => el instanceof HTMLInputElement && el.type === "file").catch(() => false);
        if (isInput) await loc.setInputFiles(paths);
        else {
          const marked = await loc
            .evaluate((el) => {
              const forId = el instanceof HTMLLabelElement && el.htmlFor ? document.getElementById(el.htmlFor) : null;
              let input = (forId instanceof HTMLInputElement && forId.type === "file" ? forId : null) || el.querySelector<HTMLInputElement>("input[type=file]");
              for (let up: Element | null = el.parentElement, i = 0; !input && up && i < 4; up = up.parentElement, i++) {
                const found = up.querySelectorAll<HTMLInputElement>("input[type=file]");
                if (found.length === 1) input = found[0];
              }
              if (!input) return false;
              input.setAttribute("data-jh-upload", "1");
              return true;
            })
            .catch(() => false);
          const frame = (await loc.elementHandle().then((h) => h?.ownerFrame()).catch(() => null)) ?? loc.page().mainFrame();
          if (marked) {
            const input = frame.locator("[data-jh-upload]").first();
            await input.setInputFiles(paths);
            await input.evaluate((el) => el.removeAttribute("data-jh-upload")).catch(() => undefined);
          } else {
            const [chooser] = await Promise.all([loc.page().waitForEvent("filechooser", { timeout: 8000 }), loc.click()]);
            await chooser.setFiles(paths);
          }
        }
        await sleep(1200);
        return `Uploaded ${paths.map((p) => path.basename(p)).join(", ")}.`;
      }
      case "left_click_drag": {
        const from = await this.point(page!, input.from as Target);
        const to = await this.point(page!, target!);
        await page!.mouse.move(from.x, from.y, { steps: 8 });
        await page!.mouse.down();
        await page!.mouse.move(to.x, to.y, { steps: 20 });
        await page!.mouse.up();
        return "Dragged.";
      }
      case "left_mouse_down":
      case "left_mouse_up":
      case "mouse_move": {
        const { x, y } = await this.point(page!, target!);
        await page!.mouse.move(x, y, { steps: 8 });
        if (name === "left_mouse_down") await page!.mouse.down();
        if (name === "left_mouse_up") await page!.mouse.up();
        return "Done.";
      }
      case "new_tab": {
        const p = await this.context.newPage();
        this.track(p, true);
        return [await this.withTitles(this.state())];
      }
      case "list_tabs":
        return [await this.withTitles(this.state())];
      case "switch_tab": {
        const p = this.page(input.tab_id);
        await p.bringToFront();
        this.activeTab = String(input.tab_id);
        return [await this.withTitles(this.state())];
      }
      case "close_tab":
        await this.page(input.tab_id).close();
        return [await this.withTitles(this.state())];
      default:
        throw new Error(`The helper doesn't support "${name}".`);
    }
  }
}
