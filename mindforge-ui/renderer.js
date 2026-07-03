"use strict";
/* global Terminal, FitAddon */
// Coordinator: tabs, header layer lights, autopilot state, telemetry clock,
// the integrated PTY terminal, and live refresh on every .fablize change.

// ── tabs ─────────────────────────────────────────────────────────────────────
for (const tab of document.querySelectorAll(".tab")) {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
    tab.classList.add("active");
    document.getElementById(`view-${tab.dataset.tab}`).classList.add("active");
    if (tab.dataset.tab === "terminal") setTimeout(() => { fit.fit(); term.focus(); }, 30);
    const view = window.Views[tab.dataset.tab];
    if (view && view.refresh) view.refresh();
  });
}

// ── integrated terminal (real PTY) ───────────────────────────────────────────
const term = new Terminal({
  fontFamily: '"IBM Plex Mono", ui-monospace, "SF Mono", Menlo, monospace',
  fontSize: 12.5, cursorBlink: true,
  theme: { background: "#131316", foreground: "#D6D6D9", cursor: "#ECECEE",
           selectionBackground: "#2A2A2E", brightGreen: "#3FB950", yellow: "#D9A03F" },
});
const fit = new FitAddon.FitAddon();
term.loadAddon(fit);
term.open(document.getElementById("term"));
fit.fit();
window.mf.onPtyData((d) => term.write(d));
window.mf.onPtyExit(() => term.write("\r\n[shell exited]\r\n"));
term.onData((d) => window.mf.ptyInput(d));
term.onResize(({ cols, rows }) => window.mf.ptyResize(cols, rows));
new ResizeObserver(() => { try { fit.fit(); } catch {} })
  .observe(document.getElementById("view-terminal"));

// ── header: layer lights ─────────────────────────────────────────────────────
async function refreshLayers() {
  const l = await window.mf.layers();
  const set = (id, on, value, warn) => {
    const el = document.getElementById(`light-${id}`);
    el.classList.toggle("on", !!on && !warn);
    el.classList.toggle("warn", !!warn);
    document.getElementById(`light-${id}-v`).textContent = value;
  };
  set("memory", !!l.memory, l.memory ? `${(l.memory.nodes / 1000).toFixed(1)}k узлов` : "офлайн");
  set("procedure", !!l.procedure,
    l.procedure ? `${l.procedure.done}/${l.procedure.total}` : "нет плана",
    l.procedure && l.procedure.done < l.procedure.total);
  set("brain", l.brain.facts > 0, `${l.brain.facts} фактов`);
}

// ── autopilot toggle ─────────────────────────────────────────────────────────
const ap = document.getElementById("autopilot");
ap.checked = localStorage.getItem("mf-autopilot") === "1";
const apState = () => {
  document.getElementById("ap-state").textContent = ap.checked ? "Автопилот" : "Ручной режим";
  document.getElementById("ap-state").classList.toggle("auto", ap.checked);
};
ap.addEventListener("change", () => { localStorage.setItem("mf-autopilot", ap.checked ? "1" : "0"); apState(); });
apState();

// ── telemetry clock ──────────────────────────────────────────────────────────
setInterval(() => {
  document.getElementById("tm-clock").textContent =
    new Date().toLocaleTimeString("en-GB", { hour12: false });
}, 1000);

// ── boot + live refresh ──────────────────────────────────────────────────────
for (const v of Object.values(window.Views)) v.init();
refreshLayers();
window.mf.onChanged(() => {
  window.Views.board.refresh();
  refreshLayers();
  const active = document.querySelector(".tab.active").dataset.tab;
  if (active !== "board" && window.Views[active] && window.Views[active].refresh)
    window.Views[active].refresh();
});
setInterval(refreshLayers, 20000);
