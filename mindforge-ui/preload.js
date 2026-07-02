"use strict";
const { contextBridge, ipcRenderer } = require("electron");

// Minimal, safe bridge — the renderer never gets Node; it only gets these typed channels.
contextBridge.exposeInMainWorld("mf", {
  // terminal (real PTY)
  onPtyData: (cb) => ipcRenderer.on("pty-data", (_e, d) => cb(d)),
  onPtyExit: (cb) => ipcRenderer.on("pty-exit", () => cb()),
  ptyInput: (d) => ipcRenderer.send("pty-input", d),
  ptyResize: (cols, rows) => ipcRenderer.send("pty-resize", { cols, rows }),
  // explanation panels (real data sources)
  layerState: () => ipcRenderer.invoke("layer-state"),
  diff: () => ipcRenderer.invoke("diff"),
  traces: () => ipcRenderer.invoke("traces"),
  // live agent reasoning stream
  runAgent: (p, autonomous) => ipcRenderer.send("agent-run", { prompt: p, autonomous: !!autonomous }),
  stopAgent: () => ipcRenderer.send("agent-stop"),
  onAgentEvent: (cb) => ipcRenderer.on("agent-event", (_e, m) => cb(m)),
});
