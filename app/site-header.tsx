"use client";
import { ReactNode, useEffect, useRef } from "react";
import Link from "next/link";
import { ClaudeStatus } from "./claude-status";
import { TaskTray } from "./task-tray";

export function SiteHeader({ current, children }: { current: "jobs" | "find" | "resume" | "network"; children?: ReactNode }) {
  const nav = useRef<HTMLElement>(null);
  // On a phone the menu scrolls sideways; keep the current page in view.
  useEffect(() => {
    const el = nav.current;
    const here = el?.querySelector<HTMLElement>('[aria-current="page"]');
    if (el && here && el.scrollWidth > el.clientWidth) el.scrollLeft += here.getBoundingClientRect().left - el.getBoundingClientRect().left - (el.clientWidth - here.offsetWidth) / 2;
  }, [current]);
  return (
    <header className="site-header">
      <div className="container header-row">
        <Link className="wordmark" href="/" aria-label="Pacer home">
          pacer
        </Link>
        <nav className="main-nav" aria-label="Main" ref={nav}>
          <Link href="/" aria-current={current === "jobs" ? "page" : undefined}>
            My jobs
          </Link>
          <Link href="/find" aria-current={current === "find" ? "page" : undefined}>
            Find jobs
          </Link>
          <Link href="/resume" aria-current={current === "resume" ? "page" : undefined}>
            Resume editor
          </Link>
          <Link href="/network" aria-current={current === "network" ? "page" : undefined}>
            Networking
          </Link>
        </nav>
        <div className="header-actions">
          <TaskTray />
          <ClaudeStatus />
          {children}
        </div>
      </div>
    </header>
  );
}
