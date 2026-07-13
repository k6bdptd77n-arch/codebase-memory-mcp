"use strict";
// Board — mission lanes. One lane per story; the lane IS the status display:
// amber pulse + taxiing rail while the agent flies, teal when merged, red on failure.
window.Views = window.Views || {};

window.Views.board = (() => {
  const t = (key, params) => window.I18N.t(key, params);
  const lanes = () => document.getElementById("lanes");
  let snap = null;
  let pollTimer = null;
  let mergedOpen = false;                // архивная группа «Смержено» раскрыта?
  let openLaneLogs = new Set();          // story ids with visible live log

  const stateLabel = (state) => t(`board.state.${state}`);

  // «взлётка»: план → код → verify → ревью → merge(gate). Честная проекция
  // доступного состояния; гейт зеленеет ТОЛЬКО на complete.
  function phaseRail(st, hasBranch) {
    const seg = ["plan", "code", "verify", "review", "project"].map((name) => t(`board.flight.${name}`));
    const fill = { pending: 1, in_progress: 2, running: 1, review: 4,
      complete: 5, failed: hasBranch ? 4 : 2 }[st] ?? 1;
    let h = '<div class="phase-rail">';
    for (let i = 0; i < 5; i++) {
      let cls = "";
      if (st === "complete") cls = "ok";
      else if (i < fill) cls = "done";
      if (st === "running" && i === 1) cls = "run";
      if (st === "failed" && i === 4) cls = "bad";
      h += `<i class="${cls}${i === 4 ? " gate" : ""}" title="${seg[i]}"></i>`;
    }
    return h + "</div>";
  }

  function laneState(g) {
    const rt = snap.states[g.id] || {};
    if (g.status === "complete") return "complete";
    if (rt.running) return "running";
    if (g.status === "failed" || g.status === "blocked") return "failed";
    if (rt.branch) return "review";
    return g.status === "in_progress" ? "in_progress" : "pending";
  }

  // последняя содержательная строка-вопрос из лога агента (провал «агент спрашивает»)
  function extractQuestion(t) {
    const lines = String(t || "").split("\n").map((s) => s.trim()).filter(Boolean);
    const qs = lines.filter((l) => /\?\s*$/.test(l) && l.length > 12);
    return qs.length ? qs[qs.length - 1].slice(0, 220) : "";
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
    const gs = snap.goals.goals;
    const done = gs.filter((g) => g.status === "complete").length;
    brief.innerHTML = `${esc(snap.goals.brief)}<small>${esc(t("board.acceptedCount", { done, total: gs.length }))}</small>`;
    guide();
    box.innerHTML = "";
    const gate = firstOpenId();

    const laneEl = (g) => {
      const st = laneState(g);
      const rt = snap.states[g.id] || {};
      const el = document.createElement("div");
      el.className = `lane ${st}${g.id === gate ? " is-next" : ""}`;
      el.dataset.id = g.id;
      const tele = st === "running" && (rt.commits != null || rt.elapsedMin != null)
        ? `<span class="lane-tele">${esc(t("board.telemetry", { commits: rt.commits ?? 0, minutes: rt.elapsedMin ?? 0 }))}</span>` : "";
      el.innerHTML = `
        <div class="lane-top">
          <span class="lane-id">${g.id}</span>
          <span class="lane-title">${esc(g.title)}</span>
          <span class="lane-status">${tele}<span class="lane-chip">${esc(stateLabel(st))}</span></span>
        </div>
        <div class="lane-obj" title="${esc(g.objective)}">${esc(g.objective)}</div>
        ${phaseRail(st, !!rt.branch)}
        ${g.attempts >= 2 ? `<div class="escalation">${esc(t("board.escalation", { attempts: g.attempts }))}</div>` : ""}
        <div class="lane-question hidden"></div>
        <div class="lane-log hidden"></div>
        <div class="lane-actions"></div>`;
      // строка кликабельна целиком → полный текст и доказательства в drawer
      el.addEventListener("click", (e) => {
        if (e.target.closest("button, .lane-log")) return;
        openReview(g.id);
      });
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
      if (st === "pending") btn(t("board.runAgent"), "primary", () => runStory(g.id));
      if (st === "running") {
        btn(t("board.stop"), "red", () => stopStory(g.id));
        btn(t("board.log"), "ghost", () => toggleLog(el, g.id));
      }
      if (st === "review") {
        btn(t("board.review"), "teal", () => openReview(g.id),
            g.id !== gate, g.id !== gate ? t("board.reviewOrder") : "");
        btn(t("board.log"), "ghost", () => toggleLog(el, g.id));
      }
      if (st === "failed") {
        btn(t("board.retry"), "ghost", () => window.mf.storyRetry(g.id).then(refresh));
        // если агент упёрся и задал вопрос — он не должен тонуть в логе провала
        window.mf.logTail(g.id).then((t) => {
          const q = extractQuestion(t);
          const box = el.querySelector(".lane-question");
          if (q && box && el.isConnected) {
            box.textContent = t("board.agentAsks", { question: q });
            box.classList.remove("hidden");
          }
        }).catch(() => {});
      }
      if (st === "complete" && g.evidence) {
        const ev = document.createElement("span");
        ev.className = "lane-evidence"; ev.title = g.evidence; ev.textContent = "✓ " + g.evidence;
        act.appendChild(ev);
      }
      return el;
    };

    syncDrawer();  // открытая панель ревью обязана отражать СВЕЖИЙ статус, не момент открытия

    // сначала — что происходит СЕЙЧАС; принятые сворачиваются в архивную группу
    const active = gs.filter((g) => laneState(g) !== "complete");
    const merged = gs.filter((g) => laneState(g) === "complete");
    for (const g of active) box.appendChild(laneEl(g));
    if (merged.length) {
      const grp = document.createElement("div");
      grp.className = "merged-group" + (mergedOpen ? " open" : "");
      const head = document.createElement("button");
      head.className = "merged-head";
      head.innerHTML = `<span class="chev">▶</span> ${esc(t("board.acceptedGroup", { count: merged.length }))}`;
      head.addEventListener("click", () => { mergedOpen = !mergedOpen; grp.classList.toggle("open", mergedOpen); });
      const body = document.createElement("div");
      body.className = "merged-body";
      for (const g of merged) body.appendChild(laneEl(g));
      grp.appendChild(head); grp.appendChild(body);
      box.appendChild(grp);
    }
  }

  async function runStory(id) {
    const r = await window.mf.storyRun(id);
    if (!r.ok) note(r.error || t("board.runFailed"));
    refresh();
  }
  async function stopStory(id) {
    if (await window.mf.confirm(t("board.stopTitle"), t("board.stopDetail", { id })))
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
      el.textContent = t || window.I18N.t("board.logStarting");
      if (stick) el.scrollTop = el.scrollHeight;
    }
  }

  // review drawer
  let drawerId = null;
  // Живая синхронизация: статус стори может измениться, пока панель открыта (автопилот
  // провалил, другой процесс принял) — кнопки обязаны гаснуть, а не вести в тупик.
  function syncDrawer() {
    if (!drawerId || !snap || !snap.goals) return;
    const g = snap.goals.goals.find((x) => x && x.id === drawerId);
    if (!g) return;
    const st = laneState(g);
    const reviewable = st === "review" && drawerId === firstOpenId();
    document.getElementById("drawer-approve").disabled = !reviewable;
    document.getElementById("drawer-fail").disabled = st !== "review";
    document.getElementById("drawer-state").textContent =
      st === "failed" ? t("board.failedState")
      : st === "complete" ? t("board.completeState")
      : st === "running" ? t("board.runningState")
      : "";
  }
  function renderPatch(body, ev) {
    // the actual patch, so approving is never blind: monospace block, +/- coloring
    const head = document.createElement("div");
    head.className = "diff-head";
    head.textContent = t("board.patch", { suffix: ev.truncated ? t("board.patchTruncated") : "" });
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
    const g = snap && snap.goals ? snap.goals.goals.find((x) => x && x.id === id) : null;
    const reviewable = g && laneState(g) === "review" && id === firstOpenId();
    document.getElementById("drawer-title").textContent = `${id} · ${g ? g.title : ""}`;
    document.getElementById("drawer-progress").textContent = "";
    // Принять/Провалить активны только для стори, реально стоящей на ревью
    document.getElementById("drawer-approve").disabled = !reviewable;
    document.getElementById("drawer-fail").disabled = !(g && laneState(g) === "review");
    const body = document.getElementById("drawer-body");
    body.textContent = "";
    if (g) {
      const obj = document.createElement("div");
      obj.className = "drawer-obj";
      obj.textContent = g.objective + "\n\n";
      body.appendChild(obj);
    }
    const load = document.createElement("div");
    load.textContent = t("board.collecting");
    body.appendChild(load);
    d.classList.remove("hidden");
    syncDrawer();
    try {
      const ev = await window.mf.reviewEvidence(id);
      load.textContent = ev.text;
      if (ev.ok && ev.patch) renderPatch(body, ev);
    } catch { load.textContent = t("board.collectFailed"); }
  }
  function closeReview() { document.getElementById("drawer").classList.add("hidden"); drawerId = null; }

  async function approve() {
    if (!drawerId) return;
    const id = drawerId;
    if (!(await window.mf.confirm(t("board.acceptTitle", { id }), t("board.acceptDetail")))) return;
    progress(t("board.testing"));
    const mode = window.mfMode ? window.mfMode() : "manual";
    const r = await window.mf.storyApprove(id, t("board.acceptEvidence"), mode);
    for (const s of r.steps) progress(`${s.ok ? "✓" : "✗"} ${s.name}\n${s.out}`, s.ok);
    if (r.ok) { progress(t("board.acceptDone", { id, tail: r.testsTail }), true); setTimeout(closeReview, 1200); }
    refresh();
  }
  async function fail() {
    if (!drawerId) return;
    const id = drawerId;
    if (!(await window.mf.confirm(t("board.rejectTitle", { id }), t("board.rejectDetail"))))
      return;
    await window.mf.storyFail(id, t("board.rejected"));
    closeReview(); refresh();
  }
  function progress(text, ok) {
    const p = document.getElementById("drawer-progress");
    const div = document.createElement("div");
    div.className = ok === false ? "bad" : ok ? "ok" : "";
    div.textContent = text;
    p.appendChild(div); p.scrollTop = p.scrollHeight;
  }

  // Шкала доверия: agent exited → поведение зависит от режима (window.mfMode()).
  //   manual — ничего не делаем, человек проверяет и мержит сам через drawer.
  //   review — LLM-ревью запускается ОБЯЗАТЕЛЬНО (вердикт виден в статусбаре), но
  //            merge/fail всё равно требует ручного клика — доверие ещё не заработано.
  //   auto   — то же ревью, и при COMPLETE merge происходит сам (storyApprove сам
  //            гоняет verify-гейт заново — режим никогда не обходит проверку).
  async function onExit(id) {
    const mode = window.mfMode ? window.mfMode() : "manual";
    if (mode === "manual") { refresh(); return; }
    const label = mode === "auto" ? t("board.autopilot") : t("board.flight.review");
    note(t("board.autoChecking", { label, id }));
    const r = await window.mf.reviewLLM(id);
    if (mode !== "auto") {                                        // review: только уведомление, merge рукой
      note(t("board.reviewReady", { id, verdict: r.verdict }));
      refresh();
      return;
    }
    note(t("board.autoResult", { label, id, verdict: r.verdict }));
    if (r.verdict === "COMPLETE" && id === firstOpenId()) {
      const ap = await window.mf.storyApprove(id, `${t("board.autopilot")}: ${r.text.slice(0, 160)}`, "auto");
      note(ap.ok ? t("board.autoAccepted", { id }) : t("board.autoTestsFailed", { id }));
    } else if (r.verdict === "FAILED") {
      await window.mf.storyFail(id, `${t("board.autopilot")}: ${r.text.slice(0, 160)}`);
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
      return show(t("board.guideStart"),
        null);
    const gs = snap.goals.goals;
    const by = (st) => gs.filter((g) => laneState(g) === st);
    const rev = by("review"), run = by("running"), pen = by("pending"), fail = by("failed");
    if (rev.length)
      return show(t("board.guideReview", { id: rev[0].id }),
        t("board.reviewId", { id: rev[0].id }), () => openReview(rev[0].id));
    if (run.length)
      return show(t("board.guideRunning", { ids: run.map((g) => g.id).join(", "), parallel: pen.length ? t("board.guideParallel") : "" }), null);
    if (pen.length)
      return show(t("board.guidePending", { id: pen[0].id }),
        t("board.runId", { id: pen[0].id }), () => runStory(pen[0].id));
    if (fail.length)
      return show(t("board.guideFailed", { id: fail[0].id }),
        t("board.retry"), () => window.mf.storyRetry(fail[0].id).then(refresh));
    return show(t("board.guideDone"),
      t("board.openPlan"), () => document.querySelector('.tab[data-tab="plan"]').click());
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
        <input class="wz-title" placeholder="${t("board.storyTitlePh")}" spellcheck="false" />
        <button class="wz-del btn ghost small" title="${t("board.removeStory")}">✕</button>
      </div>
      <textarea class="wz-obj" rows="2" placeholder="${t("board.storyObjectivePh")}" spellcheck="false"></textarea>
      <input class="wz-verify" list="verify-suggestions" placeholder="${t("board.verifyPh")}" spellcheck="false" />`;
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
    if (!brief) { err.textContent = t("board.briefRequired"); return; }
    const stories = [];
    for (const row of document.querySelectorAll("#wiz-stories .wiz-story")) {
      const title = row.querySelector(".wz-title").value.trim();
      const obj = row.querySelector(".wz-obj").value.trim();
      const verify = row.querySelector(".wz-verify").value.trim();
      if (!title && !obj) continue;                        // пустую строку молча пропускаем
      if (!title || !obj) { err.textContent = t("board.storyFieldsRequired"); return; }
      if (title.includes("::")) { err.textContent = t("board.badSeparator"); return; }
      stories.push(`${title}::${obj}${verify ? ` Verify: ${verify}` : ""}`);
    }
    if (!stories.length) { err.textContent = t("board.storyRequired"); return; }
    const go = document.getElementById("wiz-create");
    go.disabled = true;
    try {
      const r = await window.mf.planAccept(brief, stories, "create");
      if (r.ok) { wizardClose(); refresh(); }
      else err.textContent = (r.err || r.out || t("board.goalsFailed")).trim().slice(0, 200);
    } catch { err.textContent = t("board.planCreateFailed"); }
    finally { go.disabled = false; }
  }

  // ── композер на пустой доске: описал → план → полосы на месте, без вкладок ──
  let composing = false, bcProposed = null, bcBrief = "";
  function composerStream(m) {
    if (m.tag !== "plan" || !composing) return;
    const out = document.getElementById("bc-stream");
    out.classList.remove("hidden");
    const stick = out.scrollTop + out.clientHeight >= out.scrollHeight - 8;
    if (m.error) out.textContent += `\n[${t("board.streamError")}] ${m.error}`;
    else if (m.ev && m.ev.type === "assistant" && m.ev.message && Array.isArray(m.ev.message.content))
      for (const b of m.ev.message.content) {
        if (b.type === "thinking" && b.thinking) out.textContent += b.thinking;
        if (b.type === "text" && b.text) out.textContent += b.text;
      }
    if (stick) out.scrollTop = out.scrollHeight;
  }
  async function composerGo() {
    bcBrief = document.getElementById("bc-input").value.trim();
    if (!bcBrief) return;
    const go = document.getElementById("bc-go");
    go.disabled = true; composing = true;
    document.getElementById("bc-status").textContent = t("board.composerReading");
    document.getElementById("bc-stream").textContent = "";
    document.getElementById("bc-preview").classList.add("hidden");
    try {
      const r = await window.mf.planGenerate(bcBrief);
      if (!r.ok) {
        document.getElementById("bc-status").textContent = r.error || t("board.composerFailed");
        return;
      }
      bcProposed = r.stories;
      document.getElementById("bc-status").textContent = t("board.composerProposed", { count: r.stories.length });
      const ol = document.getElementById("bc-stories");
      ol.innerHTML = "";
      for (const s of r.stories) {
        const [t, o] = [s.split("::")[0], s.split("::").slice(1).join("::")];
        const li = document.createElement("li");
        li.innerHTML = `<div class="st-title">${esc(t)}</div><div class="st-obj">${esc(o)}</div>`;
        ol.appendChild(li);
      }
      document.getElementById("bc-preview").classList.remove("hidden");
    } catch {
      document.getElementById("bc-status").textContent = t("board.composerNoAnswer");
    } finally {
      go.disabled = false;
      composing = false;
    }
  }
  async function composerAccept() {
    if (!bcProposed) return;
    const accept = document.getElementById("bc-accept");
    accept.disabled = true;
    try {
      const r = await window.mf.planAccept(bcBrief.slice(0, 90), bcProposed, "create");
      document.getElementById("bc-status").textContent = (r.out || r.err || r.error || "").split("\n")[0];
      if (!r.ok) return;
      bcProposed = null;
      document.getElementById("bc-preview").classList.add("hidden");
      document.getElementById("bc-stream").classList.add("hidden");
      refresh();                       // план создан → render() сам заменит композер полосами
    } catch {
      document.getElementById("bc-status").textContent = t("board.composerSaveFailed");
    } finally { accept.disabled = false; }
  }
  function composerReset() {
    bcProposed = null;
    for (const id of ["bc-preview", "bc-stream"]) document.getElementById(id).classList.add("hidden");
    document.getElementById("bc-status").textContent = "";
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
        : t("runtime.noPlan");
      const live = Object.values((snap && snap.states) || {}).filter((x) => x.running).length;
      document.getElementById("tm-agents").textContent = t("board.agents", { count: live });
    } catch { /* keep the last rendered state */ }
  }

  function init() {
    document.getElementById("drawer-close").addEventListener("click", closeReview);
    document.getElementById("drawer-approve").addEventListener("click", approve);
    document.getElementById("drawer-fail").addEventListener("click", fail);
    document.getElementById("board-wizard-open").addEventListener("click", wizardOpen);
    document.getElementById("board-open-plan").addEventListener("click",
      () => document.querySelector('.tab[data-tab="plan"]').click());
    document.getElementById("bc-go").addEventListener("click", composerGo);
    document.getElementById("bc-input").addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); composerGo(); }
    });
    document.getElementById("bc-accept").addEventListener("click", composerAccept);
    document.getElementById("bc-discard").addEventListener("click", composerReset);
    window.mf.onClaudeStream(composerStream);
    document.getElementById("board-run-demo").addEventListener("click", async (e) => {
      const original = e.target.textContent;
      e.target.disabled = true; e.target.textContent = "…";
      const r = await window.mf.runDemo();
      if (!r.ok) note(r.error || t("board.demoFailed"));
      e.target.disabled = false; e.target.textContent = original;
    });
    document.getElementById("wiz-add").addEventListener("click", wizardRow);
    document.getElementById("wiz-create").addEventListener("click", wizardSubmit);
    document.getElementById("plan-wizard").addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); wizardSubmit(); }
    });
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
