"use strict";
// Brain — the persistent memory made visible: facts (click to open), recall search,
// episodes timeline, prune with a dry-run first and a native confirm before deleting.
window.Views = window.Views || {};

window.Views.brain = (() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  async function refresh() {
    const facts = await window.mf.brainFacts();
    $("brain-count").textContent = `· ${facts.length}`;
    const box = $("facts");
    box.innerHTML = "";
    const order = { lesson: 0, feedback: 1, project: 2, user: 3, reference: 4 };
    facts.sort((a, b) => (order[a.type] ?? 9) - (order[b.type] ?? 9) || String(b.updated || "").localeCompare(a.updated || ""));
    for (const f of facts) {
      const el = document.createElement("div");
      el.className = "fact";
      el.innerHTML = `
        <div class="fact-head">
          <span class="fact-name">${esc(f.name || "?")}</span>
          <span class="fact-badge ${esc(f.type || "project")}">${esc(f.type || "?")}</span>
          <span class="fact-badge scope">${esc(f.scope)}</span>
          ${f.expires ? `<span class="fact-badge scope">expires ${esc(f.expires)}</span>` : ""}
        </div>
        <div class="fact-desc">${esc(f.description || "")}</div>
        <div class="fact-body">${esc(f.body || "")}</div>`;
      el.addEventListener("click", () => el.classList.toggle("open"));
      box.appendChild(el);
    }

    const eps = await window.mf.episodes();
    const list = $("episode-list");
    list.innerHTML = "";
    for (const e of eps.slice(0, 40)) {
      const el = document.createElement("div");
      el.className = "episode";
      const goal = e.goal || e.trace || "";
      const out = e.lesson || e.result || (e.tools ? Object.keys(e.tools).join(" · ") : "");
      el.innerHTML = `<div class="ep-ts">${esc(String(e.ts || "").slice(0, 16).replace("T", " "))}</div>
        <div class="ep-goal">${esc(goal.slice(0, 140))}</div>
        <div class="ep-out">${esc(String(out).slice(0, 140))}</div>`;
      list.appendChild(el);
    }
  }

  async function recall() {
    const q = $("brain-q").value.trim();
    if (!q) return;
    const out = $("brain-recall-out");
    out.classList.remove("hidden");
    out.textContent = "recalling…";
    const r = await window.mf.brainRecall(q);
    out.textContent = (r.out || r.err || "").trim();
  }

  async function prune() {
    const out = $("brain-recall-out");
    out.classList.remove("hidden");
    out.textContent = "checking for expired facts…";
    const dry = await window.mf.brainPrune(false);
    out.textContent = (dry.out || dry.err || "").trim();
    if (!/expired/i.test(dry.out) || /nothing expired/i.test(dry.out)) return;
    if (await window.mf.confirm("Delete expired facts",
      "Removes every fact listed above from the brain. This cannot be undone."))
      { const r = await window.mf.brainPrune(true); out.textContent = (r.out || r.err || "").trim(); refresh(); }
  }

  function init() {
    $("brain-search").addEventListener("click", recall);
    $("brain-q").addEventListener("keydown", (e) => { if (e.key === "Enter") recall(); });
    $("brain-prune").addEventListener("click", prune);
    refresh();
  }
  return { init, refresh };
})();
