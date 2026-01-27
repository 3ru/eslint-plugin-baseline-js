#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { features as wfFeatures } from "web-features";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Heuristics to convert MDN BCD compat_features entries to Descriptor DSL.
 * We only emit patterns we can detect robustly without type information (safe preset).
 */

const LOWER_GLOBAL_INSTANCE = new Map([
  ["Navigator", "navigator"],
  ["Window", "window"],
]);

/** @type {import('../../src/baseline/types').Descriptor[]} */
const apiDescs = [];
/** @type {import('../../src/baseline/types').Descriptor[]} */
const jsbiDescs = [];

for (const [id, f] of Object.entries(wfFeatures)) {
  const cfs = Array.isArray(f.compat_features) ? f.compat_features : [];
  if (cfs.length === 0) continue;

  // Web API (api.*)
  if (cfs.some((k) => k.startsWith("api."))) {
    for (const k of cfs) {
      if (!k.startsWith("api.")) continue;
      const parts = k.split(".");
      if (parts.length === 3 && parts[1] === parts[2]) {
        apiDescs.push({ featureId: id, kind: "newIdent", name: parts[1] });
        continue;
      }
      if (parts.length === 3 && parts[2].endsWith("_static")) {
        const prop = parts[2].slice(0, -"_static".length);
        apiDescs.push({ featureId: id, kind: "callStatic", base: parts[1], prop });
        continue;
      }
      if (parts.length === 3) {
        const iface = parts[1];
        const prop = parts[2];
        if (iface === "Navigator" || iface === "Window") {
          const inst = LOWER_GLOBAL_INSTANCE.get(iface) ?? iface.toLowerCase();
          apiDescs.push({ featureId: id, kind: "member", base: inst, prop });
          continue;
        }
        if (iface === "CSS") {
          apiDescs.push({ featureId: id, kind: "callStatic", base: "CSS", prop });
          continue;
        }
        apiDescs.push({ featureId: id, kind: "instanceMember", iface, prop });
      }
    }
  }

  // JavaScript builtins (javascript.builtins.*)
  if (cfs.some((k) => k.startsWith("javascript.builtins"))) {
    for (const k of cfs) {
      if (!k.startsWith("javascript.builtins")) continue;
      const parts = k.split(".");
      if (parts.length === 5 && parts[3] === parts[4]) {
        jsbiDescs.push({ featureId: id, kind: "newMember", base: parts[2], prop: parts[3] });
        continue;
      }
      if (parts.length === 4) {
        const base = parts[2];
        const prop = parts[3];
        const STATIC_BASES = new Set(["Atomics", "Object", "Math", "JSON", "Reflect"]);
        const ARRAY_STATIC = new Set(["from", "fromAsync", "of", "isArray"]);
        if (STATIC_BASES.has(base) || (base === "Array" && ARRAY_STATIC.has(prop))) {
          jsbiDescs.push({ featureId: id, kind: "callStatic", base, prop });
          continue;
        }
        const ALLOWED_IFACE = new Set([
          "Array",
          "ReadonlyArray",
          "String",
          "Number",
          "Boolean",
          "Map",
          "Set",
          "WeakMap",
          "WeakSet",
          "Date",
          "RegExp",
          "Promise",
        ]);
        const isTypedArray =
          /^[UI]?(?:Int|Float)\d+Array$/.test(base) ||
          base === "BigInt64Array" ||
          base === "BigUint64Array";
        if (ALLOWED_IFACE.has(base) || isTypedArray) {
          jsbiDescs.push({ featureId: id, kind: "instanceMember", iface: base, prop });
        }
      }
    }
  }
}

// Manual safe descriptors
/** @type {import('../../src/baseline/types').Descriptor[]} */
const manualApi = [
  {
    featureId: "canvas-2d-alpha",
    kind: "callMemberWithArgs",
    prop: "getContext",
    stringArg: { index: 0, values: ["2d"] },
    objectArg: { index: 1, hasKeys: ["alpha"] },
  },
  {
    featureId: "canvas-2d-desynchronized",
    kind: "callMemberWithArgs",
    prop: "getContext",
    stringArg: { index: 0, values: ["2d"] },
    objectArg: { index: 1, hasKeys: ["desynchronized"] },
  },
  {
    featureId: "canvas-2d-willreadfrequently",
    kind: "callMemberWithArgs",
    prop: "getContext",
    stringArg: { index: 0, values: ["2d"] },
    objectArg: { index: 1, hasKeys: ["willReadFrequently"] },
  },
  {
    featureId: "canvas-2d-color-management",
    kind: "callMemberWithArgs",
    prop: "getContext",
    stringArg: { index: 0, values: ["2d"] },
    objectArg: { index: 1, keyValues: [{ key: "colorSpace", values: ["display-p3", "srgb"] }] },
  },
  {
    featureId: "webgl-desynchronized",
    kind: "callMemberWithArgs",
    prop: "getContext",
    stringArg: { index: 0, values: ["webgl", "experimental-webgl"] },
    objectArg: { index: 1, hasKeys: ["desynchronized"] },
  },
  {
    featureId: "webgl2-desynchronized",
    kind: "callMemberWithArgs",
    prop: "getContext",
    stringArg: { index: 0, values: ["webgl2"] },
    objectArg: { index: 1, hasKeys: ["desynchronized"] },
  },
  {
    featureId: "js-modules-workers",
    kind: "newWithOptions",
    name: "Worker",
    objectArg: { index: 1, keyValues: [{ key: "type", values: ["module"] }] },
  },
  {
    featureId: "js-modules-shared-workers",
    kind: "newWithOptions",
    name: "SharedWorker",
    objectArg: { index: 1, keyValues: [{ key: "type", values: ["module"] }] },
  },
  {
    featureId: "transformstream-transformer-cancel",
    kind: "newWithOptions",
    name: "TransformStream",
    objectArg: { index: 0, hasKeys: ["cancel"] },
  },
  {
    featureId: "ext-srgb",
    kind: "callMemberWithArgs",
    prop: "getExtension",
    stringArg: { index: 0, values: ["EXT_sRGB"] },
  },
  {
    featureId: "ext-srgb",
    kind: "callMemberWithArgs",
    prop: "includes",
    stringArg: { index: 0, values: ["EXT_sRGB"] },
    viaCall: { prop: "getSupportedExtensions" },
  },
];
for (const d of manualApi) apiDescs.push(d);

// Auto-generate WebGL extension descriptors
const already = new Set(manualApi.filter((d) => d.featureId).map((d) => d.featureId));
for (const [id, f] of Object.entries(wfFeatures)) {
  const group = f.group;
  if (
    !(group === "webgl-extensions" || (Array.isArray(group) && group.includes("webgl-extensions")))
  )
    continue;
  if (already.has(id)) continue;
  const name = String(f.name || "").trim();
  const token = name.split(/\s+/)[0];
  if (!token || !/^[A-Z0-9_]+/.test(token)) continue;
  apiDescs.push({
    featureId: id,
    kind: "callMemberWithArgs",
    prop: "getExtension",
    stringArg: { index: 0, values: [token] },
  });
  apiDescs.push({
    featureId: id,
    kind: "callMemberWithArgs",
    prop: "includes",
    stringArg: { index: 0, values: [token] },
    viaCall: { prop: "getSupportedExtensions" },
  });
}

// Manual JS builtins descriptors
/** @type {import('../../src/baseline/types').Descriptor[]} */
const manualJsbi = [
  {
    featureId: "error-cause",
    kind: "newWithOptions",
    name: "Error",
    objectArg: { index: 1, hasKeys: ["cause"] },
  },
  {
    featureId: "error-cause",
    kind: "newWithOptions",
    name: "AggregateError",
    objectArg: { index: 2, hasKeys: ["cause"] },
  },
  { featureId: "explicit-resource-management", kind: "newIdent", name: "DisposableStack" },
  { featureId: "explicit-resource-management", kind: "member", base: "Symbol", prop: "dispose" },
  {
    featureId: "explicit-resource-management",
    kind: "member",
    base: "Symbol",
    prop: "asyncDispose",
  },
  { featureId: "is-error", kind: "callStatic", base: "Error", prop: "isError" },
  {
    featureId: "resizable-buffers",
    kind: "newWithOptions",
    name: "ArrayBuffer",
    objectArg: { index: 1, hasKeys: ["maxByteLength"] },
  },
  {
    featureId: "resizable-buffers",
    kind: "newWithOptions",
    name: "SharedArrayBuffer",
    objectArg: { index: 1, hasKeys: ["maxByteLength", "growable"] },
    typedOnly: true,
  },
  {
    featureId: "uint8array-base64-hex",
    kind: "callStatic",
    base: "Uint8Array",
    prop: "fromBase64",
  },
  { featureId: "uint8array-base64-hex", kind: "callStatic", base: "Uint8Array", prop: "fromHex" },
  {
    featureId: "uint8array-base64-hex",
    kind: "instanceMember",
    iface: "Uint8Array",
    prop: "toBase64",
  },
  {
    featureId: "uint8array-base64-hex",
    kind: "instanceMember",
    iface: "Uint8Array",
    prop: "toHex",
  },
  { featureId: "weak-references", kind: "newIdent", name: "WeakRef" },
  { featureId: "weak-references", kind: "newIdent", name: "FinalizationRegistry" },
  { featureId: "intl-locale-info", kind: "newMember", base: "Intl", prop: "Locale" },
  { featureId: "intl-locale-info", kind: "instanceMember", iface: "Locale", prop: "maximize" },
  { featureId: "intl-locale-info", kind: "instanceMember", iface: "Locale", prop: "minimize" },
  { featureId: "intl-locale-info", kind: "instanceMember", iface: "Locale", prop: "hourCycle" },
  { featureId: "intl-locale-info", kind: "instanceMember", iface: "Locale", prop: "textInfo" },
  { featureId: "intl-locale-info", kind: "instanceMember", iface: "Locale", prop: "weekInfo" },
  { featureId: "iterator-methods", kind: "instanceMember", iface: "Iterator", prop: "map" },
  { featureId: "iterator-methods", kind: "instanceMember", iface: "Iterator", prop: "filter" },
  { featureId: "iterator-methods", kind: "instanceMember", iface: "Iterator", prop: "take" },
  { featureId: "iterator-methods", kind: "instanceMember", iface: "Iterator", prop: "drop" },
  { featureId: "iterator-methods", kind: "instanceMember", iface: "Iterator", prop: "flatMap" },
  { featureId: "iterator-methods", kind: "instanceMember", iface: "Iterator", prop: "reduce" },
  { featureId: "iterator-methods", kind: "instanceMember", iface: "Iterator", prop: "toArray" },
  { featureId: "iterator-concat", kind: "callStatic", base: "Iterator", prop: "concat" },
];
for (const d of manualJsbi) jsbiDescs.push(d);
for (const prop of ["forEach", "some", "every", "find"]) {
  jsbiDescs.push({
    featureId: "iterator-methods",
    kind: "instanceMember",
    iface: "Iterator",
    prop,
  });
}
for (const prop of ["calendars", "collations", "numberingSystems"]) {
  jsbiDescs.push({ featureId: "intl-locale-info", kind: "instanceMember", iface: "Locale", prop });
}

const TYPED_ARRAY_IFACES = [
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
];
for (const iface of TYPED_ARRAY_IFACES) {
  for (const prop of ["entries", "keys", "values"]) {
    jsbiDescs.push({ featureId: "typed-array-iterators", kind: "instanceMember", iface, prop });
  }
}
const TYPED_ITER_METHODS = [
  "every",
  "some",
  "forEach",
  "map",
  "filter",
  "reduce",
  "reduceRight",
  "find",
  "findIndex",
];
for (const iface of TYPED_ARRAY_IFACES) {
  for (const prop of TYPED_ITER_METHODS) {
    jsbiDescs.push({
      featureId: "typed-array-iteration-methods",
      kind: "instanceMember",
      iface,
      prop,
    });
  }
}

function writeTs(outPath, name, arr) {
  const header = `// @ts-nocheck\n/**\n * @fileoverview AUTOGENERATED — Do not edit directly.\n * Source: web-features compat_features → descriptor DSL (strict-safe subset).\n */`;
  const body = `${header}\n\nimport type { Descriptor } from "../types";\n\nconst ${name}: ReadonlyArray<Descriptor> = ${JSON.stringify(arr, null, 2)};\nexport default ${name};\n`;
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, body, "utf-8");
}

writeTs(
  resolve(__dirname, "..", "..", "src", "baseline", "data", "descriptors.api.ts"),
  "descriptors",
  apiDescs,
);
writeTs(
  resolve(__dirname, "..", "..", "src", "baseline", "data", "descriptors.jsbi.ts"),
  "descriptors",
  jsbiDescs,
);

console.log(`Generated descriptors: api=${apiDescs.length}, jsbi=${jsbiDescs.length}`);
