"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createAdaptivePoller, createAsyncMemo } = require("../pollcore");

function fakeTimers() {
  let next = 1;
  const timers = new Map();
  return {
    set(fn, ms) { const id = next++; timers.set(id, { fn, ms }); return id; },
    clear(id) { timers.delete(id); },
    latest() { return [...timers.values()].at(-1); },
    async fire() {
      const [id, timer] = [...timers.entries()].at(-1);
      timers.delete(id);
      await timer.fn();
    },
    count() { return timers.size; },
  };
}

test("adaptive poller backs off to 30s and resets on change", async () => {
  const timers = fakeTimers();
  const outcomes = [false, false, false, false, true];
  const poller = createAdaptivePoller({ run: async () => outcomes.shift(),
    setTimer: timers.set, clearTimer: timers.clear });
  poller.start();
  assert.equal(timers.latest().ms, 4000);
  for (const expected of [8000, 16000, 30000, 30000, 4000]) {
    await timers.fire();
    assert.equal(poller.delay, expected);
    assert.equal(timers.latest().ms, expected);
  }
});

test("adaptive poller pauses while hidden and resumes immediately", () => {
  const timers = fakeTimers();
  let hidden = true;
  const poller = createAdaptivePoller({ run: async () => false, isHidden: () => hidden,
    setTimer: timers.set, clearTimer: timers.clear });
  poller.start();
  assert.equal(timers.count(), 0);
  hidden = false;
  poller.visibilityChanged();
  assert.equal(timers.latest().ms, 0);
  hidden = true;
  poller.visibilityChanged();
  assert.equal(timers.count(), 0);
});

test("async memo deduplicates in-flight work and expires per key", async () => {
  let now = 10, calls = 0;
  const memo = createAsyncMemo({ ttlMs: 100, now: () => now });
  const load = async () => ++calls;
  const [a, b] = await Promise.all([memo.get("one", load), memo.get("one", load)]);
  assert.equal(a, 1); assert.equal(b, 1); assert.equal(calls, 1);
  now = 50;
  assert.equal(await memo.get("one", load), 1);
  now = 111;
  assert.equal(await memo.get("one", load), 2);
  assert.equal(await memo.get("two", load), 3);
  memo.clear();
  assert.equal(await memo.get("two", load), 4);
});

test("async memo keeps deduplicating work that outlives the TTL", async () => {
  let now = 0, calls = 0, release;
  const memo = createAsyncMemo({ ttlMs: 10, now: () => now });
  const load = () => { calls++; return new Promise((resolve) => { release = resolve; }); };
  const first = memo.get("metrics", load);
  await Promise.resolve();
  now = 100;
  const second = memo.get("metrics", load);
  assert.equal(calls, 1);
  release(42);
  assert.equal(await first, 42);
  assert.equal(await second, 42);
});
