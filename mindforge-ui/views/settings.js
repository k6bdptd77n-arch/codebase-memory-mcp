"use strict";
// Настройки — структура как в Cursor Settings: левая навигация, секции справа.
//   Экипаж    — три роли (Мозг/Планировщик/Рука): модель, MCP, скиллы, промпт
//   Модели    — внешние провайдеры (Ollama/OpenAI/OpenRouter) для думающих ролей
//   MCP       — список серверов из конфигурации claude (health-статус)
// Один конфиг (.fablize/crew.json), одна кнопка «Сохранить» на всё.
window.Views = window.Views || {};

window.Views.settings = (() => {
  const t = (key, params) => window.I18N.t(key, params);
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  const ROLES = [
    { id: "brain", icon: "◉", title: "settings.role.brain", duty: "settings.role.brainDuty", think: true },
    { id: "planner", icon: "◈", title: "settings.role.planner", duty: "settings.role.plannerDuty", think: true },
    { id: "hand", icon: "▶", title: "settings.role.hand", duty: "settings.role.handDuty", think: false },
  ];
  const CLAUDE_MODELS = ["inherit", "haiku", "sonnet", "opus"];
  const modelLabel = (model) => model === "inherit" ? t("settings.inherit") : ({ haiku: "Haiku", sonnet: "Sonnet", opus: "Opus" }[model] || model);
  const PROVIDERS = [
    { id: "ollama", title: "Ollama", hint: "settings.provider.ollama", keyless: true },
    { id: "openai", title: "OpenAI", hint: "settings.provider.openai" },
    { id: "openrouter", title: "OpenRouter", hint: "settings.provider.openrouter" },
  ];

  let cfg = null, inv = null, dirty = false;

  function markDirty() {
    dirty = true;
    $("crew-status").textContent = t("settings.unsaved");
    $("crew-save").disabled = false;
  }

  // модели, доступные думающим ролям: клод-алиасы + модели включённых провайдеров
  function thinkModels() {
    const out = CLAUDE_MODELS.map((m) => ({ v: m, label: modelLabel(m) }));
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
        <span class="role-title">${t(role.title)}</span>
        <span class="role-duty">${t(role.duty)}</span>
      </div>
      ${role.think ? "" : `<div class="role-sec-title">${t("settings.cliRunner")}</div><div class="cli-seg model-seg"></div>`}
      <div class="role-sec-title">${t("settings.model")}</div>
      <div class="model-row"></div>
      <div class="role-sec-title">${t("settings.mcpServers")}</div>
      <div class="toggles mcp-toggles"></div>
      <div class="role-sec-title">${t("settings.skills")}</div>
      <div class="toggles skill-toggles"></div>
      <div class="role-sec-title">${t("settings.promptExtra")}</div>
      <textarea class="role-prompt" rows="2" placeholder="${t("settings.promptPlaceholder")}"></textarea>`;

    // выбор CLI для Руки (codex/aider — если установлены)
    if (!role.think) {
      const seg = el.querySelector(".cli-seg");
      for (const cli of ["claude", "codex", "gemini", "opencode", "aider"]) {  // = orchestrate.py AGENT_STYLES
        const b = document.createElement("button");
        b.className = "seg" + ((rc.cli || "claude") === cli ? " on" : "");
        b.textContent = cli;
        window.mf.cliAvailable(cli).then((ok) => {
          if (!ok && cli !== "claude") { b.disabled = true; b.title = t("settings.cliMissing", { cli }); }
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
    const opts = role.think ? thinkModels() : CLAUDE_MODELS.map((m) => ({ v: m, label: modelLabel(m) }));
    for (const o of opts) {
      const op = document.createElement("option");
      op.value = o.v; op.textContent = o.label;
      if ((rc.model || "inherit") === o.v) op.selected = true;
      sel.appendChild(op);
    }
    if (role.think && opts.length === CLAUDE_MODELS.length) {
      const op = document.createElement("option");
      op.disabled = true;
      op.textContent = t("settings.otherAi");
      sel.appendChild(op);
    }
    sel.addEventListener("change", () => { rc.model = sel.value; markDirty(); });
    mr.appendChild(sel);
    if (role.think) {
      const hint = document.createElement("button");
      hint.className = "model-hint";
      hint.textContent = t("settings.enableProviders");
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
    if (!inv.mcp.length) mcpBox.innerHTML = `<div class="toggles-empty">${invNote(
      t("settings.noMcp"))}</div>`;
    for (const s of inv.mcp)
      toggleRow(mcpBox, s.name, rc.mcp,
        `<i class="mcp-dot ${s.connected ? "ok" : ""}"></i><span class="tg-name">${esc(s.name)}</span>` +
        (s.defined ? "" : `<span class="tg-src">${t("settings.pluginCloud")}</span>`));
    const skBox = el.querySelector(".skill-toggles");
    if (!inv.skills.length) skBox.innerHTML = `<div class="toggles-empty">${invNote(t("settings.noSkills"))}</div>`;
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
        <span class="prov-hint">${t(p.hint)}</span>
        <span class="prov-status"></span>
      </div>
      <div class="prov-body ${pc.enabled ? "" : "hidden"}">
        <div class="prov-row"><span>${t("settings.address")}</span><input class="p-base" value="${esc(pc.base)}" spellcheck="false" /></div>
        ${p.keyless ? "" : `<div class="prov-row"><span>${t("settings.apiKey")}</span><input class="p-key" type="password" value="${esc(pc.key)}" placeholder="sk-…" spellcheck="false" /></div>`}
        <div class="prov-row"><span>${t("settings.modelList")}</span><input class="p-models" value="${esc((pc.models || []).join(", "))}" placeholder="${t("settings.commaNames")}" spellcheck="false" />
          ${p.id === "ollama" ? `<button class="btn ghost small p-scan">${t("settings.findLocal")}</button>` : ""}</div>
        <div class="prov-note">${t("settings.providerNote", { provider: p.title })}</div>
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
      st.textContent = t("settings.searching");
      const r = await window.mf.ollamaModels();
      if (r.ok && r.models.length) {
        pc.models = r.models;
        el.querySelector(".p-models").value = r.models.join(", ");
        st.textContent = t("settings.found", { count: r.models.length });
        markDirty(); rerenderCrew();
      } else st.textContent = t("settings.ollamaDown");
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
    if (!inv.mcp.length) { box.innerHTML = `<div class="toggles-empty">${invNote(t("settings.noServers"))}</div>`; return; }
    for (const s of inv.mcp) {
      const row = document.createElement("div");
      row.className = "mcp-row";
      row.innerHTML = `<i class="mcp-dot ${s.connected ? "ok" : ""}"></i>
        <span class="tg-name">${esc(s.name)}</span>
        <span class="tg-src">${s.defined ? t("settings.config") : t("settings.pluginCloud")}</span>
        <span class="mcp-state">${s.connected ? t("settings.connected") : t("settings.unavailable")}</span>`;
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
    const short = (m) => (!m || m === "inherit") ? t("settings.session") : m.includes("/") ? m.split("/")[1].slice(0, 12) : m;
    b.textContent = t("settings.headerRoles", { brain: short(cfg.roles.brain.model), planner: short(cfg.roles.planner.model), hand: cfg.roles.hand.cli && cfg.roles.hand.cli !== "claude" ? cfg.roles.hand.cli : short(cfg.roles.hand.model) });
  }

  // inv states: null → not asked yet; {loading:true} → mcp list in flight;
  // {failed:true} → claude mcp list не ответил. Роль-карточки рендерятся сразу.
  const invNote = (fallback) => inv && inv.loading ? t("settings.inventoryLoading")
    : inv && inv.failed ? t("settings.inventoryUnavailable") : fallback;

  let invPending = false;
  async function refresh() {
    if (dirty) return;                        // не затирать несохранённое фоновым обновлением
    const body = $("settings-body");          // и не сбрасывать фокус, пока пользователь в поле
    if (body && document.activeElement && body.contains(document.activeElement)) return;
    try { cfg = await window.mf.crewGet(); } catch { return; }
    headerBadge();                            // бейдж в шапке — сразу, не дожидаясь mcp list
    if (!inv || inv.loading) inv = { mcp: [], skills: [], loading: true };
    rerenderCrew();                           // карточки сразу — инвентарь дольётся ниже
    renderProviders();
    renderMcpList();
    if (invPending) return;                   // mcp list уже в полёте — не плодить процессы
    invPending = true;
    try {
      const got = await window.mf.crewInventory();
      inv = got && Array.isArray(got.mcp) ? got : { mcp: [], skills: [], failed: true };
    } catch { inv = { mcp: [], skills: [], failed: true }; }
    finally { invPending = false; }
    if (dirty) return;                        // пользователь уже что-то трогает — не перерисовывать
    rerenderCrew();
    renderMcpList();
  }

  async function save() {
    const r = await window.mf.crewSave(cfg);
    if (r.ok) {
      dirty = false;
      $("crew-save").disabled = true;
      $("crew-status").textContent = t("settings.saved");
      headerBadge();
    } else $("crew-status").textContent = t("settings.saveError", { error: r.error || "" });
  }

  function applyTheme(t) {
    document.body.classList.toggle("theme-deck", t === "deck");
    localStorage.setItem("mf-theme", t);
    document.querySelectorAll(".theme-card").forEach((c) => {
      const active = c.dataset.theme === t;
      c.classList.toggle("on", active);
      c.setAttribute("aria-pressed", String(active));
    });
  }

  function init() {
    applyTheme(localStorage.getItem("mf-theme") || "cursor");
    for (const card of document.querySelectorAll(".theme-card"))
      card.addEventListener("click", () => applyTheme(card.dataset.theme));
    if (window.I18N) {
      window.I18N.init();
      window.mf.setLocale(window.I18N.locale);
      for (const btn of document.querySelectorAll(".lang-seg button")) {
        btn.classList.toggle("on", btn.dataset.locale === window.I18N.locale);
        btn.addEventListener("click", async () => {
          window.I18N.setLocale(btn.dataset.locale);
          await window.mf.setLocale(btn.dataset.locale);
          document.querySelectorAll(".lang-seg button").forEach((b) =>
            b.classList.toggle("on", b.dataset.locale === btn.dataset.locale));
        });
      }
    }
    $("crew-save").addEventListener("click", save);
    document.addEventListener("keydown", (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s" && dirty) {
        e.preventDefault();
        save();
      }
    });
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

  // project switched: crew.json is per-project — drop unsaved edits and reload
  function onProject() {
    dirty = false;
    inv = null;
    $("crew-save").disabled = true;
    $("crew-status").textContent = "";
    refresh();
  }

  return { init, refresh, onProject };
})();
