"use client";
/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarPlus, Check, ChevronDown, ChevronLeft, ChevronRight, Copy, Download, ExternalLink, LoaderCircle, Plus, Search, Sparkles, Star, Trash2, UserPlus, X } from "lucide-react";
import { SiteHeader } from "../site-header";
import { postJson } from "../jobs";
import "./network.css";

type NetEvent = { id: string; title: string; starts_at: string; ends_at: string; city: string; venue: string; url: string; organizer: string; kind: string; cost: string; summary: string; status: string; notes: string; verified: number; source: string };
type Channel = { kind: string; label: string; value: string; note: string };
type Person = {
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
  created_at?: string;
};
type Job = { id: string; company: string; role: string; status: string; followUpAt: string; dossierJson?: string; fitScore: number };
type Item = { date: string; time: string; kind: "event" | "meeting" | "followup" | "job"; label: string; tone: string; ref: string; place?: string };
type View = "review" | "plan" | "past" | "skipped";
type Step = { id: string; label: string; state: "waiting" | "running" | "done" | "failed"; count?: number };
type SearchRun = { places: string[]; steps: Step[]; check?: { done: number; total: number }; phase: "starting" | "searching" | "checking" | "saving"; startedAt: number };
const clock = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;

const STATUSES = ["to contact", "contacted", "replied", "chat booked", "referred", "closed"];
const ACTIVE_JOB = new Set(["Saved", "Applied", "Screen", "Interview", "Final"]);
const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const TODAY = () => ymd(new Date());
const plusDays = (n: number) => ymd(new Date(Date.now() + n * 86400000));

// "2026-11-20T18:00" read as local time.
function local(value: string) {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] || 0), Number(m[5] || 0)) : null;
}
const timeOf = (value: string) => (/T\d{2}:\d{2}/.test(value) && !/T00:00/.test(value) ? local(value)!.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "");
const shortTime = (value: string) => timeOf(value).replace(":00", "").replace(" AM", "a").replace(" PM", "p");
const niceDate = (value: string) => local(value)?.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }) || value;

// Where an event is, as a colour and a short name, so it reads at a glance.
const PLACES = [
  { code: "PGH", label: "Pittsburgh", re: /pittsburgh|pgh|allegheny|oakland, pa|shadyside|lawrenceville|east liberty|strip district/i },
  { code: "NYC", label: "New York", re: /new york|nyc|brooklyn|manhattan|queens|bronx/i },
  { code: "NJ", label: "New Jersey", re: /new jersey|\bnj\b|hoboken|jersey city|newark|princeton/i },
  { code: "PHL", label: "Philadelphia", re: /philadelphia|philly/i },
  { code: "BOS", label: "Boston", re: /boston|cambridge|somerville|massachusetts|\bma\b/i },
  { code: "WEB", label: "Online", re: /online|virtual|zoom|remote|webinar/i },
] as const;
function placeOf(e: { city: string; venue?: string; kind?: string }) {
  const text = `${e.city} ${e.venue || ""}`;
  const hit = PLACES.find((p) => p.re.test(e.city)) || PLACES.find((p) => p.re.test(text)) || (e.kind === "online" ? PLACES[5] : undefined);
  return hit ? { code: hit.code as string, label: hit.label as string } : { code: "OTHER", label: e.city || "Place not listed" };
}
const KIND_LABEL: Record<string, string> = {
  meetup: "Meetup",
  talk: "Talk",
  workshop: "Workshop",
  "portfolio review": "Portfolio review",
  conference: "Conference",
  "career fair": "Career fair",
  social: "Social",
  networking: "Networking",
  hackathon: "Hackathon",
  online: "Online event",
};
const kindOf = (k: string) => KIND_LABEL[k] || (k ? k[0].toUpperCase() + k.slice(1) : "Event");
const STATUS_LABEL: Record<string, string> = { new: "Not decided", maybe: "Interested", going: "Going", skipped: "Not interested", went: "Went", missed: "Didn’t go" };

const channels = (p: Person) => {
  try {
    return JSON.parse(p.channels_json || "[]") as Channel[];
  } catch {
    return [];
  }
};

// Google Calendar takes local times without a zone, so the event lands at the right hour in the person's own calendar.
const stamp = (d: Date) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
function spanOf(e: NetEvent) {
  const start = local(e.starts_at)!;
  const end = (e.ends_at && local(e.ends_at)) || new Date(start.getTime() + 2 * 3600000);
  return { start, end };
}
// Skip the city when the venue's address already names it.
const whereOf = (e: NetEvent) => [e.venue, e.city && e.venue.toLowerCase().includes(e.city.toLowerCase()) ? "" : e.city].filter(Boolean).join(", ");
function googleLink(e: NetEvent) {
  const { start, end } = spanOf(e);
  const q = new URLSearchParams({ action: "TEMPLATE", text: e.title, dates: `${stamp(start)}/${stamp(end)}`, details: [e.summary, e.url].filter(Boolean).join("\n\n"), location: whereOf(e) });
  return `https://calendar.google.com/calendar/render?${q}`;
}
const mapLink = (e: NetEvent) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(whereOf(e))}`;
function downloadIcs(e: NetEvent) {
  const { start, end } = spanOf(e);
  const esc = (s: string) => s.replace(/[\\,;]/g, (c) => `\\${c}`).replace(/\n/g, "\\n");
  const ics = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Pacer//Networking//EN", "BEGIN:VEVENT", `UID:${e.id}@jobhunter`, `DTSTAMP:${stamp(new Date())}`, `DTSTART:${stamp(start)}`, `DTEND:${stamp(end)}`, `SUMMARY:${esc(e.title)}`, `LOCATION:${esc(whereOf(e))}`, `DESCRIPTION:${esc([e.summary, e.url].filter(Boolean).join("\n\n"))}`, e.url ? `URL:${e.url}` : "", "END:VEVENT", "END:VCALENDAR"].filter(Boolean).join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
  a.download = `${e.title.replace(/[^a-z0-9]+/gi, "-").slice(0, 60)}.ics`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// "Maya Chen, UX lead at Duolingo - talked about design systems" -> one person. One per line.
type MetRow = { name: string; title: string; company: string; link: string; notes: string };
function splitPeople(text: string): MetRow[] {
  return text
    .split(/\n+/)
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
    .filter(Boolean)
    .map((line) => {
      const link = line.match(/(https?:\/\/\S+|linkedin\.com\/\S+)/i)?.[0] || "";
      const rest = link ? line.replace(link, "").trim() : line;
      const [who, ...more] = rest.split(/\s+[-–—:]\s+|\s*[–—]\s*/);
      const notes = more.join(" - ").trim();
      const parts = who.split(",").map((x) => x.trim()).filter(Boolean);
      const name = parts.shift() || "";
      let title = parts[0] || "";
      let company = parts[1] || "";
      if (parts.length === 1 && / at /i.test(title)) [title, company] = title.split(/ at /i).map((x) => x.trim());
      return { name, title, company, link: link && !/^https?:/i.test(link) ? `https://${link}` : link, notes };
    })
    .filter((r) => r.name);
}

// Phones get their own calendar: a strip of days and the events listed under each day.
function useMobile() {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 720px)");
    const update = () => setMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return mobile;
}

async function getJson<T>(url: string, fallback: T): Promise<T> {
  try {
    return (await (await fetch(url)).json()) as T;
  } catch {
    return fallback;
  }
}

export default function Networking() {
  const [events, setEvents] = useState<NetEvent[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [tab, setTab] = useState<"events" | "people" | "journal">("events");
  // Links from the home page can open a tab directly, e.g. /network?tab=journal.
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    if (t === "journal" || t === "people" || t === "events") setTab(t);
  }, []);
  const [view, setView] = useState<View>("review");
  const [day, setDay] = useState("");
  const [open, setOpen] = useState<string>("");
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [places, setPlaces] = useState("");
  const [peopleFilter, setPeopleFilter] = useState("all");
  const [jobCount, setJobCount] = useState(3);
  const [placeFilter, setPlaceFilter] = useState("all");
  const [kindFilter, setKindFilter] = useState("all");
  const [showJobs, setShowJobs] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const mobile = useMobile();
  const [mview, setMview] = useState<"calendar" | View>("calendar");
  const [earlier, setEarlier] = useState(false);
  const [jump, setJump] = useState("");
  const stripRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLElement>(null);

  async function load() {
    const [e, p, a] = await Promise.all([
      getJson<{ events?: NetEvent[] }>("/api/network/events", {}),
      getJson<{ contacts?: Person[] }>("/api/network/contacts", {}),
      getJson<Job[] | { applications?: Job[] }>("/api/applications", []),
    ]);
    setEvents(e.events || []);
    setPeople(p.contacts || []);
    setJobs((Array.isArray(a) ? a : a.applications) || []);
  }
  useEffect(() => {
    void load();
  }, []);

  const today = TODAY();
  const dateOf = (e: NetEvent) => e.starts_at.slice(0, 10);
  const isPast = (e: NetEvent) => dateOf(e) < today;
  const filtered = useMemo(() => events.filter((e) => (placeFilter === "all" || placeOf(e).code === placeFilter) && (kindFilter === "all" || e.kind === kindFilter)), [events, placeFilter, kindFilter]);

  // Each list answers one question: what's new to look at, what am I going to, where did I go, what did I pass on.
  const lists: Record<View, NetEvent[]> = {
    review: filtered.filter((e) => !isPast(e) && e.status === "new"),
    plan: filtered.filter((e) => !isPast(e) && (e.status === "going" || e.status === "maybe")),
    past: filtered.filter((e) => isPast(e) && ["going", "maybe", "went", "missed"].includes(e.status)).reverse(),
    skipped: filtered.filter((e) => e.status === "skipped"),
  };
  const shown = day ? filtered.filter((e) => dateOf(e) === day) : lists[view];
  const toConfirm = events.filter((e) => isPast(e) && (e.status === "going" || e.status === "maybe"));
  const nextUp = events.filter((e) => !isPast(e) && (e.status === "going" || e.status === "maybe")).slice(0, 5);
  const went = events.filter((e) => e.status === "went").length;

  /* ---------- What goes on the calendar ---------- */

  const items = useMemo(() => {
    const list: Item[] = [];
    for (const e of filtered) if (e.status !== "skipped") list.push({ date: e.starts_at.slice(0, 10), time: shortTime(e.starts_at), kind: "event", label: e.title, tone: e.status, ref: e.id, place: placeOf(e).code });
    for (const p of people) {
      if (p.meeting_at) list.push({ date: p.meeting_at.slice(0, 10), time: shortTime(p.meeting_at), kind: "meeting", label: `Chat with ${p.name}`, tone: "meeting", ref: p.id });
      if (p.next_follow_up_at && !["closed", "referred"].includes(p.status)) list.push({ date: p.next_follow_up_at.slice(0, 10), time: "", kind: "followup", label: `Follow up: ${p.name}`, tone: "followup", ref: p.id });
    }
    if (showJobs) for (const j of jobs) if (j.followUpAt && ACTIVE_JOB.has(j.status) && j.status !== "Saved") list.push({ date: j.followUpAt.slice(0, 10), time: "", kind: "job", label: `Check in: ${j.company}`, tone: "job", ref: j.id });
    // Your plans first, then the rest by time.
    const rank = (it: Item) => (it.tone === "going" || it.tone === "went" ? 0 : it.tone === "maybe" ? 1 : it.kind === "event" ? 3 : 2);
    return list.sort((a, b) => a.date.localeCompare(b.date) || rank(a) - rank(b) || a.time.localeCompare(b.time));
  }, [filtered, people, jobs, showJobs]);

  const byDay = useMemo(() => {
    const map = new Map<string, Item[]>();
    for (const it of items) map.set(it.date, [...(map.get(it.date) || []), it]);
    return map;
  }, [items]);

  const grid = useMemo(() => {
    const first = new Date(month);
    const start = new Date(first);
    start.setDate(1 - first.getDay());
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }, [month]);

  /* ---------- Phone calendar: day strip and agenda ---------- */

  const monthKey = ymd(month).slice(0, 7);
  const monthDays = grid.filter((d) => d.getMonth() === month.getMonth());
  const agendaAll = [...byDay.keys()].filter((k) => k.startsWith(monthKey)).sort();
  const agendaDays = !earlier && today.startsWith(monthKey) ? agendaAll.filter((k) => k >= today) : agendaAll;
  const earlierCount = agendaAll.length - agendaDays.length;
  const eventById = useMemo(() => new Map(events.map((e) => [e.id, e])), [events]);

  // Keep the sticky day strip just under the site header, whatever its height.
  useEffect(() => {
    if (!mobile) return;
    const header = document.querySelector(".site-header") as HTMLElement | null;
    const set = () => pageRef.current?.style.setProperty("--hdr", `${header?.offsetHeight || 0}px`);
    set();
    window.addEventListener("resize", set);
    return () => window.removeEventListener("resize", set);
  }, [mobile]);

  // Slide the strip so today (or the 1st) is in view.
  useEffect(() => {
    const el = stripRef.current;
    if (!el) return;
    const target = (el.querySelector(".today") || el.querySelector(".has")) as HTMLElement | null;
    el.scrollLeft = target ? target.offsetLeft - el.clientWidth / 2 + target.offsetWidth / 2 : 0;
  }, [mobile, mview, monthKey]);

  function jumpTo(key: string) {
    setJump(key);
    if (key < today) setEarlier(true);
    // Scroll the page so the day sits just under the sticky strip.
    setTimeout(() => {
      const target = document.getElementById(`ag-${key}`);
      const strip = stripRef.current;
      if (!target || !strip) return;
      const top = target.getBoundingClientRect().top + window.scrollY - strip.getBoundingClientRect().height - (parseFloat(pageRef.current?.style.getPropertyValue("--hdr") || "0") || 0) - 10;
      window.scrollTo({ top, behavior: "smooth" });
    }, 60);
  }
  function shiftMonth(n: number) {
    setMonth(new Date(month.getFullYear(), month.getMonth() + n, 1));
    setEarlier(false);
    setJump("");
  }

  // Short notes about where an event moved fade on their own.
  useEffect(() => {
    if (!note.startsWith("“")) return;
    const t = setTimeout(() => setNote(""), 4000);
    return () => clearTimeout(t);
  }, [note]);

  /* ---------- People queue ---------- */

  const dueFollowUps = people.filter((p) => p.next_follow_up_at && p.next_follow_up_at.slice(0, 10) <= today && ["contacted", "replied"].includes(p.status));
  const toContact = people.filter((p) => p.status === "to contact");
  const jobsWithoutPeople = jobs
    .filter((j) => ACTIVE_JOB.has(j.status))
    .filter((j) => {
      try {
        return !(JSON.parse(j.dossierJson || "{}").contacts?.people || []).length;
      } catch {
        return true;
      }
    })
    .sort((a, b) => (b.fitScore || 0) - (a.fitScore || 0));

  /* ---------- Actions ---------- */

  const [run, setRun] = useState<SearchRun | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!run) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [run]);

  // The search streams one line per step, so the page can show which searches are running and what each found.
  async function findEvents() {
    setBusy("events");
    setError("");
    setNote("");
    setRun({ places: [], steps: [], phase: "starting", startedAt: Date.now() });
    setTimeout(() => document.getElementById("search-progress")?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
    const list = places
      .split(/[,;\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
    type Final = { events?: NetEvent[]; result?: { found: number; added: number; updated: number; dropped: string[]; unconfirmed: number }; places?: string[]; error?: string };
    let data: Final = {};
    let ok = false;
    try {
      const r = await fetch("/api/network/events", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "find", places: list, stream: true }) });
      if (!r.ok || !r.body) {
        data = (await r.json().catch(() => ({}))) as Final;
      } else {
        const reader = r.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() || "";
          for (const line of lines) {
            if (!line.trim()) continue;
            const m = JSON.parse(line) as Record<string, unknown> & { type: string };
            if (m.type === "places") setRun((x) => x && { ...x, places: m.places as string[] });
            else if (m.type === "steps") setRun((x) => x && { ...x, steps: m.steps as Step[], phase: "searching" });
            else if (m.type === "step") setRun((x) => x && { ...x, steps: x.steps.map((st) => (st.id === m.id ? { ...st, state: m.state as Step["state"], count: m.count as number | undefined } : st)) });
            else if (m.type === "check") setRun((x) => x && { ...x, phase: "checking", check: { done: m.done as number, total: m.total as number } });
            else if (m.type === "saving") setRun((x) => x && { ...x, phase: "saving" });
            else if (m.type === "result") ((ok = true), (data = m as Final));
            else if (m.type === "error") data = { error: m.error as string };
          }
        }
      }
    } catch {
      data = { error: "Lost the connection to the app while searching. Events found so far may still have been saved; reload to check." };
    }
    setBusy("");
    setRun(null);
    if (!ok) return setError(data.error || "Couldn’t search for events.");
    setEvents(data.events || []);
    const r = data.result;
    setNote(r ? `${r.added} new ${r.added === 1 ? "event" : "events"} to review in ${(data.places || []).join(", ")}${r.updated ? ` (${r.updated} already listed)` : ""}.` : "");
    setTab("events");
    setDay("");
    setView("review");
  }

  async function patchEvent(e: NetEvent, change: { status?: string; notes?: string }) {
    // Update on screen first so the buttons feel instant.
    setEvents((list) => list.map((x) => (x.id === e.id ? { ...x, ...change } : x)));
    const { ok, data } = await postJson<{ events?: NetEvent[] }>("/api/network/events", { id: e.id, ...change }, "PATCH");
    if (ok && data.events) setEvents(data.events);
  }
  const MOVED: Record<string, string> = { going: "My plan (Going)", maybe: "My plan (Interested)", skipped: "Not interested", new: "To review", went: "Past (Went)", missed: "Past" };
  function setStatus(e: NetEvent, status: string) {
    const next = e.status === status ? (isPast(e) ? "going" : "new") : status;
    void patchEvent(e, { status: next });
    if (!day && (!mobile || mview !== "calendar" || next === "skipped")) setNote(`“${e.title}” moved to ${MOVED[next]}.`);
  }

  async function removeEvent(e: NetEvent) {
    if (!window.confirm(`Remove “${e.title}”?`)) return;
    const r = await fetch(`/api/network/events?id=${encodeURIComponent(e.id)}`, { method: "DELETE" });
    if (r.ok) setEvents(((await r.json()) as { events: NetEvent[] }).events);
  }

  async function findPeople() {
    const targets = jobsWithoutPeople.slice(0, jobCount);
    if (!targets.length) return setNote("Every active job already has people found.");
    setBusy("people");
    setError("");
    for (const [i, j] of targets.entries()) {
      setNote(`Finding people at ${j.company} (${i + 1} of ${targets.length})…`);
      const { ok, data } = await postJson<{ error?: string }>("/api/people", { id: j.id });
      if (!ok) setError(`${j.company}: ${data.error || "couldn’t find people"}`);
    }
    const { data } = await postJson<{ added?: number; contacts?: Person[] }>("/api/network/contacts", { action: "import" });
    setPeople(data.contacts || []);
    setBusy("");
    setNote(`Added ${data.added || 0} people from ${targets.length} ${targets.length === 1 ? "job" : "jobs"}. Each has a drafted message for you to send.`);
    void load();
  }

  async function importFound() {
    const { data } = await postJson<{ added?: number; contacts?: Person[] }>("/api/network/contacts", { action: "import" });
    setPeople(data.contacts || []);
    setNote(`Added ${data.added || 0} people already found on your job pages.`);
  }

  async function updatePerson(p: Person, change: Record<string, string>) {
    const { ok, data } = await postJson<{ contacts?: Person[] }>("/api/network/contacts", { id: p.id, ...change }, "PATCH");
    if (ok) setPeople(data.contacts || []);
  }

  async function removePerson(p: Person) {
    if (!window.confirm(`Remove ${p.name} from your people?`)) return;
    const r = await fetch(`/api/network/contacts?id=${encodeURIComponent(p.id)}`, { method: "DELETE" });
    if (r.ok) setPeople(((await r.json()) as { contacts: Person[] }).contacts);
  }

  const [draft, setDraft] = useState({ title: "", date: "", time: "18:00", city: "", url: "", kind: "meetup" });
  async function addEvent() {
    if (!draft.title || !draft.date) return;
    const { ok, data } = await postJson<{ events?: NetEvent[] }>("/api/network/events", { action: "add", title: draft.title, startsAt: `${draft.date}T${draft.time || "00:00"}`, city: draft.city, url: draft.url, kind: draft.kind });
    if (!ok) return setError(data.error || "Couldn’t add the event.");
    setEvents(data.events || []);
    setDraft({ title: "", date: "", time: "18:00", city: "", url: "", kind: "meetup" });
    setNote("Added to your plan as Going.");
  }

  const [newPerson, setNewPerson] = useState({ name: "", title: "", company: "", link: "", notes: "" });
  async function addPerson() {
    if (!newPerson.name) return;
    const { ok, data } = await postJson<{ contacts?: Person[] }>("/api/network/contacts", { action: "add", ...newPerson });
    if (!ok) return setError(data.error || "Couldn’t add the person.");
    setPeople(data.contacts || []);
    setNewPerson({ name: "", title: "", company: "", link: "", notes: "" });
  }
  /* ---------- Journal: who you met, when and where ---------- */

  const BLANK_MET = { name: "", title: "", company: "", link: "", notes: "", eventId: "", on: "", where: "" };
  const [met, setMet] = useState(BLANK_MET);
  const [elsewhere, setElsewhere] = useState(false);
  const [journalSearch, setJournalSearch] = useState("");
  const [bulk, setBulk] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [bulkRows, setBulkRows] = useState<MetRow[]>([]);
  async function readNotes() {
    setBusy("read");
    setError("");
    const { ok, data } = await postJson<{ people?: MetRow[] }>("/api/network/contacts", { action: "read", text: bulkText });
    setBusy("");
    if (!ok) return setError(data.error || "Couldn’t read the notes.");
    setBulkRows(data.people || []);
    if (!data.people?.length) setNote("Claude didn’t find anyone in those notes.");
  }
  async function saveBulk() {
    const rows = bulkRows.filter((r) => r.name.trim());
    if (!rows.length) return;
    const { ok, data } = await postJson<{ added?: number; contacts?: Person[] }>("/api/network/contacts", { action: "bulk", people: rows, metEventId: met.eventId, metOn: met.on || today, metWhere: met.where });
    if (!ok) return setError(data.error || "Couldn’t save them.");
    setPeople(data.contacts || []);
    setBulkRows([]);
    setBulkText("");
    setNote(`Saved ${data.added} ${data.added === 1 ? "person" : "people"} to your journal.`);
  }
  const editRow = (i: number, change: Partial<MetRow>) => setBulkRows((rows) => rows.map((r, n) => (n === i ? { ...r, ...change } : r)));
  // Events you could have met someone at: the ones you went to or planned to, up to today, newest first.
  const metEventChoices = events.filter((e) => dateOf(e) <= today && ["went", "going", "maybe"].includes(e.status)).reverse();
  function pickMetEvent(id: string) {
    if (id === "other") {
      setElsewhere(true);
      return setMet({ ...met, eventId: "", where: "", on: today });
    }
    setElsewhere(false);
    const e = eventById.get(id);
    setMet({ ...met, eventId: id, on: e ? dateOf(e) : "", where: e ? whereOf(e) || e.city : "" });
  }
  function focusMetForm() {
    setTimeout(() => {
      document.getElementById("met-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
      document.getElementById("met-name")?.focus({ preventScroll: true });
    }, 60);
  }
  async function logMet() {
    if (!met.name.trim()) return;
    const { ok, data } = await postJson<{ contacts?: Person[] }>("/api/network/contacts", {
      action: "add",
      name: met.name,
      title: met.title,
      company: met.company,
      link: met.link,
      notes: met.notes,
      metEventId: met.eventId,
      metOn: met.on || today,
      metWhere: met.where,
    });
    if (!ok) return setError(data.error || "Couldn’t save the person.");
    setPeople(data.contacts || []);
    // Keep the place and date, so logging several people from one night is quick.
    setMet({ ...BLANK_MET, eventId: met.eventId, on: met.on, where: met.where });
    setNote(`Saved ${met.name.trim()} to your journal.`);
    setTimeout(() => document.getElementById("met-name")?.focus(), 30);
  }
  function metAt(e: NetEvent) {
    setElsewhere(false);
    setMet({ ...BLANK_MET, eventId: e.id, on: dateOf(e), where: whereOf(e) || e.city });
    setTab("journal");
    focusMetForm();
  }
  const metPeople = people.filter((p) => p.met_on || p.met_event_id || p.met_where);
  const metAtEvent = (id: string) => metPeople.filter((p) => p.met_event_id === id);
  const journal = useMemo(() => {
    const q = journalSearch.trim().toLowerCase();
    const list = q ? metPeople.filter((p) => [p.name, p.title, p.company, p.notes, p.met_where, eventById.get(p.met_event_id)?.title || ""].join(" ").toLowerCase().includes(q)) : metPeople;
    const groups = new Map<string, { key: string; date: string; title: string; where: string; place: { code: string; label: string }; event?: NetEvent; people: Person[] }>();
    for (const p of list) {
      const ev = p.met_event_id ? eventById.get(p.met_event_id) : undefined;
      const date = p.met_on || (ev ? ev.starts_at.slice(0, 10) : (p.created_at || "").slice(0, 10));
      const key = ev ? ev.id : `${date}|${p.met_where.toLowerCase()}`;
      if (!groups.has(key)) {
        const where = ev ? whereOf(ev) || p.met_where : p.met_where;
        groups.set(key, { key, date, title: ev ? ev.title : p.met_where || "Place not noted", where, place: ev ? placeOf(ev) : placeOf({ city: where }), event: ev, people: [] });
      }
      groups.get(key)!.people.push(p);
    }
    return [...groups.values()].sort((a, b) => b.date.localeCompare(a.date));
  }, [metPeople, journalSearch, eventById]);
  const initials = (name: string) =>
    name
      .split(/\s+/)
      .map((w) => w[0])
      .slice(0, 2)
      .join("")
      .toUpperCase();

  function pickDay(key: string) {
    setDay(day === key ? "" : key);
    setTimeout(() => listRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }
  function openEvent(id: string, date: string) {
    setDay(date);
    setOpen(id);
    setTimeout(() => document.getElementById(`ev-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 60);
  }

  const shownPeople = people.filter((p) => peopleFilter === "all" || p.status === peopleFilter);
  const upcomingAll = events.filter((e) => !isPast(e) && e.status !== "skipped");
  const placeCodes = [...new Set(events.map((e) => placeOf(e).code))];
  const kindCodes = [...new Set(events.map((e) => e.kind).filter(Boolean))].sort();
  const VIEWS: { key: View; label: string; hint: string }[] = [
    { key: "review", label: "To review", hint: "New events you haven’t decided on" },
    { key: "plan", label: "My plan", hint: "Going and interested" },
    { key: "past", label: "Past", hint: "Events you planned to go to" },
    { key: "skipped", label: "Not interested", hint: "Hidden from the calendar" },
  ];

  /* ---------- One event, collapsed or opened ---------- */

  function eventRow(e: NetEvent) {
    const d = local(e.starts_at);
    const place = placeOf(e);
    const past = isPast(e);
    const expanded = open === e.id;
    const choices = past
      ? ([
          ["went", "I went", Check],
          ["missed", "Didn’t go", X],
        ] as const)
      : ([
          ["going", "Going", Check],
          ["maybe", "Interested", Star],
          ["skipped", "Not interested", X],
        ] as const);
    return (
      <article key={e.id} id={`ev-${e.id}`} className={`nw-ev s-${e.status} ${expanded ? "open" : ""}`}>
        <div className="nw-ev-row">
          <button className="nw-ev-main" onClick={() => setOpen(expanded ? "" : e.id)} aria-expanded={expanded}>
            <span className="nw-date">
              <span>{d?.toLocaleDateString([], { weekday: "short" })}</span>
              <strong>{d?.getDate()}</strong>
              <span>{d?.toLocaleDateString([], { month: "short" })}</span>
            </span>
            <span className="nw-ev-text">
              <span className="nw-ev-title">{e.title}</span>
              <span className="nw-ev-meta">
                <span className={`nw-dot p-${place.code}`} aria-hidden />
                <b>{place.label}</b>
                {timeOf(e.starts_at) && <span>{timeOf(e.starts_at)}</span>}
                <span>{kindOf(e.kind)}</span>
                {e.cost && <span>{e.cost.length > 24 ? "Paid, see details" : e.cost}</span>}
              </span>
            </span>
            <ChevronDown className="nw-chev" aria-hidden />
          </button>
          <div className="nw-choice" role="group" aria-label={`Your plan for ${e.title}`}>
            {choices.map(([key, label, Icon]) => (
              <button key={key} className={`c-${key}`} aria-pressed={e.status === key} onClick={() => setStatus(e, key)}>
                <Icon aria-hidden /> <span>{label}</span>
              </button>
            ))}
          </div>
        </div>
        {expanded && (
          <div className="nw-ev-body">
            {e.summary && <p className="nw-ev-summary">{e.summary}</p>}
            <dl className="nw-facts">
              <div>
                <dt>Where</dt>
                <dd>
                  {whereOf(e) || "Not listed"}
                  {whereOf(e) && place.code !== "WEB" && (
                    <a href={mapLink(e)} target="_blank" rel="noreferrer">
                      Map <ExternalLink aria-hidden />
                    </a>
                  )}
                </dd>
              </div>
              <div>
                <dt>When</dt>
                <dd>
                  {niceDate(e.starts_at)}
                  {timeOf(e.starts_at) && `, ${timeOf(e.starts_at)}`}
                  {e.ends_at && timeOf(e.ends_at) && e.ends_at.slice(0, 10) === dateOf(e) && ` to ${timeOf(e.ends_at)}`}
                </dd>
              </div>
              {e.organizer && (
                <div>
                  <dt>Host</dt>
                  <dd>{e.organizer}</dd>
                </div>
              )}
              <div>
                <dt>Cost</dt>
                <dd>{e.cost || "Not listed"}</dd>
              </div>
            </dl>
            <div className="nw-ev-actions">
              {e.url && (
                <a className="button primary" href={e.url} target="_blank" rel="noreferrer">
                  Open event page <ExternalLink aria-hidden />
                </a>
              )}
              {!past && (
                <>
                  <a className="button" href={googleLink(e)} target="_blank" rel="noreferrer">
                    <CalendarPlus aria-hidden /> Google Calendar
                  </a>
                  <button className="button" onClick={() => downloadIcs(e)}>
                    <Download aria-hidden /> Calendar file
                  </button>
                </>
              )}
              <button className="nw-text-btn danger" onClick={() => removeEvent(e)}>
                <Trash2 aria-hidden /> Remove
              </button>
            </div>
            {(e.status === "went" || e.status === "going") && (
              <div className="nw-ev-notes">
                <label htmlFor={`notes-${e.id}`}>{e.status === "went" ? "Who did you meet? What should you follow up on?" : "Notes for the day (who to look for, what to ask)"}</label>
                <textarea id={`notes-${e.id}`} className="nw-input" defaultValue={e.notes} onBlur={(x) => x.target.value !== e.notes && patchEvent(e, { notes: x.target.value })} />
                {e.status === "went" && metAtEvent(e.id).length > 0 && (
                  <p className="nw-met-here">
                    You met {metAtEvent(e.id).map((p) => p.name).join(", ")} here.{" "}
                    <button className="nw-text-btn" onClick={() => setTab("journal")}>
                      Open journal
                    </button>
                  </p>
                )}
                {e.status === "went" && (
                  <button className="button" onClick={() => metAt(e)}>
                    <UserPlus aria-hidden /> Log someone you met here
                  </button>
                )}
              </div>
            )}
            <p className="nw-fine">{e.source === "manual" ? "You added this event." : e.verified ? "Confirmed on its event page." : "Couldn’t open the event page to confirm it. Check the link before you go."}</p>
          </div>
        )}
      </article>
    );
  }

  /* ---------- Shared pieces ---------- */

  const filterSelects = (
    <>
      <select className="nw-input" value={placeFilter} onChange={(e) => setPlaceFilter(e.target.value)} aria-label="Where">
        <option value="all">All places</option>
        {PLACES.filter((p) => placeCodes.includes(p.code)).map((p) => (
          <option key={p.code} value={p.code}>
            {p.label}
          </option>
        ))}
        {placeCodes.includes("OTHER") && <option value="OTHER">Other places</option>}
      </select>
      <select className="nw-input" value={kindFilter} onChange={(e) => setKindFilter(e.target.value)} aria-label="Type">
        <option value="all">All types</option>
        {kindCodes.map((k) => (
          <option key={k} value={k}>
            {kindOf(k)}
          </option>
        ))}
      </select>
    </>
  );

  const confirmPanel = toConfirm.length > 0 && (
    <section className="nw-card nw-confirm" aria-label="Did you go?">
      <h2>Did you go?</h2>
      {toConfirm.map((e) => (
        <div className="nw-q" key={e.id}>
          <span>
            <b>{e.title}</b>
            <small>{niceDate(e.starts_at)}</small>
          </span>
          <span className="nw-q-btns">
            <button className="nw-mini yes" onClick={() => patchEvent(e, { status: "went" })}>
              <Check aria-hidden /> Went
            </button>
            <button className="nw-mini" onClick={() => patchEvent(e, { status: "missed" })}>
              No
            </button>
          </span>
        </div>
      ))}
    </section>
  );

  const emptyText = (v: View) =>
    v === "review"
      ? upcomingAll.length
        ? "You’ve decided on every event. Search again to find more."
        : "No events yet. Search below and the app will look on Meetup, Luma, Eventbrite and organisers’ sites."
      : v === "plan"
        ? "No plans yet. Mark events Going or Interested in “To review”."
        : v === "past"
          ? "Events you planned to go to show up here afterwards, so you can mark if you went and note who you met."
          : "Nothing hidden.";

  const moreTools = (
    <div className="nw-more-tools">
      <details className="nw-card">
        <summary>
          <Sparkles aria-hidden /> Find more events
        </summary>
        <div className="nw-form">
          <input className="nw-input grow" placeholder="Places, comma separated (blank = your job-search places and online)" value={places} onChange={(e) => setPlaces(e.target.value)} aria-label="Places to search" />
          <button className="button primary" onClick={findEvents} disabled={busy !== ""}>
            {busy === "events" ? <LoaderCircle className="spin" aria-hidden /> : <Sparkles aria-hidden />} Search
          </button>
        </div>
      </details>
      <details className="nw-card">
        <summary>
          <Plus aria-hidden /> Add an event yourself
        </summary>
        <div className="nw-form">
          <input className="nw-input grow" placeholder="Event name" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          <input className="nw-input" type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} aria-label="Date" />
          <input className="nw-input" type="time" value={draft.time} onChange={(e) => setDraft({ ...draft, time: e.target.value })} aria-label="Time" />
          <input className="nw-input" placeholder="City" value={draft.city} onChange={(e) => setDraft({ ...draft, city: e.target.value })} />
          <select className="nw-input" value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value })} aria-label="Type">
            {Object.keys(KIND_LABEL).map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
          <input className="nw-input" placeholder="Link (optional)" value={draft.url} onChange={(e) => setDraft({ ...draft, url: e.target.value })} />
          <button className="button" onClick={addEvent} disabled={!draft.title || !draft.date}>
            <Plus aria-hidden /> Add
          </button>
        </div>
      </details>
    </div>
  );

  /* ---------- Phone layout ---------- */

  const nextMonthName = new Date(month.getFullYear(), month.getMonth() + 1, 1).toLocaleDateString([], { month: "long" });
  const mobileEvents = (
    <div className="nwm">
      {confirmPanel}
      <div className="nwm-views" role="tablist" aria-label="Which events">
        <button role="tab" aria-selected={mview === "calendar"} onClick={() => setMview("calendar")}>
          Calendar
        </button>
        {VIEWS.map((v) => (
          <button key={v.key} role="tab" aria-selected={mview === v.key} onClick={() => setMview(v.key)}>
            {v.label} <span>{lists[v.key].length}</span>
          </button>
        ))}
      </div>

      {mview === "calendar" ? (
        <>
          <div className="nwm-month">
            <button className="nw-icon" aria-label="Previous month" onClick={() => shiftMonth(-1)}>
              <ChevronLeft />
            </button>
            <h2>{month.toLocaleDateString([], { month: "long", year: "numeric" })}</h2>
            <button className="nw-icon" aria-label="Next month" onClick={() => shiftMonth(1)}>
              <ChevronRight />
            </button>
            {!today.startsWith(monthKey) && (
              <button
                className="nw-today"
                onClick={() => {
                  const d = new Date();
                  setMonth(new Date(d.getFullYear(), d.getMonth(), 1));
                  setEarlier(false);
                }}
              >
                Today
              </button>
            )}
          </div>
          <div className="nwm-strip" ref={stripRef} aria-label="Jump to a day">
            {monthDays.map((d) => {
              const key = ymd(d);
              const list = byDay.get(key) || [];
              return (
                <button key={key} className={`${list.length ? "has" : ""} ${key === today ? "today" : ""} ${key === jump ? "sel" : ""} ${key < today ? "past" : ""}`} disabled={!list.length} onClick={() => jumpTo(key)} aria-label={`${d.toDateString()}: ${list.length ? `${list.length} ${list.length === 1 ? "thing" : "things"}` : "nothing"}`}>
                  <span>{d.toLocaleDateString([], { weekday: "narrow" })}</span>
                  <strong>{d.getDate()}</strong>
                  <i>
                    {list.slice(0, 3).map((it, n) => (
                      <em key={n} className={`d-${it.kind === "event" ? it.tone : "people"}`} />
                    ))}
                  </i>
                </button>
              );
            })}
          </div>
          <div className="nwm-filters">{filterSelects}</div>
          <div className="nwm-key" aria-hidden>
            <span>
              <em className="d-going" /> Going
            </span>
            <span>
              <em className="d-maybe" /> Interested
            </span>
            <span>
              <em className="d-new" /> Not decided
            </span>
            <span>
              <em className="d-people" /> People
            </span>
          </div>

          {earlierCount > 0 && (
            <button className="nwm-earlier" onClick={() => setEarlier(true)}>
              Show {earlierCount} earlier {earlierCount === 1 ? "day" : "days"} this month
            </button>
          )}
          {agendaDays.length === 0 ? (
            <div className="nw-empty">
              <p>Nothing {earlierCount ? "else " : ""}on the calendar in {month.toLocaleDateString([], { month: "long" })}.</p>
            </div>
          ) : (
            agendaDays.map((key) => {
              const list = byDay.get(key) || [];
              return (
                <section key={key} id={`ag-${key}`} className={`nwm-day ${key === today ? "today" : ""} ${key === jump ? "hit" : ""}`}>
                  <h3>
                    {local(key)?.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" })}
                    {key === today && <span className="nwm-tag">Today</span>}
                  </h3>
                  {list.map((it) => {
                    const ev = it.kind === "event" ? eventById.get(it.ref) : undefined;
                    if (ev) return eventRow(ev);
                    return (
                      <button key={`${it.kind}-${it.ref}`} className={`nwm-other t-${it.tone}`} onClick={() => it.kind !== "job" && setTab("people")}>
                        {it.time && <b>{it.time}</b>} {it.label}
                        {it.kind !== "job" && <ChevronRight aria-hidden />}
                      </button>
                    );
                  })}
                </section>
              );
            })
          )}
          <button className="nwm-next" onClick={() => (shiftMonth(1), window.scrollTo({ top: 0, behavior: "smooth" }))}>
            See {nextMonthName} <ChevronRight aria-hidden />
          </button>
          <label className="nw-toggle nwm-jobs">
            <input type="checkbox" checked={showJobs} onChange={(e) => setShowJobs(e.target.checked)} /> Show job check-ins on the calendar
          </label>
        </>
      ) : (
        <>
          <p className="nwm-hint">{VIEWS.find((v) => v.key === mview)?.hint}</p>
          <div className="nwm-filters">{filterSelects}</div>
          {lists[mview].length === 0 ? (
            <div className="nw-empty">
              <p>{emptyText(mview)}</p>
            </div>
          ) : (
            <div className="nw-ev-list">{lists[mview].map((e) => eventRow(e))}</div>
          )}
        </>
      )}
      {moreTools}
    </div>
  );

  /* ---------- Journal view ---------- */

  const journalView = (
    <section className="nw-journal" aria-label="Journal">
      <div className="nw-card nw-met-form" id="met-form">
        <div className="nw-met-head">
          <h2>
            <UserPlus aria-hidden /> {bulk ? "Log several people at once" : "Log someone you met"}
          </h2>
          <div className="nw-seg" role="tablist" aria-label="How many people">
            <button role="tab" aria-selected={!bulk} onClick={() => setBulk(false)}>
              One person
            </button>
            <button role="tab" aria-selected={bulk} onClick={() => setBulk(true)}>
              Several at once
            </button>
          </div>
        </div>
        <div className="nw-met-grid">
          <label className="wide">
            Where you met
            <select className="nw-input" value={met.eventId || (elsewhere ? "other" : "")} onChange={(e) => pickMetEvent(e.target.value)}>
              <option value="">Pick an event…</option>
              {metEventChoices.map((e) => (
                <option key={e.id} value={e.id}>
                  {niceDate(e.starts_at)} · {e.title}
                </option>
              ))}
              <option value="other">Somewhere else (coffee, class, a friend’s party…)</option>
            </select>
          </label>
          {elsewhere && (
            <>
              <label>
                Place
                <input className="nw-input" placeholder="e.g. Commonplace Coffee, Squirrel Hill" value={met.where} onChange={(e) => setMet({ ...met, where: e.target.value })} />
              </label>
              <label>
                Date
                <input className="nw-input" type="date" value={met.on} onChange={(e) => setMet({ ...met, on: e.target.value })} />
              </label>
            </>
          )}
          {bulk ? (
            <>
              <label className="wide">
                Paste your notes
                <textarea
                  className="nw-input nw-bulk-text"
                  placeholder={"One person per line, like:\nMaya Chen, UX lead at Duolingo - talked about design systems\nSam, PM, Aurora - wants my portfolio link\n\nOr paste messy notes and let Claude sort them out."}
                  value={bulkText}
                  onChange={(e) => setBulkText(e.target.value)}
                />
              </label>
              <div className="wide nw-bulk-btns">
                <button className="button" onClick={() => setBulkRows(splitPeople(bulkText))} disabled={!bulkText.trim()}>
                  Split into people
                </button>
                <button className="button" onClick={readNotes} disabled={!bulkText.trim() || busy !== ""}>
                  {busy === "read" ? <LoaderCircle className="spin" aria-hidden /> : <Sparkles aria-hidden />} Let Claude read messy notes
                </button>
              </div>
              {bulkRows.length > 0 && (
                <div className="wide nw-bulk-preview">
                  <p className="nw-muted">Check these before saving. Fix anything that’s wrong.</p>
                  {bulkRows.map((r, i) => (
                    <div className="nw-bulk-row" key={i}>
                      <input className="nw-input" placeholder="Name" value={r.name} onChange={(e) => editRow(i, { name: e.target.value })} aria-label="Name" />
                      <input className="nw-input" placeholder="What they do" value={r.title} onChange={(e) => editRow(i, { title: e.target.value })} aria-label="What they do" />
                      <input className="nw-input" placeholder="Company" value={r.company} onChange={(e) => editRow(i, { company: e.target.value })} aria-label="Company" />
                      <input className="nw-input notes" placeholder="What to remember" value={r.notes} onChange={(e) => editRow(i, { notes: e.target.value })} aria-label="What to remember" />
                      <button className="nw-icon" onClick={() => setBulkRows((rows) => rows.filter((_, n) => n !== i))} aria-label={`Drop ${r.name || "this row"}`}>
                        <X />
                      </button>
                    </div>
                  ))}
                  <button className="nw-text-btn" onClick={() => setBulkRows([...bulkRows, { name: "", title: "", company: "", link: "", notes: "" }])}>
                    <Plus aria-hidden /> Add a row
                  </button>
                </div>
              )}
            </>
          ) : (
            <>
          <label>
            Name
            <input id="met-name" className="nw-input" placeholder="Who did you meet?" value={met.name} onChange={(e) => setMet({ ...met, name: e.target.value })} />
          </label>
          <label>
            What they do
            <input className="nw-input" placeholder="e.g. Senior product designer" value={met.title} onChange={(e) => setMet({ ...met, title: e.target.value })} />
          </label>
          <label>
            Company
            <input className="nw-input" placeholder="Where they work" value={met.company} onChange={(e) => setMet({ ...met, company: e.target.value })} />
          </label>
          <label>
            LinkedIn or website
            <input className="nw-input" placeholder="Optional" value={met.link} onChange={(e) => setMet({ ...met, link: e.target.value })} />
          </label>
          <label className="wide">
            What to remember
            <textarea className="nw-input" placeholder="What you talked about, how you’ll recognise them, anything you said you’d send…" value={met.notes} onChange={(e) => setMet({ ...met, notes: e.target.value })} />
          </label>
            </>
          )}
        </div>
        <div className="nw-met-actions">
          {bulk ? (
            <button className="button primary" onClick={saveBulk} disabled={!bulkRows.some((r) => r.name.trim())}>
              <Plus aria-hidden /> Save {bulkRows.filter((r) => r.name.trim()).length || ""} to journal
            </button>
          ) : (
            <button className="button primary" onClick={logMet} disabled={!met.name.trim()}>
              <Plus aria-hidden /> Save to journal
            </button>
          )}
          <span className="nw-muted">They’re added to People too, so you can follow up.</span>
        </div>
      </div>

      <div className="nw-journal-head">
        <h2>
          {metPeople.length} {metPeople.length === 1 ? "person" : "people"} met
        </h2>
        <label className="nw-search">
          <Search aria-hidden />
          <input placeholder="Search names, companies, notes" value={journalSearch} onChange={(e) => setJournalSearch(e.target.value)} aria-label="Search your journal" />
        </label>
      </div>

      {journal.length === 0 ? (
        <div className="nw-empty">
          <p>{metPeople.length ? "No one matches that search." : "No one yet. After an event, log the people you talked to here, so you remember who, when and where."}</p>
        </div>
      ) : (
        <ol className="nw-timeline">
          {journal.map((g) => {
            const d = local(g.date);
            return (
              <li key={g.key} className="nw-entry">
                <div className="nw-entry-date">
                  <span>{d?.toLocaleDateString([], { weekday: "short" })}</span>
                  <strong>{d?.getDate()}</strong>
                  <span>{d?.toLocaleDateString([], d && d.getFullYear() !== new Date().getFullYear() ? { month: "short", year: "numeric" } : { month: "short" })}</span>
                </div>
                <div className="nw-card nw-entry-body">
                  <div className="nw-entry-top">
                    <div>
                      <h3>{g.title}</h3>
                      <p className="nw-entry-where">
                        <span className={`nw-dot p-${g.place.code}`} aria-hidden />
                        {g.where || g.place.label}
                        {g.event && timeOf(g.event.starts_at) && ` · ${timeOf(g.event.starts_at)}`}
                      </p>
                    </div>
                    {g.event?.url && (
                      <a className="nw-text-btn" href={g.event.url} target="_blank" rel="noreferrer">
                        Event page <ExternalLink aria-hidden />
                      </a>
                    )}
                  </div>
                  {g.event?.notes && <p className="nw-entry-note">{g.event.notes}</p>}
                  <ul className="nw-met-list">
                    {g.people.map((p) => {
                      const link = channels(p).find((c) => /^https?:\/\//.test(c.value));
                      return (
                        <li key={p.id} className="nw-met">
                          <span className="nw-avatar" aria-hidden>
                            {initials(p.name)}
                          </span>
                          <div className="nw-met-text">
                            <div className="nw-met-name">
                              <b>{p.name}</b>
                              {link && (
                                <a href={link.value} target="_blank" rel="noreferrer" aria-label={`${p.name}’s profile`}>
                                  <ExternalLink aria-hidden />
                                </a>
                              )}
                            </div>
                            {(p.title || p.company) && <span className="nw-muted">{[p.title, p.company].filter(Boolean).join(" at ")}</span>}
                            <textarea className="nw-input nw-met-notes" placeholder="What to remember about them" defaultValue={p.notes} onBlur={(e) => e.target.value !== p.notes && updatePerson(p, { notes: e.target.value })} aria-label={`Notes on ${p.name}`} />
                            <div className="nw-met-ctl">
                              <select value={p.status} onChange={(e) => updatePerson(p, { status: e.target.value })} aria-label={`Where things stand with ${p.name}`}>
                                {STATUSES.map((st) => (
                                  <option key={st} value={st}>
                                    {st === "to contact" ? "Haven’t followed up" : st[0].toUpperCase() + st.slice(1)}
                                  </option>
                                ))}
                              </select>
                              <button className="nw-text-btn danger" onClick={() => removePerson(p)}>
                                <Trash2 aria-hidden /> Remove
                              </button>
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                  <button
                    className="nw-text-btn"
                    onClick={() => {
                      if (g.event) return metAt(g.event);
                      setElsewhere(true);
                      setMet({ ...BLANK_MET, on: g.date, where: g.where });
                      focusMetForm();
                    }}
                  >
                    <Plus aria-hidden /> Someone else from here
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );


  return (
    <>
      <SiteHeader current="network" />
      <main className="nw-page" ref={pageRef}>
        <div className="nw-head">
          <div>
            <h1>Networking</h1>
            <p className="nw-sub">Find events, decide which to go to, and keep track of the people you meet.</p>
          </div>
          <div className="nw-tabs" role="tablist">
            <button role="tab" aria-selected={tab === "events"} onClick={() => setTab("events")}>
              Events
            </button>
            <button role="tab" aria-selected={tab === "people"} onClick={() => setTab("people")}>
              People{toContact.length + dueFollowUps.length ? <span className="nw-count">{toContact.length + dueFollowUps.length}</span> : null}
            </button>
            <button role="tab" aria-selected={tab === "journal"} onClick={() => setTab("journal")}>
              Journal
            </button>
          </div>
        </div>
        {(note || error) && (
          <div className="nw-notes">
            {note && (
              <p className="nw-note" role="status">
                {note}
                <button className="nw-x" onClick={() => setNote("")} aria-label="Dismiss">
                  <X aria-hidden />
                </button>
              </p>
            )}
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
          </div>
        )}

        {run && tab === "events" && (
          <section className="nw-card nw-progress" id="search-progress" aria-live="polite" aria-label="Search progress">
            {(() => {
              const total = run.steps.length;
              const finished = run.steps.filter((st) => st.state === "done" || st.state === "failed").length;
              const foundSoFar = run.steps.reduce((n, st) => n + (st.count || 0), 0);
              // Searching is most of the wait; page checks and saving are the last stretch.
              const share = run.phase === "starting" ? 0.02 : run.phase === "searching" ? 0.05 + 0.8 * (total ? finished / total : 0) : run.phase === "checking" ? 0.85 + 0.13 * (run.check?.total ? run.check.done / run.check.total : 0) : 0.99;
              return (
                <>
                  <div className="nw-progress-top">
                    <LoaderCircle className="spin" aria-hidden />
                    <div>
                      <h2>
                        {run.phase === "starting"
                          ? "Starting the search…"
                          : run.phase === "searching"
                            ? `Searching: ${finished} of ${total} done`
                            : run.phase === "checking"
                              ? `Opening event pages to confirm them: ${run.check?.done || 0} of ${run.check?.total || 0}`
                              : "Saving what’s new…"}
                      </h2>
                      <p className="nw-muted">
                        {clock(now - run.startedAt)} so far{foundSoFar ? ` · ${foundSoFar} possible events found` : ""}. Usually 5 to 15 minutes. Keep this tab open; you can use the rest of the page meanwhile.
                      </p>
                    </div>
                  </div>
                  <div className="nw-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(share * 100)}>
                    <span style={{ width: `${Math.max(2, share * 100)}%` }} />
                  </div>
                  {run.steps.length > 0 && (
                    <ul className="nw-steps">
                      {run.steps.map((st) => (
                        <li key={st.id} className={`st-${st.state}`}>
                          {st.state === "running" ? <LoaderCircle className="spin" aria-hidden /> : st.state === "done" ? <Check aria-hidden /> : st.state === "failed" ? <X aria-hidden /> : <span className="nw-step-dot" aria-hidden />}
                          <span>{st.label}</span>
                          <small>{st.state === "running" ? "searching…" : st.state === "done" ? `${st.count || 0} found` : st.state === "failed" ? "didn’t finish, skipped" : "waiting"}</small>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              );
            })()}
          </section>
        )}

        {tab === "events" && mobile ? (
          mobileEvents
        ) : tab === "events" ? (
          <>
            <div className="nw-grid">
              {/* ---------- Calendar ---------- */}
              <section className="nw-card nw-cal" aria-label="Calendar">
                <div className="nw-cal-bar">
                  <button className="nw-icon" aria-label="Previous month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>
                    <ChevronLeft />
                  </button>
                  <h2>{month.toLocaleDateString([], { month: "long", year: "numeric" })}</h2>
                  <button className="nw-icon" aria-label="Next month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>
                    <ChevronRight />
                  </button>
                  <button
                    className="nw-today"
                    onClick={() => {
                      const d = new Date();
                      setMonth(new Date(d.getFullYear(), d.getMonth(), 1));
                    }}
                  >
                    Today
                  </button>
                  <label className="nw-toggle">
                    <input type="checkbox" checked={showJobs} onChange={(e) => setShowJobs(e.target.checked)} /> Job check-ins
                  </label>
                </div>
                <div className="nw-week" aria-hidden>
                  {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                    <span key={d}>{d}</span>
                  ))}
                </div>
                <div className="nw-days">
                  {grid.map((d) => {
                    const key = ymd(d);
                    const list = byDay.get(key) || [];
                    const outside = d.getMonth() !== month.getMonth();
                    return (
                      <div key={key} className={`nw-day ${outside ? "out" : ""} ${key < today ? "past" : ""} ${key === today ? "today" : ""} ${key === day ? "sel" : ""}`}>
                        <button className="nw-num" onClick={() => pickDay(key)} aria-label={`${d.toDateString()}: ${list.length ? `${list.length} things` : "nothing"}. Show this day.`}>
                          {d.getDate()}
                        </button>
                        {list.slice(0, 3).map((it, i) =>
                          it.kind === "event" ? (
                            <button key={i} className={`nw-chip t-${it.tone} p-${it.place}`} onClick={() => openEvent(it.ref, key)} title={`${it.label} (${STATUS_LABEL[it.tone] || ""})`}>
                              {it.tone === "going" || it.tone === "went" ? <Check aria-hidden /> : it.tone === "maybe" ? <Star aria-hidden /> : null}
                              {it.time && <b>{it.time}</b>} {it.label}
                            </button>
                          ) : (
                            <button
                              key={i}
                              className={`nw-chip t-${it.tone}`}
                              title={it.label}
                              onClick={() => {
                                if (it.kind !== "job") {
                                  setTab("people");
                                }
                              }}
                            >
                              {it.time && <b>{it.time}</b>} {it.label}
                            </button>
                          ),
                        )}
                        {list.length > 3 && (
                          <button className="nw-more" onClick={() => pickDay(key)}>
                            +{list.length - 3} more
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
                <div className="nw-legend">
                  <span>
                    <i className="lg-going" /> Going
                  </span>
                  <span>
                    <i className="lg-maybe" /> Interested
                  </span>
                  <span>
                    <i className="lg-new" /> Not decided
                  </span>
                  <span>
                    <i className="lg-people" /> Chats and follow-ups
                  </span>
                  <span className="nw-legend-places">
                    {PLACES.map((p) => (
                      <span key={p.code}>
                        <i className={`nw-dot p-${p.code}`} /> {p.label}
                      </span>
                    ))}
                  </span>
                </div>
              </section>

              {/* ---------- Your plan ---------- */}
              <aside className="nw-side">
                {toConfirm.length > 0 && (
                  <section className="nw-card nw-confirm" aria-label="Did you go?">
                    <h2>Did you go?</h2>
                    {toConfirm.map((e) => (
                      <div className="nw-q" key={e.id}>
                        <span>
                          <b>{e.title}</b>
                          <small>{niceDate(e.starts_at)}</small>
                        </span>
                        <span className="nw-q-btns">
                          <button className="nw-mini yes" onClick={() => patchEvent(e, { status: "went" })}>
                            <Check aria-hidden /> Went
                          </button>
                          <button className="nw-mini" onClick={() => patchEvent(e, { status: "missed" })}>
                            No
                          </button>
                        </span>
                      </div>
                    ))}
                  </section>
                )}
                <section className="nw-card" aria-label="Your plan">
                  <h2>Coming up</h2>
                  {nextUp.length === 0 ? (
                    <p className="nw-muted">
                      Nothing planned yet. Mark events <b>Going</b> or <b>Interested</b> in “To review” below.
                    </p>
                  ) : (
                    nextUp.map((e) => (
                      <button key={e.id} className="nw-plan" onClick={() => openEvent(e.id, dateOf(e))}>
                        <span className={`nw-plan-status s-${e.status}`}>{e.status === "going" ? <Check aria-hidden /> : <Star aria-hidden />}</span>
                        <span>
                          <b>{e.title}</b>
                          <small>
                            {niceDate(e.starts_at)}
                            {timeOf(e.starts_at) && ` · ${timeOf(e.starts_at)}`} · {placeOf(e).label}
                          </small>
                        </span>
                      </button>
                    ))
                  )}
                  <div className="nw-stats">
                    <button onClick={() => (setDay(""), setView("review"))}>
                      <strong>{lists.review.length}</strong> to review
                    </button>
                    <button onClick={() => (setDay(""), setView("plan"))}>
                      <strong>{events.filter((e) => !isPast(e) && e.status === "going").length}</strong> going
                    </button>
                    <button onClick={() => (setDay(""), setView("past"))}>
                      <strong>{went}</strong> attended
                    </button>
                  </div>
                </section>
                {(dueFollowUps.length > 0 || toContact.length > 0) && (
                  <section className="nw-card" aria-label="People to reach">
                    <h2>People</h2>
                    {dueFollowUps.length > 0 && (
                      <p className="nw-muted">
                        <b>{dueFollowUps.length}</b> follow-up{dueFollowUps.length === 1 ? "" : "s"} due
                      </p>
                    )}
                    {toContact.length > 0 && (
                      <p className="nw-muted">
                        <b>{toContact.length}</b> drafted {toContact.length === 1 ? "message" : "messages"} to send
                      </p>
                    )}
                    <button className="button" onClick={() => setTab("people")}>
                      Open people
                    </button>
                  </section>
                )}
              </aside>
            </div>

            {/* ---------- Event list ---------- */}
            <section className="nw-events" ref={listRef} aria-label="Events">
              <div className="nw-list-head">
                {day ? (
                  <div className="nw-dayhead">
                    <h2>{local(day)?.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}</h2>
                    <button className="nw-text-btn" onClick={() => setDay("")}>
                      <X aria-hidden /> Back to all events
                    </button>
                  </div>
                ) : (
                  <div className="nw-views" role="tablist" aria-label="Which events">
                    {VIEWS.map((v) => (
                      <button key={v.key} role="tab" aria-selected={view === v.key} title={v.hint} onClick={() => setView(v.key)}>
                        {v.label} <span>{lists[v.key].length}</span>
                      </button>
                    ))}
                  </div>
                )}
                <div className="nw-filter-row">
                  <select className="nw-input" value={placeFilter} onChange={(e) => setPlaceFilter(e.target.value)} aria-label="Where">
                    <option value="all">All places</option>
                    {PLACES.filter((p) => placeCodes.includes(p.code)).map((p) => (
                      <option key={p.code} value={p.code}>
                        {p.label}
                      </option>
                    ))}
                    {placeCodes.includes("OTHER") && <option value="OTHER">Other places</option>}
                  </select>
                  <select className="nw-input" value={kindFilter} onChange={(e) => setKindFilter(e.target.value)} aria-label="Type">
                    <option value="all">All types</option>
                    {kindCodes.map((k) => (
                      <option key={k} value={k}>
                        {kindOf(k)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {shown.length === 0 ? (
                <div className="nw-empty">
                  {day ? (
                    <p>No events on this day{placeFilter !== "all" || kindFilter !== "all" ? " with these filters" : ""}.</p>
                  ) : view === "review" ? (
                    <p>{upcomingAll.length ? "You’ve decided on every event. Search again to find more." : "No events yet. Search below and the app will look on Meetup, Luma, Eventbrite and organisers’ sites."}</p>
                  ) : view === "plan" ? (
                    <p>No plans yet. Mark events Going or Interested in “To review”.</p>
                  ) : view === "past" ? (
                    <p>Events you planned to go to show up here afterwards, so you can mark if you went and note who you met.</p>
                  ) : (
                    <p>Nothing hidden.</p>
                  )}
                </div>
              ) : (
                <div className="nw-ev-list">
                  {shown.map((e) => eventRow(e))}
                </div>
              )}

              {moreTools}
            </section>
          </>
        ) : tab === "journal" ? (
          journalView
        ) : (
          <section className="nw-list" aria-label="People">
            <div className="nw-card nw-people-find">
              <span>Find the hiring manager, recruiter and designers at your top jobs, each with a drafted message.</span>
              <span className="nw-form">
                <select className="nw-input" value={jobCount} onChange={(e) => setJobCount(Number(e.target.value))} aria-label="How many jobs">
                  {[1, 3, 5, 10].map((n) => (
                    <option key={n} value={n}>
                      {n} {n === 1 ? "job" : "jobs"}
                    </option>
                  ))}
                </select>
                <button className="button primary" onClick={findPeople} disabled={busy !== "" || !jobsWithoutPeople.length}>
                  {busy === "people" ? <LoaderCircle className="spin" aria-hidden /> : <Sparkles aria-hidden />} Find people
                </button>
              </span>
            </div>
            <div className="nw-views">
              {["all", ...STATUSES].map((s) => (
                <button key={s} role="tab" aria-selected={peopleFilter === s} onClick={() => setPeopleFilter(s)}>
                  {s === "all" ? "Everyone" : s[0].toUpperCase() + s.slice(1)} <span>{s === "all" ? people.length : people.filter((p) => p.status === s).length}</span>
                </button>
              ))}
              <button className="nw-text-btn" onClick={importFound}>
                Bring in people found on job pages
              </button>
            </div>
            {shownPeople.length === 0 && <p className="nw-muted">No one here yet.</p>}
            {shownPeople.map((p) => {
              const job = jobs.find((j) => j.id === p.application_id);
              return (
                <article key={p.id} className="nw-card nw-person">
                  <div className="nw-person-top">
                    <div>
                      <h3>{p.name}</h3>
                      <p className="nw-muted">
                        {[p.title, p.company].filter(Boolean).join(" · ")} {p.role && p.role !== "other" && <span className="nw-badge">{p.role}</span>}
                        {job && <span className="nw-muted"> · for {job.role}</span>}
                      </p>
                    </div>
                    <div className="nw-person-ctl">
                      <select value={p.status} onChange={(e) => updatePerson(p, { status: e.target.value })} aria-label={`Status for ${p.name}`}>
                        {STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {s[0].toUpperCase() + s.slice(1)}
                          </option>
                        ))}
                      </select>
                      <button className="nw-icon" onClick={() => removePerson(p)} aria-label={`Remove ${p.name}`}>
                        <X />
                      </button>
                    </div>
                  </div>
                  <div className="nw-channels">
                    {channels(p).map((c, i) => (
                      <span key={i} className="nw-channel">
                        {/^https?:\/\//.test(c.value) ? (
                          <a href={c.value} target="_blank" rel="noreferrer">
                            {c.label || c.kind} <ExternalLink aria-hidden />
                          </a>
                        ) : (
                          <>
                            {c.label || c.kind}: {c.value}
                          </>
                        )}
                        {c.note && <i> ({c.note})</i>}
                      </span>
                    ))}
                    {p.found_at && /^https?:/.test(p.found_at) && (
                      <a className="nw-channel" href={p.found_at} target="_blank" rel="noreferrer">
                        Where they were found <ExternalLink aria-hidden />
                      </a>
                    )}
                  </div>
                  {p.message && (
                    <div className="nw-message">
                      <p>{p.message}</p>
                      <button
                        className="nw-mini"
                        onClick={() => {
                          void navigator.clipboard?.writeText(p.message);
                          setNote(`Copied the message for ${p.name}. Send it yourself, then mark them “Contacted”.`);
                        }}
                      >
                        <Copy aria-hidden /> Copy message
                      </button>
                    </div>
                  )}
                  <div className="nw-dates">
                    <label>
                      Follow up on
                      <input type="date" value={p.next_follow_up_at.slice(0, 10)} onChange={(e) => updatePerson(p, { nextFollowUpAt: e.target.value })} />
                    </label>
                    <label>
                      Chat booked for
                      <input type="datetime-local" value={p.meeting_at.slice(0, 16)} onChange={(e) => updatePerson(p, { meetingAt: e.target.value })} />
                    </label>
                    {p.last_contact_at && <span className="nw-muted">Last contact {niceDate(p.last_contact_at)}</span>}
                    {p.next_follow_up_at && p.next_follow_up_at.slice(0, 10) <= today && ["contacted", "replied"].includes(p.status) && (
                      <button className="nw-mini yes" onClick={() => updatePerson(p, { lastContactAt: TODAY(), nextFollowUpAt: plusDays(7) })}>
                        <Check aria-hidden /> Followed up
                      </button>
                    )}
                  </div>
                  <textarea className="nw-input nw-notesbox" placeholder="Notes: where you met, what you talked about" defaultValue={p.notes} onBlur={(e) => e.target.value !== p.notes && updatePerson(p, { notes: e.target.value })} aria-label={`Notes on ${p.name}`} />
                </article>
              );
            })}
            <div className="nw-card nw-add" id="add-person">
              <h3>Add someone you met</h3>
              <div className="nw-form">
                <input className="nw-input" placeholder="Name" value={newPerson.name} onChange={(e) => setNewPerson({ ...newPerson, name: e.target.value })} />
                <input className="nw-input" placeholder="Title" value={newPerson.title} onChange={(e) => setNewPerson({ ...newPerson, title: e.target.value })} />
                <input className="nw-input" placeholder="Company" value={newPerson.company} onChange={(e) => setNewPerson({ ...newPerson, company: e.target.value })} />
                <input className="nw-input" placeholder="LinkedIn or website" value={newPerson.link} onChange={(e) => setNewPerson({ ...newPerson, link: e.target.value })} />
                <input className="nw-input grow" placeholder="Notes" value={newPerson.notes} onChange={(e) => setNewPerson({ ...newPerson, notes: e.target.value })} />
                <button className="button" onClick={addPerson} disabled={!newPerson.name}>
                  <Plus aria-hidden /> Add
                </button>
              </div>
            </div>
          </section>
        )}
      </main>
    </>
  );
}
