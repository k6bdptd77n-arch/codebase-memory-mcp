"use strict";
// Экипаж — три фиксированные роли (Мозг / Планировщик / Рука), каждая со своей
// моделью, набором MCP-серверов и скиллов (референсы: тумблеры MCP как в Cursor,
// наборы инструментов на роль как в профилях Zed, модель-на-профиль как в Codex).
// Конфиг применяется к СЛЕДУЮЩЕМУ запуску агента; текущие полёты не трогает.
window.Views = window.Views || {};

window.Views.crew = (() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  const ROLES = [
    { id: "brain", icon: "◉", title: "Мозг", duty: "ревьюит диффы агентов и охраняет gate" },
    { id: "planner", icon: "◈", title: "Планировщик", duty: "раскладывает фичу на стори с непересекающимися файлами" },
    { id: "hand", icon: "▶", title: "Рука", duty: "пишет код в изолированном worktree" },
  ];
  const MODELS = ["haiku", "sonnet", "opus", "inherit"];
  const MODEL_LABEL = { haiku: "Haiku", sonnet: "Sonnet", opus: "Opus", inherit: "как сессия" };

  let cfg = null, inv = null, dirty = false;

  function markDirty() {
    dirty = true;
    $("crew-status").textContent = "есть несохранённые изменения";
    $("crew-save").disabled = false;
  }

  function roleCard(role) {
    const rc = cfg.roles[role.id];
    const el = document.createElement("div");
    el.className = "role-card";
    el.innerHTML = `
      <div class="role-head">
        <span class="role-icon">${role.icon}</span>
        <span class="role-title">${role.title}</span>
        <span class="role-duty">${role.duty}</span>
      </div>
      <div class="role-sec-title">Модель</div>
      <div class="model-seg"></div>
      <div class="role-sec-title">MCP-серверы</div>
      <div class="toggles mcp-toggles"></div>
      <div class="role-sec-title">Скиллы</div>
      <div class="toggles skill-toggles"></div>
      <div class="role-sec-title">Дополнение к промпту</div>
      <textarea class="role-prompt" rows="2" placeholder="необязательно — добавится к системному промпту роли"></textarea>`;

    const seg = el.querySelector(".model-seg");
    for (const m of MODELS) {
      const b = document.createElement("button");
      b.className = "seg" + ((rc.model || "inherit") === m ? " on" : "");
      b.textContent = MODEL_LABEL[m];
      b.addEventListener("click", () => {
        rc.model = m;
        seg.querySelectorAll(".seg").forEach((x) => x.classList.remove("on"));
        b.classList.add("on");
        markDirty();
      });
      seg.appendChild(b);
    }

    const toggleRow = (box, key, store, extraHtml) => {
      const row = document.createElement("label");
      row.className = "toggle-row";
      const on = store[key] !== false;
      row.innerHTML = `<input type="checkbox" ${on ? "checked" : ""} />
        <span class="tg-track"><span class="tg-thumb"></span></span>${extraHtml}`;
      row.querySelector("input").addEventListener("change", (e) => {
        store[key] = e.target.checked;   // явное значение: true=вкл, false=выкл
        markDirty();
      });
      box.appendChild(row);
    };

    const mcpBox = el.querySelector(".mcp-toggles");
    if (!inv.mcp.length) mcpBox.innerHTML = '<div class="toggles-empty">MCP-серверов не найдено — добавьте через <code>claude mcp add</code></div>';
    for (const s of inv.mcp)
      toggleRow(mcpBox, s.name, rc.mcp,
        `<i class="mcp-dot ${s.connected ? "ok" : ""}"></i><span class="tg-name">${esc(s.name)}</span>` +
        (s.defined ? "" : '<span class="tg-src">плагин/облако</span>'));

    const skBox = el.querySelector(".skill-toggles");
    if (!inv.skills.length) skBox.innerHTML = '<div class="toggles-empty">скиллов не найдено</div>';
    for (const s of inv.skills)
      toggleRow(skBox, s.name, rc.skills,
        `<span class="tg-name" title="${esc(s.description)}">${esc(s.name)}</span>` +
        `<span class="tg-src">${esc(s.source)}</span>`);

    const ta = el.querySelector(".role-prompt");
    ta.value = rc.prompt || "";
    ta.addEventListener("input", () => { rc.prompt = ta.value; markDirty(); });
    return el;
  }

  async function refresh() {
    if (dirty) return;                       // не затирать несохранённое фоновым обновлением
    [cfg, inv] = await Promise.all([window.mf.crewGet(), window.mf.crewInventory()]);
    const box = $("crew-cards");
    box.innerHTML = "";
    for (const r of ROLES) box.appendChild(roleCard(r));
    headerBadge();
  }

  function headerBadge() {
    const b = $("crew-badge");
    if (!b || !cfg) return;
    const short = (m) => (m === "inherit" || !m ? "сессия" : m);
    b.textContent = `Мозг·${short(cfg.roles.brain.model)} / План·${short(cfg.roles.planner.model)} / Рука·${short(cfg.roles.hand.model)}`;
  }

  async function save() {
    const r = await window.mf.crewSave(cfg);
    if (r.ok) {
      dirty = false;
      $("crew-save").disabled = true;
      $("crew-status").textContent = "сохранено — применится к следующему запуску агента";
      headerBadge();
    } else $("crew-status").textContent = "ошибка: " + (r.error || "");
  }

  function init() {
    $("crew-save").addEventListener("click", save);
    $("crew-badge").addEventListener("click", () => document.querySelector('.tab[data-tab="crew"]').click());
    refresh();
  }
  return { init, refresh };
})();
