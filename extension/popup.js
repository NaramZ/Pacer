// Pacer extension panel. Talks only to the Pacer app on this computer, with the connection code from
// Profile → Browser extension. The slow part (checking the job, writing the documents) runs in the app, so this
// panel can close and pick up where it was when you open it again.
const view = document.getElementById("view");
const engineChip = document.getElementById("engine");
const store = chrome.storage.local;

const h = (tag, attrs = {}, ...children) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "onclick") el.addEventListener("click", v);
    else if (k === "class") el.className = v;
    else if (v !== false && v !== undefined) el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
  return el;
};
const show = (...nodes) => view.replaceChildren(...nodes);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function settings() {
  const s = await store.get(["server", "token"]);
  return { server: s.server || "http://localhost:5173", token: s.token || "" };
}

async function api(path, options = {}) {
  const { server, token } = await settings();
  const r = await fetch(`${server}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(options.headers || {}) },
  }).catch(() => null);
  if (!r) throw new Error("Couldn’t reach Pacer. Is the app running on this computer?");
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(data.error || `The app answered ${r.status}.`), { status: r.status });
  return data;
}

async function currentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

// The same job, whether you're on its posting or its form.
const jobKey = (url) => {
  try {
    const u = new URL(url);
    return `${u.hostname.replace(/^www\./, "")}${u.pathname.replace(/\/(apply|application)\/?$/i, "")}`;
  } catch {
    return url;
  }
};

async function jobState(url) {
  const all = (await store.get("jobs")).jobs || {};
  return all[jobKey(url)] || {};
}
async function saveJobState(url, patch) {
  const all = (await store.get("jobs")).jobs || {};
  all[jobKey(url)] = { ...(all[jobKey(url)] || {}), ...patch, at: Date.now() };
  // Only recent jobs are kept.
  for (const [k, v] of Object.entries(all)) if (Date.now() - (v.at || 0) > 14 * 864e5) delete all[k];
  await store.set({ jobs: all });
}

async function runInPage(tab, func, args = [], frameIds) {
  const target = { tabId: tab.id, allFrames: !frameIds, frameIds };
  await chrome.scripting.executeScript({ target, files: ["match.js", "fill.js"] });
  return chrome.scripting.executeScript({ target, func, args });
}

// Custom dropdowns are picked in the page's own context (see react-pick.js).
async function pickInPage(tab, frameId, picks) {
  if (!picks?.length) return [];
  const target = { tabId: tab.id, frameIds: [frameId] };
  await chrome.scripting.executeScript({ target, files: ["match.js", "react-pick.js"], world: "MAIN" });
  const [out] = await chrome.scripting.executeScript({ target, world: "MAIN", func: (p) => window.__jhPick(p), args: [picks] });
  return out?.result || [];
}

async function inFrame(tab, frameId, func, args = []) {
  const [out] = await chrome.scripting.executeScript({ target: { tabId: tab.id, frameIds: [frameId] }, func, args });
  return out?.result;
}

/* ---------- Screens ---------- */

function connectScreen(message = "") {
  const server = h("input", { id: "server", value: "http://localhost:5173", autocomplete: "off" });
  const code = h("input", { id: "code", placeholder: "njx_…", autocomplete: "off", spellcheck: "false" });
  const error = h("p", { class: "small error", role: "alert" }, message);
  show(
    h("h1", {}, "Connect to your Pacer app"),
    h("p", { class: "small muted" }, "In the app, open Profile → Browser extension → Create connection code, and paste it here."),
    h("label", {}, "Connection code", code),
    h("details", {}, h("summary", { class: "small muted" }, "App address"), h("label", { class: "small" }, "Address", server)),
    error,
    h("button", {
      onclick: async () => {
        await store.set({ server: server.value.trim().replace(/\/$/, ""), token: code.value.trim() });
        main();
      },
    }, "Connect"),
  );
  settings().then((s) => (server.value = s.server));
}

function progressCard(task) {
  const steps = (task.progress?.steps || []).filter((s) => s.state !== "skipped");
  const total = steps.reduce((n, s) => n + s.expect, 0) || 1;
  const now = Date.now();
  const done = steps.reduce((n, s) => n + (s.state === "done" ? s.expect : s.state === "active" && s.startedAt ? Math.min(s.expect * 0.9, (now - s.startedAt) / 1000) : 0), 0);
  const pct = Math.max(4, Math.min(96, Math.round((done / total) * 100)));
  return h(
    "div",
    { class: "card" },
    h("b", {}, task.label || "Preparing"),
    h("div", { class: "bar", role: "progressbar", "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": pct }, h("span", { style: `width:${pct}%` })),
    h("ol", { class: "steps" }, steps.map((s) => h("li", { class: s.state }, s.label))),
    h("p", { class: "small muted" }, "You can close this panel; it keeps going in the app."),
  );
}

async function main() {
  const { token } = await settings();
  if (!token) return connectScreen();
  let status;
  try {
    status = await api("/api/ext/status");
  } catch (e) {
    return e.status === 401 ? connectScreen("That connection code didn’t work. Create a new one in the app.") : show(h("p", { class: "error" }, e.message));
  }
  engineChip.hidden = false;
  engineChip.textContent = status.subscription ? "Claude plan" : "Helper off";
  engineChip.className = `chip ${status.subscription ? "good" : "warn"}`;
  if (!status.hasResume) return show(h("p", {}, "Add your resume in the app first (Profile)."));

  const tab = await currentTab();
  if (!tab?.url || !/^https?:/.test(tab.url)) return show(h("p", { class: "muted" }, "Open a job posting or application form, then click Pacer again."));
  const state = await jobState(tab.url);
  if (state.taskId && !state.applicationId) return follow(tab, state.taskId);
  if (state.applicationId) return readyScreen(tab, state.applicationId, state.result);
  startScreen(tab);
}

function startScreen(tab, message = "") {
  show(
    h("h1", {}, tab.title || "This job"),
    h("p", { class: "small muted" }, "Pacer reads this job, writes a tailored resume and cover letter, then fills in the form. You check it and press Submit."),
    message && h("p", { class: "small error", role: "alert" }, message),
    h("button", { onclick: () => prepare(tab) }, "Prepare this job"),
  );
}

async function prepare(tab, refresh = false) {
  show(h("p", { class: "muted" }, "Reading the page…"));
  // Careers pages often embed the job from their job board (Greenhouse, Lever, Ashby…) in a frame: read every frame
  // and use the one with the most text, and that frame's own link to the job.
  let page = { title: tab.title, text: "", url: tab.url };
  try {
    const frames = (await runInPage(tab, () => ({ ...window.__jhFill.pageText(), url: location.href }))).filter((f) => f.result);
    const board = /greenhouse\.io|lever\.co|ashbyhq\.com|myworkdayjobs\.com|myworkdaysite\.com|smartrecruiters\.com|workable\.com|jobvite\.com|icims\.com|bamboohr\.com|recruitee\.com|teamtailor\.com|breezy\.hr|jazzhr\.com|applytojob\.com|rippling\.com|dover\.com/i;
    const embedded = frames.filter((f) => f.frameId !== 0 && board.test(f.result.url) && f.result.text.length > 500).sort((a, b) => b.result.text.length - a.result.text.length)[0];
    const longest = frames.sort((a, b) => b.result.text.length - a.result.text.length)[0];
    const pick = embedded || longest;
    if (pick) page = { ...pick.result, title: pick.frameId === 0 ? pick.result.title : tab.title };
  } catch {}
  try {
    const r = await api("/api/ext/prepare", { method: "POST", body: JSON.stringify({ url: page.url || tab.url, pageUrl: tab.url, title: page.title, text: page.text, refresh }) });
    if (r.applicationId && r.ready) {
      await saveJobState(tab.url, { applicationId: r.applicationId, taskId: "" });
      return readyScreen(tab, r.applicationId);
    }
    await saveJobState(tab.url, { taskId: r.taskId, applicationId: "" });
    follow(tab, r.taskId);
  } catch (e) {
    startScreen(tab, e.message);
  }
}

async function follow(tab, taskId) {
  for (;;) {
    let task;
    try {
      task = await api(`/api/ext/task?id=${encodeURIComponent(taskId)}`);
    } catch (e) {
      await saveJobState(tab.url, { taskId: "" });
      return startScreen(tab, e.message);
    }
    if (task.status === "running") {
      show(progressCard(task));
      await sleep(1500);
      continue;
    }
    const body = task.result?.body || {};
    if (task.status === "done" && body.applicationId) {
      await saveJobState(tab.url, { applicationId: body.applicationId, taskId: "" });
      return readyScreen(tab, body.applicationId);
    }
    await saveJobState(tab.url, { taskId: "" });
    return startScreen(tab, body.error || "It didn’t finish. Try again.");
  }
}

// Your fit for this job: the match, the match with the tailored documents, and what's still missing.
function fitCard(fit) {
  if (!fit) return null;
  const tone = fit.score >= 70 ? "good" : fit.score >= 55 ? "" : "warn";
  return h(
    "div",
    { class: "card fit" },
    h(
      "div",
      { class: "fit-head" },
      h("div", {}, h("b", {}, fit.role), h("p", { class: "small muted" }, [fit.company, fit.location].filter(Boolean).join(" · "))),
      h(
        "p",
        { class: `score ${tone}`, "aria-label": `${fit.score} percent match${fit.scoreAfter !== null ? `, ${fit.scoreAfter} percent with your tailored documents` : ""}` },
        `${fit.score}%`,
        fit.scoreAfter !== null && fit.scoreAfter !== fit.score ? h("span", { class: "after" }, ` → ${fit.scoreAfter}%`) : null,
      ),
    ),
    h("p", { class: "small" }, `Your resume shows ${fit.strong} of ${fit.total} things this job asks for, partly shows ${fit.partial}, and doesn’t show ${fit.missing}.`),
    fit.letterCovers && h("p", { class: "small muted" }, `Your cover letter speaks to ${fit.letterCovers}.`),
    fit.gaps.length ? h("details", {}, h("summary", { class: "small" }, "Still missing"), h("ul", { class: "left" }, fit.gaps.map((g) => h("li", {}, g)))) : null,
    fit.recommendation && h("p", { class: "small muted" }, fit.recommendation),
    fit.salary && h("p", { class: "small" }, `Salary to ask: ${fit.salary}`),
    fit.warnings ? h("p", { class: "small" }, `${fit.warnings} line${fit.warnings === 1 ? "" : "s"} in the documents to check (see the app).`) : null,
  );
}

async function readyScreen(tab, applicationId, result) {
  const left = result?.left || [];
  const fit = await api(`/api/ext/summary?id=${encodeURIComponent(applicationId)}`).catch(() => null);
  show(
    fitCard(fit),
    result
      ? h(
          "div",
          { class: "card" },
          h("b", {}, `Filled ${result.filled} field${result.filled === 1 ? "" : "s"}${result.uploaded?.length ? ` · uploaded ${result.uploaded.length === 2 ? "resume and cover letter" : "your resume"}` : ""}`),
          left.length
            ? [h("p", { class: "small" }, `${left.length} required ${left.length === 1 ? "question is" : "questions are"} left for you, outlined in yellow:`), h("ul", { class: "left" }, left.slice(0, 8).map((l) => h("li", {}, l)))]
            : h("p", { class: "small muted" }, "Everything required is filled. Check it over, then press Submit on the page."),
          result.notice && h("p", { class: "small muted" }, result.notice),
        )
      : h("p", { class: "small muted" }, "Your tailored resume and cover letter are ready. Open the application form on this site, then fill it in."),
    h(
      "div",
      { class: "row" },
      h("button", { onclick: () => fill(tab, applicationId) }, result ? "Fill again" : "Fill this application"),
      result && h("button", { class: "secondary", onclick: () => submitted(tab, applicationId) }, "I submitted it"),
    ),
    h(
      "p",
      { class: "small" },
      h("a", { href: "#", onclick: async (e) => { e.preventDefault(); const { server } = await settings(); chrome.tabs.create({ url: `${server}/?job=${encodeURIComponent(applicationId)}` }); } }, "Open in Pacer"),
      " · ",
      h("a", { href: "#", onclick: (e) => { e.preventDefault(); prepare(tab, true); } }, "Rewrite the documents"),
    ),
  );
}

async function fill(tab, applicationId) {
  show(h("p", { class: "muted" }, "Filling in your details…"));
  try {
    const data = await api(`/api/ext/fill?id=${encodeURIComponent(applicationId)}`);
    // 1. Everything the profile answers: details, links, documents, and the dropdowns among them.
    const frames = (await runInPage(tab, (d) => window.__jhFill.fillKnown(d), [data])).filter((f) => f.result);
    let filled = 0;
    const uploaded = [];
    const questions = [];
    for (const f of frames) {
      filled += f.result.filled;
      uploaded.push(...f.result.uploaded);
      await pickInPage(tab, f.frameId, f.result.picks);
      for (const q of f.result.questions) questions.push({ ...q, id: `${f.frameId}:${q.id}` });
    }
    // 2. The form's own questions, answered by Claude in one go.
    let notice = "";
    if (questions.length) {
      show(h("p", { class: "muted" }, `Answering ${questions.length} of the form’s own questions…`));
      const r = await api("/api/ext/answers", { method: "POST", body: JSON.stringify({ id: applicationId, questions }) });
      notice = r.notice || "";
      for (const f of frames) {
        const mine = (r.answers || []).filter((a) => String(a.id).startsWith(`${f.frameId}:`)).map((a) => ({ id: String(a.id).split(":")[1], value: a.value }));
        if (!mine.length) continue;
        const out = await inFrame(tab, f.frameId, (a) => window.__jhFill.fillAnswers(a), [mine]);
        filled += out?.filled || 0;
        await pickInPage(tab, f.frameId, out?.picks);
      }
    }
    // 3. Profile fields the page cleared while starting up are filled again.
    for (const f of frames) {
      const again = await inFrame(tab, f.frameId, (d) => window.__jhFill.refill(d), [data]);
      await pickInPage(tab, f.frameId, again?.picks);
    }
    // 4. Whatever's still empty and required is outlined for you.
    const left = [];
    for (const f of frames) left.push(...((await inFrame(tab, f.frameId, () => window.__jhFill.markLeft()))?.left || []));
    const result = { filled, uploaded: [...new Set(uploaded)], left: [...new Set(left)], notice };
    await saveJobState(tab.url, { applicationId, result });
    readyScreen(tab, applicationId, result);
  } catch (e) {
    show(h("p", { class: "error", role: "alert" }, e.message), h("button", { onclick: () => fill(tab, applicationId) }, "Try again"));
  }
}

async function submitted(tab, applicationId) {
  try {
    await api("/api/ext/applied", { method: "POST", body: JSON.stringify({ id: applicationId }) });
    show(h("h1", {}, "Logged as Applied"), h("p", { class: "small muted" }, "It’s in My jobs with today’s date. Good luck!"));
  } catch (e) {
    show(h("p", { class: "error" }, e.message));
  }
}

main();
