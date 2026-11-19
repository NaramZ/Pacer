// Picks the right option in a dropdown when the form's wording differs from ours:
// "United States" vs "US" / "USA" / "United States +1", "Pittsburgh, PA" vs "Pittsburgh, Pennsylvania, United States",
// "Bachelor's" vs "BS" / "Bachelor's Degree", "Decline to self-identify" vs "I don't wish to answer".

export const normalize = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’`]/g, "")
    .replace(/[^\p{L}\p{N}+]+/gu, " ")
    .trim();

const STATES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware",
  DC: "District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa",
  KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota",
  MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon",
  PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah",
  VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming", PR: "Puerto Rico",
};

// Extra names forms use for some countries, beyond the standard English name and ISO code.
const COUNTRY_EXTRA: Record<string, string[]> = {
  US: ["USA", "U.S.", "U.S.A.", "United States of America", "America", "United States (US)"],
  GB: ["UK", "U.K.", "Great Britain", "England", "United Kingdom of Great Britain and Northern Ireland", "GBR"],
  AE: ["UAE", "U.A.E."],
  KR: ["South Korea", "Korea, Republic of", "Republic of Korea", "Korea"],
  KP: ["North Korea"],
  RU: ["Russian Federation"],
  CZ: ["Czech Republic"],
  NL: ["Holland", "The Netherlands"],
  VN: ["Viet Nam"],
  IR: ["Iran, Islamic Republic of"],
  TW: ["Taiwan, Province of China"],
  CI: ["Ivory Coast", "Cote d'Ivoire"],
  TR: ["Turkey", "Türkiye"],
  MK: ["Macedonia"],
  LB: ["Lebanese Republic"],
  ES: ["España", "Espana", "Kingdom of Spain"],
  DE: ["Deutschland"],
  JP: ["Nippon"],
  CN: ["PRC", "People's Republic of China"],
  HK: ["Hong Kong SAR", "Hong Kong SAR China"],
};

let countries: { code: string; names: string[] }[] | null = null;
function countryTable() {
  if (countries) return countries;
  const display = new Intl.DisplayNames(["en"], { type: "region" });
  const list: { code: string; names: string[] }[] = [];
  for (let a = 65; a <= 90; a++)
    for (let b = 65; b <= 90; b++) {
      const code = String.fromCharCode(a, b);
      let name = "";
      try {
        name = display.of(code) || "";
      } catch {}
      if (!name || name === code || /unknown/i.test(name)) continue;
      list.push({ code, names: [name, code, ...(COUNTRY_EXTRA[code] || [])] });
    }
  countries = list;
  return list;
}

export function countryOf(value: string) {
  const v = normalize(value);
  if (!v) return null;
  return countryTable().find((c) => c.names.some((n) => normalize(n) === v)) || null;
}

const GROUPS: string[][] = [
  ["Bachelor's", "Bachelors", "Bachelor", "Bachelor's Degree", "Bachelors Degree", "BS", "B.S.", "BA", "B.A.", "BSc", "B.Sc.", "Bachelor of Science", "Bachelor of Arts", "Undergraduate"],
  ["Master's", "Masters", "Master", "Master's Degree", "Masters Degree", "MS", "M.S.", "MA", "M.A.", "MSc", "Master of Science", "Master of Arts"],
  ["Associate's", "Associates", "Associate", "Associate's Degree", "Associate Degree"],
  ["Doctorate", "PhD", "Ph.D.", "Doctoral", "Doctor of Philosophy"],
  ["High School", "High School Diploma", "Secondary School", "GED"],
  ["Computer Science", "CS", "Computer Science and Engineering", "Computing"],
];

// Ways forms say "I'd rather not answer".
const DECLINE = /decline|prefer not|not (wish|want) to|dont (wish|want)|do not (wish|want)|choose not|rather not|not to (say|answer|disclose)|not disclose|no answer/;

function equivalents(value: string): string[] {
  const out = new Set<string>([normalize(value)]);
  const beforeComma = value.split(",")[0].trim();
  if (beforeComma !== value.trim()) out.add(normalize(beforeComma));
  // "Pittsburgh, PA" → "Pittsburgh Pennsylvania"
  const parts = value.split(",").map((p) => p.trim());
  if (parts.length >= 2 && STATES[parts[1].toUpperCase()]) out.add(normalize(`${parts[0]} ${STATES[parts[1].toUpperCase()]}`));
  const state = STATES[value.trim().toUpperCase()] || Object.values(STATES).find((s) => normalize(s) === normalize(value));
  if (state) {
    out.add(normalize(state));
    const code = Object.keys(STATES).find((k) => STATES[k] === state);
    if (code) out.add(normalize(code));
  }
  const country = countryOf(value);
  if (country) for (const n of country.names) out.add(normalize(n));
  for (const group of GROUPS) if (group.some((g) => normalize(g) === normalize(value))) for (const g of group) out.add(normalize(g));
  return [...out].filter(Boolean);
}

// What to type into a type-to-search box, in order, until the right option shows up.
export function searchTerms(value: string) {
  const terms = [value.trim()];
  const beforeComma = value.split(",")[0].trim();
  if (beforeComma && beforeComma !== value.trim()) terms.push(beforeComma);
  const country = countryOf(value);
  if (country) terms.push(...country.names.filter((n) => n.length >= 2 && n !== value.trim()).slice(0, 3));
  for (const group of GROUPS) if (group.some((g) => normalize(g) === normalize(value))) terms.push(group[0].replace(/'s$/, ""));
  if (DECLINE.test(normalize(value))) terms.push("Decline", "Prefer not", "wish");
  return [...new Set(terms)].slice(0, 4);
}

// Scores one option against the value; 0 means no match. Higher is better; shorter options win ties.
function score(option: string, eqs: string[], decline: boolean) {
  const o = normalize(option);
  if (!o) return 0;
  if (decline) return DECLINE.test(o) ? 100 : 0;
  let best = 0;
  for (const e of eqs) {
    if (o === e) best = Math.max(best, 100);
    // "US +1", "United States +1", "United States (+1)"
    else if (new RegExp(`^${e.replace(/[+]/g, "\\+")} \\+?\\d+$`).test(o)) best = Math.max(best, 95);
    else if (e.length >= 3 && (o.startsWith(`${e} `) || o.startsWith(`${e},`))) best = Math.max(best, 85);
    else if (e.length >= 4) {
      // Every word of the value appears in the option: "pittsburgh pennsylvania" in "pittsburgh pennsylvania united states".
      const words = e.split(" ");
      const have = new Set(o.split(" "));
      if (words.length > 1 && words.every((w) => have.has(w))) best = Math.max(best, 75);
      else if (words.length === 1 && have.has(e)) best = Math.max(best, 60);
    }
  }
  return best;
}

export function bestOption(options: string[], value: string, minScore = 1) {
  const decline = DECLINE.test(normalize(value));
  const eqs = equivalents(value);
  let pick = -1;
  let top = 0;
  options.forEach((opt, i) => {
    const s = score(opt, eqs, decline);
    if (s > top || (s === top && s > 0 && opt.length < options[pick].length)) {
      top = s;
      pick = i;
    }
  });
  return top >= minScore ? pick : -1;
}

export const OTHER = /^(other|others|other \(please specify\)|other not listed|not listed|none of the above|my school is not listed|school not listed)$/;
// Fields where "Other" is a sensible answer when the real one isn't listed.
export const OTHER_OK = /school|university|college|institution|discipline|major|field of study|degree|employer|company/i;
