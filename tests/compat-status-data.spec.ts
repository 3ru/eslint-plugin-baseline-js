import { describe, expect, it } from "vitest";
import { features as webFeatures } from "web-features";
import apiDescriptors from "../src/baseline/data/descriptors.api";
import jsbiDescriptors from "../src/baseline/data/descriptors.jsbi";
import overrides from "../src/baseline/data/statuses.compat";
import { getFeatureStatus, isBeyondBaseline } from "../src/baseline/resolve";
import type { BaselineStatus, Descriptor } from "../src/baseline/types";

const descriptors = [...apiDescriptors, ...jsbiDescriptors];
const sourceFeatures = webFeatures as unknown as Record<
  string,
  {
    compat_features?: string[];
    status?: BaselineStatus & { by_compat_key?: Record<string, BaselineStatus> };
  }
>;

function statusFields(status: BaselineStatus | undefined) {
  return [status?.baseline, status?.baseline_low_date, status?.baseline_high_date];
}

describe("descriptor compatibility status projection", () => {
  it("retains an upstream-owned compatibility key for every generated pattern", () => {
    expect(descriptors.length).toBeGreaterThan(0);
    for (const descriptor of descriptors) {
      const { featureId, compatKey } = descriptor;
      expect(compatKey, JSON.stringify(descriptor)).toBeTruthy();
      expect(sourceFeatures[featureId]?.compat_features, featureId).toContain(compatKey);
    }
  });

  it("resolves every descriptor to the canonical per-key status and policy", () => {
    for (const { featureId, compatKey } of descriptors) {
      const source = sourceFeatures[featureId];
      const expected = source.status?.by_compat_key?.[compatKey!] ?? source.status;
      const label = `${featureId}: ${compatKey}`;
      expect(statusFields(getFeatureStatus(featureId, compatKey)), label).toEqual(
        statusFields(expected),
      );
      expect(isBeyondBaseline(featureId, "widely", compatKey), label).toBe(
        expected?.baseline !== "high",
      );
      expect(isBeyondBaseline(featureId, "newly", compatKey), label).toBe(
        expected?.baseline === false,
      );
      const date = expected?.baseline_low_date ?? expected?.baseline_high_date;
      const year = date ? Number(date.replace(/^≤/, "").slice(0, 4)) : null;
      for (const policy of [2015, 2020, 2024]) {
        expect(isBeyondBaseline(featureId, policy, compatKey), `${label} @ ${policy}`).toBe(
          expected?.baseline === false || (year !== null && year > policy),
        );
      }
    }
  });

  it("stores only required atomic overrides without browser support tables", () => {
    const ownedKeys = new Set(
      descriptors.map(({ featureId, compatKey }) => `${featureId}:${compatKey}`),
    );
    for (const [featureId, entries] of Object.entries(overrides)) {
      const source = sourceFeatures[featureId];
      for (const [compatKey, status] of Object.entries(entries)) {
        expect(ownedKeys.has(`${featureId}:${compatKey}`)).toBe(true);
        expect(statusFields(status)).not.toEqual(statusFields(source.status));
        expect(statusFields(status)).toEqual(
          statusFields(source.status?.by_compat_key?.[compatKey]),
        );
        expect(
          Object.keys(status).every((key) =>
            ["baseline", "baseline_low_date", "baseline_high_date"].includes(key),
          ),
        ).toBe(true);
      }
    }
  });
});

// Expected keys are audited independently of the generator's inference rules.
const manualCases: [Partial<Descriptor>, string][] = [
  [
    { featureId: "canvas-2d-alpha", kind: "callMemberWithArgs" },
    "api.HTMLCanvasElement.getContext.2d_context.options_alpha_parameter",
  ],
  [
    { featureId: "canvas-2d-willreadfrequently", kind: "callMemberWithArgs" },
    "api.HTMLCanvasElement.getContext.2d_context.options_willReadFrequently_parameter",
  ],
  [
    { featureId: "js-modules-workers", kind: "newWithOptions", name: "Worker" },
    "api.Worker.Worker.ecmascript_modules",
  ],
  [
    { featureId: "js-modules-shared-workers", kind: "newWithOptions", name: "SharedWorker" },
    "api.SharedWorker.SharedWorker.ecmascript_modules",
  ],
  [{ featureId: "ext-srgb", kind: "callMemberWithArgs", prop: "getExtension" }, "api.EXT_sRGB"],
  [
    { featureId: "error-cause", kind: "newWithOptions", name: "Error" },
    "javascript.builtins.Error.Error.options_cause_parameter",
  ],
  [
    { featureId: "error-cause", kind: "newWithOptions", name: "AggregateError" },
    "javascript.builtins.Error.Error.options_cause_parameter",
  ],
  [
    { featureId: "resizable-buffers", kind: "newWithOptions", name: "ArrayBuffer" },
    "javascript.builtins.ArrayBuffer.ArrayBuffer.maxByteLength_option",
  ],
  [
    {
      featureId: "intl-locale-info",
      kind: "instanceMember",
      iface: "Locale",
      prop: "getCalendars",
    },
    "javascript.builtins.Intl.Locale.getCalendars",
  ],
  [
    {
      featureId: "typed-array-iterators",
      kind: "instanceMember",
      iface: "Uint8Array",
      prop: "values",
    },
    "javascript.builtins.TypedArray.values",
  ],
];

describe("manual descriptor compatibility keys", () => {
  it.each(manualCases)("keeps %j attached to %s", (pattern, compatKey) => {
    const matched = descriptors.filter((descriptor) =>
      Object.entries(pattern).every(
        ([key, value]) => descriptor[key as keyof Descriptor] === value,
      ),
    );
    expect(matched).toHaveLength(1);
    expect(matched[0].compatKey).toBe(compatKey);
  });
});
