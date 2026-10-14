import { describe, expect, it, vi } from "vitest";

vi.mock("../src/baseline/data/features.javascript", () => ({ default: {} }));
vi.mock("../src/baseline/data/features.jsbi", () => ({ default: {} }));
vi.mock("../src/baseline/data/features.api", () => ({
  default: {
    example: {
      name: "Example",
      status: {
        baseline: "high",
        baseline_low_date: "2015-01-01",
        baseline_high_date: "2017-07-01",
      },
    },
  },
}));
vi.mock("../src/baseline/data/statuses.compat", () => ({
  default: {
    example: {
      "api.Example.unknown": {},
      "api.Example.limited": { baseline: false },
      "api.Example.undated": { baseline: "low" },
      "api.Example.recent": { baseline: "low", baseline_low_date: "2024-09-01" },
    },
  },
}));

import { getFeatureBucket, getFeatureStatus, isBeyondBaseline } from "../src/baseline/resolve";
import { baselineMessage } from "../src/orchestrator/messages";

describe("atomic compatibility overrides", () => {
  it("keeps explicit unknown status instead of inheriting the headline", () => {
    expect(getFeatureStatus("example", "api.Example.unknown")).toEqual({});
    expect(getFeatureBucket("example", "api.Example.unknown")).toBe("unknown");
    expect(isBeyondBaseline("example", "widely", "api.Example.unknown")).toBe(true);
    expect(isBeyondBaseline("example", "newly", "api.Example.unknown")).toBe(false);
    expect(isBeyondBaseline("example", 2010, "api.Example.unknown")).toBe(false);
  });

  it("does not inherit dates for limited or undated exact members", () => {
    expect(getFeatureStatus("example", "api.Example.limited")).toEqual({ baseline: false });
    expect(isBeyondBaseline("example", 9999, "api.Example.limited")).toBe(true);
    expect(getFeatureStatus("example", "api.Example.undated")).toEqual({ baseline: "low" });
    expect(isBeyondBaseline("example", 2010, "api.Example.undated")).toBe(false);
    expect(baselineMessage("example", 2020, "member", "api.Example.limited")).toBe(
      "member has Limited availability and exceeds 2020 (example).",
    );
  });

  it("uses the same exact status for filtering and diagnostic years", () => {
    expect(isBeyondBaseline("example", 2023, "api.Example.recent")).toBe(true);
    expect(isBeyondBaseline("example", 2024, "api.Example.recent")).toBe(false);
    expect(baselineMessage("example", 2023, "member", "api.Example.recent")).toBe(
      "member became Baseline in 2024 and exceeds 2023 (example).",
    );
  });

  it("falls back as a whole when no exact override exists", () => {
    expect(getFeatureStatus("example", "api.Example.original")).toEqual({
      baseline: "high",
      baseline_low_date: "2015-01-01",
      baseline_high_date: "2017-07-01",
    });
    expect(getFeatureBucket("example")).toBe("widely");
  });
});
