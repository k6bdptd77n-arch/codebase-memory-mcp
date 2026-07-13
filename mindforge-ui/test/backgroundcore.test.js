"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createBackgroundLifecycle } = require("../backgroundcore");

function harness(platform = "darwin") {
  const calls = [];
  const win = {
    visible: true,
    destroyed: false,
    minimized: false,
    isDestroyed: () => win.destroyed,
    isVisible: () => win.visible,
    isMinimized: () => win.minimized,
    show: () => { win.visible = true; calls.push("show"); },
    hide: () => { win.visible = false; calls.push("hide"); },
    focus: () => calls.push("focus"),
    restore: () => { win.minimized = false; calls.push("restore"); },
  };
  const app = {
    dock: { show: () => calls.push("dock-show"), hide: () => calls.push("dock-hide") },
    quit: () => calls.push("quit"),
  };
  const lifecycle = createBackgroundLifecycle({ app, platform, getWindow: () => win,
    createWindow: () => { calls.push("create"); return win; } });
  return { calls, win, lifecycle };
}

test("closing hides the window and keeps the app alive", () => {
  const { calls, win, lifecycle } = harness();
  let prevented = false;
  lifecycle.handleWindowClose({ preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(win.visible, false);
  assert.deepEqual(calls, ["hide", "dock-hide"]);
});

test("show restores, focuses and returns the existing window", () => {
  const { calls, win, lifecycle } = harness();
  win.visible = false;
  win.minimized = true;
  assert.equal(lifecycle.show(), win);
  assert.deepEqual(calls, ["dock-show", "restore", "show", "focus"]);
});

test("toggle and explicit quit are deterministic", () => {
  const { calls, win, lifecycle } = harness("linux");
  lifecycle.toggle();
  assert.equal(win.visible, false);
  lifecycle.toggle();
  lifecycle.quit();
  assert.deepEqual(calls, ["hide", "show", "focus", "quit"]);
  assert.equal(lifecycle.isQuitting(), true);
});

test("app quit is not intercepted by the close handler", () => {
  const { calls, lifecycle } = harness();
  lifecycle.markQuitting();
  let prevented = false;
  lifecycle.handleWindowClose({ preventDefault: () => { prevented = true; } });
  assert.equal(prevented, false);
  assert.deepEqual(calls, []);
});
