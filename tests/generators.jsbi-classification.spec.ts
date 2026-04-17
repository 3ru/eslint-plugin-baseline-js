import { describe, expect, it } from "vitest";
import { features as wfFeatures } from "web-features";
import {
  classifyJsBuiltinCompatFeature,
  JS_BUILTIN_CLASSIFICATION_FALLBACKS,
} from "../scripts/data/classify-js-builtins.mjs";
import descriptors from "../src/baseline/data/descriptors.jsbi";

type GeneratedDescriptor = (typeof descriptors)[number];

function keyOf(value: GeneratedDescriptor): string {
  return JSON.stringify(value);
}

function collectAutoClassifiedDescriptors(): GeneratedDescriptor[] {
  const out: GeneratedDescriptor[] = [];
  for (const [featureId, feature] of Object.entries(wfFeatures)) {
    const compatFeatures = Array.isArray(feature.compat_features) ? feature.compat_features : [];
    for (const compatKey of compatFeatures) {
      if (!compatKey.startsWith("javascript.builtins.")) continue;
      const parts = compatKey.split(".");
      if (parts.length !== 4) continue;
      const classified = classifyJsBuiltinCompatFeature(parts[2], parts[3]);
      if (!classified) continue;
      out.push({ featureId, ...classified } as GeneratedDescriptor);
    }
  }
  return out;
}

function collectFallbackDescriptors(): GeneratedDescriptor[] {
  const out: GeneratedDescriptor[] = [];
  for (const entry of JS_BUILTIN_CLASSIFICATION_FALLBACKS) {
    for (const [featureId, feature] of Object.entries(wfFeatures)) {
      const compatFeatures = Array.isArray(feature.compat_features) ? feature.compat_features : [];
      if (!compatFeatures.includes(entry.compatKey)) continue;
      out.push({ featureId, ...entry.descriptor } as GeneratedDescriptor);
    }
  }
  return out;
}

describe("descriptors.jsbi generation (auto builtin classification)", () => {
  it("covers every auto-classified javascript.builtins.* member", () => {
    const generated = new Set(descriptors.map((descriptor) => keyOf(descriptor)));
    const missing = collectAutoClassifiedDescriptors().filter(
      (descriptor) => !generated.has(keyOf(descriptor)),
    );

    expect(missing).toEqual([]);
  });

  it("covers every explicit builtin classification fallback", () => {
    const generated = new Set(descriptors.map((descriptor) => keyOf(descriptor)));
    const missing = collectFallbackDescriptors().filter(
      (descriptor) => !generated.has(keyOf(descriptor)),
    );

    expect(missing).toEqual([]);
  });

  it("classifies representative builtin surfaces by evidence, not by base-local allowlists", () => {
    expect(classifyJsBuiltinCompatFeature("Promise", "try")).toEqual({
      kind: "callStatic",
      base: "Promise",
      prop: "try",
    });
    expect(classifyJsBuiltinCompatFeature("ArrayBuffer", "isView")).toEqual({
      kind: "callStatic",
      base: "ArrayBuffer",
      prop: "isView",
    });
    expect(classifyJsBuiltinCompatFeature("Symbol", "for")).toEqual({
      kind: "callStatic",
      base: "Symbol",
      prop: "for",
    });
    expect(classifyJsBuiltinCompatFeature("Number", "EPSILON")).toEqual({
      kind: "staticMember",
      base: "Number",
      prop: "EPSILON",
    });
    expect(classifyJsBuiltinCompatFeature("Promise", "then")).toEqual({
      kind: "instanceMember",
      iface: "Promise",
      prop: "then",
    });
    expect(classifyJsBuiltinCompatFeature("Map", "getOrInsert")).toEqual({
      kind: "instanceMember",
      iface: "Map",
      prop: "getOrInsert",
    });
    expect(classifyJsBuiltinCompatFeature("Intl", "Collator")).toEqual({
      kind: "newMember",
      base: "Intl",
      prop: "Collator",
    });
  });
});
