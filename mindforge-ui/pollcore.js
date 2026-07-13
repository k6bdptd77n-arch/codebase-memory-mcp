"use strict";

function createAdaptivePoller({ run, isHidden = () => false, setTimer = setTimeout,
  clearTimer = clearTimeout, baseMs = 4000, maxMs = 30000 }) {
  let timer = null, delay = baseMs, busy = false, stopped = false;

  function cancel() {
    if (timer !== null) clearTimer(timer);
    timer = null;
  }
  function schedule(ms = delay) {
    cancel();
    if (stopped || isHidden()) return;
    timer = setTimer(tick, ms);
  }
  async function tick() {
    timer = null;
    if (stopped || isHidden()) return;
    if (busy) { schedule(); return; }
    busy = true;
    let changed = true;
    try { changed = !!(await run()); } catch { changed = true; }
    finally { busy = false; }
    delay = changed ? baseMs : Math.min(maxMs, delay * 2);
    schedule();
  }
  function visibilityChanged() {
    if (isHidden()) cancel();
    else { delay = baseMs; schedule(0); }
  }
  function activity() { delay = baseMs; schedule(); }
  function start() { stopped = false; delay = baseMs; schedule(); }
  function stop() { stopped = true; cancel(); }

  return { start, stop, activity, visibilityChanged, tick,
    get delay() { return delay; }, get scheduled() { return timer !== null; } };
}

function createAsyncMemo({ ttlMs, now = Date.now }) {
  let entry = null;
  return {
    get(key, load) {
      const at = now();
      if (entry && entry.key === key && (!entry.settled || at - entry.at < ttlMs)) return entry.promise;
      const promise = Promise.resolve().then(load);
      const current = { key, at, promise, settled: false };
      entry = current;
      promise.finally(() => { current.settled = true; }).catch(() => {});
      return promise;
    },
    clear() { entry = null; },
  };
}

const PollCore = { createAdaptivePoller, createAsyncMemo };
if (typeof window !== "undefined") window.PollCore = PollCore;
if (typeof module !== "undefined" && module.exports) module.exports = PollCore;
