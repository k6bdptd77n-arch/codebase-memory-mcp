"use strict";

const { afterEach, beforeEach, describe, test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { atomicWriteFileSync } = require("../filecore");

describe("atomicWriteFileSync", () => {
  let dir;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "mf-atomic-")); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  test("creates and atomically replaces a private file", () => {
    const target = path.join(dir, "nested", "settings.json");
    atomicWriteFileSync(target, "one\n");
    atomicWriteFileSync(target, "two\n");
    assert.equal(fs.readFileSync(target, "utf8"), "two\n");
    if (process.platform !== "win32")
      assert.equal(fs.statSync(target).mode & 0o777, 0o600);
    assert.deepEqual(fs.readdirSync(path.dirname(target)), ["settings.json"]);
  });

  test("removes the temporary file when rename fails", () => {
    const target = path.join(dir, "settings.json");
    const fsImpl = Object.create(fs);
    fsImpl.renameSync = () => { throw new Error("rename failed"); };
    assert.throws(() => atomicWriteFileSync(target, "data", { fsImpl }), /rename failed/);
    assert.deepEqual(fs.readdirSync(dir), []);
  });
});
