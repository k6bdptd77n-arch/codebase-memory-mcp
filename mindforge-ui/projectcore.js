"use strict";
// Project creation core — deliberately free of any Electron dependency so it can
// be unit-tested with plain node. main.js supplies the dialogs; this module does
// the work: mkdir → git init → apply the fablize disciplines via this repo's
// installer (bash fablize/install.sh <target> — non-interactive, self-contained).
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");

// Folder name: letters (incl. Cyrillic), digits, _ . -, inner spaces. Never a
// path: separators are rejected outright, no leading/trailing space or dot-dot.
const NAME_RE = /^[\p{L}\p{N}_.\-](?:[\p{L}\p{N}_.\- ]*[\p{L}\p{N}_.\-])?$/u;
const okProjectName = (s) =>
  typeof s === "string" && s.length > 0 && s.length <= 80 &&
  !/[/\\]/.test(s) && s !== "." && s !== ".." && NAME_RE.test(s);

function runIn(cwd, cmd, args, env) {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd, timeout: 60000, maxBuffer: 8 << 20, env: env || process.env },
      (err, out, errOut) => resolve({ ok: !err, out: out || "", err: errOut || (err && err.message) || "" }));
  });
}

// Creates <parentDir>/<name>: mkdir, git init, fablize disciplines. Returns
// { ok, target, steps[], warning? } — ok means "project usable" (a disciplines
// failure degrades gracefully: the project still opens, with a clear warning).
async function createProjectAt(installDir, parentDir, name, env) {
  const steps = [];
  const step = (n, ok, out) => { steps.push({ name: n, ok, out: String(out || "").trim().slice(-800) }); return ok; };
  if (!okProjectName(name))
    return { ok: false, steps: [{ name: "имя", ok: false, out: "недопустимое имя проекта" }] };
  if (!parentDir || !fs.existsSync(parentDir))
    return { ok: false, steps: [{ name: "родительская папка", ok: false, out: "папка не существует" }] };
  const target = path.join(parentDir, name);
  if (fs.existsSync(target))
    return { ok: false, target, steps: [{ name: "mkdir", ok: false, out: "такая папка уже существует" }] };
  try { fs.mkdirSync(target, { recursive: true }); step("mkdir", true, target); }
  catch (e) { return { ok: false, target, steps: [{ name: "mkdir", ok: false, out: e.message }] }; }

  const g = await runIn(target, "git", ["init"], env);
  if (!step("git init", g.ok, g.out + g.err)) return { ok: false, target, steps };

  let warning;
  const installer = path.join(installDir, "fablize", "install.sh");
  if (fs.existsSync(installer)) {
    const r = await runIn(installDir, "bash", [installer, target], env);
    step("дисциплины fablize", r.ok, r.out + r.err);
    if (!r.ok) warning = "проект создан, но дисциплины fablize не применились — " +
      `выполните вручную: bash ${installer} "${target}"`;
  } else {
    step("дисциплины fablize", false, "installer не найден: " + installer);
    warning = "проект создан без дисциплин fablize (installer не найден в " + installDir + ")";
  }

  // Первый коммит обязателен: запуск историй делает `git worktree add … HEAD`,
  // а HEAD в репозитории без коммитов не резолвится — история падала бы сразу.
  await runIn(target, "git", ["add", "-A"], env);
  let c = await runIn(target, "git",
    ["commit", "--allow-empty", "-m", "MindForge: инициализация проекта"], env);
  if (!c.ok) // машина без настроенной git-идентичности
    c = await runIn(target, "git",
      ["-c", "user.name=MindForge", "-c", "user.email=mindforge@local",
       "commit", "--allow-empty", "-m", "MindForge: инициализация проекта"], env);
  if (!step("первый коммит", c.ok, c.out + c.err) && !warning)
    warning = "проект создан, но первый коммит не удался — истории не запустятся, " +
      "выполните вручную: git -C \"" + target + "\" commit --allow-empty -m init";
  return { ok: true, target, steps, warning };
}

module.exports = { okProjectName, createProjectAt };
