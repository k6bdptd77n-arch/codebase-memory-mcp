"use strict";
// Brain — the persistent memory made visible: facts (click to open), recall search,
// episodes timeline, prune with a dry-run first and a native confirm before deleting.
window.Views = window.Views || {};

window.Views.brain = (() => {
  const t = (key, params) => window.I18N.t(key, params);
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  async function refresh() {
    let facts, eps;
    try {
      [facts, eps] = await Promise.all([window.mf.brainFacts(), window.mf.episodes()]);
    } catch {
      if (!$("facts").children.length)
        $("facts").innerHTML = `<div class="pal-empty">${esc(t("brain.unavailable"))}</div>`;
      if (!$("episode-list").children.length)
        $("episode-list").innerHTML = `<div class="pal-empty">${esc(t("brain.historyUnavailable"))}</div>`;
      return;
    }
    $("brain-count").textContent = `· ${facts.length}`;
    const box = $("facts");
    box.innerHTML = "";
    const order = { lesson: 0, feedback: 1, project: 2, user: 3, reference: 4 };
    facts.sort((a, b) => (order[a.type] ?? 9) - (order[b.type] ?? 9) || String(b.updated || "").localeCompare(a.updated || ""));
    for (const f of facts) {
      const el = document.createElement("div");
      el.className = "fact";
      el.title = t("brain.expandFact");
      // человеку показываем смысл (description), а не kebab-слаг — слаг уходит в подпись
      const title = (f.description || f.body || f.name || "").trim();
      el.innerHTML = `
        <div class="fact-head">
          <span class="fact-title">${esc(title)}</span>
          <span class="fact-badge ${esc(f.type || "project")}">${esc(f.type || "?")}</span>
          ${f.scope ? `<span class="fact-badge scope">${esc(f.scope)}</span>` : ""}
          ${f.expires ? `<span class="fact-badge scope">${esc(t("brain.until", { date: f.expires }))}</span>` : ""}
        </div>
        <div class="fact-slug">${esc(f.name || "")}</div>
        <div class="fact-body">${esc(f.body || f.description || "")}</div>`;
      el.addEventListener("click", () => el.classList.toggle("open"));
      box.appendChild(el);
    }

    const list = $("episode-list");
    list.innerHTML = "";
    let lastDay = "";
    for (const e of eps.slice(0, 40)) {
      const day = dayLabel(e.ts);
      if (day && day !== lastDay) {
        lastDay = day;
        const h = document.createElement("div");
        h.className = "ep-day";
        h.textContent = day;
        list.appendChild(h);
      }
      const el = document.createElement("div");
      el.className = "episode";
      el.title = t("brain.expandEpisode");
      const goal = e.goal || e.trace || "";
      const out = e.lesson || e.result || (e.tools ? Object.keys(e.tools).join(" · ") : "");
      // без JS-обрезки: CSS клампит одной строкой, клик по эпизоду раскрывает полностью
      el.innerHTML = `<div class="ep-ts">${esc(String(e.ts || "").slice(11, 16))}</div>
        <div class="ep-goal">${esc(goal)}</div>
        <div class="ep-out">${esc(String(out))}</div>`;
      el.addEventListener("click", () => el.classList.toggle("open"));
      list.appendChild(el);
    }
  }

  // «2026-07-07T03:14» → «сегодня» / «7 июл 2026» — заголовок дня в ленте эпизодов
  function dayLabel(ts) {
    const m = String(ts || "").slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return "";
    if (m[0] === new Date().toISOString().slice(0, 10)) return t("brain.today");
    return new Intl.DateTimeFormat(window.I18N.locale, { day: "numeric", month: "short", year: "numeric" })
      .format(new Date(`${m[0]}T00:00:00`));
  }

  async function recall() {
    const q = $("brain-q").value.trim();
    if (!q) return;
    const out = $("brain-recall-out");
    const button = $("brain-search");
    out.classList.remove("hidden");
    out.textContent = t("brain.searching");
    button.disabled = true;
    try {
      const r = await window.mf.brainRecall(q);
      out.textContent = (r?.out || r?.err || t("brain.nothing")).trim();
    } catch {
      out.textContent = t("brain.searchFailed");
    } finally {
      button.disabled = false;
    }
  }

  async function prune() {
    const out = $("brain-recall-out");
    const button = $("brain-prune");
    out.classList.remove("hidden");
    out.textContent = t("brain.checking");
    button.disabled = true;
    try {
      const dry = await window.mf.brainPrune(false);
      out.textContent = (dry?.out || dry?.err || t("brain.checkDone")).trim();
      if (!/expired/i.test(dry?.out || "") || /nothing expired/i.test(dry?.out || "")) return;
      if (await window.mf.confirm(t("brain.pruneTitle"), t("brain.pruneDetail"))) {
        const r = await window.mf.brainPrune(true);
        out.textContent = (r?.out || r?.err || t("brain.pruneDone")).trim();
        await refresh();
      }
    } catch {
      out.textContent = t("brain.pruneFailed");
    } finally {
      button.disabled = false;
    }
  }

  function init() {
    $("brain-search").addEventListener("click", recall);
    $("brain-q").addEventListener("keydown", (e) => { if (e.key === "Enter") recall(); });
    $("brain-prune").addEventListener("click", prune);
    refresh();
  }
  return { init, refresh };
})();
