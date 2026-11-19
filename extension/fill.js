// Pacer form filler. Injected into every frame of the page when you press "Fill this application".
// It fills what it can from your profile, collects the questions it can't, and fills Claude's answers to those.
// Nothing here talks to the network: the extension's panel passes everything in.
(() => {
  if (window.__jhFill) return;

  const { norm, bestOption } = window.__jhMatch;

  /* ---------- Finding fields and their questions ---------- */

  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return (r.width > 0 || r.height > 0 || el.type === "file") && cs.visibility !== "hidden" && cs.display !== "none" && el.getAttribute("aria-hidden") !== "true";
  };
  const clean = (s) => String(s || "").replace(/\s+/g, " ").replace(/[*✱]/g, "").trim().slice(0, 200);

  function labelOf(el) {
    const aria = el.getAttribute("aria-label");
    if (aria && !/^(select|search|start typing)/i.test(aria)) return clean(aria);
    const by = el.getAttribute("aria-labelledby");
    if (by) {
      const t = by.split(/\s+/).map((id) => document.getElementById(id)?.innerText || "").join(" ");
      if (clean(t)) return clean(t);
    }
    if (el.labels && el.labels.length) {
      let t = el.labels[0].innerText || "";
      el.labels[0].querySelectorAll("select,textarea,ul,[role=listbox]").forEach((c) => (t = t.replace(c.innerText || "", " ")));
      if (clean(t)) return clean(t);
    }
    const legend = el.closest("fieldset")?.querySelector("legend");
    if (legend && el.type !== "text") return clean(legend.innerText);
    // The nearest text before the field, a few levels up.
    let branch = el;
    for (let up = 0; up < 5 && branch.parentElement; up++) {
      const parent = branch.parentElement;
      for (const child of parent.children) {
        if (child === branch) break;
        if (child.matches("input,select,textarea,button") || child.querySelector("input,select,textarea")) continue;
        const t = clean(child.innerText);
        if (t.length > 1) return t;
      }
      branch = parent;
    }
    return clean(el.getAttribute("placeholder") || el.name || el.id);
  }

  const isRequired = (el) => el.required || el.getAttribute("aria-required") === "true" || /\*|✱|required/i.test(el.closest("label, .field, .form-group, [class*=field]")?.innerText?.slice(0, 120) || "");

  function scan() {
    const fields = [];
    const seenGroups = new Set();
    for (const el of document.querySelectorAll("input, textarea, select, [role=combobox]")) {
      if (!visible(el) || el.disabled || el.readOnly) continue;
      const type = (el.getAttribute("type") || "").toLowerCase();
      if (["hidden", "submit", "button", "reset", "image", "password"].includes(type)) continue;
      if (el.closest("[data-jh-skip]")) continue;
      if (type === "radio" || type === "checkbox") {
        const name = el.name || el.id;
        const group = name ? [...document.querySelectorAll(`input[type=${type}][name="${CSS.escape(name)}"]`)] : [el];
        if (group.length > 1 || type === "radio") {
          if (seenGroups.has(name)) continue;
          seenGroups.add(name);
          const question = clean(group[0].closest("fieldset")?.querySelector("legend")?.innerText) || questionAbove(group[0]) || labelOf(group[0]);
          fields.push({ el: group[0], group, kind: type === "radio" ? "radio" : "checkboxes", label: question, options: group.map((g) => labelOf(g)), required: group.some(isRequired) });
          continue;
        }
        fields.push({ el, kind: "checkbox", label: labelOf(el), options: [], required: isRequired(el) });
        continue;
      }
      if (type === "file") {
        fields.push({ el, kind: "file", label: labelOf(el), options: [], required: isRequired(el) });
        continue;
      }
      if (el.tagName === "SELECT") {
        fields.push({ el, kind: "select", label: labelOf(el), options: [...el.options].map((o) => clean(o.text)).filter((t) => t && !/^(select|choose|--)/i.test(t)), required: isRequired(el) });
        continue;
      }
      const combo = el.getAttribute("role") === "combobox" || el.hasAttribute("aria-autocomplete") || el.getAttribute("aria-haspopup") === "listbox";
      fields.push({ el, kind: combo ? "combobox" : el.tagName === "TEXTAREA" ? "textarea" : "text", label: labelOf(el), options: [], required: isRequired(el), inputType: type });
    }
    return fields;
  }

  function questionAbove(el) {
    let branch = el;
    for (let up = 0; up < 6 && branch.parentElement; up++) {
      const parent = branch.parentElement;
      const prev = [...parent.children].slice(0, [...parent.children].indexOf(branch)).reverse().find((c) => clean(c.innerText).length > 3 && !c.querySelector("input"));
      if (prev) return clean(prev.innerText);
      branch = parent;
    }
    return "";
  }

  /* ---------- Setting values the way a person would ---------- */

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  function setNative(el, value) {
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }
  function setText(el, value) {
    el.focus();
    setNative(el, value);
    el.dispatchEvent(new Event("blur", { bubbles: true }));
    return true;
  }
  function setSelect(el, value) {
    const opts = [...el.options].map((o) => clean(o.text));
    const i = bestOption(opts, value);
    if (i < 0) return false;
    el.selectedIndex = i;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }
  function clickChoice(group, value) {
    const labels = group.map((g) => labelOf(g));
    const i = bestOption(labels, value);
    if (i < 0) return false;
    if (!group[i].checked) group[i].click();
    return true;
  }
  // Custom dropdowns (react-select and the like) only react to real typing, so they're picked in the page's own context
  // (react-pick.js) after this pass. Each one is marked so that script can find it.
  let pickCount = 0;
  let picks = [];
  function queuePick(el, value) {
    const mark = String(++pickCount);
    el.setAttribute("data-jh-pick", mark);
    picks.push({ mark, value: String(value) });
    return true;
  }
  async function suggest(el, value) {
    // Location boxes that suggest places as you type (Lever, Google Places): pick the matching suggestion.
    setText(el, value);
    for (let waited = 0; waited < 6000; waited += 400) {
      await sleep(400);
      const box = el.closest("label, .field, [class*=field], [class*=location]") || el.parentElement?.parentElement || document;
      const items = [...box.querySelectorAll("[role=option], li, [class*=suggest] div, [class*=dropdown] div")].filter((x) => visible(x) && x.children.length <= 2 && clean(x.innerText));
      if (!items.length) continue;
      const i = bestOption(items.map((x) => clean(x.innerText)), value);
      if (i >= 0) items[i].click();
      return true;
    }
    return true;
  }
  function upload(el, file) {
    const bytes = Uint8Array.from(atob(file.base64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], file.name, { type: "application/pdf" }));
    el.files = dt.files;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  /* ---------- What the profile answers on its own ---------- */

  function knownValue(f, d) {
    const key = norm(`${f.label} ${f.el.name || ""} ${f.el.id || ""} ${f.el.getAttribute("autocomplete") || ""}`);
    const x = d.fields;
    if (f.kind === "file") {
      if (/cover/.test(key)) return d.coverLetter ? { file: d.coverLetter } : null;
      if (/resume|cv|curriculum/.test(key)) return { file: d.resume };
      return null;
    }
    if (f.kind === "textarea" && /cover letter/.test(key) && d.coverLetter) return { text: d.coverLetter.text };
    if (f.kind !== "text" && f.kind !== "combobox" && f.kind !== "select") return null;
    if (/\bpreferred\b.*\bname\b|\bnickname\b/.test(key)) return { text: x.preferredName };
    if (/\bfirst name\b|given name|\bfname\b|^first$/.test(key)) return { text: x.firstName };
    if (/\blast name\b|surname|family name|\blname\b|^last$/.test(key)) return { text: x.lastName };
    if (/\bfull name\b|^name\b|\byour name\b|legal name|candidate name/.test(key) && !/company|school|reference/.test(key)) return { text: x.fullName };
    if (/e ?mail/.test(key) && !/confirm/.test(key)) return { text: x.email };
    if (/confirm.*e ?mail/.test(key)) return { text: x.email };
    if (/phone|mobile|tel\b|cell/.test(key) && !/country|code|type/.test(key)) return { text: x.phone };
    if (/linkedin/.test(key)) return x.linkedin ? { text: x.linkedin } : null;
    if (/github/.test(key)) return x.github ? { text: x.github } : null;
    if (/portfolio|personal (web)?site|\bwebsite\b|\bweb site\b|other website/.test(key)) return x.portfolio ? { text: x.portfolio } : null;
    if (/pronoun/.test(key)) return x.pronouns ? { text: x.pronouns } : null;
    if (/\b(current )?location\b|\bcity\b|where are you (based|located)|address/.test(key) && !/willing|relocat|country|state|zip|postal|office/.test(key)) return { text: x.location, suggest: true };
    return null;
  }

  async function apply(f, v) {
    if (v.file) return upload(f.el, v.file);
    const value = v.text;
    if (value === undefined || value === null || value === "") return false;
    if (f.kind === "select") return setSelect(f.el, value);
    if (f.kind === "radio" || f.kind === "checkboxes") return clickChoice(f.group, value);
    if (f.kind === "checkbox") {
      if (/^(true|yes|y)$/i.test(value) && !f.el.checked) f.el.click();
      return true;
    }
    if (f.kind === "combobox") return queuePick(f.el, value);
    if (v.suggest) return suggest(f.el, value);
    return setText(f.el, value);
  }

  const filledAlready = (f) => {
    if (f.kind === "file") return f.el.files && f.el.files.length > 0;
    if (f.kind === "radio" || f.kind === "checkboxes") return f.group.some((g) => g.checked);
    if (f.kind === "checkbox") return false;
    if (f.kind === "select") return f.el.selectedIndex > 0 && !/^(select|choose|--)/i.test(f.el.options[f.el.selectedIndex]?.text || "");
    if (f.kind === "combobox") {
      if (String(f.el.value || "").trim()) return true;
      // A chosen option shows next to the input, a few levels up (react-select's "single value").
      for (let n = f.el.parentElement, i = 0; n && i < 4; n = n.parentElement, i++) {
        const chosen = n.querySelector("[class*=single-value], [class*=singleValue], [class*=multi-value], [class*=multiValue]");
        if (chosen && clean(chosen.innerText)) return true;
      }
      return false;
    }
    return Boolean(String(f.el.value || "").trim());
  };

  let current = [];

  window.__jhFill = {
    // Fills from the profile; returns the questions only Claude (or the person) can answer, and the dropdowns to pick.
    async fillKnown(d) {
      current = scan();
      picks = [];
      let filled = 0;
      const uploaded = [];
      const questions = [];
      for (let i = 0; i < current.length; i++) {
        const f = current[i];
        if (filledAlready(f)) continue;
        const v = knownValue(f, d);
        if (v && (await apply(f, v).catch(() => false))) {
          filled++;
          if (v.file) uploaded.push(v.file.name);
          continue;
        }
        if (f.kind === "file" || !f.label) continue;
        questions.push({ id: String(i), label: f.label, kind: f.kind === "combobox" ? "select" : f.kind, options: f.options, required: f.required });
      }
      return { filled, uploaded, questions, picks, fields: current.length };
    },
    // Fills Claude's answers.
    async fillAnswers(answers) {
      picks = [];
      let filled = 0;
      for (const a of answers || []) {
        const f = current[Number(a.id)];
        if (!f || !a.value || filledAlready(f)) continue;
        if (await apply(f, { text: a.value }).catch(() => false)) filled++;
      }
      return { filled, picks };
    },
    // A second pass for profile fields a page cleared while it was still starting up.
    async refill(d) {
      picks = [];
      let filled = 0;
      for (const f of current) {
        if (filledAlready(f)) continue;
        const v = knownValue(f, d);
        if (v && !v.file && (await apply(f, v).catch(() => false))) filled++;
      }
      return { filled, picks };
    },
    // Outlines whatever's still empty and required, for the person to answer.
    markLeft() {
      const left = [];
      for (const f of current) {
        if (!f.required || filledAlready(f) || f.kind === "checkbox") continue;
        // Outline just this field: the dropdown's box, the choice group, or the input itself.
        const target =
          f.kind === "radio" || f.kind === "checkboxes"
            ? f.group[0].closest("fieldset") || f.group[0].parentElement
            : f.kind === "combobox"
              ? f.el.closest("[class*=control], [class*=Control]") || f.el
              : f.el;
        target.style.outline = "3px solid #f2b705";
        target.style.outlineOffset = "2px";
        target.setAttribute("data-jh-left", "1");
        left.push(f.label);
      }
      document.querySelector("[data-jh-left]")?.scrollIntoView({ behavior: "smooth", block: "center" });
      return { left };
    },
    pageText() {
      const main = document.querySelector("main, article, [class*=job-description], [class*=description], [class*=posting], #content");
      const text = (main && main.innerText.length > 500 ? main : document.body).innerText || "";
      return { title: document.title, text: text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, 40000) };
    },
  };
})();
