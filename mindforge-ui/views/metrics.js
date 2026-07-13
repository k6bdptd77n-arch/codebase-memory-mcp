"use strict";
// Metrics — the project's own telemetry (metrics.py --project), the locked spec,
// and the latest ledger events. Numbers only claim what the ledger recorded.
window.Views = window.Views || {};

window.Views.metrics = (() => {
  const t = (key, params) => window.I18N.t(key, params);
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
    const strip = $("metric-strip");
    if (!m) { cards.innerHTML = card("—", t("metrics.none")); if (strip) strip.innerHTML = ""; }
    else {
      const rate = m.completion_rate == null ? "—" : Math.round(m.completion_rate * 100) + "%";
      const o = m.orchestrator || {};
      const b = m.brain || {};
      // четыре карточки, которые важны; остальное — тонкая строка ниже
      cards.innerHTML =
        card(m.plans_created ?? 0, t("metrics.plans")) +
        card(m.stories_started ?? 0, t("metrics.stories")) +
        card(rate, t("metrics.completion"), m.completion_rate >= 0.9 ? "teal" : m.completion_rate < 0.6 ? "red" : "") +
        card(m.escalations ?? 0, t("metrics.escalations"), m.escalations ? "red" : "");
      const c = m.cost || {};
      const mins = c.story_seconds ? Math.round(c.story_seconds / 60) : 0;
      if (strip) strip.innerHTML =
        `<span>${esc(t("metrics.agents"))} <b>${o.stories_ok ?? 0}/${(o.stories_ok ?? 0) + (o.stories_failed ?? 0)}</b></span>` +
        `<span>${esc(t("metrics.time"))} <b>${esc(t("metrics.minutes", { n: mins }))}</b></span>` +
        (c.story_cost_usd ? `<span>${esc(t("metrics.cost"))} <b>$${c.story_cost_usd}</b></span>` : "") +
        `<span>${esc(t("metrics.facts"))} <b>${b.net_facts ?? 0}</b></span>` +
        `<span>recall <b>${b.recalls ?? 0}</b></span>` +
        `<span>reflect <b>${b.reflects ?? 0}</b></span>`;
    }

    const spec = $("spec-view");
    if (snap.spec) {
      const s = snap.spec;
      let body = "";
      const reqs = s.requirements || [];
      if (reqs.length) body += `<ul>${reqs.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>`;
      if ((s.constraints || []).length)
        body += `<b>${esc(t("metrics.constraints"))}</b><ul>${s.constraints.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>`;
      for (const d of s.decisions || []) body += `<div><b>${esc(d.question)}</b> → ${esc(d.answer)}</div>`;
      spec.className = "spec-view";     // свёрнута по умолчанию
      spec.innerHTML =
        `<button class="spec-toggle"><span class="chev">▶</span>${esc(s.brief || t("metrics.noBrief"))}` +
        `<span class="spec-date">${esc(String(s.locked || "").slice(0, 10))}</span></button>` +
        `<div class="spec-body">${body}</div>`;
      spec.querySelector(".spec-toggle").addEventListener("click", () => spec.classList.toggle("open"));
    } else { spec.className = "spec-view"; spec.innerHTML = `<div class="pal-empty">${esc(t("metrics.noSpec"))}</div>`; }

    const lg = $("ledger-view");
    lg.innerHTML = (snap.ledger || []).map((e) => {
      const ev = e.event || "", st = e.status || "";
      const dot = /plan/.test(ev) ? "plan"
        : /(complete|locked)/.test(ev + st) ? "good"
        : /(fail|block|escalat)/.test(ev + st) ? "bad"
        : /(story|orchestr|checkpoint)/.test(ev) ? "story" : "";
      const id = e.id ? esc(e.id) : e.name ? esc(e.name) : "";
      return `<div class="lg-row"><span class="lg-t">${esc(String(e.ts || "").slice(5, 16).replace("T", " "))}</span>` +
        `<span class="lg-dot ${dot}"></span><span class="lg-ev">${esc(ev)}</span>` +
        `${id ? `<span class="lg-id">${id}</span>` : ""}${st ? `<span class="lg-st">→ ${esc(st)}</span>` : ""}</div>`;
    }).join("") || `<div class="pal-empty">${esc(t("metrics.noEvents"))}</div>`;
  }

  function init() { refresh(); }
  return { init, refresh };
})();
