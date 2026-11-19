# Pacer

A free job search assistant that runs on your own computer. Paste a job and see how well your resume fits, get a tailored resume and cover letter, find jobs at companies you follow, keep track of every application and follow-up, and log the people you meet. Your resume and job history stay on your computer: there's no account and no server.

Pacer was built for a product designer's search. Everything works for any profession, but finding networking events and finding people at a company are tuned for design roles.

## Get started

You need [Node.js](https://nodejs.org) 22.13 or newer (the LTS download is fine) and about 1 GB of disk space.

1. Download Pacer: **Code → Download ZIP** on GitHub and unzip it, or `git clone` it.
2. Open a terminal in the Pacer folder and install it (once):

   ```
   npx pnpm@11.25.0 install
   ```

3. Start it:

   ```
   npm start
   ```

4. Open http://localhost:5173 and add your resume.

Next time, just run `npm start`. To stop Pacer, press Ctrl+C in the terminal. After downloading a newer version, run the install step again.

### AI features (optional)

Without AI, Pacer still tracks your jobs, finds jobs on public job boards, ranks them with a free word match, edits your resume and keeps your networking notes. For tailored documents, Claude's read of each job, pay research, event search and people search, pick one:

- **Your Claude plan (Pro or Max).** Install [Claude Code](https://claude.com/claude-code), run `claude auth login` once, then set up the browser helper below and keep it running. AI work counts toward your plan's usage limits instead of costing extra.
- **An Anthropic API key.** Create one at [console.anthropic.com](https://console.anthropic.com), paste it in Profile, and choose "My API key" in Autopilot. You pay Anthropic per use; Pacer shows what you've spent and stops at the monthly limit you set in Profile ($5 to start).

### Browser extension (optional)

Fills in application forms from your profile. In Chrome, Edge or Brave, open the extensions page, turn on Developer mode, choose **Load unpacked** and pick the `extension` folder. Then in Pacer open Profile → Browser extension → Create connection code, and paste the code into the extension.

## Privacy

Pacer holds people's resumes and job history, so it's built to keep them on this computer:

- The server only listens on localhost, and `proxy.ts` refuses any request whose Host isn't localhost (blocks DNS rebinding), any cross-site write, and any non-JSON API write (blocks CSRF).
- A strict Content Security Policy stops the page from loading or sending anything to another site. Fonts are bundled; there are no analytics or trackers.
- Resumes are read in the browser; the database lives in `.wrangler/` and is never committed.
- The browser helper keeps its own profile in `.helper/`, separate from your normal browser, and only talks to the app on localhost.
- The only outbound requests are: fetching a job listing you paste, reading public job boards for companies you follow, and — only if you add your own API key — sending the resume and job text to Anthropic.

## Browser helper (Autopilot)

`helper/` is a small program that runs next to the app and does the applying. It needs an Anthropic API key (for filling in forms).

1. `npm run helper:setup` — once; downloads the Chromium build it drives (~360 MB on disk, kept in Playwright's cache).
2. In the app, open Autopilot → Create connection code, then `npm run helper -- pair <code>`.
3. `npm run helper`, and press Start in Autopilot.

It checks followed companies for new jobs (free), checks your fit, then opens each application in its own visible browser window and fills it in with Claude, reading pages as text rather than screenshots to keep cost down. **It never presses the final submit button**: it stops with a summary, you check the form and submit it yourself, and it records the application once the employer's confirmation page appears. When an employer needs an account first (every Workday application does), it pauses with “Sign in needed”: you sign in or create the account yourself in the helper's window, and it carries on once you're through. Its browser remembers the sign-in, and it never reads, types or reports passwords. It stops at CAPTCHAs, identity checks, assessments and questions it can't answer from your profile, and only uploads the resume and cover letter it generated. It paces itself like an unhurried person and works through one application at a time, within your daily limit.

**Auto-submit (optional, off by default).** In Autopilot → “When a form is ready”, choose “Submit for me while I’m away” and the helper runs unattended: it submits only when every required answer came from the profile, resume or saved answers, sets aside anything it can't answer and any sign-in walls, and keeps a record of each submission — every field and value, drafted answers, the documents used, the confirmation link (shown on the job in My jobs) and full-page screenshots of the form and confirmation (in `.helper/records/`). Daily and monthly spending limits still apply.

**Claude in Chrome (for Claude Pro/Max subscribers).** Turn it on in Profile to get “Apply with Claude in Chrome” on each job: it copies a brief (details, saved answers, tailored resume and cover letter) and opens the application, so Claude in Chrome fills it on the subscription while you watch. Subscriptions can't power the unattended helper; that uses the API key.

The helper keeps its connection code, its own browser profile and the generated PDFs in `.helper/` (never committed), and only talks to the app on localhost.

## Scripts

- `npm start` — set up or update the database, then start the app on port 5173
- `npm run dev` — start the app without touching the database
- `npm run build` — production build
- `npm run db:generate` — generate a migration after changing `db/schema.ts`
- `npm run db:migrate` — apply migrations in `drizzle/` to the local database
- `npm run helper:setup` / `npm run helper` — set up and run the browser helper

## How it's built

- Next.js App Router on Cloudflare Workers via [vinext](https://github.com/cloudflare/vinext); local D1 (SQLite) database via Drizzle. Config lives in `wrangler.jsonc`.
- UI: `app/page.tsx` (home + job list), `app/job-sheet.tsx` (job details), `app/automation-panel.tsx` (Autopilot), `app/ui.tsx` (accessible dialog and tabs), `app/globals.css` (design tokens, light and dark).
- Profile (`app/profile-panel.tsx`, `app/api/profile`): each person adds their resume once. PDF and Word files are read in the browser (`app/resume-import.ts`), so nothing is uploaded. PDFs are read by where text sits on the page, and uploads are checked for text stored out of reading order (which some ATS read jumbled) with a warning and how to fix it. Links are saved with names (LinkedIn, Portfolio…) so each lands in the right form field.
- Find jobs (`app/find/page.tsx`, `app/lib/job-boards.ts`, `app/lib/feed.ts`): people follow companies by pasting a careers page or job board link. The app reads their public Greenhouse, Lever, Ashby, Workday, Workable, SmartRecruiters, BambooHR or Recruitee boards (free, no account; large Workday and SmartRecruiters boards are searched by the person's job titles). Following “Workable jobs” searches every Workable-hosted employer at once, in each place the person wants, which is the best way to reach small local companies, keeps postings that fit the person's titles, places and skipped words, and ranks them with the free matcher. Closed postings drop out on each check. The page adds search, filters (company, work type, posted date) and sorting.
- Salary (`app/lib/salary.ts`): worked out per job — the posted range if there is one (free), otherwise, only when an application form actually asks (about 4% do) or the person presses the button, Claude Haiku searches for the company's pay data (pitched higher) or the market range for the role and area — then pitched by experience level and never below the person's minimum. Shown on each job and used on forms.
- Saved answers (`app/answers.ts`): in Profile, people answer the questions most applications ask (work authorization, sponsorship, salary, start date, relocation, voluntary demographic questions, plus their own). The helper uses them instead of stopping to ask; anything left as “Ask me each time” is flagged for the person.
- Job analysis and documents (`app/lib/job-analysis.ts`) have two modes:
  - **Free** (no API key): a word-overlap match between the job and the resume that works for any profession, plus the resume as-is and a cover letter outline.
  - Scores come from per-requirement verdicts weighted by importance (`app/scoring.ts`); each job shows the full breakdown. "Strong" requires evidence stated in the resume itself.
  - Tailored documents use STAR-shaped bullets and stories and lean on what the person asks to emphasize (Profile → "What should your resume and cover letter emphasize?"). They are written by Sonnet 5.5 and then checked twice: in code (role lines, order, sections, numbers, first-person letter; `app/doc-check.ts`) and by a separate Claude fact check against the original resume. One fix round; anything still unconfirmed is shown as a warning.
  - People worth knowing (`app/lib/people.ts`): on request, Claude searches for the likely hiring manager, recruiter and peers with free ways to reach them (published links, documented email format — guesses labelled), plus fact-checked message drafts. About 17¢ per search, so it only runs when the person asks.
  - **Claude** (with the person's own API key, saved in Profile or `.dev.vars`): one Haiku 4.5 call reads the job against the resume (about 1.5¢), and Sonnet 5.5 writes the tailored resume and cover letter (about 4¢ with its fact check). Both use structured output and are told never to invent experience.

## Using your Claude subscription (default)

Autopilot → Which Claude to use → **My Claude subscription** (the default) reads jobs, writes documents and fact-checks them, and fills applications with Claude Code on your computer, signed in to your Claude plan, instead of the API: no per-token cost, it counts toward your plan's usage limits. Run `claude auth login` once in Terminal (choose your Claude account). The helper serves its browser tools to Claude Code as a local MCP server on 127.0.0.1 with a one-time key (`helper/claude-code.ts`), runs `claude -p` with only those tools (no file, shell or web tools) and without `ANTHROPIC_API_KEY` in its environment, and applies the same kill switches to every tool call. For reading jobs and writing documents, the running helper also serves Claude Code to the app on 127.0.0.1 (`serveClaudeBridge`, registered through `/api/runner/bridge`; the app only accepts a 127.0.0.1 address) and `writerFor` in `app/lib/claude.ts` uses it, with structured output via `--json-schema` and no tools. When the helper isn't running, those two fall back to the API key and say so; form filling never falls back on its own. Salary research and finding people use Claude Code's own web search on your plan too (`search` in `AskRequest`), and the API's web search otherwise. "My API key" is the other choice.

## Browser extension (Vivaldi, Chrome, Edge, Brave)

For jobs you find yourself. On a job's page, click the Pacer icon:

1. **Prepare this job** reads the page, checks your fit and writes the tailored resume and cover letter in the app (a background task; the panel can close). An application-only page (Lever's /apply, Ashby's /application) reads the posting itself.
2. **Fill this application** fills the form in one pass, no browser agent: contact details and links from Profile, the two PDFs uploaded, your saved answers, and one Claude call for the form's own questions (`/api/ext/answers`). Custom dropdowns (react-select and the like) are picked through the page's own component (`extension/react-pick.js`, run in the page's context) because they ignore scripted typing; values match the form's wording ("US", "Pittsburgh, Pennsylvania, United States"). Required fields still empty are outlined in yellow.
3. You check it and press Submit, then **I submitted it** marks it Applied in My jobs.

Setup: `vivaldi://extensions` → Developer mode → Load unpacked → the `extension` folder; then Profile → Browser extension → Create connection code, and paste it into the extension. The extension talks only to this app on this computer; its endpoints (`/api/ext/*`) need that code, and the dev server allows only this extension's fixed ID (from the `key` in `extension/manifest.json`, listed in `next.config.ts`).

## Claude usage and cost

All Claude calls go through `claudeFor` in `app/lib/claude.ts`, using the person's own key. Every call's real cost (from the token counts Anthropic returns) is recorded in `ai_usage`, and a monthly limit ($5 by default, set in Profile) stops Claude calls once reached: reading jobs and writing documents fall back to the free versions, and Autopilot pauses. Profile and Autopilot show spending this month. Web search fees ($10 per 1,000 searches) are counted too. To keep form filling cheap, Claude fills several fields per step, `form_input` picks options in custom dropdowns and type-to-search boxes in one step, and old page reads are only cleared past 50k tokens and at least 20k at a time (clearing breaks the prompt cache). Autopilot also has kill switches, checked before every Claude step: **Stop** takes effect mid-application; each application has its own spending cap ($0.75 by default, set in Autopilot); and the helper stops any application that repeats the same actions 3 times in 6 steps, spends 8 steps in a row only reading the page, runs past 15 minutes of work, or passes 45 steps. A stopped application is marked "Needs you" with the reason, and nothing more is spent on it. Everything is tuned to keep cost low for people who are out of work; only the steps needed to apply run automatically:

| Step | Model | Runs | About |
|---|---|---|---|
| Read and score the job | `claude-haiku-4-5` | every job Autopilot considers | 1.5¢ |
| Resume and cover letter | `claude-sonnet-5-5` writes and fact-checks | jobs that pass the minimum fit | 5¢ (10¢ when the check sends it back for a fix) |
| Fill in the application | `claude-sonnet-5-5` (cheapest with the browser toolset) | jobs that pass the minimum fit | 62¢ in the first real test, before the fixes below |
| Salary research | `claude-haiku-4-5` + web search | only when the posting has no range and the form asks | 6¢ |
| People worth knowing | `claude-sonnet-5-5` + web search (Claude Code's on your plan when the helper runs) | only on request | free on your plan, 17¢ on the API |
- `POST /api/runner/discover` — no AI: returns the best-matching jobs from the free job feed.
- `POST /api/runner/computer` — one step of the browser toolset (`browser_toolset_20260801`). It reads pages as text instead of screenshots, caches the system prompt and tools, and clears old page reads once the conversation passes 30k tokens.

The browser step is stateless: send `{task}` to start, then `{messages}` with the full conversation, appending Claude's content and your `tool_result` blocks (each with `toolset_name: "browser"`). Response: `{message, done}`.

