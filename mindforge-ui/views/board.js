"use strict";
// Board — mission lanes. One lane per story; the lane IS the status display:
// amber pulse + taxiing rail while the agent flies, teal when merged, red on failure.
window.Views = window.Views || {};

window.Views.board = (() => {
  const lanes = () => document.getElementById("lanes");
  let snap = null;
  let pollTimer = null;
  let openLaneLogs = new Set();          // story ids with visible live log

  const STATE_LABEL = {
    pending: "standby", running: "live", review: "review wait",
    complete: "merged", failed: "failed", blocked: "blocked", in_progress: "active",
  };

  function laneState(g) {
    const rt = snap.states[g.id] || {};
    if (g.status === "complete") return "complete";
    if (rt.running) return "running";
    if (g.status === "failed" || g.status === "blocked") return "failed";
    if (rt.branch) return "review";
    return g.status === "in_progress" ? "in_progress" : "pending";
  }

  function firstOpenId() {
    if (!snap || !snap.goals) return null;
    const g = snap.goals.goals.find((x) => x.status !== "complete");
    return g ? g.id : null;
  }

  function render() {
    const box = lanes();
    const empty = document.getElementById("board-empty");
    const brief = document.getElementById("board-brief");
    if (!snap || !snap.goals) {
      box.innerHTML = ""; brief.textContent = "";
      empty.classList.remove("hidden");
      return;
    }
    empty.classList.add("hidden");
    const done = snap.goals.goals.filter((g) => g.status === "complete").length;
    brief.innerHTML = `${esc(snap.goals.brief)}<small>flight plan · ${done}/${snap.goals.goals.length} merged</small>`;
    box.innerHTML = "";
    const gate = firstOpenId();
    for (const g of snap.goals.goals) {
      const st = laneState(g);
      const el = document.createElement("div");
      el.className = `lane ${st}`;
      el.dataset.id = g.id;
      const pct = { complete: 100, review: 78, running: 0, failed: 60, in_progress: 40, pending: 0 }[st];
      el.innerHTML = `
        <div class="lane-top">
          <span class="lane-id">${g.id}</span>
          <span class="lane-title">${esc(g.title)}</span>
          <span class="lane-status">${st === "running" ? '<span class="pulse"></span>' : ""}${STATE_LABEL[st]}</span>
        </div>
        <div class="lane-obj" title="click to expand">${esc(g.objective)}</div>
        <div class="rail"><i style="width:${pct}%"></i></div>
        ${g.attempts >= 2 ? `<div class="escalation">⚠ escalation gate — ${g.attempts} failed attempts; consider a stronger model or human help</div>` : ""}
        <div class="lane-log hidden"></div>
        <div class="lane-actions"></div>`;
      el.querySelector(".lane-obj").addEventListener("click", (e) => e.target.classList.toggle("open"));
      const act = el.querySelector(".lane-actions");
      const btn = (label, cls, fn, disabled, title) => {
        const b = document.createElement("button");
        b.className = `btn small ${cls}`; b.textContent = label;
        if (title) b.title = title;
        b.disabled = !!disabled;
        b.addEventListener("click", fn);
        act.appendChild(b);
        return b;
      };
      if (st === "pending") btn("Run agent", "amber", () => runStory(g.id));
      if (st === "running") { btn("Stop", "red", () => stopStory(g.id)); showLog(el, g.id); }
      if (st === "review") {
        btn("Review", "teal", () => window.Views.board.openReview(g.id),
            g.id !== gate, g.id !== gate ? "merge queue: earlier stories first" : "");
        btn("Log", "ghost", () => toggleLog(el, g.id));
      }
      if (st === "failed") btn("Retry", "ghost", () => window.mf.storyRetry(g.id).then(refresh));
      if (st === "complete" && g.evidence) {
        const ev = document.createElement("span");
        ev.className = "lane-evidence"; ev.title = g.evidence; ev.textContent = "✓ " + g.evidence;
        act.appendChild(ev);
      }
      box.appendChild(el);
    }
  }

  async function runStory(id) {
    const r = await window.mf.storyRun(id);
    if (!r.ok) note(r.error || "run failed");
    refresh();
  }
  async function stopStory(id) {
    if (await window.mf.confirm("Stop agent", `Kill the running agent for ${id}? Its worktree stays for inspection.`))
      { await window.mf.storyStop(id); refresh(); }
  }

  function toggleLog(el, id) {
    const lg = el.querySelector(".lane-log");
    lg.classList.toggle("hidden");
    if (!lg.classList.contains("hidden")) { openLaneLogs.add(id); pump(); } else openLaneLogs.delete(id);
  }
  function showLog(el, id) {
    el.querySelector(".lane-log").classList.remove("hidden");
    openLaneLogs.add(id);
  }
  async function pump() {
    for (const id of openLaneLogs) {
      const el = lanes().querySelector(`.lane[data-id="${id}"] .lane-log`);
      if (!el) continue;
      const t = await window.mf.logTail(id);
      const stick = el.scrollTop + el.clientHeight >= el.scrollHeight - 8;
      el.textContent = t || "(agent starting — log appears once claude begins writing)";
      if (stick) el.scrollTop = el.scrollHeight;
    }
  }

  // review drawer
  let drawerId = null;
  async function openReview(id) {
    drawerId = id;
    const d = document.getElementById("drawer");
    document.getElementById("drawer-title").textContent = `Review ${id}`;
    document.getElementById("drawer-progress").textContent = "";
    const body = document.getElementById("drawer-body");
    body.textContent = "collecting evidence…";
    d.classList.remove("hidden");
    const ev = await window.mf.reviewEvidence(id);
    body.textContent = ev.text;
  }
  function closeReview() { document.getElementById("drawer").classList.add("hidden"); drawerId = null; }

  async function approve() {
    if (!drawerId) return;
    const id = drawerId;
    if (!(await window.mf.confirm(`Merge ${id}`,
      "Runs the full test suite (verification gate), checkpoints the story, merges the branch and removes its worktree."))) return;
    progress(`▸ verification gate: running the test suite…`);
    const r = await window.mf.storyApprove(id, `approved in MindForge Control`);
    for (const s of r.steps) progress(`${s.ok ? "✓" : "✗"} ${s.name}\n${s.out}`, s.ok);
    if (r.ok) { progress(`✓ ${id} merged — ${r.testsTail}`, true); setTimeout(closeReview, 1200); }
    refresh();
  }
  async function fail() {
    if (!drawerId) return;
    const id = drawerId;
    if (!(await window.mf.confirm(`Fail ${id}`, "Marks the story failed; the branch and worktree stay for inspection.")))
      return;
    await window.mf.storyFail(id, "rejected in review");
    closeReview(); refresh();
  }
  function progress(text, ok) {
    const p = document.getElementById("drawer-progress");
    const div = document.createElement("div");
    div.className = ok === false ? "bad" : ok ? "ok" : "";
    div.textContent = text;
    p.appendChild(div); p.scrollTop = p.scrollHeight;
  }

  // autopilot: agent exited → LLM review → approve/fail automatically
  async function onExit(id) {
    if (!document.getElementById("autopilot").checked) { refresh(); return; }
    note(`autopilot: reviewing ${id}…`);
    const r = await window.mf.reviewLLM(id);
    note(`autopilot ${id}: ${r.verdict}`);
    if (r.verdict === "COMPLETE" && id === firstOpenId()) {
      const ap = await window.mf.storyApprove(id, "autopilot: " + r.text.slice(0, 160));
      note(ap.ok ? `autopilot: ${id} merged ✓` : `autopilot: ${id} gate failed — left for manual review`);
    } else if (r.verdict === "FAILED") {
      await window.mf.storyFail(id, "autopilot: " + r.text.slice(0, 160));
    }
    refresh();
  }

  const note = (t) => { document.getElementById("tm-note").textContent = t; };
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  async function refresh() {
    snap = await window.mf.snapshot();
    render();
    document.getElementById("tm-plan").textContent = snap.goals
      ? `${snap.goals.goals.filter((g) => g.status === "complete").length}/${snap.goals.goals.length} · ${snap.goals.brief.slice(0, 48)}`
      : "no plan";
    const live = Object.values(snap.states).filter((s) => s.running).length;
    document.getElementById("tm-agents").textContent = `agents: ${live}`;
  }

  function init() {
    document.getElementById("drawer-close").addEventListener("click", closeReview);
    document.getElementById("drawer-approve").addEventListener("click", approve);
    document.getElementById("drawer-fail").addEventListener("click", fail);
    window.mf.onStoryState((m) => { if (m.state === "exited") onExit(m.id); else refresh(); });
    pollTimer = setInterval(pump, 1500);
    refresh();
  }

  return { init, refresh, openReview };
})();
