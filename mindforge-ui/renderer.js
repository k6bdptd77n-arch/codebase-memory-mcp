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
  theme: { background: "#0F1011", foreground: "#D3D5D9", cursor: "#E8EAED",
           selectionBackground: "#26282C", brightGreen: "#34C77B", yellow: "#E8A33D" },
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

// ── режим Ручной|Авто (титлбар) — тот же скрытый чекбокс #autopilot ─────────
const ap = document.getElementById("autopilot");
ap.checked = localStorage.getItem("mf-autopilot") === "1";
const modeBtns = { manual: document.getElementById("mode-manual"), auto: document.getElementById("mode-auto") };
function paintMode() {
  modeBtns.manual.classList.toggle("on", !ap.checked);
  modeBtns.auto.classList.toggle("on", ap.checked);
}
function setMode(auto) {
  ap.checked = auto;
  localStorage.setItem("mf-autopilot", auto ? "1" : "0");
  paintMode();
}
modeBtns.manual.addEventListener("click", () => setMode(false));
modeBtns.auto.addEventListener("click", () => setMode(true));
paintMode();

// ── ESC закрывает верхний слой: палитру, модалку, drawer, меню проекта ──────
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  const palette = document.getElementById("palette");
  if (!palette.classList.contains("hidden")) { palette.classList.add("hidden"); return; }
  const modal = document.getElementById("proj-modal");
  if (!modal.classList.contains("hidden")) { modal.classList.add("hidden"); return; }
  const drawer = document.getElementById("drawer");
  if (!drawer.classList.contains("hidden")) { document.getElementById("drawer-close").click(); return; }
  document.getElementById("proj-menu").classList.add("hidden");
});

// ── command palette (⌘K / Ctrl+K) — только уже существующие действия ─────────
const palette = document.getElementById("palette");
const palInput = document.getElementById("palette-q");
const palList = document.getElementById("palette-list");
let palItems = [], palSel = 0;

function buildActions(stories) {
  const tab = (name, label) => ({ label, k: "вкладка",
    run: () => document.querySelector(`.tab[data-tab="${name}"]`).click() });
  const acts = [
    tab("board", "Доска"), tab("plan", "План"), tab("brain", "Мозг"),
    tab("metrics", "Метрики"), tab("settings", "Настройки"), tab("terminal", "Терминал"),
    { label: "Создать план", k: "действие", run: () => {
      document.querySelector('.tab[data-tab="board"]').click();
      document.getElementById("board-wizard-open").click(); } },
    { label: "Открыть папку…", k: "проект", run: () => window.mf.projectOpen() },
    { label: "Новый проект…", k: "проект", run: () => showProjModal() },
    { label: "Открыть 3D-граф", k: "действие", run: () => window.mf.openGraph() },
    { label: ap.checked ? "Режим → Ручной" : "Режим → Авто", k: "режим", run: () => setMode(!ap.checked) },
  ];
  for (const g of stories)
    if (g && g.status !== "complete")
      acts.push({ label: `Открыть ${g.id} · ${g.title}`, k: "стори",
        run: () => { document.querySelector('.tab[data-tab="board"]').click(); window.Views.board.openReview(g.id); } });
  return acts;
}

const fuzzy = (hay, q) => { // подпоследовательность: «нп» найдёт «Новый Проект»
  let i = 0; for (const ch of hay) if (ch === q[i]) i++; return i === q.length;
};
function renderPal(q) {
  const ql = q.toLowerCase().trim();
  palItems = baseActions.filter((a) => !ql || fuzzy(a.label.toLowerCase(), ql));
  palSel = 0;
  palList.innerHTML = "";
  if (!palItems.length) { palList.innerHTML = `<div class="pal-empty">ничего не найдено</div>`; return; }
  palItems.forEach((a, i) => {
    const b = document.createElement("button");
    b.className = "pal-item" + (i === palSel ? " sel" : "");
    b.innerHTML = `<span></span><span class="pal-k"></span>`;
    b.children[0].textContent = a.label;
    b.children[1].textContent = a.k || "";
    b.addEventListener("click", () => runPal(i));
    b.addEventListener("mousemove", () => setPalSel(i));
    palList.appendChild(b);
  });
}
function setPalSel(i) {
  palSel = i;
  [...palList.children].forEach((el, j) => el.classList && el.classList.toggle("sel", j === i));
  const sel = palList.children[i];
  if (sel && sel.scrollIntoView) sel.scrollIntoView({ block: "nearest" });
}
function runPal(i) {
  const a = palItems[i];
  palette.classList.add("hidden");
  if (a) try { a.run(); } catch {}
}
let baseActions = [];
async function openPalette() {
  let stories = [];
  try { const s = await window.mf.snapshot(); if (s && s.goals) stories = s.goals.goals; } catch {}
  baseActions = buildActions(stories);
  palette.classList.remove("hidden");
  palInput.value = "";
  renderPal("");
  palInput.focus();
}
palInput.addEventListener("input", () => renderPal(palInput.value));
palInput.addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown") { e.preventDefault(); setPalSel(Math.min(palSel + 1, palItems.length - 1)); }
  else if (e.key === "ArrowUp") { e.preventDefault(); setPalSel(Math.max(palSel - 1, 0)); }
  else if (e.key === "Enter") { e.preventDefault(); runPal(palSel); }
});
palette.addEventListener("click", (e) => { if (e.target === palette) palette.classList.add("hidden"); });
document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    if (palette.classList.contains("hidden")) openPalette(); else palette.classList.add("hidden");
  }
});

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
