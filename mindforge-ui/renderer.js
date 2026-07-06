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
  try {
    const l = await window.mf.layers();
    if (!l) return;                       // keep the last rendered state
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
    set("brain", (l.brain || {}).facts > 0, `${(l.brain || {}).facts ?? 0} фактов`);
  } catch { /* keep the last rendered state */ }
}

// ── "Открыть 3D-граф" — statusbar action (URL is hardcoded in main) ──────────
document.getElementById("open-graph").addEventListener("click", () => window.mf.openGraph());

// ── project switcher (titlebar) ──────────────────────────────────────────────
const projBtn = document.getElementById("proj-btn");
const projMenu = document.getElementById("proj-menu");

async function refreshProject() {
  try {
    const info = await window.mf.projectInfo();
    document.getElementById("title-text").textContent = "MindForge";
    projBtn.querySelector(".proj-name").textContent = info.name;
    buildProjMenu(info);
  } catch {}
}

function buildProjMenu(info) {
  projMenu.innerHTML = "";
  const item = (label, fn, cls = "") => {
    const b = document.createElement("button");
    b.className = "proj-item " + cls;
    b.textContent = label;
    b.addEventListener("click", () => { hideProjMenu(); fn(); });
    projMenu.appendChild(b);
    return b;
  };
  info.recents.forEach((r, i) => {
    const b = item(r.name, () => window.mf.projectRecent(i));
    b.title = r.dir;
    if (r.dir === info.dir) b.classList.add("on");
  });
  if (info.recents.length) {
    const hr = document.createElement("div"); hr.className = "proj-sep"; projMenu.appendChild(hr);
  }
  item("Открыть папку…", () => window.mf.projectOpen());
  item("Новый проект…", () => showProjModal());
}

function hideProjMenu() { projMenu.classList.add("hidden"); }
projBtn.addEventListener("click", (e) => { e.stopPropagation(); projMenu.classList.toggle("hidden"); });
document.addEventListener("click", (e) => { if (!projMenu.contains(e.target)) hideProjMenu(); });

// ── new-project modal (name only; the parent folder is a native dialog in main) ──
const projModal = document.getElementById("proj-modal");
const projName = document.getElementById("proj-name");
const projErr = document.getElementById("proj-err");
function showProjModal() {
  projErr.classList.add("hidden");
  projName.value = "";
  projModal.classList.remove("hidden");
  projName.focus();
}
function hideProjModal() { projModal.classList.add("hidden"); }
document.getElementById("proj-create-cancel").addEventListener("click", hideProjModal);
projModal.addEventListener("click", (e) => { if (e.target === projModal) hideProjModal(); });
async function submitProjCreate() {
  const name = projName.value.trim();
  projErr.classList.add("hidden");
  if (!name) { projErr.textContent = "введите имя проекта"; projErr.classList.remove("hidden"); return; }
  const btn = document.getElementById("proj-create-go");
  btn.disabled = true; btn.textContent = "создаю…";
  try {
    const r = await window.mf.projectCreate(name);
    if (r.ok) {
      hideProjModal();
      if (r.warning) document.getElementById("tm-note").textContent = "⚠ " + r.warning;
    } else if (!r.canceled) {
      projErr.textContent = r.error || ((r.steps || []).filter((s) => !s.ok).map((s) => `${s.name}: ${s.out}`).join("; ")) || "не удалось создать";
      projErr.classList.remove("hidden");
    }
  } finally { btn.disabled = false; btn.textContent = "Создать"; }
}
document.getElementById("proj-create-go").addEventListener("click", submitProjCreate);
projName.addEventListener("keydown", (e) => { if (e.key === "Enter") submitProjCreate(); });

// project switched → retitle and re-pull every view from the new state dir
window.mf.onProjectChanged(() => {
  refreshProject();
  for (const v of Object.values(window.Views)) {
    if (v.onProject) v.onProject(); else if (v.refresh) v.refresh();
  }
  refreshLayers();
});
refreshProject();

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

// Polling fallback: fs.watch(recursive) can silently fail or drop events on some
// platforms — a cheap ~4s tick keeps the active view and lights honest.
// (main memoizes snapshot ~500ms, so this stays lightweight.)
let pollBusy = false;
setInterval(async () => {
  if (pollBusy) return;
  pollBusy = true;
  try {
    const active = document.querySelector(".tab.active").dataset.tab;
    const view = window.Views[active];
    if (view && view.refresh) await view.refresh();
    if (active !== "board") await window.Views.board.refresh();  // statusbar plan/agents counters
    await refreshLayers();
  } catch {} finally { pollBusy = false; }
}, 4000);
