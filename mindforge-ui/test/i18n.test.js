"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const I18N = require("../i18n");
const fs = require("node:fs");
const path = require("node:path");

test("English and Russian dictionaries have exactly the same keys", () => {
  const en = Object.keys(I18N.dict.en).sort();
  const ru = Object.keys(I18N.dict.ru).sort();
  assert.deepEqual(ru, en);
  assert.ok(en.length > 40, "dictionary unexpectedly small");
  for (const locale of ["en", "ru"])
    for (const key of en) assert.ok(I18N.dict[locale][key], `${locale}.${key} is empty`);
});

test("translation falls back safely and interpolates every occurrence", () => {
  I18N.setLocale("ru");
  assert.equal(I18N.t("main.whereCreate", { name: "demo" }), "Где создать проект «demo»");
  assert.equal(I18N.t("missing.key"), "missing.key");
  I18N.setLocale("not-a-locale");
  assert.equal(I18N.locale, "en");
  assert.equal(I18N.t("main.thinking", { model: "GPT" }), "[GPT] thinking…");
});

function cyrillicInRuntimeStrings(source) {
  // Runtime files do not contain localized URL literals; stripping comments first
  // keeps the lightweight scanner deterministic even across nested template expressions.
  source = source.replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n").map((line) => line.replace(/\/\/.*$/, "")).join("\n");
  const hits = [];
  let state = "code", line = 1;
  for (let i = 0; i < source.length; i++) {
    const c = source[i], n = source[i + 1];
    if (c === "\n") { line++; if (state === "line-comment") state = "code"; continue; }
    if (state === "line-comment") continue;
    if (state === "block-comment") { if (c === "*" && n === "/") { state = "code"; i++; } continue; }
    if (state === "code") {
      if (c === "/" && n === "/") { state = "line-comment"; i++; continue; }
      if (c === "/" && n === "*") { state = "block-comment"; i++; continue; }
      if (c === "'") state = "single";
      else if (c === '"') state = "double";
      else if (c === "`") state = "template";
      continue;
    }
    if (c === "\\") { i++; continue; }
    if ((state === "single" && c === "'") || (state === "double" && c === '"') ||
        (state === "template" && c === "`")) { state = "code"; continue; }
    if (/[А-Яа-яЁё]/.test(c)) hits.push(line);
  }
  return [...new Set(hits)];
}

test("runtime JavaScript keeps localized text in i18n.js", () => {
  const root = path.join(__dirname, "..");
  const files = ["main.js", "renderer.js", "preload.js", ...fs.readdirSync(path.join(root, "views"))
    .filter((name) => name.endsWith(".js")).map((name) => `views/${name}`)];
  const failures = [];
  for (const file of files) {
    const lines = cyrillicInRuntimeStrings(fs.readFileSync(path.join(root, file), "utf8"));
    if (lines.length) failures.push(`${file}:${lines.join(",")}`);
  }
  assert.deepEqual(failures, [], `hard-coded Cyrillic runtime strings: ${failures.join("; ")}`);
});
