"use strict";
// Plan — feature → stories via a subscription claude -p planner whose thinking
// streams live into the right pane. Nothing lands in the plan without your Accept.
window.Views = window.Views || {};

window.Views.plan = (() => {
  const t = (key, params) => window.I18N.t(key, params);
  let proposed = null;   // ["title::objective", ...]
  let feature = "";

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  function streamEvent(m) {
    if (m.tag !== "plan") return;
    const out = $("plan-stream");
    const stick = out.scrollTop + out.clientHeight >= out.scrollHeight - 8;
    if (m.error) out.textContent += `\n[error] ${m.error}`;
    else if (m.ev && m.ev.type === "assistant" && m.ev.message && Array.isArray(m.ev.message.content)) {
      for (const b of m.ev.message.content) {
        if (b.type === "thinking" && b.thinking) append(out, b.thinking, "think");
        if (b.type === "text" && b.text) append(out, b.text, "say");
      }
    }
    if (stick) out.scrollTop = out.scrollHeight;
  }
  function append(out, text, cls) {
    const span = document.createElement("span");
    span.className = cls;
    span.textContent = text;
    out.appendChild(span);
  }

  async function go() {
    feature = $("plan-input").value.trim();
    if (!feature) return;
    $("plan-go").disabled = true;
    $("plan-status").textContent = t("plan.reading");
    $("plan-live").classList.add("on");
    $("plan-stream").textContent = "";
    $("plan-preview").classList.add("hidden");
    try {
      const r = await window.mf.planGenerate(feature);
      if (!r.ok) { $("plan-status").textContent = r.error || t("plan.failed"); return; }
      proposed = r.stories;
      $("plan-status").textContent = t("plan.proposed", { count: proposed.length });
      const ol = $("plan-stories");
      ol.innerHTML = "";
      for (const s of proposed) {
        const [t, o] = [s.split("::")[0], s.split("::").slice(1).join("::")];
        const li = document.createElement("li");
        li.innerHTML = `<div class="st-title">${esc(t)}</div><div class="st-obj">${esc(o)}</div>`;
        ol.appendChild(li);
      }
      $("plan-preview").classList.remove("hidden");
    } catch {
      $("plan-status").textContent = t("plan.noAnswer");
    } finally {
      $("plan-go").disabled = false;
      $("plan-live").classList.remove("on");
    }
  }

  async function accept(mode) {
    if (!proposed) return;
    if (mode === "create" && !(await window.mf.confirm(t("plan.replaceTitle"), t("plan.replaceDetail")))) return;
    const buttons = [$("plan-accept"), $("plan-append"), $("plan-discard")];
    buttons.forEach((button) => { button.disabled = true; });
    try {
      const r = await window.mf.planAccept(feature.slice(0, 90), proposed, mode);
      $("plan-status").textContent = (r.out || r.err || r.error || "").split("\n")[0];
      if (!r.ok) return;
      proposed = null;
      $("plan-preview").classList.add("hidden");
      window.Views.board.refresh();
      document.querySelector('.tab[data-tab="board"]').click();
    } catch {
      $("plan-status").textContent = t("plan.saveFailed");
    } finally {
      buttons.forEach((button) => { button.disabled = false; });
    }
  }

  function init() {
    // примеры брифа: клик подставляет текст в поле и фокусирует его
    for (const chip of document.querySelectorAll(".plan-examples .ex-chip"))
      chip.addEventListener("click", () => { const t = $("plan-input"); t.value = chip.textContent; t.focus(); });
    $("plan-go").addEventListener("click", go);
    $("plan-input").addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); go(); }
    });
    $("plan-accept").addEventListener("click", () => accept("create"));
    $("plan-append").addEventListener("click", () => accept("add"));
    $("plan-discard").addEventListener("click", () => { proposed = null; $("plan-preview").classList.add("hidden"); });
    window.mf.onClaudeStream(streamEvent);
  }
  return { init, refresh() {} };
})();
