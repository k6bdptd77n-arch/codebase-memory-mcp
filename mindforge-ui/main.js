"use strict";
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { execFile, spawn } = require("child_process");
const pty = require("node-pty");

const REPO = path.resolve(__dirname, "..");                 // the fablize-memory-mcp repo
const PY = "python3";
const SCRIPTS = path.join(REPO, "fablize", "scripts");
const BIN = path.join(REPO, "build", "c", "codebase-memory-mcp");
const SHOT = process.argv.includes("--shot");

let win = null;
let term = null;

// --- helpers: run a command, resolve its stdout (never reject; the panels degrade gracefully) ---
function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd: REPO, timeout: 8000, maxBuffer: 4 << 20, ...opts },
      (err, stdout, stderr) => resolve({ ok: !err, out: stdout || "", err: stderr || (err && err.message) || "" }));
  });
}

// Panel 3 — live MindForge layer state: Brain facts, Goals plan, Memory graph size.
async function layerState() {
  const [brain, goals, projects] = await Promise.all([
    run(PY, [path.join(SCRIPTS, "brain.py"), "index"]),
    run(PY, [path.join(SCRIPTS, "goals.py"), "status"]),
    run(BIN, ["cli", "list_projects", "{}"]),
  ]);
  let graph = "";
  try {
    // `cli` returns the tool JSON directly; an RPC path would wrap it in result.content[0].text.
    let obj = JSON.parse(projects.out);
    if (obj.result && obj.result.content) obj = JSON.parse(obj.result.content[0].text);
    const list = obj.projects || [];
    const me = list.find((p) => p.root_path === REPO) || list[0];
    if (me) graph = `${me.name}\n${me.nodes.toLocaleString()} nodes · ${me.edges.toLocaleString()} edges`;
  } catch { graph = projects.ok ? "(parse error)" : "(memory server not built / no projects)"; }
  return {
    brain: brain.out.trim() || "(brain empty — recall/reflect to grow it)",
    goals: goals.out.trim() || "(no active plan)",
    graph: graph || "(no indexed project)",
  };
}

// Panel 4 — file diffs (what changed in the repo right now).
async function diff() {
  const stat = await run("git", ["diff", "--stat"]);
  const full = await run("git", ["diff", "--unified=2"]);
  return { stat: stat.out.trim() || "(clean working tree)", full: (full.out || "").slice(0, 20000) };
}

// Panel 1 — agent reasoning/steps: the MindForge brain's episodic traces (real recorded steps).
function traces() {
  const f = path.join(REPO, ".fablize", "traces.jsonl");
  try {
    const lines = fs.readFileSync(f, "utf8").trim().split("\n").filter(Boolean);
    return lines.slice(-12).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1480, height: 900, backgroundColor: "#0b0f17", show: !SHOT,
    title: "MindForge",
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false },
  });
  win.loadFile("index.html");

  // Real integrated terminal: a PTY running the user's shell (type `claude` to start the agent).
  const shell = process.env.SHELL || (os.platform() === "win32" ? "powershell.exe" : "bash");
  term = pty.spawn(shell, [], { name: "xterm-color", cols: 100, rows: 28, cwd: REPO, env: process.env });
  term.onData((d) => win && !win.isDestroyed() && win.webContents.send("pty-data", d));
  term.onExit(() => win && !win.isDestroyed() && win.webContents.send("pty-exit"));

  ipcMain.on("pty-input", (_e, d) => term && term.write(d));
  ipcMain.on("pty-resize", (_e, { cols, rows }) => { try { term.resize(cols, rows); } catch {} });
  ipcMain.handle("layer-state", layerState);
  ipcMain.handle("diff", diff);
  ipcMain.handle("traces", () => traces());

  // Panel ① live feed — run the real agent in headless stream-json mode and surface every
  // thinking block, text, tool-use DECISION and tool-result as it happens (how it thinks/decides).
  let agent = null;
  ipcMain.on("agent-run", (_e, { prompt, autonomous }) => {
    if (agent) { try { agent.kill(); } catch {} }
    const send = (m) => win && !win.isDestroyed() && win.webContents.send("agent-event", m);
    send({ kind: "start", text: prompt });
    const args = ["-p", String(prompt), "--output-format", "stream-json", "--verbose"];
    if (autonomous) args.push("--dangerously-skip-permissions"); // opt-in: let it actually run tools
    agent = spawn("claude", args, { cwd: REPO, env: process.env });
    let buf = "";
    agent.stdout.on("data", (d) => {
      buf += d.toString();
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
        if (line.trim()) { try { send({ kind: "event", ev: JSON.parse(line) }); } catch {} }
      }
    });
    agent.on("error", (e) => send({ kind: "error", text: e.message }));
    agent.on("close", (code) => { send({ kind: "done", code }); agent = null; });
  });
  ipcMain.on("agent-stop", () => { if (agent) { try { agent.kill(); } catch {} agent = null; } });

  if (SHOT) {
    win.webContents.once("did-finish-load", async () => {
      await new Promise((r) => setTimeout(r, 2500));        // let panels fetch + terminal render
      const img = await win.webContents.capturePage();
      fs.writeFileSync("/tmp/mindforge_shot.png", img.toPNG());
      app.quit();
    });
  }
}

app.whenReady().then(createWindow);
app.on("window-all-closed", () => app.quit());
