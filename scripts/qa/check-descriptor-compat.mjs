#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { features as wfFeatures } from "web-features";
import { classifyWindowMember, LEGACY_FACTORY_COMPAT_KEYS } from "../data/classify-web-apis.mjs";

/** @typedef {import("../../src/baseline/types").GeneratedDescriptor} GeneratedDescriptor */
/** @typedef {typeof import("web-features").features} SourceFeatures */

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

/** @param {string} pathFromRoot @returns {GeneratedDescriptor[]} */
function parseGeneratedDescriptorFile(pathFromRoot) {
  const abs = resolve(process.cwd(), pathFromRoot);
  const src = readFileSync(abs, "utf8");
  const m = src.match(/=\s*(\[[\s\S]*\]);\s*export default /m);
  if (!m) throw new Error(`Failed to parse descriptor array: ${pathFromRoot}`);
  return JSON.parse(m[1]);
}

/** @param {GeneratedDescriptor} desc @param {Set<string>} keys */
function matchesApiDescriptor(desc, keys) {
  if (!keys.size) return true;
  switch (desc.kind) {
    case "callGlobal":
      return keys.has(`api.${desc.name}`) || keys.has(`api.Window.${desc.name}`);
    case "newIdent":
      return (
        keys.has(`api.${desc.name}.${desc.name}`) ||
        keys.has(`api.${desc.name}`) ||
        [...LEGACY_FACTORY_COMPAT_KEYS].some(([key, name]) => name === desc.name && keys.has(key))
      );
    case "newWithOptions":
      return true;
    case "callStatic":
    case "staticMember":
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

/** @param {GeneratedDescriptor} desc @param {Set<string>} keys */
function matchesJsbiDescriptor(desc, keys) {
  if (!keys.size) return true;
  /** @param {string} k */
  const hasKey = (k) => keys.has(k);
  switch (desc.kind) {
    case "newMember":
      return (
        hasKey(`javascript.builtins.${desc.base}.${desc.prop}`) ||
        hasKey(`javascript.builtins.${desc.base}.${desc.prop}.${desc.prop}`)
      );
    case "callStatic":
    case "staticMember":
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

/**
 * Validate ownership and the selected compatibility key, not another member in the same feature.
 * Composite option patterns are explicit, reviewed mappings in manual-descriptors.mjs.
 * @param {ReadonlyArray<GeneratedDescriptor>} descs
 * @param {SourceFeatures} features
 * @param {"api." | "javascript.builtins."} keyPrefix
 */
export function checkDescriptors(descs, features, keyPrefix) {
  const matcher = keyPrefix === "api." ? matchesApiDescriptor : matchesJsbiDescriptor;
  const problems = [];
  for (const d of descs) {
    if (!d?.featureId || !d?.kind) {
      problems.push({ featureId: d?.featureId, descriptor: d, reason: "invalid-descriptor" });
      continue;
    }
    const feature = features[d.featureId];
    if (!feature || !("compat_features" in feature)) {
      problems.push({
        featureId: d.featureId,
        descriptor: d,
        reason: "feature-not-found-in-web-features",
      });
      continue;
    }
    const keySet = new Set(feature.compat_features ?? []);
    if (typeof d.compatKey !== "string" || !d.compatKey) {
      problems.push({
        featureId: d.featureId,
        descriptor: d,
        reason: "missing-compat-key",
      });
      continue;
    }
    if (!d.compatKey.startsWith(keyPrefix)) {
      problems.push({
        featureId: d.featureId,
        descriptor: d,
        reason: "compat-key-outside-namespace",
      });
      continue;
    }
    if (!keySet.has(d.compatKey)) {
      problems.push({
        featureId: d.featureId,
        descriptor: d,
        reason: "compat-key-not-in-feature",
      });
      continue;
    }
    if (!matcher(d, new Set([d.compatKey]))) {
      problems.push({
        featureId: d.featureId,
        descriptor: d,
        reason: "no-compat-key-match",
      });
    }
  }
  return problems;
}

function main() {
  // A future web-features update must review every new Window member's kind.
  for (const feature of Object.values(wfFeatures)) {
    if (feature.kind !== "feature") continue;
    for (const key of feature.compat_features ?? []) {
      const parts = key.split(".");
      if (parts.length === 3 && parts[0] === "api" && parts[1] === "Window") {
        if (!classifyWindowMember(parts[2])) {
          throw new Error(
            `Unreviewed Window compat key: ${key}; classify it in classify-web-apis.mjs`,
          );
        }
      }
    }
  }

  const api = parseGeneratedDescriptorFile("src/baseline/data/descriptors.api.ts");
  const jsbi = parseGeneratedDescriptorFile("src/baseline/data/descriptors.jsbi.ts");
  const all = [
    ...checkDescriptors(api, wfFeatures, "api."),
    ...checkDescriptors(jsbi, wfFeatures, "javascript.builtins."),
  ];
  if (all.length > 0) {
    console.error("[check:descriptor-compat] Found descriptor/compat mismatches:");
    for (const p of all.slice(0, 50)) {
      console.error(`- ${p.featureId} (${p.reason}) :: ${JSON.stringify(p.descriptor)}`);
    }
    if (all.length > 50) console.error(`...and ${all.length - 50} more.`);
    process.exitCode = 1;
    return;
  }
  console.log(`[check:descriptor-compat] OK (api=${api.length}, jsbi=${jsbi.length})`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
