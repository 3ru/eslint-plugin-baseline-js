import { describe, expect, it } from "vitest";
import {
  buildCompatStatusOverrides,
  canonicalizeDescriptors,
} from "../scripts/data/descriptor-status.mjs";

function permutations<T>([head, ...tail]: T[]): T[][] {
  if (head === undefined) return [[]];
  return permutations(tail).flatMap((rest) =>
    Array.from({ length: rest.length + 1 }, (_, index) => [
      ...rest.slice(0, index),
      head,
      ...rest.slice(index),
    ]),
  );
}

describe("descriptor canonicalization", () => {
  it.each([
    {
      descriptor: { featureId: "widget", kind: "newIdent", name: "Widget" },
      broadKey: "api.Widget",
      constructorKey: "api.Widget.Widget",
    },
    {
      descriptor: { featureId: "widget", kind: "newMember", base: "Intl", prop: "Widget" },
      broadKey: "javascript.builtins.Intl.Widget",
      constructorKey: "javascript.builtins.Intl.Widget.Widget",
    },
  ])(
    "selects the exact $constructorKey constructor before availability filtering",
    ({ descriptor, broadKey, constructorKey }) => {
      const exact = { ...descriptor, compatKey: constructorKey };
      const broad = { ...descriptor, compatKey: broadKey };
      const features = {
        widget: {
          compat_features: [broadKey, constructorKey],
          status: {
            baseline: "high",
            baseline_low_date: "2015-01-01",
            baseline_high_date: "2017-07-01",
            by_compat_key: {
              [broadKey]: { baseline: "high", baseline_low_date: "2015-01-01" },
              [constructorKey]: { baseline: false },
            },
          },
        },
      };
      for (const candidates of permutations([descriptor, broad, exact])) {
        const selected = canonicalizeDescriptors(candidates);
        expect(selected).toEqual([exact]);
        expect(buildCompatStatusOverrides(selected, features)).toEqual({
          widget: { [constructorKey]: { baseline: false } },
        });
      }
    },
  );

  it("deduplicates keyed and unkeyed patterns independently of property order", () => {
    const unkeyed = { featureId: "widget", kind: "callStatic", base: "Widget", prop: "parse" };
    const keyed = {
      compatKey: "api.Widget.parse_static",
      prop: "parse",
      base: "Widget",
      kind: "callStatic",
      featureId: "widget",
    };
    for (const candidates of permutations([unkeyed, keyed, { ...keyed }])) {
      expect(canonicalizeDescriptors(candidates)).toEqual([keyed]);
    }
  });

  it("keeps different detection patterns and feature owners separate", () => {
    const descriptors = [
      {
        featureId: "first",
        kind: "member",
        base: "window",
        prop: "widget",
        compatKey: "api.Window.widget",
      },
      { featureId: "first", kind: "callGlobal", name: "widget", compatKey: "api.Window.widget" },
      {
        featureId: "second",
        kind: "member",
        base: "window",
        prop: "widget",
        compatKey: "api.Window.widget",
      },
    ];
    expect(canonicalizeDescriptors(descriptors)).toEqual(descriptors);
  });

  it("rejects ambiguous exact keys rather than selecting by input order", () => {
    const descriptor = { featureId: "widget", kind: "callStatic", base: "Widget", prop: "parse" };
    for (const keys of permutations(["api.Widget.parse", "api.Widget.parse_static"])) {
      expect(() =>
        canonicalizeDescriptors(keys.map((compatKey) => ({ ...descriptor, compatKey }))),
      ).toThrow("Ambiguous compat keys");
    }
  });
});

describe("descriptor compatibility status projection", () => {
  const compatKey = "api.Widget.parse_static";
  const descriptor = {
    featureId: "widget",
    kind: "callStatic",
    base: "Widget",
    prop: "parse",
    compatKey,
  };
  const headline = {
    baseline: "high",
    baseline_low_date: "2015-01-01",
    baseline_high_date: "2017-07-01",
  };

  function featureWithExact(exact: Record<string, unknown>) {
    return {
      widget: {
        compat_features: [compatKey],
        status: { ...headline, by_compat_key: { [compatKey]: exact } },
      },
    };
  }

  it("omits exact statuses equal to the feature headline", () => {
    expect(
      buildCompatStatusOverrides([descriptor], featureWithExact({ ...headline, support: {} })),
    ).toEqual({});
  });

  it("omits absent per-key statuses", () => {
    expect(
      buildCompatStatusOverrides([descriptor], {
        widget: { compat_features: [compatKey], status: headline },
      }),
    ).toEqual({});
  });

  it.each([{}, { baseline: false }, { baseline: "low" }, { baseline: "high" }])(
    "preserves atomic exact status %j without inheriting headline fields",
    (exact) => {
      const overrides = buildCompatStatusOverrides([descriptor], featureWithExact(exact));
      expect(overrides).toEqual({ widget: { [compatKey]: exact } });
      expect(Object.hasOwn(overrides.widget[compatKey], "baseline_low_date")).toBe(false);
      expect(Object.hasOwn(overrides.widget[compatKey], "baseline_high_date")).toBe(false);
    },
  );

  it("projects only Baseline status fields", () => {
    expect(
      buildCompatStatusOverrides(
        [descriptor],
        featureWithExact({ baseline: "low", baseline_low_date: "2025-01-01", support: {} }),
      ),
    ).toEqual({ widget: { [compatKey]: { baseline: "low", baseline_low_date: "2025-01-01" } } });
  });

  it("does not treat inherited properties as exact statuses", () => {
    expect(
      buildCompatStatusOverrides([descriptor], {
        widget: {
          compat_features: [compatKey],
          status: {
            ...headline,
            by_compat_key: Object.create({ [compatKey]: { baseline: false } }),
          },
        },
      }),
    ).toEqual({});
  });

  it.each([
    {},
    { widget: { status: headline } },
    { widget: { compat_features: ["api.Widget.other"], status: headline } },
  ])("rejects keys outside their feature membership", (features) => {
    expect(() => buildCompatStatusOverrides([descriptor], features)).toThrow(
      `Unknown compat key for widget: ${compatKey}`,
    );
  });
});
