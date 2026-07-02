"use strict";
const { contextBridge, ipcRenderer } = require("electron");

// Minimal, safe bridge — the renderer never gets Node; only these typed channels.
contextBridge.exposeInMainWorld("mf", {
  // terminal (real PTY)
  onPtyData: (cb) => ipcRenderer.on("pty-data", (_e, d) => cb(d)),
  onPtyExit: (cb) => ipcRenderer.on("pty-exit", () => cb()),
  ptyInput: (d) => ipcRenderer.send("pty-input", d),
  ptyResize: (cols, rows) => ipcRenderer.send("pty-resize", { cols, rows }),

  // state
  snapshot: () => ipcRenderer.invoke("snapshot"),
  layers: () => ipcRenderer.invoke("layers"),
  brainFacts: () => ipcRenderer.invoke("brain-facts"),
  episodes: () => ipcRenderer.invoke("episodes"),
  metrics: () => ipcRenderer.invoke("metrics"),
  logTail: (id) => ipcRenderer.invoke("log-tail", id),
  reviewEvidence: (id) => ipcRenderer.invoke("review-evidence", id),
  onChanged: (cb) => ipcRenderer.on("fablize-changed", () => cb()),

  // brain actions
  brainRecall: (q) => ipcRenderer.invoke("brain-recall", q),
  brainPrune: (apply) => ipcRenderer.invoke("brain-prune", !!apply),

  // story lifecycle
  storyRun: (id) => ipcRenderer.invoke("story-run", id),
  storyStop: (id) => ipcRenderer.invoke("story-stop", id),
  storyApprove: (id, evidence) => ipcRenderer.invoke("story-approve", { id, evidence }),
  storyFail: (id, reason) => ipcRenderer.invoke("story-fail", { id, reason }),
  storyRetry: (id) => ipcRenderer.invoke("story-retry", id),
  reviewLLM: (id) => ipcRenderer.invoke("review-llm", id),
  onStoryState: (cb) => ipcRenderer.on("story-state", (_e, m) => cb(m)),

  // planner + live claude stream
  planGenerate: (feature) => ipcRenderer.invoke("plan-generate", feature),
  planAccept: (brief, stories, mode) => ipcRenderer.invoke("plan-accept", { brief, stories, mode }),
  onClaudeStream: (cb) => ipcRenderer.on("claude-stream", (_e, m) => cb(m)),

  // native confirmation for destructive actions
  confirm: (title, detail) => ipcRenderer.invoke("confirm", { title, detail }),
});
