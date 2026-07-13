"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");

function bridgeCalls() {
  const calls = { invoke: new Set(), send: new Set(), on: new Set() };
  let api;
  const electron = {
    contextBridge: { exposeInMainWorld: (name, value) => { assert.equal(name, "mf"); api = value; } },
    ipcRenderer: {
      invoke: (channel) => { calls.invoke.add(channel); return Promise.resolve({ ok: true }); },
      send: (channel) => calls.send.add(channel),
      on: (channel) => { calls.on.add(channel); },
    },
  };
  const source = fs.readFileSync(path.join(ROOT, "preload.js"), "utf8");
  vm.runInNewContext(source, {
    require: (name) => { assert.equal(name, "electron"); return electron; },
  }, { filename: "preload.js" });
  assert.ok(api, "preload must expose window.mf");
  for (const [name, fn] of Object.entries(api)) {
    assert.equal(typeof fn, "function", `${name} must be a function`);
    fn(name.startsWith("on") ? () => {} : "G001", "evidence", "manual");
  }
  return calls;
}

function matches(source, re) {
  return new Set([...source.matchAll(re)].map((m) => m[1]));
}

test("preload IPC channels have matching main-process endpoints", () => {
  const calls = bridgeCalls();
  const main = fs.readFileSync(path.join(ROOT, "main.js"), "utf8");
  const handles = matches(main, /ipcMain\.handle\("([^"]+)"/g);
  const listeners = matches(main, /ipcMain\.on\("([^"]+)"/g);
  const produced = matches(main, /send\("([^"]+)"/g);

  assert.deepEqual([...calls.invoke].filter((ch) => !handles.has(ch)), [],
    "every preload invoke must have an ipcMain.handle");
  assert.deepEqual([...calls.send].filter((ch) => !listeners.has(ch)), [],
    "every preload send must have an ipcMain.on");
  assert.deepEqual([...calls.on].filter((ch) => !produced.has(ch)), [],
    "every preload subscription must be produced by main");
});

test("critical workflow and background channels remain exposed end-to-end", () => {
  const calls = bridgeCalls();
  for (const channel of ["project-create", "plan-accept", "story-approve", "story-fail", "app-hide", "app-show"])
    assert.ok(calls.invoke.has(channel), `missing critical channel: ${channel}`);
});
