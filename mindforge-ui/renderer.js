"use strict";
/* global Terminal, FitAddon */
// Coordinator: tabs, header layer lights, autopilot state, telemetry clock,
// the integrated PTY terminal, and live refresh on every .fablize change.

// ── tabs ─────────────────────────────────────────────────────────────────────
const TAB_IDS = ["board", "plan", "brain", "metrics", "settings", "terminal"];
const SHORTCUT_MOD = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+";
document.querySelector(".palette-trigger kbd").textContent = `${SHORTCUT_MOD}K`;
document.querySelectorAll(".tab-key").forEach((key, i) => {
  key.textContent = `${SHORTCUT_MOD}${i + 1}`;
});

function activateTab(tabId, { persist = true, focus = false } = {}) {
  if (!TAB_IDS.includes(tabId)) return;
  const next = document.querySelector(`.tab[data-tab="${tabId}"]`);
  if (!next) return;

  document.querySelectorAll(".tab").forEach((tab) => {
    const active = tab === next;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
  });
  document.querySelectorAll(".view").forEach((view) => {
    const active = view.id === `view-${tabId}`;
    view.classList.toggle("active", active);
    view.setAttribute("aria-hidden", String(!active));
  });

  if (persist) localStorage.setItem("mf-active-tab", tabId);
  if (focus) next.focus();
  if (tabId === "terminal") setTimeout(() => { fit.fit(); term.focus(); }, 30);
  const view = window.Views[tabId];
  if (view && view.refresh) view.refresh();
}

for (const tab of document.querySelectorAll(".tab"))
  tab.addEventListener("click", () => activateTab(tab.dataset.tab));

document.getElementById("tabs").addEventListener("keydown", (e) => {
  const current = TAB_IDS.indexOf(document.activeElement?.dataset?.tab);
  if (current < 0) return;
  let next = current;
  if (e.key === "ArrowDown" || e.key === "ArrowRight") next = (current + 1) % TAB_IDS.length;
  else if (e.key === "ArrowUp" || e.key === "ArrowLeft") next = (current - 1 + TAB_IDS.length) % TAB_IDS.length;
  else if (e.key === "Home") next = 0;
  else if (e.key === "End") next = TAB_IDS.length - 1;
  else return;
  e.preventDefault();
  activateTab(TAB_IDS[next], { focus: true });
});

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

// ── "Открыть 3D-граф" — main starts/reuses the local server, then opens it ──
document.getElementById("open-graph").addEventListener("click", async () => {
  const button = document.getElementById("open-graph");
  const note = document.getElementById("tm-note");
  button.disabled = true;
  note.textContent = "запускаю 3D-граф…";
  try {
    const result = await window.mf.openGraph();
    note.textContent = result?.ok ? "3D-граф открыт" : (result?.error || "3D-граф недоступен");
  } catch { note.textContent = "не удалось запустить 3D-граф"; }
  finally { button.disabled = false; }
});

// ── "↻ индекс" — reindex the current project into the C memory engine ─────────
document.getElementById("reindex").addEventListener("click", async () => {
  const note = document.getElementById("tm-note");
  const r = await window.mf.reindex();
  note.textContent = r && r.ok ? "индексирую проект…" : "движок памяти не собран";
  setTimeout(refreshLayers, 2500);
});

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
    b.type = "button";
    b.setAttribute("role", "menuitem");
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

function hideProjMenu({ focus = false } = {}) {
  projMenu.classList.add("hidden");
  projBtn.setAttribute("aria-expanded", "false");
  if (focus) projBtn.focus();
}
function showProjMenu({ focusFirst = false } = {}) {
  projMenu.classList.remove("hidden");
  projBtn.setAttribute("aria-expanded", "true");
  if (focusFirst) projMenu.querySelector("button")?.focus();
}
projBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  if (projMenu.classList.contains("hidden")) showProjMenu(); else hideProjMenu();
});
projBtn.addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown") { e.preventDefault(); showProjMenu({ focusFirst: true }); }
});
projMenu.addEventListener("keydown", (e) => {
  const items = [...projMenu.querySelectorAll("button")];
  const current = items.indexOf(document.activeElement);
  if (e.key === "Escape") { e.preventDefault(); hideProjMenu({ focus: true }); return; }
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
  e.preventDefault();
  const direction = e.key === "ArrowDown" ? 1 : -1;
  items[(current + direction + items.length) % items.length]?.focus();
});
document.addEventListener("click", (e) => { if (!projMenu.contains(e.target)) hideProjMenu(); });

// ── new-project modal (name only; the parent folder is a native dialog in main) ──
const projModal = document.getElementById("proj-modal");
const projName = document.getElementById("proj-name");
const projErr = document.getElementById("proj-err");
function showProjModal() {
  projErr.classList.add("hidden");
  projName.value = "";
  projModal.classList.remove("hidden");
  projModal.setAttribute("aria-hidden", "false");
  projName.focus();
}
function hideProjModal() {
  projModal.classList.add("hidden");
  projModal.setAttribute("aria-hidden", "true");
  projBtn.focus();
}
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

// ── шкала доверия: Ручной / Ревью / Авто (титлбар) ──────────────────────────
// Ручной — merge только рукой, никакого автоматического ревью. Ревью — LLM-ревью
// запускается ОБЯЗАТЕЛЬНО при выходе агента (ничего не скрыто), но merge всё равно
// только рукой. Авто — то же ревью, и при вердикте COMPLETE merge происходит сам
// (сам gate внутри storyApprove всё равно проверяет тесты — режим не обходит гейт).
const MODES = ["manual", "review", "auto"];
const ap = document.getElementById("autopilot");                 // сохранён для обратной совместимости чтения board.js
const modeBtns = { manual: document.getElementById("mode-manual"),
                   review: document.getElementById("mode-review"),
                   auto: document.getElementById("mode-auto") };
let mfMode = (() => {
  const saved = localStorage.getItem("mf-mode");
  if (MODES.includes(saved)) return saved;
  return localStorage.getItem("mf-autopilot") === "1" ? "auto" : "manual";  // миграция со старого булева ключа
})();
window.mfMode = () => mfMode;
function paintMode() {
  for (const m of MODES) {
    modeBtns[m].classList.toggle("on", m === mfMode);
    modeBtns[m].setAttribute("aria-pressed", String(m === mfMode));
  }
  ap.checked = mfMode === "auto";                                 // board.js читает это как "полный автопилот"
}
function setMode(mode) {
  mfMode = MODES.includes(mode) ? mode : "manual";
  localStorage.setItem("mf-mode", mfMode);
  paintMode();
}
for (const m of MODES) modeBtns[m].addEventListener("click", () => setMode(m));
paintMode();

// ── ESC закрывает верхний слой: палитру, модалку, drawer, меню проекта ──────
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  const palette = document.getElementById("palette");
  if (!palette.classList.contains("hidden")) { closePalette(); return; }
  const modal = document.getElementById("proj-modal");
  if (!modal.classList.contains("hidden")) { hideProjModal(); return; }
  if (!quickModal.classList.contains("hidden")) { hideQuick(); return; }
  const drawer = document.getElementById("drawer");
  if (!drawer.classList.contains("hidden")) { document.getElementById("drawer-close").click(); return; }
  hideProjMenu({ focus: true });
});

// ── быстрая задача: одно поручение → интерактивный claude в PTY проекта ──────
// Средний режим между церемонией доски и голым терминалом: без плана и ревью,
// но в папке проекта и с его дисциплинами (AGENTS.md агент подхватывает сам).
const quickModal = document.getElementById("quick-modal");
const quickInput = document.getElementById("quick-input");
function showQuick() {
  quickInput.value = "";
  quickModal.classList.remove("hidden");
  quickModal.setAttribute("aria-hidden", "false");
  quickInput.focus();
}
function hideQuick() {
  quickModal.classList.add("hidden");
  quickModal.setAttribute("aria-hidden", "true");
  document.getElementById("quick-btn").focus();
}
function quickGo() {
  const text = quickInput.value.trim();
  if (!text) return;
  hideQuick();
  document.querySelector('.tab[data-tab="terminal"]').click();
  const escaped = text.replace(/'/g, "'\\''");   // безопасно для одинарных кавычек шелла
  setTimeout(() => window.mf.ptyInput(`claude '${escaped}'\n`), 120);
}
document.getElementById("quick-btn").addEventListener("click", showQuick);
document.getElementById("quick-go").addEventListener("click", quickGo);
document.getElementById("quick-cancel").addEventListener("click", hideQuick);
quickModal.addEventListener("click", (e) => { if (e.target === quickModal) hideQuick(); });
quickInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); quickGo(); }
});

// ── command palette (⌘K / Ctrl+K) — только уже существующие действия ─────────
const palette = document.getElementById("palette");
const palInput = document.getElementById("palette-q");
const palList = document.getElementById("palette-list");
let palItems = [], palSel = 0;

function buildActions(stories) {
  const tab = (name, label) => ({ label, k: `${SHORTCUT_MOD}${TAB_IDS.indexOf(name) + 1}`,
    run: () => activateTab(name, { focus: true }) });
  const acts = [
    tab("board", "Доска"), tab("plan", "План"), tab("brain", "Мозг"),
    tab("metrics", "Метрики"), tab("settings", "Настройки"), tab("terminal", "Терминал"),
    { label: "Создать план", k: "действие", run: () => {
      document.querySelector('.tab[data-tab="board"]').click();
      document.getElementById("board-wizard-open").click(); } },
    { label: "Открыть папку…", k: "проект", run: () => window.mf.projectOpen() },
    { label: "Новый проект…", k: "проект", run: () => showProjModal() },
    { label: "Открыть 3D-граф", k: "действие", run: () => window.mf.openGraph() },
    { label: "Быстрая задача…", k: "действие", run: () => showQuick() },
    ...MODES.filter((m) => m !== mfMode).map((m) => ({
      label: `Режим → ${{ manual: "Ручной", review: "Ревью", auto: "Авто" }[m]}`,
      k: "режим", run: () => setMode(m) })),
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
  closePalette();
  if (a) try { a.run(); } catch {}
}
let baseActions = [];
function closePalette(restoreFocus = true) {
  palette.classList.add("hidden");
  palette.setAttribute("aria-hidden", "true");
  const trigger = document.getElementById("palette-btn");
  trigger.setAttribute("aria-expanded", "false");
  if (restoreFocus) trigger.focus();
}
async function openPalette() {
  let stories = [];
  try { const s = await window.mf.snapshot(); if (s && s.goals) stories = s.goals.goals; } catch {}
  baseActions = buildActions(stories);
  palette.classList.remove("hidden");
  palette.setAttribute("aria-hidden", "false");
  document.getElementById("palette-btn").setAttribute("aria-expanded", "true");
  palInput.value = "";
  renderPal("");
  palInput.focus();
}
document.getElementById("palette-btn").addEventListener("click", openPalette);
palInput.addEventListener("input", () => renderPal(palInput.value));
palInput.addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown") { e.preventDefault(); setPalSel(Math.min(palSel + 1, palItems.length - 1)); }
  else if (e.key === "ArrowUp") { e.preventDefault(); setPalSel(Math.max(palSel - 1, 0)); }
  else if (e.key === "Enter") { e.preventDefault(); runPal(palSel); }
});
palette.addEventListener("click", (e) => { if (e.target === palette) closePalette(); });

// Keep keyboard focus inside the active dialog. This prevents Tab from moving
// into controls hidden behind the modal overlay.
document.addEventListener("keydown", (e) => {
  if (e.key !== "Tab") return;
  const layer = [palette, projModal, quickModal].find((el) => !el.classList.contains("hidden"));
  if (!layer) return;
  const focusable = [...layer.querySelectorAll('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])')];
  if (!focusable.length) return;
  const first = focusable[0], last = focusable[focusable.length - 1];
  if (e.shiftKey && (document.activeElement === first || !layer.contains(document.activeElement))) {
    e.preventDefault(); last.focus();
  } else if (!e.shiftKey && (document.activeElement === last || !layer.contains(document.activeElement))) {
    e.preventDefault(); first.focus();
  }
});
document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    if (palette.classList.contains("hidden")) openPalette(); else closePalette();
    return;
  }
  if ((e.metaKey || e.ctrlKey) && /^[1-6]$/.test(e.key)) {
    e.preventDefault();
    activateTab(TAB_IDS[Number(e.key) - 1], { focus: true });
  }
});

// ── telemetry clock ──────────────────────────────────────────────────────────
setInterval(() => {
  document.getElementById("tm-clock").textContent =
    new Date().toLocaleTimeString("en-GB", { hour12: false });
}, 1000);

// ── preflight: tell the user what's missing up front, not as a silent spawn failure ──
(async () => {
  try {
    const p = await window.mf.preflight();
    const missing = [];
    if (!p.claude) missing.push("claude CLI не найден в PATH — установите Claude Code и перезапустите MindForge");
    if (!p.git) missing.push("git не найден в PATH");
    if (!p.engineBuilt) missing.push(p.packaged
      ? "движок памяти отсутствует в установленной сборке — переустановите MindForge"
      : "движок памяти не собран");
    if (!missing.length) return;
    const banner = document.getElementById("preflight-banner");
    document.getElementById("preflight-text").textContent = "⚠ " + missing.join(" · ");
    banner.classList.remove("hidden");
    if (!p.engineBuilt && !p.packaged) {
      const action = document.getElementById("preflight-action");
      action.classList.remove("hidden");
      action.addEventListener("click", () => {
        action.disabled = true;
        action.textContent = "Команда готова";
        activateTab("terminal", { focus: true });
        const installDir = String(p.installDir || "").replace(/'/g, "'\\''");
        setTimeout(() => window.mf.ptyInput(`cd '${installDir}' && ./install-combined.sh --with-ui`), 120);
        document.getElementById("tm-note").textContent = "команда подготовлена — нажмите Enter";
      }, { once: true });
    }
    document.getElementById("preflight-dismiss").addEventListener("click",
      () => banner.classList.add("hidden"), { once: true });
  } catch {}
})();

// ── boot + live refresh ──────────────────────────────────────────────────────
for (const v of Object.values(window.Views)) v.init();
const restoredTab = localStorage.getItem("mf-active-tab");
if (TAB_IDS.includes(restoredTab)) activateTab(restoredTab, { persist: false });
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
