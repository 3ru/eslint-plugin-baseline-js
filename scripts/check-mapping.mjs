#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

function parseTsObjectLiteral(tsPath) {
  const src = readFileSync(tsPath, "utf8");
  const m = src.match(/export default (\{[\s\S]*\}) as const;\n?$/);
  if (!m) throw new Error(`Failed to parse features from ${tsPath}`);
  return JSON.parse(m[1]);
}

const root = resolve(process.cwd());
const featuresTs = resolve(root, "src/baseline/data/features.javascript.ts");
const mappingTs = resolve(root, "src/baseline/mapping/syntax.ts");

const features = parseTsObjectLiteral(featuresTs);

function extractMappingKeys(tsPath) {
  const src = readFileSync(tsPath, "utf8");
  // Capture top-level string keys followed by a colon and opening brace.
  // This is robust enough for our mapping file shape.
  const bodyMatch = src.match(/export default\s*\{[\s\S]*\}\s*as const;\n?$/);
  const body = bodyMatch ? bodyMatch[0] : src;
  const re = /^(?:\s*(?:"([^"]+)"|'([^']+)'|([A-Za-z_$][\w$-]*))\s*:\s*\{)/gm;
  const out = new Set();
  for (const m of body.matchAll(re)) {
    const key = m[1] || m[2] || m[3];
    if (key) out.add(key);
  }
  return Array.from(out);
}

const featureIds = Object.keys(features);
const mappedIds = extractMappingKeys(mappingTs);

const missing = featureIds
  .filter((id) => !mappedIds.includes(id))
  .map((id) => ({
    id,
    name: features[id]?.name || id,
  }));

const unknown = mappedIds.filter((id) => !featureIds.includes(id)).map((id) => ({ id }));

const report = { missing, unknown };

const outFlagIndex = process.argv.indexOf("--out");
if (outFlagIndex !== -1 && process.argv[outFlagIndex + 1]) {
  const outPath = resolve(root, process.argv[outFlagIndex + 1]);
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
}

console.log(`mapping check: missing=${missing.length}, unknown=${unknown.length}`);
if (missing.length) {
  console.log("Missing feature IDs:", missing.map((m) => m.id).join(", "));
}
if (unknown.length) {
  console.log("Unknown mapping IDs:", unknown.map((u) => u.id).join(", "));
}
