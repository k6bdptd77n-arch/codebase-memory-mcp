"use strict";
// Board — mission lanes. One lane per story; the lane IS the status display:
// amber pulse + taxiing rail while the agent flies, teal when merged, red on failure.
window.Views = window.Views || {};

window.Views.board = (() => {
  const lanes = () => document.getElementById("lanes");
  let snap = null;
  let pollTimer = null;
  let openLaneLogs = new Set();          // story ids with visible live log

  const STATE_LABEL = {
    pending: "ожидание", running: "в полёте", review: "на проверке",
    complete: "слито ✓", failed: "провал", blocked: "заблокировано", in_progress: "активна",
  };

  function laneState(g) {
    const rt = snap.states[g.id] || {};
    if (g.status === "complete") return "complete";
    if (rt.running) return "running";
    if (g.status === "failed" || g.status === "blocked") return "failed";
    if (rt.branch) return "review";
    return g.status === "in_progress" ? "in_progress" : "pending";
  }

  function firstOpenId() {
    if (!snap || !snap.goals) return null;
    const g = snap.goals.goals.find((x) => x.status !== "complete");
    return g ? g.id : null;
  }

  function render() {
    const box = lanes();
    const empty = document.getElementById("board-empty");
    const brief = document.getElementById("board-brief");
    const wizard = document.getElementById("plan-wizard");
    if (!snap || !snap.goals) {
      box.innerHTML = ""; brief.textContent = "";
      // пока открыт мастер плана, пустышку не показываем
      empty.classList.toggle("hidden", !wizard.classList.contains("hidden"));
      guide();
      return;
    }
    empty.classList.add("hidden");
    wizard.classList.add("hidden");
    const done = snap.goals.goals.filter((g) => g.status === "complete").length;
    brief.innerHTML = `${esc(snap.goals.brief)}<small>план полёта · слито ${done}/${snap.goals.goals.length}</small>`;
    guide();
    box.innerHTML = "";
    const gate = firstOpenId();
    for (const g of snap.goals.goals) {
      const st = laneState(g);
      const rt = snap.states[g.id] || {};
      const el = document.createElement("div");
      el.className = `lane ${st}`;
      el.dataset.id = g.id;
      const pct = { complete: 100, review: 78, running: 0, failed: 60, in_progress: 40, pending: 0 }[st];
      const tele = st === "running" && (rt.commits != null || rt.elapsedMin != null)
        ? `<span class="lane-tele">${rt.commits ?? 0} коммитов · ${rt.elapsedMin ?? 0}м</span>` : "";
      el.innerHTML = `
        <div class="lane-top">
          <span class="lane-id">${g.id}</span>
          <span class="lane-title">${esc(g.title)}</span>
          <span class="lane-status">${tele}${st === "running" ? '<span class="pulse"></span>' : ""}${STATE_LABEL[st]}</span>
        </div>
        <div class="lane-obj" title="нажмите, чтобы развернуть">${esc(g.objective)}</div>
        <div class="rail"><i style="width:${pct}%"></i></div>
        ${g.attempts >= 2 ? `<div class="escalation">⚠ эскалация — ${g.attempts} провала подряд; нужна модель сильнее или человек</div>` : ""}
        <div class="lane-log hidden"></div>
        <div class="lane-actions"></div>`;
      el.querySelector(".lane-obj").addEventListener("click", (e) => e.target.classList.toggle("open"));
      const act = el.querySelector(".lane-actions");
      const btn = (label, cls, fn, disabled, title) => {
        const b = document.createElement("button");
        b.className = `btn small ${cls}`; b.textContent = label;
        if (title) b.title = title;
        b.disabled = !!disabled;
        b.addEventListener("click", fn);
        act.appendChild(b);
        return b;
      };
      if (st === "pending") btn("▶ Запустить агента", "amber", () => runStory(g.id));
      if (st === "running") { btn("Остановить", "red", () => stopStory(g.id)); showLog(el, g.id); }
      if (st === "review") {
        btn("Проверить", "teal", () => window.Views.board.openReview(g.id),
            g.id !== gate, g.id !== gate ? "очередь на merge: сначала более ранние стори" : "");
        btn("Лог", "ghost", () => toggleLog(el, g.id));
      }
      if (st === "failed") btn("Повторить", "ghost", () => window.mf.storyRetry(g.id).then(refresh));
      if (st === "complete" && g.evidence) {
        const ev = document.createElement("span");
        ev.className = "lane-evidence"; ev.title = g.evidence; ev.textContent = "✓ " + g.evidence;
        act.appendChild(ev);
      }
      box.appendChild(el);
    }
  }

  async function runStory(id) {
    const r = await window.mf.storyRun(id);
    if (!r.ok) note(r.error || "не удалось запустить");
    refresh();
  }
  async function stopStory(id) {
    if (await window.mf.confirm("Остановить агента", `Прервать работающего агента ${id}? Его worktree останется для разбора.`))
      { await window.mf.storyStop(id); refresh(); }
  }

  function toggleLog(el, id) {
    const lg = el.querySelector(".lane-log");
    lg.classList.toggle("hidden");
    if (!lg.classList.contains("hidden")) { openLaneLogs.add(id); pump(); } else openLaneLogs.delete(id);
  }
  function showLog(el, id) {
    el.querySelector(".lane-log").classList.remove("hidden");
    openLaneLogs.add(id);
  }
  async function pump() {
    for (const id of openLaneLogs) {
      const el = lanes().querySelector(`.lane[data-id="${id}"] .lane-log`);
      if (!el) continue;
      const t = await window.mf.logTail(id);
      const stick = el.scrollTop + el.clientHeight >= el.scrollHeight - 8;
      el.textContent = t || "(агент стартует — лог появится, как только claude начнёт писать)";
      if (stick) el.scrollTop = el.scrollHeight;
    }
  }

  // review drawer
  let drawerId = null;
  function renderPatch(body, ev) {
    // the actual patch, so approving is never blind: monospace block, +/- coloring
    const head = document.createElement("div");
    head.className = "diff-head";
    head.textContent = "=== патч" + (ev.truncated ? " (показаны первые 1500 строк)" : "") + ":";
    body.appendChild(head);
    const block = document.createElement("div");
    block.className = "diff-block";
    for (const line of ev.patch.split("\n")) {
      const row = document.createElement("div");
      row.className = "diff-line" +
        (line.startsWith("+++") || line.startsWith("---") || /^(diff |index |@@)/.test(line) ? " diff-meta"
          : line.startsWith("+") ? " diff-add"
          : line.startsWith("-") ? " diff-del" : "");
      row.textContent = line === "" ? " " : line;
      block.appendChild(row);
    }
    body.appendChild(block);
  }
  async function openReview(id) {
    drawerId = id;
    const d = document.getElementById("drawer");
    document.getElementById("drawer-title").textContent = `Проверка ${id}`;
    document.getElementById("drawer-progress").textContent = "";
    const body = document.getElementById("drawer-body");
    body.textContent = "собираю доказательства…";
    d.classList.remove("hidden");
    try {
      const ev = await window.mf.reviewEvidence(id);
      body.textContent = ev.text;
      if (ev.ok && ev.patch) renderPatch(body, ev);
    } catch { body.textContent = "не удалось собрать доказательства — попробуйте ещё раз"; }
  }
  function closeReview() { document.getElementById("drawer").classList.add("hidden"); drawerId = null; }

  async function approve() {
    if (!drawerId) return;
    const id = drawerId;
    if (!(await window.mf.confirm(`Слить ${id}`,
      "Прогонит весь тестовый набор (gate), закроет стори, сольёт ветку и уберёт worktree."))) return;
    progress(`▸ gate: гоняю тестовый набор…`);
    const r = await window.mf.storyApprove(id, `принято в MindForge Control`);
    for (const s of r.steps) progress(`${s.ok ? "✓" : "✗"} ${s.name}\n${s.out}`, s.ok);
    if (r.ok) { progress(`✓ ${id} слито — ${r.testsTail}`, true); setTimeout(closeReview, 1200); }
    refresh();
  }
  async function fail() {
    if (!drawerId) return;
    const id = drawerId;
    if (!(await window.mf.confirm(`Провалить ${id}`, "Пометит стори проваленной; ветка и worktree останутся для разбора.")))
      return;
    await window.mf.storyFail(id, "отклонено на проверке");
    closeReview(); refresh();
  }
  function progress(text, ok) {
    const p = document.getElementById("drawer-progress");
    const div = document.createElement("div");
    div.className = ok === false ? "bad" : ok ? "ok" : "";
    div.textContent = text;
    p.appendChild(div); p.scrollTop = p.scrollHeight;
  }

  // autopilot: agent exited → LLM review → approve/fail automatically
  async function onExit(id) {
    if (!document.getElementById("autopilot").checked) { refresh(); return; }
    note(`автопилот: проверяю ${id}…`);
    const r = await window.mf.reviewLLM(id);
    note(`автопилот ${id}: ${r.verdict}`);
    if (r.verdict === "COMPLETE" && id === firstOpenId()) {
      const ap = await window.mf.storyApprove(id, "автопилот: " + r.text.slice(0, 160));
      note(ap.ok ? `автопилот: ${id} слито ✓` : `автопилот: ${id} не прошло gate — оставлено на ручную проверку`);
    } else if (r.verdict === "FAILED") {
      await window.mf.storyFail(id, "автопилот: " + r.text.slice(0, 160));
    }
    refresh();
  }

  // Путеводитель: одна строка, которая всегда говорит, каков следующий шаг.
  function guide() {
    const gt = document.getElementById("guide-text");
    const cta = document.getElementById("guide-cta");
    const show = (text, ctaLabel, fn) => {
      gt.textContent = text;
      cta.classList.toggle("hidden", !ctaLabel);
      if (ctaLabel) { cta.textContent = ctaLabel; cta.onclick = fn; }
    };
    if (!snap || !snap.goals)
      return show("Шаг 1 · Плана нет — опишите фичу, планировщик разложит её на стори.",
        "Открыть «План»", () => document.querySelector('.tab[data-tab="plan"]').click());
    const gs = snap.goals.goals;
    const by = (st) => gs.filter((g) => laneState(g) === st);
    const rev = by("review"), run = by("running"), pen = by("pending"), fail = by("failed");
    if (rev.length)
      return show(`Шаг 3 · ${rev[0].id} ждёт проверки — посмотрите диф и примите merge.`,
        `Проверить ${rev[0].id}`, () => openReview(rev[0].id));
    if (run.length)
      return show(`Шаг 2 · Агент в полёте (${run.map((g) => g.id).join(", ")}) — живой лог на дорожке.` +
        (pen.length ? " Можно запустить следующую стори параллельно." : ""), null);
    if (pen.length)
      return show(`Шаг 2 · Запустите агента на ${pen[0].id} — он будет работать в изолированном worktree.`,
        `▶ Запустить ${pen[0].id}`, () => runStory(pen[0].id));
    if (fail.length)
      return show(`⚠ ${fail[0].id} провалена — посмотрите лог и повторите, либо переформулируйте стори.`,
        "Повторить", () => window.mf.storyRetry(fail[0].id).then(refresh));
    return show("Миссия завершена ✓ — все стори слиты. Начните следующую: опишите новую фичу.",
      "Открыть «План»", () => document.querySelector('.tab[data-tab="plan"]').click());
  }

  // ── ручной план: brief + N стори (title / objective / команда проверки) ──
  // Отправка идёт через тот же движок, что и планировщик: goals.py create
  // --brief … --goal "title::objective" (команда проверки дописывается в конец
  // objective — так того требует контракт стори; отдельного флага у create нет).
  function wizardRow() {
    const row = document.createElement("div");
    row.className = "wiz-story";
    row.innerHTML = `
      <div class="wiz-row1">
        <input class="wz-title" placeholder="название (kebab-case)" spellcheck="false" />
        <button class="wz-del btn ghost small" title="убрать стори">✕</button>
      </div>
      <textarea class="wz-obj" rows="2" placeholder="задача: какие файлы можно трогать и что должно получиться" spellcheck="false"></textarea>
      <input class="wz-verify" placeholder="команда проверки (например: npm test)" spellcheck="false" />`;
    row.querySelector(".wz-del").addEventListener("click", () => {
      if (document.querySelectorAll("#wiz-stories .wiz-story").length > 1) row.remove();
    });
    document.getElementById("wiz-stories").appendChild(row);
    return row;
  }
  function wizardOpen() {
    const box = document.getElementById("wiz-stories");
    box.innerHTML = "";
    document.getElementById("wiz-brief").value = "";
    document.getElementById("wiz-err").textContent = "";
    wizardRow();
    document.getElementById("plan-wizard").classList.remove("hidden");
    document.getElementById("board-empty").classList.add("hidden");
    document.getElementById("wiz-brief").focus();
  }
  function wizardClose() {
    document.getElementById("plan-wizard").classList.add("hidden");
    render();
  }
  async function wizardSubmit() {
    const err = document.getElementById("wiz-err");
    err.textContent = "";
    const brief = document.getElementById("wiz-brief").value.trim();
    if (!brief) { err.textContent = "нужен brief"; return; }
    const stories = [];
    for (const row of document.querySelectorAll("#wiz-stories .wiz-story")) {
      const title = row.querySelector(".wz-title").value.trim();
      const obj = row.querySelector(".wz-obj").value.trim();
      const verify = row.querySelector(".wz-verify").value.trim();
      if (!title && !obj) continue;                        // пустую строку молча пропускаем
      if (!title || !obj) { err.textContent = "у каждой стори нужны и название, и задача"; return; }
      if (title.includes("::")) { err.textContent = "«::» в названии недопустимо"; return; }
      stories.push(`${title}::${obj}${verify ? ` Verify: ${verify}` : ""}`);
    }
    if (!stories.length) { err.textContent = "нужна хотя бы одна стори"; return; }
    const go = document.getElementById("wiz-create");
    go.disabled = true;
    try {
      const r = await window.mf.planAccept(brief, stories, "create");
      if (r.ok) { wizardClose(); refresh(); }
      else err.textContent = (r.err || r.out || "goals.py create не сработал").trim().slice(0, 200);
    } catch { err.textContent = "не удалось создать план"; }
    finally { go.disabled = false; }
  }

  const note = (t) => { document.getElementById("tm-note").textContent = t; };
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  // A failed IPC round-trip must never blank the board: keep the last good
  // snapshot, and only believe "плана нет" after two consecutive empty reads
  // (a lone null usually means goals.py was mid-write).
  let emptyStreak = 0;
  async function refresh() {
    try {
      const s = await window.mf.snapshot();
      if (s && s.goals) { snap = s; emptyStreak = 0; }
      else {
        emptyStreak++;
        if (emptyStreak >= 2 || !snap || !snap.goals) snap = s || snap;
      }
      render();
      const goals = snap && snap.goals;
      document.getElementById("tm-plan").textContent = goals
        ? `${goals.goals.filter((g) => g.status === "complete").length}/${goals.goals.length} · ${String(goals.brief || "").slice(0, 48)}`
        : "плана нет";
      const live = Object.values((snap && snap.states) || {}).filter((x) => x.running).length;
      document.getElementById("tm-agents").textContent = `агентов: ${live}`;
    } catch { /* keep the last rendered state */ }
  }

  function init() {
    document.getElementById("drawer-close").addEventListener("click", closeReview);
    document.getElementById("drawer-approve").addEventListener("click", approve);
    document.getElementById("drawer-fail").addEventListener("click", fail);
    document.getElementById("board-wizard-open").addEventListener("click", wizardOpen);
    document.getElementById("board-open-plan").addEventListener("click",
      () => document.querySelector('.tab[data-tab="plan"]').click());
    document.getElementById("wiz-add").addEventListener("click", wizardRow);
    document.getElementById("wiz-create").addEventListener("click", wizardSubmit);
    document.getElementById("wiz-cancel").addEventListener("click", wizardClose);
    window.mf.onStoryState((m) => { if (m.state === "exited") onExit(m.id); else refresh(); });
    pollTimer = setInterval(pump, 1500);
    refresh();
  }

  // project switched: forget the old project's snapshot before re-reading
  function onProject() {
    snap = null; emptyStreak = 0; openLaneLogs.clear(); closeReview();
    document.getElementById("plan-wizard").classList.add("hidden");
    refresh();
  }

  return { init, refresh, openReview, onProject };
})();
