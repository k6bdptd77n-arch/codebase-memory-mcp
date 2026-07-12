import { readdirSync, statSync } from "node:fs";

const assetsDir = new URL("../dist/assets/", import.meta.url);
const initialChunk = readdirSync(assetsDir)
  .find((name) => /^index-.*\.js$/.test(name));

if (!initialChunk) {
  throw new Error("initial Graph UI chunk was not found; run the production build first");
}

const maxBytes = 350 * 1024;
const bytes = statSync(new URL(initialChunk, assetsDir)).size;

if (bytes > maxBytes) {
  throw new Error(
    `initial Graph UI bundle is ${(bytes / 1024).toFixed(1)} KiB; budget is ${maxBytes / 1024} KiB`,
  );
}

console.log(`initial Graph UI bundle: ${(bytes / 1024).toFixed(1)} KiB (budget: ${maxBytes / 1024} KiB)`);
