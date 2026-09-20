import { describe, expect, it } from "vitest";
import apiRaw from "../src/baseline/data/features.api";
import jsRaw from "../src/baseline/data/features.javascript";
import jsbiRaw from "../src/baseline/data/features.jsbi";
import { getFeatureBucket, isBeyondBaseline } from "../src/baseline/resolve";
import { reportingPolicyFor } from "./utils/policy";

// These checks derive the expected outcome from each record's own status
// fields, so they hold for any web-features snapshot: refreshing the data
// changes which features fall into which bucket, not the rules under test.

interface Status {
  baseline?: "high" | "low" | false;
  baseline_low_date?: string;
  baseline_high_date?: string;
}

const features = { ...jsRaw, ...apiRaw, ...jsbiRaw } as unknown as Record<
  string,
  { status?: Status }
>;
const entries = Object.entries(features);

function isRanged(status: Status | undefined): boolean {
  const date = status?.baseline_low_date ?? status?.baseline_high_date;
  return date?.startsWith("≤") ?? false;
}

// Ranged dates ("≤YYYY-MM-DD") yield no year in src/baseline/resolve.ts.
function baselineYear(status: Status | undefined): number | null {
  const date = status?.baseline_low_date ?? status?.baseline_high_date;
  if (!date || isRanged(status)) return null;
  return Number(date.slice(0, 4));
}

describe("baseline resolution against the bundled snapshot", () => {
  it("snapshot covers every bucket, so the checks below are not vacuous", () => {
    const buckets = new Set(entries.map(([id]) => getFeatureBucket(id)));
    expect(buckets).toEqual(new Set(["widely", "newly", "limited"]));
  });

  it("maps status.baseline to a bucket", () => {
    for (const [id, rec] of entries) {
      const b = rec.status?.baseline;
      // "unknown" only guards against a generator bug: web-features always sets baseline.
      const expected =
        b === "high" ? "widely" : b === "low" ? "newly" : b === false ? "limited" : "unknown";
      expect(getFeatureBucket(id), id).toBe(expected);
    }
  });

  it("available: widely reports everything that is not Baseline high", () => {
    for (const [id, rec] of entries) {
      expect(isBeyondBaseline(id, "widely"), id).toBe(rec.status?.baseline !== "high");
    }
  });

  it("available: newly reports only Limited features", () => {
    for (const [id, rec] of entries) {
      expect(isBeyondBaseline(id, "newly"), id).toBe(rec.status?.baseline === false);
    }
  });

  it("available: <year> reports Limited features and anything that became Baseline later", () => {
    for (const year of [2015, 2020, 2024]) {
      for (const [id, rec] of entries) {
        if (rec.status?.baseline === false) {
          expect(isBeyondBaseline(id, year), `${id} @ ${year}`).toBe(true);
          continue;
        }
        const y = baselineYear(rec.status);
        if (y == null) continue;
        expect(isBeyondBaseline(id, year), `${id} @ ${year}`).toBe(y > year);
      }
    }
  });

  it("reportingPolicyFor() yields a year policy that reports the feature", () => {
    for (const [id, rec] of entries) {
      if (isRanged(rec.status)) {
        // No year policy can report these; the helper must say so instead of guessing.
        expect(() => reportingPolicyFor(id), id).toThrow(/ranged Baseline date/);
        continue;
      }
      expect(isBeyondBaseline(id, reportingPolicyFor(id)), id).toBe(true);
    }
    expect(() => reportingPolicyFor("not-a-feature")).toThrow(/unknown feature id/);
  });

  it("unknown feature ids are never reported", () => {
    for (const policy of ["widely", "newly", 2000] as const) {
      expect(isBeyondBaseline("not-a-feature", policy)).toBe(false);
    }
    expect(getFeatureBucket("not-a-feature")).toBe("unknown");
  });
});
