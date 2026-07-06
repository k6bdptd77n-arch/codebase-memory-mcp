"use strict";
// Metrics — the project's own telemetry (metrics.py --project), the locked spec,
// and the latest ledger events. Numbers only claim what the ledger recorded.
window.Views = window.Views || {};

window.Views.metrics = (() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  function card(v, k, cls = "") {
    return `<div class="mcard"><div class="m-v ${cls}">${v}</div><div class="m-k">${k}</div></div>`;
  }

  async function refresh() {
    // a single rejected IPC must not blank the tab — keep the last rendered state
    let m, snap;
    try { [m, snap] = await Promise.all([window.mf.metrics(), window.mf.snapshot()]); }
    catch { return; }
    if (!snap) return;
    const cards = $("metric-cards");
    if (!m) { cards.innerHTML = card("—", "телеметрии пока нет"); }
    else {
      const rate = m.completion_rate == null ? "—" : Math.round(m.completion_rate * 100) + "%";
      const o = m.orchestrator || {};
      const b = m.brain || {};
      cards.innerHTML =
        card(m.plans_created ?? 0, "планов") +
        card(m.stories_started ?? 0, "сторей начато") +
        card(rate, "доля завершения", m.completion_rate >= 0.9 ? "teal" : m.completion_rate < 0.6 ? "red" : "amber") +
        card(m.escalations ?? 0, "эскалаций", m.escalations ? "red" : "") +
        card(`${o.stories_ok ?? 0}/${(o.stories_ok ?? 0) + (o.stories_failed ?? 0)}`, "стори агентов ок", o.stories_failed ? "amber" : "teal") +
        card(b.net_facts ?? 0, "фактов в мозге", "amber") +
        card(b.recalls ?? 0, "recall-ов") +
        card(b.reflects ?? 0, "reflect-ов");
    }

    const spec = $("spec-view");
    if (snap.spec) {
      let h = `<b>${esc(snap.spec.brief || "(no brief)")}</b><br>locked ${esc(String(snap.spec.locked || "").slice(0, 16))}<br><br>`;
      for (const r of snap.spec.requirements || []) h += `• ${esc(r)}<br>`;
      if ((snap.spec.constraints || []).length) {
        h += "<br><b>constraints</b><br>";
        for (const c of snap.spec.constraints) h += `• ${esc(c)}<br>`;
      }
      for (const d of snap.spec.decisions || []) h += `<br><b>${esc(d.question)}</b> → ${esc(d.answer)}`;
      spec.innerHTML = h;
    } else spec.textContent = "спека не залочена — зафиксируйте её через spec.py после прояснения задачи";

    const lg = $("ledger-view");
    lg.innerHTML = (snap.ledger || []).map((e) => {
      const cls = /complete|spec_locked|plan_created/.test(e.event) ? "lg-ok"
        : /fail|block|escalat/.test(e.event + (e.status || "")) ? "lg-bad" : "lg-ev";
      const extra = e.id ? ` ${e.id}` : e.name ? ` ${e.name}` : "";
      return `<div>${esc(String(e.ts || "").slice(5, 16).replace("T", " "))} <span class="${cls}">${esc(e.event)}</span>${esc(extra)}${e.status ? " → " + esc(e.status) : ""}</div>`;
    }).join("") || "событий пока нет";
  }

  function init() { refresh(); }
  return { init, refresh };
})();
