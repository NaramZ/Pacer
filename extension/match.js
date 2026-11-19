// Matching a value to a form's own wording ("United States" → "US", "Pittsburgh, PA" → "Pittsburgh, Pennsylvania").
// Loaded into the page twice: next to the form filler, and in the page's own context for custom dropdowns.
(() => {
  if (window.__jhMatch) return;
  /* ---------- Matching words and options ---------- */

  const norm = (s) =>
    String(s || "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/['’`]/g, "")
      .replace(/[^\p{L}\p{N}+]+/gu, " ")
      .trim();

  const STATES = { AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming" };
  const COUNTRY_EXTRA = { US: ["USA", "U.S.", "United States of America", "America"], GB: ["UK", "Great Britain", "England"], AE: ["UAE"], KR: ["South Korea", "Korea, Republic of"], ES: ["España"], DE: ["Deutschland"] };
  const GROUPS = [
    ["Bachelor's", "Bachelors", "Bachelor", "Bachelor's Degree", "BS", "B.S.", "BA", "B.A.", "BSc", "Bachelor of Science", "Bachelor of Arts", "Undergraduate"],
    ["Master's", "Masters", "Master", "Master's Degree", "MS", "M.S.", "MA", "MSc"],
    ["Doctorate", "PhD", "Ph.D."],
    ["Yes", "Y", "True"],
    ["No", "N", "False"],
  ];
  const DECLINE = /decline|prefer not|not (wish|want) to|dont (wish|want)|do not (wish|want)|choose not|rather not|not to (say|answer|disclose)|not disclose/;

  let countries = null;
  function countryNames(value) {
    if (!countries) {
      countries = [];
      const d = new Intl.DisplayNames(["en"], { type: "region" });
      for (let a = 65; a <= 90; a++)
        for (let b = 65; b <= 90; b++) {
          const code = String.fromCharCode(a, b);
          let name = "";
          try {
            name = d.of(code);
          } catch {}
          if (name && name !== code) countries.push([name, code, ...(COUNTRY_EXTRA[code] || [])]);
        }
    }
    const v = norm(value);
    return countries.find((names) => names.some((n) => norm(n) === v)) || null;
  }

  function equivalents(value) {
    const out = new Set([norm(value)]);
    const parts = String(value).split(",").map((p) => p.trim());
    if (parts.length > 1) out.add(norm(parts[0]));
    if (parts.length > 1 && STATES[parts[1].toUpperCase()]) out.add(norm(`${parts[0]} ${STATES[parts[1].toUpperCase()]}`));
    const c = countryNames(value);
    if (c) c.forEach((n) => out.add(norm(n)));
    for (const g of GROUPS) if (g.some((x) => norm(x) === norm(value))) g.forEach((x) => out.add(norm(x)));
    return [...out].filter(Boolean);
  }

  function bestOption(options, value) {
    const decline = DECLINE.test(norm(value));
    const eqs = equivalents(value);
    let best = -1;
    let top = 0;
    options.forEach((opt, i) => {
      const o = norm(opt);
      let s = 0;
      if (!o) return;
      if (decline) s = DECLINE.test(o) ? 100 : 0;
      else
        for (const e of eqs) {
          if (o === e) s = Math.max(s, 100);
          else if (new RegExp(`^${e.replace(/\+/g, "\\+")} \\+?\\d+$`).test(o)) s = Math.max(s, 95);
          else if (e.length >= 3 && (o.startsWith(`${e} `) || o.startsWith(`${e},`))) s = Math.max(s, 85);
          else if (e.length >= 4) {
            const words = e.split(" ");
            const have = new Set(o.split(" "));
            if (words.length > 1 && words.every((w) => have.has(w))) s = Math.max(s, 75);
          }
        }
      if (s > top || (s === top && s > 0 && opt.length < options[best].length)) {
        top = s;
        best = i;
      }
    });
    return best;
  }

  window.__jhMatch = { norm, bestOption };
})();
