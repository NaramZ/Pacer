import { z } from "zod/v4";
import { database } from "./automation-auth";
import { AGENT_MODEL, type Writer } from "./claude";

// Networking: design events found on the web (each confirmed on its own page) and the people the person is getting to know.

export type NetworkEvent = {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  city: string;
  venue: string;
  url: string;
  organizer: string;
  kind: string;
  cost: string;
  summary: string;
  status: string;
  notes: string;
  verified: number;
  source: string;
};

const KINDS = [
  "meetup",
  "talk",
  "workshop",
  "portfolio review",
  "conference",
  "career fair",
  "social",
  "networking",
  "hackathon",
  "online",
] as const;

const EventsSchema = z.object({
  events: z.array(
    z.object({
      title: z.string(),
      startsAt: z.string(),
      endsAt: z.string(),
      city: z.string(),
      venue: z.string(),
      url: z.string(),
      organizer: z.string(),
      kind: z.enum(KINDS),
      cost: z.string(),
      summary: z.string(),
    }),
  ),
});

const PROMPT = `Find real, upcoming events where a product designer could meet other designers, design leaders and hiring managers.

Look for: UX and product design meetups (IxDA, AIGA, UXPA, Friends of Figma, Design Buddies, Women Who Design, local product design groups), design talks and panels, workshops, portfolio reviews, design or tech career fairs, CreativeMornings, design systems and AI-for-designers events, and conferences. Search Meetup, Luma (lu.ma), Eventbrite and organisers' own sites.

Rules:
- Only list an event you found on its own event page, with the date stated there. Never invent an event, a date or a link. If unsure, leave it out.
- url is that event page (not a search results page or a group's home page).
- startsAt is the local date and time as "YYYY-MM-DDTHH:MM" (use "T00:00" only if the page gives no time); endsAt the same way, or "".
- Only events between {FROM} and {TO}.
- Search widely for this one place: run several different searches, for example "UX design meetup {PLACE}", "product design event {PLACE} lu.ma", "site:luma.com {PLACE} design", "site:lu.ma {PLACE} tech", "eventbrite UX design {PLACE}", "AIGA {PLACE} events", "IxDA {PLACE}", "UXPA {PLACE}", "Friends of Figma {PLACE}", "CreativeMornings {PLACE}", "design systems meetup {PLACE}", "tech networking {PLACE} designers". Open the promising event pages to read their dates.
- city is the city it happens in, or "Online".
- Only events held in or near this place (or online). Leave out trips a local group takes to another city.
- cost is what the page says ("Free", "$15", "Free, RSVP required"), or "" if it doesn't say.
- summary is one plain sentence on what happens there and who goes.
Aim for 6 to 15 events for this place if that many exist; never pad the list. Most useful for meeting people first.`;

// Local groups worth checking by name, per place and per pass. These are search leads, not facts: an event still has to be found on its own page.
type Focus = "design" | "tech" | "campus" | "listings";
const LOCAL_LEADS: { re: RegExp; leads: Partial<Record<Focus, string>> }[] = [
  {
    re: /pittsburgh/i,
    leads: {
      design:
        "IxDA Pittsburgh, AIGA Pittsburgh, UXPA Pittsburgh, Pittsburgh UX and UI design meetups, Friends of Figma Pittsburgh, CreativeMornings Pittsburgh, Pittsburgh design systems or accessibility meetups, ADPList or Design Buddies events in Pittsburgh",
      tech: "ProductTank Pittsburgh, Pittsburgh product management meetups, Code & Supply, Pittsburgh Technology Council, Black Tech Nation, Innovation Works and AlphaLab, Startup Pittsburgh, Ascender, Pittsburgh Robotics Network, Pittsburgh AI and machine learning meetups, Pittsburgh startup pitch nights and demo days, hackathons",
      campus:
        "Carnegie Mellon HCII and School of Design public lectures and events, CMU Swartz Center for Entrepreneurship, University of Pittsburgh Innovation Institute, Point Park and Chatham design events, Pittsburgh Cultural Trust and Pittsburgh design week events, Pittsburgh creative and arts networking nights, coworking spaces' event calendars",
      listings:
        "Meetup's Pittsburgh design, UX, tech and product groups, lu.ma events in Pittsburgh, Eventbrite's Pittsburgh business, tech and design events, and Pittsburgh city tech event calendars",
    },
  },
  {
    re: /new york/i,
    leads: {
      design:
        "IxDA New York, AIGA NY, UXPA NYC, Friends of Figma NYC, CreativeMornings New York, Design Driven NYC, New York design systems and accessibility meetups, Women Who Design and Out in Tech design events, ADPList events in New York",
      tech: "ProductTank NYC, Product School NYC events, NY Tech Alliance and NY Tech Meetup, Built In NYC events, Betaworks, Techstars NYC, New York AI and startup demo days, General Assembly New York, hackathons",
      campus:
        "Parsons School of Design and The New School public talks, School of Visual Arts (SVA) design talks, Pratt Institute events, NYU ITP and IMA shows and talks, Cooper Union lectures, Columbia and Cornell Tech public events",
      listings:
        "Meetup's New York design, UX, tech and product groups, lu.ma/nyc, Eventbrite's New York design and tech events, and Gary's Guide NYC tech events",
    },
  },
  {
    re: /new jersey/i,
    leads: {
      design:
        "AIGA New Jersey, UX and UXPA meetups in Hoboken, Jersey City, Newark, Montclair and Princeton, New Jersey creative and design networking nights",
      tech: "NJ Tech Meetup, TechUnited:NJ, Jersey City and Hoboken tech and startup meetups, Princeton tech and startup events, NJIT Enterprise Development Center, Newark Venture Partners demo days, hackathons in New Jersey",
      campus:
        "Rutgers, Princeton, NJIT, Stevens Institute of Technology and Montclair State public design, HCI and entrepreneurship events, Kean University's Michael Graves College design events",
      listings:
        "Meetup's New Jersey design, UX, tech and product groups, lu.ma events in New Jersey, and Eventbrite's New Jersey tech and design events",
    },
  },
  {
    re: /philadelphia/i,
    leads: {
      design:
        "IxDA Philadelphia, AIGA Philadelphia, UXPA Philadelphia and Philly UX meetups, Friends of Figma Philadelphia, CreativeMornings Philadelphia, Philadelphia Design Week events",
      tech: "ProductTank Philadelphia, Technical.ly Philly events, Philly Startup Leaders, Ben Franklin Technology Partners, Philadelphia AI and data meetups, Comcast LIFT Labs, hackathons",
      campus:
        "Drexel Westphal College of Media Arts & Design, University of Pennsylvania (Weitzman, Penn Engineering, Wharton) public events, Temple's Tyler School of Art and Architecture, Thomas Jefferson University design events",
      listings:
        "Meetup's Philadelphia design, UX, tech and product groups, lu.ma/philadelphia, Eventbrite's Philadelphia tech and design events, and Technical.ly's Philly event calendar",
    },
  },
  {
    re: /boston/i,
    leads: {
      design:
        "IxDA Boston, AIGA Boston, UXPA Boston, Boston UX meetups, Friends of Figma Boston, CreativeMornings Boston, Design Museum Everywhere events",
      tech: "ProductTank Boston, Boston Product Management Association, Boston New Technology, MassChallenge, CIC Cambridge and Venture Café Cambridge Thursday gatherings, Boston and Cambridge AI meetups, hackathons",
      campus:
        "MIT Media Lab and MIT Design public talks, Harvard GSD and Harvard i-lab events, MassArt, Northeastern and Boston University design and HCI events, Tufts human factors events",
      listings:
        "Meetup's Boston design, UX, tech and product groups, lu.ma/boston, Eventbrite's Boston and Cambridge tech and design events, and Built In Boston events",
    },
  },
];

// Job-search places overlap ("Boston, MA" and "Massachusetts" are one trip), so each area is searched once.
const AREAS: { re: RegExp; label: string }[] = [
  { re: /pittsburgh|\bpgh\b/i, label: "Pittsburgh, PA" },
  { re: /new york|\bnyc\b|brooklyn|manhattan|queens/i, label: "New York City" },
  { re: /new jersey|\bnj\b|hoboken|jersey city|newark|princeton/i, label: "New Jersey" },
  { re: /philadelphia|philly/i, label: "Philadelphia, PA" },
  { re: /boston|cambridge|somerville|massachusetts|\bma\b/i, label: "Boston, MA (and Cambridge)" },
  { re: /online|virtual|remote/i, label: "Online" },
];
export function mergePlaces(places: string[]) {
  const out: string[] = [];
  for (const raw of places) {
    const place = raw.trim();
    if (!place) continue;
    const label = AREAS.find((a) => a.re.test(place))?.label || place;
    if (!out.some((p) => p.toLowerCase() === label.toLowerCase())) out.push(label);
  }
  return out;
}
const leadsFor = (place: string) =>
  LOCAL_LEADS.find((l) => l.re.test(place))?.leads;
const FOCUS_NOTE: Record<Focus, string> = {
  design: "",
  tech: "This pass: tech, startup, product management, AI and hackathon events where product designers meet founders, product managers, engineers and hiring managers.",
  campus:
    "This pass: public university talks and lectures, design school events, and creative-community or arts networking events open to the public.",
  listings:
    "This pass: browse the place's event listings on Meetup, Luma and Eventbrite for anything design, UX, product, tech or creative networking, and open each promising event page.",
};

// Finds events for one place with Claude's web search. Each result still has to pass the page check below.
export async function searchEvents(
  ai: Writer,
  place: string,
  from: string,
  to: string,
  focus: Focus = "design",
) {
  const leads = leadsFor(place)?.[focus] || "";
  const extra = [
    FOCUS_NOTE[focus],
    leads ? `Local groups and calendars to check by name: ${leads}.` : "",
  ]
    .filter(Boolean)
    .join("\n");
  const r = await ai.ask({
    model: AGENT_MODEL,
    maxTokens: 8000,
    effort: "medium",
    search: 10,
    system:
      "You find real, upcoming in-person and online events for designers, and report only what event pages actually say.",
    schema: EventsSchema,
    messages: [
      {
        role: "user",
        content: `${PROMPT.replaceAll("{FROM}", from).replaceAll("{TO}", to).replaceAll("{PLACE}", place)}${extra ? `\n\n${extra}` : ""}\n\nPlace: ${place}${/online/i.test(place) ? " (virtual events open to people in the US)" : ""}`,
      },
    ],
  });
  if (!r.data) console.warn(`[events] ${place} / ${focus}: no usable answer (${r.stop})`);
  return r.data?.events || [];
}

/* ---------- Luma ---------- */

// Luma's public city pages ("luma.com/pittsburgh") list the events it features there. Read straight from the page, so no web search is needed.
const LUMA_CITIES: { re: RegExp; slug: string }[] = [
  { re: /pittsburgh/i, slug: "pittsburgh" },
  { re: /new york|nyc|brooklyn|manhattan/i, slug: "nyc" },
  { re: /boston|cambridge|massachusetts/i, slug: "boston" },
  { re: /philadelphia|philly/i, slug: "philadelphia" },
];
// Only events a product designer would network at; Luma city pages also carry mahjong nights and run clubs.
const LUMA_RELEVANT = /design|\bux\b|\bui\b|product|figma|tech|\bai\b|a\.i\.|startup|founder|pitch|software|developer|engineer|hack|creative|innovation|network|career|data|robot|demo day|build|\bweb\b|app|saas|venture|entrepreneur/i;

const LUMA_OFF_TOPIC = /run club|running|yoga|mahj|crypto|bitcoin|biolog|biotech|wellness|dating|singles|poker/i;

type LumaEntry = {
  event?: { name?: string; start_at?: string; end_at?: string; timezone?: string; url?: string; location_type?: string; geo_address_info?: { city?: string; address?: string; full_address?: string } | null };
  calendar?: { name?: string } | null;
  hosts?: { name?: string }[] | null;
  ticket_info?: { is_free?: boolean; price?: { cents?: number } | null } | null;
};

// "2026-11-17T22:00:00.000Z" in America/New_York -> "2026-11-17T17:00".
function localStamp(iso: string, zone: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: zone || "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

function lumaKind(name: string): (typeof KINDS)[number] {
  if (/hackathon|hack night|buildathon/i.test(name)) return "hackathon";
  if (/workshop|bootcamp|hands.on/i.test(name)) return "workshop";
  if (/portfolio/i.test(name)) return "portfolio review";
  if (/conference|summit|\bcon\b/i.test(name)) return "conference";
  if (/career|job fair|hiring/i.test(name)) return "career fair";
  if (/happy hour|mixer|social|drinks|coffee|breakfast/i.test(name)) return "social";
  if (/talk|panel|fireside|lecture|keynote/i.test(name)) return "talk";
  if (/network/i.test(name)) return "networking";
  return "meetup";
}

const nearCity = (geo: string, re: RegExp, place: string) => (!geo ? place : re.test(geo) ? geo : `${geo} (near ${place.split(",")[0]})`);

export async function lumaEvents(place: string) {
  const city = LUMA_CITIES.find((c) => c.re.test(place));
  if (!city) return [];
  try {
    const r = await fetch(`https://luma.com/${city.slug}`, { headers: { "User-Agent": "Mozilla/5.0 (compatible; JobHunter/1.0)", Accept: "text/html" } });
    if (!r.ok) return [];
    const html = await r.text();
    const json = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)?.[1];
    if (!json) return [];
    const entries = (JSON.parse(json)?.props?.pageProps?.initialData?.data?.events || []) as LumaEntry[];
    return entries
      .filter((x) => x.event?.name && x.event.start_at && x.event.url && LUMA_RELEVANT.test(x.event.name) && !LUMA_OFF_TOPIC.test(x.event.name))
      .map((x) => {
        const e = x.event!;
        const zone = e.timezone || "America/New_York";
        const online = e.location_type === "online" || !e.geo_address_info;
        const host = x.calendar?.name && x.calendar.name !== "Personal" ? x.calendar.name : (x.hosts || []).map((h) => h.name).filter(Boolean).slice(0, 2).join(", ");
        const cents = x.ticket_info?.price?.cents;
        return {
          title: e.name!,
          startsAt: localStamp(e.start_at!, zone),
          endsAt: e.end_at ? localStamp(e.end_at, zone) : "",
          city: online ? "Online" : nearCity(e.geo_address_info?.city || "", city.re, place),
          venue: online ? "" : e.geo_address_info?.address || "",
          url: `https://luma.com/${e.url}`,
          organizer: host || "Luma",
          kind: online ? ("online" as const) : lumaKind(e.name!),
          cost: x.ticket_info?.is_free ? "Free" : cents ? `$${Math.round(cents / 100)}` : "",
          summary: `Listed on Luma${host ? ` by ${host}` : ""}.`,
        };
      })
      .filter((e) => e.startsAt);
  } catch {
    return [];
  }
}

const STOP = new Set(
  "with from your this that what when where will about design designers designer meetup event events night online talk".split(
    " ",
  ),
);

// Opens the event page: false when it's gone, true when the event's name is on it, null when the site wouldn't let us look.
export async function checkEventPage(
  url: string,
  title: string,
): Promise<boolean | null> {
  if (!/^https?:\/\//i.test(url)) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const r = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; JobHunter/1.0)",
        Accept: "text/html",
      },
      redirect: "follow",
      signal: controller.signal,
    });
    if (r.status === 404 || r.status === 410) return false;
    if (!r.ok) return null;
    const page = (await r.text()).toLowerCase();
    const words =
      title
        .toLowerCase()
        .match(/[a-z0-9][a-z0-9'-]{3,}/g)
        ?.filter((w) => !STOP.has(w)) || [];
    if (!words.length) return null;
    const seen = words.filter((w) => page.includes(w)).length;
    return seen >= Math.min(2, words.length) ? true : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const day = (d: Date) => d.toISOString().slice(0, 10);
// Same day and one title contains the start of the other ("Tech 50 Awards" / "Tech 50 Awards Celebration").
const squash = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, "");
const sameEvent = (a: string, b: string) => {
  const x = squash(a);
  const y = squash(b);
  const n = Math.min(x.length, y.length, 24);
  return n >= 8 && (x.includes(y.slice(0, n)) || y.includes(x.slice(0, n)));
};
const normalUrl = (u: string) =>
  u
    .trim()
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "")
    .toLowerCase();

// What the search is doing, sent to the page as it happens so a long search never looks stuck.
export type SearchStep = { id: string; label: string; state: "waiting" | "running" | "done" | "failed"; count?: number };
export type SearchProgress =
  | { type: "steps"; steps: SearchStep[] }
  | { type: "step"; id: string; state: SearchStep["state"]; count?: number }
  | { type: "check"; done: number; total: number }
  | { type: "saving" };
const FOCUS_LABEL: Record<Focus, string> = {
  design: "Design and UX groups",
  tech: "Tech, startup and product events",
  campus: "University and creative talks",
  listings: "Meetup, Luma and Eventbrite listings",
};

// Searches, checks every page, and saves what's real. Events already saved keep the person's going/maybe/skip choice.
export async function findAndSaveEvents(
  userId: string,
  ai: Writer,
  places: string[],
  progress: (p: SearchProgress) => void = () => {},
) {
  const now = new Date();
  const from = day(now);
  const to = day(new Date(now.getTime() + 56 * 86400000));
  // One search per place (a few at a time) finds far more than one search across all of them.
  const found: Awaited<ReturnType<typeof searchEvents>> = [];
  // Places with known local groups (Pittsburgh) get four narrower passes, each with its own search budget.
  const runs = places.flatMap((place) =>
    (leadsFor(place)
      ? (["design", "tech", "campus", "listings"] as const)
      : (["design"] as const)
    ).map((focus) => ({ id: `${place}|${focus}`, place, focus })),
  );
  const lumaPlaces = places.filter((p) => LUMA_CITIES.some((c) => c.re.test(p)));
  progress({
    type: "steps",
    steps: [
      ...(lumaPlaces.length ? [{ id: "luma", label: `Luma city pages (${lumaPlaces.map((p) => p.split(",")[0]).join(", ")})`, state: "waiting" as const }] : []),
      ...runs.map((r) => ({ id: r.id, label: `${r.place}: ${runs.filter((x) => x.place === r.place).length > 1 ? FOCUS_LABEL[r.focus] : "design, tech and networking events"}`, state: "waiting" as const })),
    ],
  });

  // Luma is quick, so it goes first.
  let fromLuma: Awaited<ReturnType<typeof lumaEvents>> = [];
  if (lumaPlaces.length) {
    progress({ type: "step", id: "luma", state: "running" });
    fromLuma = (await Promise.all(lumaPlaces.map((place) => lumaEvents(place)))).flat();
    progress({ type: "step", id: "luma", state: "done", count: fromLuma.length });
  }
  console.log(`[events] Luma city pages: ${fromLuma.length}`);

  // Four searches at a time; a new one starts as soon as one finishes.
  let next = 0;
  const worker = async () => {
    while (next < runs.length) {
      const r = runs[next++];
      progress({ type: "step", id: r.id, state: "running" });
      try {
        const list = await searchEvents(ai, r.place, from, to, r.focus);
        console.log(`[events] ${r.place} / ${r.focus}: ${list.length}`);
        progress({ type: "step", id: r.id, state: "done", count: list.length });
        found.push(...list);
      } catch (e) {
        console.warn(`[events] ${r.place} / ${r.focus} failed: ${e instanceof Error ? e.message : e}`);
        progress({ type: "step", id: r.id, state: "failed" });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, runs.length) }, worker));
  const lumaUrls = new Set(fromLuma.map((e) => normalUrl(e.url)));
  found.unshift(...fromLuma);
  const db = database();
  const existing = ((
    await db
      .prepare("SELECT * FROM network_events WHERE user_id=?")
      .bind(userId)
      .all<NetworkEvent>()
  ).results || []) as NetworkEvent[];
  const result = {
    found: found.length,
    added: 0,
    updated: 0,
    dropped: [] as string[],
    unconfirmed: 0,
  };
  const seen = new Set<string>();
  const kept: { date: string; title: string }[] = [];
  progress({ type: "check", done: 0, total: found.length });
  for (let i = 0; i < found.length; i += 4) {
    if (i) progress({ type: "check", done: i, total: found.length });
    const batch = found.slice(i, i + 4);
    const checks = await Promise.all(
      batch.map((e) => (lumaUrls.has(normalUrl(e.url)) ? true : checkEventPage(e.url, e.title))),
    );
    for (const [k, e] of batch.entries()) {
      const date = e.startsAt.slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}/.test(e.startsAt) || date < from || date > to) {
        result.dropped.push(`${e.title} (date outside the next 8 weeks)`);
        continue;
      }
      if (checks[k] === false) {
        result.dropped.push(`${e.title} (its page is gone)`);
        continue;
      }
      const key = normalUrl(e.url) || `${e.title.toLowerCase()}|${date}`;
      if (seen.has(key) || kept.some((k) => k.date === date && sameEvent(k.title, e.title))) continue;
      seen.add(key);
      kept.push({ date, title: e.title });
      const verified = checks[k] === true ? 1 : 0;
      if (!verified) result.unconfirmed++;
      const match = existing.find((x) => (x.url && normalUrl(x.url) === normalUrl(e.url)) || (x.starts_at.slice(0, 10) === date && sameEvent(x.title, e.title)));
      const stamp = new Date().toISOString();
      if (match) {
        await db
          .prepare(
            "UPDATE network_events SET title=?,starts_at=?,ends_at=?,city=?,venue=?,url=?,organizer=?,kind=?,cost=?,summary=?,verified=?,updated_at=? WHERE id=? AND user_id=?",
          )
          .bind(
            e.title,
            e.startsAt,
            e.endsAt,
            e.city,
            e.venue,
            e.url,
            e.organizer,
            e.kind,
            e.cost,
            e.summary,
            verified,
            stamp,
            match.id,
            userId,
          )
          .run();
        result.updated++;
      } else {
        await db
          .prepare(
            "INSERT INTO network_events (id,user_id,title,starts_at,ends_at,city,venue,url,organizer,kind,cost,summary,status,verified,source,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'new',?,'search',?,?)",
          )
          .bind(
            crypto.randomUUID(),
            userId,
            e.title,
            e.startsAt,
            e.endsAt,
            e.city,
            e.venue,
            e.url,
            e.organizer,
            e.kind,
            e.cost,
            e.summary,
            verified,
            stamp,
            stamp,
          )
          .run();
        result.added++;
      }
    }
  }
  progress({ type: "saving" });
  return result;
}

export async function listEvents(userId: string) {
  // Past events stay, so the person keeps a history of where they went and who they met.
  const rows = await database().prepare("SELECT * FROM network_events WHERE user_id=? ORDER BY starts_at").bind(userId).all<NetworkEvent>();
  return rows.results || [];
}

/* ---------- People ---------- */

export type ContactRow = {
  id: string;
  name: string;
  title: string;
  company: string;
  role: string;
  application_id: string;
  channels_json: string;
  found_at: string;
  message: string;
  status: string;
  last_contact_at: string;
  next_follow_up_at: string;
  meeting_at: string;
  notes: string;
  met_event_id: string;
  met_on: string;
  met_where: string;
  created_at: string;
  updated_at: string;
};

export const CONTACT_STATUSES = [
  "to contact",
  "contacted",
  "replied",
  "chat booked",
  "referred",
  "closed",
] as const;

export async function listContacts(userId: string) {
  const rows = await database()
    .prepare("SELECT * FROM contacts WHERE user_id=? ORDER BY updated_at DESC")
    .bind(userId)
    .all<ContactRow>();
  return rows.results || [];
}

type FoundPerson = {
  name: string;
  title: string;
  role: string;
  foundAt: string;
  channels: unknown[];
  message: string;
};

// Brings the people found on each job page ("People worth knowing") into the contact list, once each.
export async function importPeopleFromJobs(userId: string) {
  const db = database();
  const apps = ((
    await db
      .prepare(
        "SELECT id,company,dossier_json FROM applications WHERE user_id=?",
      )
      .bind(userId)
      .all<{ id: string; company: string; dossier_json: string }>()
  ).results || []) as {
    id: string;
    company: string;
    dossier_json: string;
  }[];
  const have = new Set(
    (await listContacts(userId)).map(
      (c) => `${c.name.toLowerCase()}|${c.company.toLowerCase()}`,
    ),
  );
  let added = 0;
  for (const a of apps) {
    let people: FoundPerson[] = [];
    try {
      people = (JSON.parse(a.dossier_json || "{}").contacts?.people ||
        []) as FoundPerson[];
    } catch {
      continue;
    }
    for (const p of people) {
      const key = `${p.name.toLowerCase()}|${a.company.toLowerCase()}`;
      if (!p.name || have.has(key)) continue;
      have.add(key);
      const stamp = new Date().toISOString();
      await db
        .prepare(
          "INSERT INTO contacts (id,user_id,name,title,company,role,application_id,channels_json,found_at,message,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,'to contact',?,?)",
        )
        .bind(
          crypto.randomUUID(),
          userId,
          p.name,
          p.title || "",
          a.company,
          p.role || "other",
          a.id,
          JSON.stringify(p.channels || []),
          p.foundAt || "",
          p.message || "",
          stamp,
          stamp,
        )
        .run();
      added++;
    }
  }
  return added;
}
