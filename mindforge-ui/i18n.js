"use strict";
// Minimal i18n — no framework, a flat key→string dictionary per locale. Covers the STATIC
// markup surface (titlebar, sidebar nav, section headers, static labels/placeholders) that a
// first-time visitor sees; dynamic strings generated at runtime in views/*.js (guide text,
// story status labels, notes) stay Russian for now — see fablize's ROADMAP.md step 9 for the
// rest of that scope. EN is the default per the roadmap's "EN external surface" call.
window.I18N = (() => {
  const DICT = {
    en: {
      "nav.board": "Board", "nav.plan": "Plan", "nav.brain": "Brain",
      "nav.metrics": "Metrics", "nav.settings": "Settings", "nav.terminal": "Terminal",
      "mode.manual": "Manual", "mode.review": "Review", "mode.auto": "Auto",
      "board.empty.title": "No plan yet",
      "board.empty.hint": "Write a plan by hand — or describe a feature in «Plan» and the planner will split it up for you.",
      "board.empty.create": "Create a plan", "board.empty.open": "Open «Plan»", "board.empty.demo": "Run the demo",
      "wizard.title": "New plan", "wizard.brief": "What are we building (brief)",
      "wizard.stories": "Stories — each has its own task and verify command",
      "wizard.addStory": "+ story", "wizard.create": "Create plan", "wizard.cancel": "Cancel",
      "plan.describe": "Describe the feature",
      "plan.placeholder": "What needs to be built? The planner reads the project's memory first, then splits the task into 1-4 stories with disjoint files.",
      "plan.go": "Plan it", "plan.thinking": "Planner's thinking",
      "plan.preview": "Proposed stories — review before accepting",
      "plan.accept": "Accept → new plan", "plan.append": "Append to current", "plan.discard": "Discard",
      "brain.ask": "ask the project's memory…", "brain.recall": "Recall", "brain.prune": "Prune stale…",
      "brain.facts": "Facts", "brain.episodes": "Episodes — how past tasks ended",
      "metrics.spec": "Locked spec", "metrics.ledger": "Ledger — recent events",
      "settings.crew": "Crew", "settings.models": "Models & providers", "settings.mcp": "MCP servers",
      "settings.appearance": "Appearance", "settings.save": "Save",
      "project.open": "Open folder…", "project.new": "New project…",
    },
    ru: {
      "nav.board": "Доска", "nav.plan": "План", "nav.brain": "Мозг",
      "nav.metrics": "Метрики", "nav.settings": "Настройки", "nav.terminal": "Терминал",
      "mode.manual": "Ручной", "mode.review": "Ревью", "mode.auto": "Авто",
      "board.empty.title": "Плана нет",
      "board.empty.hint": "Составьте план вручную — или опишите фичу в «План», и планировщик разложит её сам.",
      "board.empty.create": "Создать план", "board.empty.open": "Открыть «План»", "board.empty.demo": "Запустить демо",
      "wizard.title": "Новый план", "wizard.brief": "Что строим (brief)",
      "wizard.stories": "Стори — у каждой своя задача и команда проверки",
      "wizard.addStory": "+ стори", "wizard.create": "Создать план", "wizard.cancel": "Отмена",
      "plan.describe": "Опишите фичу",
      "plan.placeholder": "Что нужно построить? Планировщик сначала прочитает память проекта, затем разложит задачу на 1–4 стори с непересекающимися файлами.",
      "plan.go": "Спланировать", "plan.thinking": "Мышление планировщика",
      "plan.preview": "Предложенные стори — проверьте перед принятием",
      "plan.accept": "Принять → новый план", "plan.append": "Добавить к текущему", "plan.discard": "Отклонить",
      "brain.ask": "спросить память проекта…", "brain.recall": "Вспомнить", "brain.prune": "Почистить протухшее…",
      "brain.facts": "Факты", "brain.episodes": "Эпизоды — чем закончились прошлые задачи",
      "metrics.spec": "Залоченная спека", "metrics.ledger": "Леджер — последние события",
      "settings.crew": "Экипаж", "settings.models": "Модели и провайдеры", "settings.mcp": "MCP-серверы",
      "settings.appearance": "Оформление", "settings.save": "Сохранить",
      "project.open": "Открыть папку…", "project.new": "Новый проект…",
    },
  };

  let locale = "en";
  function t(key) { return (DICT[locale] && DICT[locale][key]) || DICT.en[key] || key; }

  function apply() {
    for (const el of document.querySelectorAll("[data-i18n]")) {
      const key = el.getAttribute("data-i18n");
      el.textContent = t(key);
    }
    for (const el of document.querySelectorAll("[data-i18n-ph]")) {
      const key = el.getAttribute("data-i18n-ph");
      el.setAttribute("placeholder", t(key));
    }
    document.documentElement.lang = locale;
  }

  function setLocale(l) {
    locale = DICT[l] ? l : "en";
    try { localStorage.setItem("mf-locale", locale); } catch {}
    apply();
  }

  function init() {
    let saved = "en";
    try { saved = localStorage.getItem("mf-locale") || "en"; } catch {}
    locale = DICT[saved] ? saved : "en";
    apply();
  }

  return { t, apply, setLocale, init, get locale() { return locale; } };
})();
