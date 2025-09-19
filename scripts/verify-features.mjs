#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function main() {
  const featuresPath = resolve(process.cwd(), "src/baseline/data/features.javascript.ts");
  const src = readFileSync(featuresPath, "utf8");
  const m = src.match(/export default (\{[\s\S]*\}) as const;\n?$/);
  if (!m) {
    console.error("[verify:features] Failed to parse features from", featuresPath);
    process.exitCode = 1;
    return;
  }
  let obj;
  try {
    obj = JSON.parse(m[1]);
  } catch (err) {
    console.error("[verify:features] JSON parse error:", err);
    process.exitCode = 1;
    return;
  }
  const count = Object.keys(obj).length;
  console.log(`features ${count}`);
}

main();
