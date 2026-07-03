"use strict";
// Настройки — структура как в Cursor Settings: левая навигация, секции справа.
//   Экипаж    — три роли (Мозг/Планировщик/Рука): модель, MCP, скиллы, промпт
//   Модели    — внешние провайдеры (Ollama/OpenAI/OpenRouter) для думающих ролей
//   MCP       — список серверов из конфигурации claude (health-статус)
// Один конфиг (.fablize/crew.json), одна кнопка «Сохранить» на всё.
window.Views = window.Views || {};

window.Views.settings = (() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  const ROLES = [
    { id: "brain", icon: "◉", title: "Мозг", duty: "ревьюит диффы агентов и охраняет gate", think: true },
    { id: "planner", icon: "◈", title: "Планировщик", duty: "раскладывает фичу на стори", think: true },
    { id: "hand", icon: "▶", title: "Рука", duty: "пишет код в изолированном worktree", think: false },
  ];
  const CLAUDE_MODELS = ["inherit", "haiku", "sonnet", "opus"];
  const MODEL_LABEL = { inherit: "как сессия", haiku: "Haiku", sonnet: "Sonnet", opus: "Opus" };
  const PROVIDERS = [
    { id: "ollama", title: "Ollama", hint: "локальные модели — бесплатно, без ключа", keyless: true },
    { id: "openai", title: "OpenAI", hint: "GPT-модели по вашему API-ключу" },
    { id: "openrouter", title: "OpenRouter", hint: "один ключ — сотни моделей (Gemini, DeepSeek, Llama…)" },
  ];

  let cfg = null, inv = null, dirty = false;

  function markDirty() {
    dirty = true;
    $("crew-status").textContent = "есть несохранённые изменения";
    $("crew-save").disabled = false;
  }

  // модели, доступные думающим ролям: клод-алиасы + модели включённых провайдеров
  function thinkModels() {
    const out = CLAUDE_MODELS.map((m) => ({ v: m, label: MODEL_LABEL[m] }));
    for (const p of PROVIDERS) {
      const pc = cfg.providers[p.id];
      if (pc && pc.enabled) for (const m of pc.models || [])
        out.push({ v: `${p.id}/${m}`, label: `${p.title} · ${m}` });
    }
    return out;
  }

  // ── карточка роли ───────────────────────────────────────────────────────
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
      ${role.think ? "" : `<div class="role-sec-title">CLI-исполнитель</div><div class="cli-seg model-seg"></div>`}
      <div class="role-sec-title">Модель</div>
      <div class="model-row"></div>
      <div class="role-sec-title">MCP-серверы</div>
      <div class="toggles mcp-toggles"></div>
      <div class="role-sec-title">Скиллы</div>
      <div class="toggles skill-toggles"></div>
      <div class="role-sec-title">Дополнение к промпту</div>
      <textarea class="role-prompt" rows="2" placeholder="необязательно — добавится к системному промпту роли"></textarea>`;

    // выбор CLI для Руки (codex/aider — если установлены)
    if (!role.think) {
      const seg = el.querySelector(".cli-seg");
      for (const cli of ["claude", "codex", "aider"]) {
        const b = document.createElement("button");
        b.className = "seg" + ((rc.cli || "claude") === cli ? " on" : "");
        b.textContent = cli;
        window.mf.cliAvailable(cli).then((ok) => {
          if (!ok && cli !== "claude") { b.disabled = true; b.title = `${cli} не найден в PATH`; }
        });
        b.addEventListener("click", () => {
          rc.cli = cli;
          seg.querySelectorAll(".seg").forEach((x) => x.classList.remove("on"));
          b.classList.add("on"); markDirty();
        });
        seg.appendChild(b);
      }
    }

    // модель: думающим — селект со всеми провайдерами; Руке — только клод-алиасы
    const mr = el.querySelector(".model-row");
    const sel = document.createElement("select");
    sel.className = "model-select";
    const opts = role.think ? thinkModels() : CLAUDE_MODELS.map((m) => ({ v: m, label: MODEL_LABEL[m] }));
    for (const o of opts) {
      const op = document.createElement("option");
      op.value = o.v; op.textContent = o.label;
      if ((rc.model || "inherit") === o.v) op.selected = true;
      sel.appendChild(op);
    }
    if (role.think && opts.length === CLAUDE_MODELS.length) {
      const op = document.createElement("option");
      op.disabled = true;
      op.textContent = "── другие ИИ: включите провайдера ниже ──";
      sel.appendChild(op);
    }
    sel.addEventListener("change", () => { rc.model = sel.value; markDirty(); });
    mr.appendChild(sel);
    if (role.think) {
      const hint = document.createElement("button");
      hint.className = "model-hint";
      hint.textContent = "+ GPT / Ollama / OpenRouter — включить в «Модели и провайдеры»";
      hint.addEventListener("click", () => document.querySelector('.snav[data-sec="models"]').click());
      mr.appendChild(hint);
    }

    const toggleRow = (box, key, store, extraHtml) => {
      const row = document.createElement("label");
      row.className = "toggle-row";
      const on = store[key] !== false;
      row.innerHTML = `<input type="checkbox" ${on ? "checked" : ""} />
        <span class="tg-track"><span class="tg-thumb"></span></span>${extraHtml}`;
      row.querySelector("input").addEventListener("change", (e) => { store[key] = e.target.checked; markDirty(); });
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

  // ── карточка провайдера (секция «Модели и провайдеры») ─────────────────
  function providerCard(p) {
    const pc = cfg.providers[p.id];
    const el = document.createElement("div");
    el.className = "provider-card";
    el.innerHTML = `
      <div class="prov-head">
        <label class="toggle-row prov-enable">
          <input type="checkbox" ${pc.enabled ? "checked" : ""} />
          <span class="tg-track"><span class="tg-thumb"></span></span>
          <span class="prov-title">${p.title}</span>
        </label>
        <span class="prov-hint">${p.hint}</span>
        <span class="prov-status"></span>
      </div>
      <div class="prov-body ${pc.enabled ? "" : "hidden"}">
        <div class="prov-row"><span>Адрес</span><input class="p-base" value="${esc(pc.base)}" spellcheck="false" /></div>
        ${p.keyless ? "" : `<div class="prov-row"><span>API-ключ</span><input class="p-key" type="password" value="${esc(pc.key)}" placeholder="sk-…" spellcheck="false" /></div>`}
        <div class="prov-row"><span>Модели</span><input class="p-models" value="${esc((pc.models || []).join(", "))}" placeholder="имена через запятую" spellcheck="false" />
          ${p.id === "ollama" ? '<button class="btn ghost small p-scan">Найти локальные</button>' : ""}</div>
        <div class="prov-note">Модели появятся в выпадающем списке у Планировщика и Мозга как «${p.title} · имя».</div>
      </div>`;
    const enable = el.querySelector(".prov-enable input");
    enable.addEventListener("change", () => {
      pc.enabled = enable.checked;
      el.querySelector(".prov-body").classList.toggle("hidden", !pc.enabled);
      markDirty(); rerenderCrew();
    });
    el.querySelector(".p-base").addEventListener("input", (e) => { pc.base = e.target.value.trim(); markDirty(); });
    const key = el.querySelector(".p-key");
    if (key) key.addEventListener("input", (e) => { pc.key = e.target.value.trim(); markDirty(); });
    el.querySelector(".p-models").addEventListener("input", (e) => {
      pc.models = e.target.value.split(",").map((s) => s.trim()).filter(Boolean);
      markDirty(); rerenderCrew();
    });
    const scan = el.querySelector(".p-scan");
    if (scan) scan.addEventListener("click", async () => {
      const st = el.querySelector(".prov-status");
      st.textContent = "ищу…";
      const r = await window.mf.ollamaModels();
      if (r.ok && r.models.length) {
        pc.models = r.models;
        el.querySelector(".p-models").value = r.models.join(", ");
        st.textContent = `найдено: ${r.models.length}`;
        markDirty(); rerenderCrew();
      } else st.textContent = "сервер Ollama не отвечает — запустите `ollama serve`";
    });
    return el;
  }

  function renderProviders() {
    const box = $("provider-cards");
    box.innerHTML = "";
    for (const p of PROVIDERS) box.appendChild(providerCard(p));
  }

  function renderMcpList() {
    const box = $("mcp-list");
    box.innerHTML = "";
    if (!inv.mcp.length) { box.innerHTML = '<div class="toggles-empty">серверов нет</div>'; return; }
    for (const s of inv.mcp) {
      const row = document.createElement("div");
      row.className = "mcp-row";
      row.innerHTML = `<i class="mcp-dot ${s.connected ? "ok" : ""}"></i>
        <span class="tg-name">${esc(s.name)}</span>
        <span class="tg-src">${s.defined ? "конфиг" : "плагин/облако"}</span>
        <span class="mcp-state">${s.connected ? "подключён" : "недоступен"}</span>`;
      box.appendChild(row);
    }
  }

  function rerenderCrew() {
    const box = $("crew-cards");
    box.innerHTML = "";
    for (const r of ROLES) box.appendChild(roleCard(r));
    headerBadge();
  }

  function headerBadge() {
    const b = $("crew-badge");
    if (!b || !cfg) return;
    const short = (m) => (!m || m === "inherit") ? "сессия" : m.includes("/") ? m.split("/")[1].slice(0, 12) : m;
    b.textContent = `Мозг·${short(cfg.roles.brain.model)} / План·${short(cfg.roles.planner.model)} / Рука·${cfg.roles.hand.cli && cfg.roles.hand.cli !== "claude" ? cfg.roles.hand.cli : short(cfg.roles.hand.model)}`;
  }

  async function refresh() {
    if (dirty) return;                        // не затирать несохранённое фоновым обновлением
    cfg = await window.mf.crewGet();
    headerBadge();                            // бейдж в шапке — сразу, не дожидаясь mcp list
    inv = await window.mf.crewInventory();
    rerenderCrew();
    renderProviders();
    renderMcpList();
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

  function applyTheme(t) {
    document.body.classList.toggle("theme-deck", t === "deck");
    localStorage.setItem("mf-theme", t);
    document.querySelectorAll(".theme-card").forEach((c) =>
      c.classList.toggle("on", c.dataset.theme === t));
  }

  function init() {
    applyTheme(localStorage.getItem("mf-theme") || "cursor");
    for (const card of document.querySelectorAll(".theme-card"))
      card.addEventListener("click", () => applyTheme(card.dataset.theme));
    $("crew-save").addEventListener("click", save);
    $("crew-badge").addEventListener("click", () => document.querySelector('.tab[data-tab="settings"]').click());
    for (const nav of document.querySelectorAll(".snav")) {
      nav.addEventListener("click", () => {
        document.querySelectorAll(".snav").forEach((n) => n.classList.remove("active"));
        document.querySelectorAll(".sec").forEach((s) => s.classList.remove("active"));
        nav.classList.add("active");
        $(`sec-${nav.dataset.sec}`).classList.add("active");
      });
    }
    refresh();
  }
  return { init, refresh };
})();
