"use strict";
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

async function main() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "mindforge-e2e-home-"));
  const resultPath = path.join(temp, "result.json");
  const electron = require("electron");
  let output = "";
  const child = spawn(electron, [".", "--e2e-smoke"], {
    cwd: path.resolve(__dirname, ".."),
    env: { ...process.env, HOME: temp, MINDFORGE_E2E_RESULT: resultPath },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (d) => { output += d; });
  child.stderr.on("data", (d) => { output += d; });
  const timer = setTimeout(() => child.kill("SIGKILL"), 120000);
  const code = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", resolve);
  });
  clearTimeout(timer);
  assert.ok(fs.existsSync(resultPath), `Electron produced no result (exit ${code})\n${output}`);
  const result = JSON.parse(fs.readFileSync(resultPath, "utf8"));
  assert.equal(code, 0, `${result.error || "Electron failed"}\n${output}`);
  assert.deepEqual({
    ok: result.ok, created: result.created, planned: result.planned,
    approved: result.approved, rejected: result.rejected, merged: result.merged,
    receipt: result.receipt, states: result.states,
  }, {
    ok: true, created: true, planned: true, approved: true, rejected: true,
    merged: true, receipt: true, states: { G001: "complete", G002: "failed" },
  });
  process.stdout.write(`Electron E2E passed: ${JSON.stringify(result)}\n`);
  fs.rmSync(temp, { recursive: true, force: true });
}

main().catch((e) => { console.error(e.stack || e); process.exitCode = 1; });
