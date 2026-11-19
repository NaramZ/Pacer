// Picks options in custom dropdowns from the page's own context. Runs in the page's world (not the extension's),
// because components like react-select only react to real typing; their own "select this option" function works instead.
(() => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const { bestOption } = window.__jhMatch;
  const labelOf = (o) => String(o?.label ?? o?.name ?? o?.value ?? "");

  // The react-select component that owns an input, found through React's bookkeeping on the element.
  function reactSelectFor(el) {
    const key = Object.keys(el).find((k) => k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$"));
    let fiber = key ? el[key] : null;
    for (let i = 0; fiber && i < 50; i++, fiber = fiber.return) {
      const inst = fiber.stateNode;
      if (inst && typeof inst.selectOption === "function" && inst.props) return inst;
    }
    return null;
  }

  async function pickReact(sel, value) {
    const want = String(value);
    const opts = () => (sel.props.options || []).flatMap((o) => (o && Array.isArray(o.options) ? o.options : [o]));
    let options = opts();
    let i = bestOption(options.map(labelOf), want);
    // Search boxes (cities, schools) load their options as you type: type the value (then its first part) and wait.
    for (const term of i < 0 ? [want, want.split(",")[0]] : []) {
      if (typeof sel.onInputChange === "function") sel.onInputChange(term, { action: "input-change", prevInputValue: "" });
      else if (typeof sel.props.onInputChange === "function") sel.props.onInputChange(term, { action: "input-change", prevInputValue: "" });
      for (let t = 0; t < 16; t++) {
        await sleep(400);
        options = opts();
        i = bestOption(options.map(labelOf), want);
        if (i >= 0) break;
      }
      if (i >= 0) break;
    }
    if (i < 0) {
      // Schools, degrees and employers that aren't listed take "Other".
      i = options.findIndex((o) => /^other\b/i.test(labelOf(o)));
      if (i < 0) return { ok: false, options: options.slice(0, 40).map(labelOf) };
    }
    sel.selectOption(options[i]);
    if (typeof sel.onMenuClose === "function") sel.onMenuClose();
    return { ok: true, label: labelOf(options[i]) };
  }

  // Anything else: click to open, then click the matching option.
  async function pickGeneric(el, value) {
    el.click();
    await sleep(500);
    const visible = (o) => o.getBoundingClientRect().height > 0;
    const options = [...document.querySelectorAll("[role=option]")].filter(visible);
    const i = bestOption(options.map((o) => o.innerText.trim()), value);
    if (i < 0) return { ok: false, options: options.slice(0, 40).map((o) => o.innerText.trim()) };
    options[i].click();
    return { ok: true, label: options[i].innerText.trim() };
  }

  window.__jhPick = async (picks) => {
    const results = [];
    for (const p of picks || []) {
      const el = document.querySelector(`[data-jh-pick="${p.mark}"]`);
      if (!el) continue;
      // The page's code may still be starting up (hydrating); give it a moment to attach to the dropdown.
      let sel = reactSelectFor(el);
      for (let t = 0; !sel && t < 6 && /select__|react-select/.test(String(el.className)); t++) {
        await sleep(500);
        sel = reactSelectFor(el);
      }
      results.push({ mark: p.mark, ...(await (sel ? pickReact(sel, p.value) : pickGeneric(el, p.value)).catch((e) => ({ ok: false, error: String(e) }))) });
      await sleep(150);
    }
    return results;
  };
})();
