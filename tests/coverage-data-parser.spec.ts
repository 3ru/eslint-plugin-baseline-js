import { describe, expect, it } from "vitest";
import { features as webFeatures } from "web-features";
import {
  formatBaselineYear,
  parseGeneratedFeaturesSource,
  readGeneratedFeatures,
} from "../scripts/coverage/parse-generated-features.mjs";

describe("generated feature data parser", () => {
  it("preserves the final feature without a trailing comma", () => {
    const source = `
      // @ts-nocheck
      export default {
        "first": { "id": "first", "name": "First", "status": { "baseline": false } },
        "last": { "id": "last", "name": "Last", "status": { "baseline": "high" } }
      } as const;
    `;

    expect(Object.keys(parseGeneratedFeaturesSource(source))).toEqual(["first", "last"]);
  });

  it("reads every generated feature record", () => {
    const entries = Object.entries(webFeatures);
    for (const [path, expectedIds] of [
      [
        "src/baseline/data/features.javascript.ts",
        entries
          .filter(([, feature]) => {
            const group = feature.group;
            return Array.isArray(group) ? group.includes("javascript") : group === "javascript";
          })
          .map(([id]) => id),
      ],
      [
        "src/baseline/data/features.api.ts",
        entries
          .filter(([, feature]) => feature.compat_features?.some((key) => key.startsWith("api.")))
          .map(([id]) => id),
      ],
      [
        "src/baseline/data/features.jsbi.ts",
        entries
          .filter(([, feature]) =>
            feature.compat_features?.some((key) => key.startsWith("javascript.builtins")),
          )
          .map(([id]) => id),
      ],
    ] as const) {
      const features = readGeneratedFeatures(path);
      expect(Object.keys(features).sort()).toEqual(expectedIds.sort());
      for (const [id, feature] of Object.entries(features)) {
        expect((feature as { id?: string }).id).toBe(id);
      }
    }
  });

  it("formats exact and upper-bound Baseline years", () => {
    expect(formatBaselineYear({ baseline_low_date: "2024-01-25" })).toBe("2024");
    expect(formatBaselineYear({ baseline_low_date: "≤2018-10-02" })).toBe("≤2018");
  });
});
