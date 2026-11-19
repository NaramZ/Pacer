"use client";
/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Application, matchScore } from "./jobs";
import "./track.css";

// The home page's track: the whole search on one timeline, with a playhead on today.
// Left of the playhead is what happened; right of it is what's coming.

export type TrackEvent = { id: string; title: string; starts_at: string; city: string; venue: string; status: string };

type Range = 2 | 4 | 8;
type Tone = "sent" | "due" | "coming" | "went" | "going" | "reply";
type Chip = { key: string; day: number; label: string; title: string; tone: Tone; ids: string[]; names: string[]; href?: string };
type Lane = { name: string; count: string; chips: Chip[]; empty: React.ReactNode };

const DAY = 86_400_000;
const WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];
const word = (n: number) => WORDS[n] || String(n);
const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);
const REPLIED = ["Screen", "Interview", "Final", "Offer", "Rejected"];

function toDate(iso: string) {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}
function iso(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const monthDay = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
const weekday = (d: Date) => `${d.toLocaleDateString("en-US", { weekday: "short" })} ${d.getDate()}`;
const daysBetween = (a: string, b: string) => Math.round((toDate(b).getTime() - toDate(a).getTime()) / DAY);

export function useToday() {
  const [today, setToday] = useState("");
  useEffect(() => setToday(iso(new Date())), []);
  return today;
}

/* ---------- What's due ---------- */

export function followUpsDue(apps: Application[], today: string) {
  return apps.filter((a) => a.status === "Applied" && a.followUpAt && a.followUpAt <= today).sort((a, b) => a.followUpAt.localeCompare(b.followUpAt));
}
const marked = (e: TrackEvent) => ["going", "maybe", "went"].includes(e.status);

export function trackHeadline(apps: Application[], events: TrackEvent[], today: string) {
  if (!today) return "";
  const due = followUpsDue(apps, today).length;
  const weekOut = iso(new Date(toDate(today).getTime() + 7 * DAY));
  const soon = events.filter((e) => ["going", "maybe"].includes(e.status) && e.starts_at.slice(0, 10) >= today && e.starts_at.slice(0, 10) <= weekOut).length;
  const parts: string[] = [];
  if (due) parts.push(`${word(due).toLowerCase()} ${plural(due, "follow-up")} due`);
  if (soon) parts.push(`${word(soon).toLowerCase()} ${plural(soon, "event")} this week`);
  if (parts.length) {
    const s = parts.join(", ");
    return `${s[0].toUpperCase()}${s.slice(1)}.`;
  }
  const saved = apps.filter((a) => a.status === "Saved").length;
  if (saved) return `Nothing due. ${word(saved)} saved ${plural(saved, "job")} waiting.`;
  return apps.length ? "Nothing due today." : "Nothing on the track yet.";
}

/* ---------- The track ---------- */

export function Track({ apps, events, today, onOpen }: { apps: Application[]; events: TrackEvent[]; today: string; onOpen: (id: string) => void }) {
  const [range, setRange] = useState<Range>(4);
  const [open, setOpen] = useState("");
  const [width, setWidth] = useState(900);
  const lanesRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // The track starts on the Sunday a week (two weeks for the 8-week view) before this one.
  const { start, days, todayAt } = useMemo(() => {
    const t = toDate(today || iso(new Date()));
    const sunday = new Date(t.getTime() - t.getDay() * DAY);
    const back = range === 8 ? 2 : range === 2 ? 0 : 1;
    const first = new Date(sunday.getTime() - back * 7 * DAY);
    const n = range * 7;
    return { start: iso(first), days: n, todayAt: daysBetween(iso(first), iso(t)) };
  }, [today, range]);

  useLayoutEffect(() => {
    const el = lanesRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // On a narrow screen the track scrolls sideways; start with today in view.
  useEffect(() => {
    const el = scrollRef.current;
    const row = lanesRef.current;
    const name = el?.querySelector<HTMLElement>(".tk-name");
    if (!el || !row || !name || el.scrollWidth <= el.clientWidth) return;
    const x = row.getBoundingClientRect().left - el.getBoundingClientRect().left + el.scrollLeft + (todayAt / days) * row.clientWidth;
    el.scrollLeft = Math.max(0, x - name.offsetWidth - 72);
  }, [todayAt, days, width]);

  useEffect(() => {
    if (!open) return;
    const close = (e: KeyboardEvent | MouseEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !(e.target as HTMLElement).closest(".tk-chip-wrap")) setOpen("");
    };
    window.addEventListener("keydown", close);
    window.addEventListener("click", close);
    return () => {
      window.removeEventListener("keydown", close);
      window.removeEventListener("click", close);
    };
  }, [open]);

  const lanes = useMemo<Lane[]>(() => {
    if (!today) return [];
    const at = (d: string) => daysBetween(start, d);
    const inside = (d: number) => d >= 0 && d < days;
    const group = (rows: { day: number; id: string; name: string; full: string }[]) => {
      const by = new Map<number, { id: string; name: string; full: string }[]>();
      rows.forEach((r) => by.set(r.day, [...(by.get(r.day) || []), r]));
      return [...by.entries()].sort((a, b) => a[0] - b[0]);
    };
    const dateText = (d: number) => monthDay(new Date(toDate(start).getTime() + d * DAY));

    const sent = apps.filter((a) => a.status !== "Saved" && a.appliedAt);
    const sentChips: Chip[] = group(sent.map((a) => ({ day: at(a.appliedAt), id: a.id, name: a.company, full: `${a.company}, ${a.role}` })).filter((r) => inside(r.day))).map(([day, rows]) => ({
      key: `s${day}`,
      day,
      label: rows.length === 1 ? rows[0].name : `${rows.length} jobs`,
      title: `Applied ${dateText(day)}: ${rows.map((r) => r.name).join(", ")}`,
      tone: "sent",
      ids: rows.map((r) => r.id),
      names: rows.map((r) => r.full),
    }));

    const waiting = apps.filter((a) => a.status === "Applied" && a.followUpAt);
    const due = waiting.filter((a) => a.followUpAt <= today);
    // A follow-up that was due before the track starts sits at its left edge.
    const fuChips: Chip[] = group(waiting.map((a) => ({ day: Math.max(0, at(a.followUpAt)), id: a.id, name: a.company, full: `${a.company}, ${a.role}` })).filter((r) => inside(r.day))).map(([day, rows]) => {
      const late = todayAt - day;
      const when = late > 0 ? `${late} ${plural(late, "day")} late` : late === 0 ? "today" : dateText(day);
      const tone: Tone = late >= 0 ? "due" : "coming";
      return {
        key: `f${day}`,
        day,
        label: rows.length === 1 ? `${rows[0].name}, ${when}` : `${rows.length} follow-ups, ${when}`,
        title: `Follow up ${late > 0 ? `(was due ${dateText(day)})` : late === 0 ? "today" : `on ${dateText(day)}`}: ${rows.map((r) => r.name).join(", ")}`,
        tone,
        ids: rows.map((r) => r.id),
        names: rows.map((r) => r.full),
      };
    });

    const mine = events.filter(marked);
    const evChips: Chip[] = mine
      .map((e) => ({ e, day: at(e.starts_at.slice(0, 10)) }))
      .filter((x) => inside(x.day))
      .map(({ e, day }) => {
        const went = e.status === "went" || e.starts_at.slice(0, 10) < today;
        const short = e.title.split(/[(:|–—]/)[0].trim();
        return {
          key: `e${e.id}`,
          day,
          label: `${short.length > 30 ? `${short.slice(0, 28).trim()}…` : short}${e.status === "went" ? ", went" : e.status === "maybe" ? ", maybe" : ""}`,
          title: `${e.title}, ${weekday(toDate(e.starts_at))}${e.city ? `, ${e.city}` : ""}`,
          tone: went ? "went" : "going",
          ids: [],
          names: [],
          href: e.status === "went" ? "/network?tab=journal" : "/network",
        } satisfies Chip;
      });

    const replied = apps.filter((a) => REPLIED.includes(a.status));
    const replyChips: Chip[] = group(replied.map((a) => ({ day: at(a.updatedAt || a.appliedAt), id: a.id, name: a.company, full: `${a.company}, ${a.role}` })).filter((r) => inside(r.day))).map(([day, rows]) => ({
      key: `r${day}`,
      day,
      label: rows.length === 1 ? rows[0].name : `${rows.length} replies`,
      title: `Heard back ${dateText(day)}: ${rows.map((r) => r.name).join(", ")}`,
      tone: "reply",
      ids: rows.map((r) => r.id),
      names: rows.map((r) => r.full),
    }));

    const ahead = mine.filter((e) => e.starts_at.slice(0, 10) >= today).length;
    const went = mine.length - ahead;
    const found = events.length - mine.length;
    return [
      { name: "Applications", count: `${sent.length} sent`, chips: sentChips, empty: <>Nothing sent in these weeks. Saved jobs are listed below.</> },
      { name: "Follow-ups", count: `${due.length} due, ${waiting.length - due.length} coming`, chips: fuChips, empty: <>Follow-ups show up a week after you apply.</> },
      {
        name: "Events",
        count: `${went} went, ${ahead} ahead`,
        chips: evChips,
        empty: (
          <>
            {found ? `${found} events found. ` : ""}
            <Link href="/network">Mark the ones you’re going to</Link> and they land here.
          </>
        ),
      },
      { name: "Replies", count: `${replied.length} so far`, chips: replyChips, empty: <>No replies yet. Following up is the best way to get one.</> },
    ];
  }, [apps, events, today, start, days, todayAt]);

  // Chips sit at their date; ones that would overlap drop to the next row.
  const placed = useMemo(
    () =>
      lanes.map((lane) => {
        const ends: number[] = [];
        const chips = lane.chips.map((c) => {
          const x = (c.day / days) * width;
          const w = c.label.length * 7.4 + 30;
          let row = ends.findIndex((end) => end <= x);
          if (row < 0) row = ends.length < 3 ? ends.length : ends.indexOf(Math.min(...ends));
          ends[row] = x + w;
          return { ...c, row, flip: x + w > width };
        });
        return { ...lane, chips, rows: Math.max(1, ends.length) };
      }),
    [lanes, days, width],
  );

  const weeks = Array.from({ length: range }, (_, i) => ({ at: (i * 7) / days, label: monthDay(new Date(toDate(start).getTime() + i * 7 * DAY)) }));
  const pct = (d: number) => `${((d / days) * 100).toFixed(3)}%`;
  const minWidth = range === 2 ? 620 : range === 4 ? 860 : 1300;

  return (
    <section className="tk" aria-labelledby="tk-title">
      <div className="tk-bar">
        <h2 id="tk-title" className="tk-h2">
          {range} weeks, from {monthDay(toDate(start))}
        </h2>
        <div className="tk-range" role="group" aria-label="How much of the track to show">
          {([2, 4, 8] as Range[]).map((r) => (
            <button key={r} aria-pressed={range === r} onClick={() => setRange(r)}>
              {r} weeks
            </button>
          ))}
        </div>
      </div>
      <div className="tk-scroll" ref={scrollRef}>
        <div className="tk-grid" style={{ minWidth }}>
          <span className="tk-corner" />
          <div className="tk-weeks" aria-hidden>
            {weeks.map((w) => (
              <span key={w.label} style={{ left: `${(w.at * 100).toFixed(3)}%` }}>
                {w.label}
              </span>
            ))}
          </div>
          {placed.map((lane, li) => (
            <div className="tk-lane" key={lane.name}>
              <div className="tk-name">
                <b>{lane.name}</b>
                <span>{lane.count}</span>
              </div>
              <div className="tk-row" ref={li === 0 ? lanesRef : undefined} style={{ minHeight: lane.rows * 40 + 24 }}>
                {weeks.slice(1).map((w) => (
                  <span key={w.label} className="tk-tick" style={{ left: `${(w.at * 100).toFixed(3)}%` }} aria-hidden />
                ))}
                {lane.chips.length === 0 && (
                  <p className="tk-empty" style={{ left: pct(Math.max(0, Math.min(todayAt, days - 10))) }}>
                    {lane.empty}
                  </p>
                )}
                {lane.chips.map((c) => (
                  <div key={c.key} className={`tk-chip-wrap${c.flip ? " flip" : ""}`} style={{ left: pct(c.day), top: 12 + c.row * 40, zIndex: open === c.key ? 5 : 2 }}>
                    {c.href ? (
                      <Link className={`tk-chip t-${c.tone}`} href={c.href} title={c.title}>
                        {c.label}
                      </Link>
                    ) : (
                      <button
                        className={`tk-chip t-${c.tone}`}
                        title={c.title}
                        aria-expanded={c.ids.length > 1 ? open === c.key : undefined}
                        onClick={() => (c.ids.length > 1 ? setOpen(open === c.key ? "" : c.key) : onOpen(c.ids[0]))}
                      >
                        {c.label}
                      </button>
                    )}
                    {open === c.key && (
                      <ul className="tk-pop">
                        {c.ids.map((id, i) => (
                          <li key={id}>
                            <button
                              onClick={() => {
                                setOpen("");
                                onOpen(id);
                              }}
                            >
                              {c.names[i]}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
          <div className="tk-headwrap" aria-hidden>
            {todayAt >= 0 && todayAt < days && (
              <span className="tk-head" style={{ left: pct(todayAt + 0.5) }}>
                <span>Today, {weekday(toDate(today))}</span>
              </span>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------- Below the track ---------- */

export function OnThePlayhead({ apps, events, today, onOpen }: { apps: Application[]; events: TrackEvent[]; today: string; onOpen: (id: string) => void }) {
  if (!today) return null;
  const items: { key: string; tag: string; tone: Tone; title: string; sub: string; action: React.ReactNode }[] = [];
  followUpsDue(apps, today).forEach((a) => {
    const late = daysBetween(a.followUpAt, today);
    items.push({
      key: a.id,
      tag: "Follow-up",
      tone: "due",
      title: `${a.company}, ${a.role}`,
      sub: late ? `Was due ${monthDay(toDate(a.followUpAt))}, ${late} ${plural(late, "day")} ago.` : "Due today.",
      action: (
        <button className="tk-act" onClick={() => onOpen(a.id)}>
          Open job
        </button>
      ),
    });
  });
  events
    .filter((e) => {
      const gap = daysBetween(e.starts_at.slice(0, 10), today);
      return (e.status === "went" && gap >= 0 && gap <= 3) || (e.status === "going" && gap <= 0 && gap >= -1);
    })
    .forEach((e) => {
      const gap = daysBetween(e.starts_at.slice(0, 10), today);
      const when = gap === 0 ? "today" : gap === 1 ? "yesterday" : gap === -1 ? "tomorrow" : weekday(toDate(e.starts_at));
      const went = e.status === "went";
      items.push({
        key: e.id,
        tag: "Event",
        tone: "going",
        title: `${e.title.split(/[(:|]/)[0].trim()}, ${when}`,
        sub: went ? "You went. Log who you met while it’s fresh." : [e.venue, e.city].filter(Boolean).join(", ") || "You’re going.",
        action: (
          <Link className="tk-act" href={went ? "/network?tab=journal" : "/network"}>
            {went ? "Log people" : "See event"}
          </Link>
        ),
      });
    });

  return (
    <div className="tk-col" aria-labelledby="tk-today">
      <h2 id="tk-today" className="tk-h2 big">
        On the playhead
      </h2>
      {items.length === 0 ? (
        <p className="tk-note">Nothing due today. Apply to a saved job to put it on the track.</p>
      ) : (
        <ul className="tk-todo">
          {items.slice(0, 6).map((t) => (
            <li key={t.key}>
              <span className={`tk-tag t-${t.tone}`}>{t.tag}</span>
              <span className="tk-todo-text">
                <b>{t.title}</b>
                <span>{t.sub}</span>
              </span>
              {t.action}
            </li>
          ))}
        </ul>
      )}
      {items.length > 6 && <p className="tk-note">{items.length - 6} more are on the track above.</p>}
    </div>
  );
}

export function WaitingList({ apps, onOpen, onShowAll }: { apps: Application[]; onOpen: (id: string) => void; onShowAll: () => void }) {
  const saved = apps
    .filter((a) => a.status === "Saved")
    .map((a) => ({ a, fit: matchScore(a) }))
    .sort((x, y) => (y.fit ?? -1) - (x.fit ?? -1));
  return (
    <div className="tk-col" aria-labelledby="tk-queue">
      <h2 id="tk-queue" className="tk-h2 big">
        Waiting to go on the track
      </h2>
      {saved.length === 0 ? (
        <p className="tk-note">No saved jobs. Paste a link above or browse Find jobs.</p>
      ) : (
        <>
          <ul className="tk-queue">
            {saved.slice(0, 6).map(({ a, fit }) => (
              <li key={a.id}>
                <button onClick={() => onOpen(a.id)}>
                  <span className="tk-q-name">
                    <b>{a.company}</b> <span>{a.role}</span>
                  </span>
                  <span className="tk-q-fit">
                    {fit === null ? (
                      <span className="visually-hidden">No match score yet</span>
                    ) : (
                      <>
                        {fit}
                        <small>%</small>
                        <span className="visually-hidden"> match</span>
                      </>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <p className="tk-note">
            Saved jobs, best match first. Applying puts them on the track.{" "}
            {saved.length > 6 && (
              <button className="text-button inline" onClick={onShowAll}>
                See all {saved.length} saved
              </button>
            )}
          </p>
        </>
      )}
    </div>
  );
}
