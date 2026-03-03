#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { features as wfFeatures } from "web-features";

const TYPED_ARRAY_IFACES = new Set([
  "Int8Array",
  "Uint8Array",
  "Uint8ClampedArray",
  "Int16Array",
  "Uint16Array",
  "Int32Array",
  "Uint32Array",
  "Float32Array",
  "Float64Array",
  "BigInt64Array",
  "BigUint64Array",
]);

function parseGeneratedDescriptorFile(pathFromRoot) {
  const abs = resolve(process.cwd(), pathFromRoot);
  const src = readFileSync(abs, "utf8");
  const m = src.match(/=\s*(\[[\s\S]*\]);\s*export default /m);
  if (!m) throw new Error(`Failed to parse descriptor array: ${pathFromRoot}`);
  return JSON.parse(m[1]);
}

function compatKeySetForFeature(featureId) {
  const rec = wfFeatures[featureId];
  if (!rec) return null;
  const byCompat = Object.keys(rec?.status?.by_compat_key ?? {});
  const compatFeatures = Array.isArray(rec.compat_features) ? rec.compat_features : [];
  return new Set([...byCompat, ...compatFeatures]);
}

function matchesApiDescriptor(desc, keys) {
  if (!keys.size) return true;
  switch (desc.kind) {
    case "callGlobal":
      return keys.has(`api.${desc.name}`);
    case "newIdent":
      return keys.has(`api.${desc.name}.${desc.name}`) || keys.has(`api.${desc.name}`);
    case "newWithOptions":
      return true;
    case "callStatic":
      return (
        keys.has(`api.${desc.base}.${desc.prop}_static`) ||
        keys.has(`api.${desc.base}.${desc.prop}`)
      );
    case "member":
      if (desc.base === "window") {
        return keys.has(`api.Window.${desc.prop}`);
      }
      if (desc.base === "navigator") {
        return keys.has(`api.Navigator.${desc.prop}`);
      }
      return keys.has(`api.${desc.base}.${desc.prop}`);
    case "instanceMember":
      return keys.has(`api.${desc.iface}.${desc.prop}`);
    case "callMemberWithArgs":
      return true;
    default:
      return true;
  }
}

function matchesJsbiDescriptor(desc, keys) {
  if (!keys.size) return true;
  const hasKey = (k) => keys.has(k);
  switch (desc.kind) {
    case "newMember":
      return (
        hasKey(`javascript.builtins.${desc.base}.${desc.prop}`) ||
        hasKey(`javascript.builtins.${desc.base}.${desc.prop}.${desc.prop}`)
      );
    case "callStatic":
    case "member":
      return hasKey(`javascript.builtins.${desc.base}.${desc.prop}`);
    case "newIdent":
      return (
        hasKey(`javascript.builtins.${desc.name}.${desc.name}`) ||
        hasKey(`javascript.builtins.${desc.name}`)
      );
    case "newWithOptions":
      return true;
    case "instanceMember": {
      if (hasKey(`javascript.builtins.${desc.iface}.${desc.prop}`)) return true;
      if (
        TYPED_ARRAY_IFACES.has(desc.iface) &&
        hasKey(`javascript.builtins.TypedArray.${desc.prop}`)
      ) {
        return true;
      }
      for (const key of keys) {
        if (key.endsWith(`.${desc.iface}.${desc.prop}`)) return true;
      }
      return false;
    }
    case "callMemberWithArgs":
      return true;
    default:
      return true;
  }
}

function checkFile(pathFromRoot, matcher, keyPrefix) {
  const descs = parseGeneratedDescriptorFile(pathFromRoot);
  const problems = [];
  for (const d of descs) {
    if (!d?.featureId || !d?.kind) continue;
    const keySet = compatKeySetForFeature(d.featureId);
    if (!keySet) {
      problems.push({
        featureId: d.featureId,
        descriptor: d,
        reason: "feature-not-found-in-web-features",
      });
      continue;
    }
    const scopedKeys = new Set([...keySet].filter((k) => k.startsWith(keyPrefix)));
    if (!matcher(d, scopedKeys)) {
      problems.push({
        featureId: d.featureId,
        descriptor: d,
        reason: "no-compat-key-match",
      });
    }
  }
  return problems;
}

const apiProblems = checkFile("src/baseline/data/descriptors.api.ts", matchesApiDescriptor, "api.");
const jsbiProblems = checkFile(
  "src/baseline/data/descriptors.jsbi.ts",
  matchesJsbiDescriptor,
  "javascript.builtins.",
);
const all = [...apiProblems, ...jsbiProblems];

if (all.length > 0) {
  console.error("[check:descriptor-compat] Found descriptor/compat mismatches:");
  for (const p of all.slice(0, 50)) {
    console.error(`- ${p.featureId} (${p.reason}) :: ${JSON.stringify(p.descriptor)}`);
  }
  if (all.length > 50) {
    console.error(`...and ${all.length - 50} more.`);
  }
  process.exit(1);
}

console.log(
  `[check:descriptor-compat] OK (api=${parseGeneratedDescriptorFile("src/baseline/data/descriptors.api.ts").length}, jsbi=${parseGeneratedDescriptorFile("src/baseline/data/descriptors.jsbi.ts").length})`,
);
