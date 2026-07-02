"use strict";
/* global Terminal, FitAddon */

// ---- integrated terminal (real PTY via main process) ----
const term = new Terminal({
  fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
  fontSize: 12.5, cursorBlink: true,
  theme: { background: "#0b0f17", foreground: "#c9d4e5", cursor: "#34d3b0",
           selectionBackground: "#26324a", brightGreen: "#4ec9a0", yellow: "#f5a55b" },
});
const fit = new FitAddon.FitAddon();
term.loadAddon(fit);
term.open(document.getElementById("term"));
fit.fit();

window.mf.onPtyData((d) => term.write(d));
window.mf.onPtyExit(() => term.write("\r\n\x1b[31m[shell exited]\x1b[0m\r\n"));

const ro = new ResizeObserver(() => { try { fit.fit(); window.mf.ptyResize(term.cols, term.rows); } catch {} });
ro.observe(document.getElementById("term"));

// ---- Panel ② : annotate each command typed into the terminal ----
let lineBuf = "";
term.onData((d) => {
  window.mf.ptyInput(d);
  for (const ch of d) {
    if (ch === "\r" || ch === "\n") { commitCommand(lineBuf); lineBuf = ""; }
    else if (ch === "" || ch === "\b") { lineBuf = lineBuf.slice(0, -1); }
    else if (ch >= " ") { lineBuf += ch; }
  }
});

function explain(cmd) {
  const c = cmd.trim();
  const rules = [
    [/^python3?\s+\S*brain\.py\s+(\w+)/, (m) => `MindForge brain: ${m[1]} — read/grow the persistent memory layer.`],
    [/^python3?\s+\S*goals\.py/, () => "Drive the multi-story goal loop (verification-gated)."],
    [/^python3?\s+\S*spec\.py/, () => "Lock/show the clarified spec ledger."],
    [/^python3?\s+\S*metrics\.py/, () => "Summarize cross-project observability (incl. brain growth)."],
    [/\bcodebase-memory-mcp\b.*\bcli\s+(\w+)/, (m) => `Query the memory graph: ${m[1]}.`],
    [/^git\s+(\w+)/, (m) => `Git: ${m[1]} — inspect/modify version control state.`],
    [/^(make|cmake)\b/, () => "Build step — compiles/links the project."],
    [/^(npm|pnpm|yarn)\s+(\w+)/, (m) => `Node package manager: ${m[2]}.`],
    [/^(claude|aider|codex)\b/, () => "Launch an AI coding agent inside this terminal."],
    [/^cd\b/, () => "Change working directory."],
    [/^(ls|ll|tree)\b/, () => "List directory contents."],
    [/^(cat|less|head|tail|bat)\b/, () => "Read a file."],
    [/^rm\b/, () => "⚠ Delete files — destructive (the guard hook may prompt)."],
    [/^(pytest|python3?\s+-m\s+pytest)/, () => "Run the test suite."],
  ];
  for (const [re, fn] of rules) { const m = c.match(re); if (m) return fn(m); }
  return c ? "Shell command." : null;
}

function commitCommand(raw) {
  const cmd = raw.trim();
  const why = explain(cmd);
  if (!cmd || !why) return;
  const box = document.getElementById("p-cmds");
  if (box.querySelector(".muted")) box.innerHTML = "";
  const el = document.createElement("div");
  el.className = "cmd";
  el.innerHTML = `<code>$ ${esc(cmd)}</code><span class="why">${esc(why)}</span>`;
  box.prepend(el);
  while (box.children.length > 30) box.removeChild(box.lastChild);
}

// ---- Panels ①③④ : refreshed from real data sources ----
function esc(s) { return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])); }

function renderTraces(list) {
  const box = document.getElementById("p-reason");
  if (!list.length) { box.innerHTML = '<div class="muted">No recorded steps yet. The brain logs one trace per session (Stop hook), and <code>brain.py reflect</code> adds lessons.</div>'; return; }
  box.innerHTML = list.reverse().map((t) => {
    const goal = t.goal || t.trace || "(step)";
    const tools = t.tools ? Object.entries(t.tools).map(([k, v]) => `${k}×${v}`).join(" ") : "";
    const files = (t.files || []).length ? ` · ${t.files.length} file(s)` : "";
    const lesson = t.lesson ? `<div class="meta">lesson: ${esc(t.lesson)}</div>` : "";
    return `<div class="step"><b>▸</b> ${esc(goal)}<div class="meta">${esc(tools)}${esc(files)}</div>${lesson}</div>`;
  }).join("");
}

function renderLayers(s) {
  document.getElementById("p-layers").innerHTML =
    `<div class="kv">brain</div>${esc(s.brain)}\n\n<div class="kv">goals</div>${esc(s.goals)}\n\n<div class="kv">memory graph</div>${esc(s.graph)}`;
}

function renderDiff(d) {
  const box = document.getElementById("p-diff");
  const body = d.full
    ? d.full.split("\n").slice(0, 200).map((l) => {
        const cls = l.startsWith("+") ? "diff-add" : l.startsWith("-") ? "diff-del"
          : (l.startsWith("@@") || l.startsWith("diff ")) ? "diff-hdr" : "";
        return cls ? `<span class="${cls}">${esc(l)}</span>` : esc(l);
      }).join("\n")
    : "";
  box.innerHTML = `${esc(d.stat)}\n\n${body}`;
}

async function refresh() {
  try { renderTraces(await window.mf.traces()); } catch {}
  try { renderLayers(await window.mf.layerState()); } catch {}
  try { renderDiff(await window.mf.diff()); } catch {}
  const st = document.getElementById("status");
  st.textContent = "● live · " + new Date().toLocaleTimeString();
}
refresh();
setInterval(refresh, 2500);

// ---- Panel ① live agent stream: how it thinks & what it decides ----
const agentInput = document.getElementById("agent-input");
const agentGo = document.getElementById("agent-go");
function runAgent() {
  const p = agentInput.value.trim();
  if (!p) return;
  document.getElementById("p-stream").innerHTML = "";
  window.mf.runAgent(p, document.getElementById("agent-auto").checked);
  agentGo.textContent = "…running";
  agentGo.disabled = true;
}
agentGo.onclick = runAgent;
agentInput.addEventListener("keydown", (e) => { if (e.key === "Enter") runAgent(); });

function sx(html, cls) {
  const box = document.getElementById("p-stream");
  if (box.querySelector(".muted")) box.innerHTML = "";
  const el = document.createElement("div");
  el.className = "sx " + (cls || "");
  el.innerHTML = html;
  box.appendChild(el);
  box.scrollTop = box.scrollHeight;
}
const brief = (o, n = 140) => { try { const s = typeof o === "string" ? o : JSON.stringify(o); return s.length > n ? s.slice(0, n) + "…" : s; } catch { return ""; } };
const resultText = (c) => typeof c === "string" ? c : (Array.isArray(c) ? c.map((x) => x.text || "").join(" ") : brief(c));

window.mf.onAgentEvent((m) => {
  if (m.kind === "start") { sx(`<b>▶ task:</b> ${esc(m.text)}`, "task"); return; }
  if (m.kind === "error") { sx(`<span class="ic">✗</span> ${esc(m.text)} <span class="muted">(is the claude CLI installed &amp; authed?)</span>`, "err"); agentGo.textContent = "Run"; agentGo.disabled = false; return; }
  if (m.kind === "done") { sx(`<b>✓ finished</b> <span class="muted">(exit ${m.code})</span>`, "fin"); agentGo.textContent = "Run"; agentGo.disabled = false; return; }
  const ev = m.ev; if (!ev) return;
  if (ev.type === "assistant" && ev.message) {
    for (const b of ev.message.content || []) {
      if (b.type === "thinking" && b.thinking) sx(`<span class="ic">💭</span> <span class="muted">thinking</span> ${esc(b.thinking)}`, "think");
      else if (b.type === "text" && b.text) sx(`<span class="ic">💬</span> ${esc(b.text)}`, "say");
      else if (b.type === "tool_use") sx(`<span class="ic">🔧</span> <b>decided →</b> <code>${esc(b.name)}</code> <span class="muted">${esc(brief(b.input))}</span>`, "tool");
    }
  } else if (ev.type === "user" && ev.message) {
    for (const b of ev.message.content || []) if (b.type === "tool_result") sx(`<span class="ic">←</span> <span class="muted">result</span> ${esc(brief(resultText(b.content)))}`, "res");
  } else if (ev.type === "result") {
    const cost = ev.total_cost_usd ? `$${ev.total_cost_usd.toFixed(4)}` : "";
    sx(`<b>✓</b> ${esc(ev.subtype || "result")} <span class="muted">${ev.duration_ms ? ev.duration_ms + "ms" : ""} ${cost}</span>`, "fin");
  }
});
