#!/usr/bin/env node
import { execFileSync } from "node:child_process";

const trackedGeneratedFiles = [
  "src/baseline/data/features.javascript.ts",
  "src/baseline/data/features.api.ts",
  "src/baseline/data/features.jsbi.ts",
  "src/baseline/data/descriptors.api.ts",
  "src/baseline/data/descriptors.jsbi.ts",
];

const out = execFileSync("git", ["diff", "--name-only", "--", ...trackedGeneratedFiles], {
  encoding: "utf8",
}).trim();

if (out) {
  console.error("[check:generated-data] Generated baseline data is out of date.");
  console.error("Run: pnpm gen:data");
  console.error("Changed files:");
  console.error(out);
  process.exit(1);
}

console.log("[check:generated-data] OK");
