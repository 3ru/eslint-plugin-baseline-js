import { describe, expect, it, vi } from "vitest";

vi.mock("../src/baseline/data/descriptors.jsbi", () => ({
  default: [
    {
      featureId: "proxy-reflect",
      kind: "callStatic",
      base: "Reflect",
      prop: "get",
      compatKey: "fixture.supported",
    },
    {
      featureId: "proxy-reflect",
      kind: "callStatic",
      base: "Proxy",
      prop: "revocable",
      compatKey: "fixture.supported",
    },
    {
      featureId: "proxy-reflect",
      kind: "callStatic",
      base: "Proxy",
      prop: "revocable",
      compatKey: "fixture.recent",
    },
    {
      featureId: "proxy-reflect",
      kind: "callStatic",
      base: "Reflect",
      prop: "has",
      compatKey: "fixture.unknown",
    },
    {
      featureId: "proxy-reflect",
      kind: "callStatic",
      base: "Reflect",
      prop: "ownKeys",
      compatKey: "fixture.datedUnknown",
    },
    {
      featureId: "proxy-reflect",
      kind: "callStatic",
      base: "Reflect",
      prop: "deleteProperty",
      compatKey: "fixture.upperBound",
    },
  ],
}));
vi.mock("../src/baseline/data/statuses.compat", () => ({
  default: {
    "proxy-reflect": {
      "fixture.supported": { baseline: "high", baseline_low_date: "2010-01-01" },
      "fixture.recent": { baseline: "low", baseline_low_date: "2030-01-01" },
      "fixture.unknown": {},
      "fixture.datedUnknown": { baseline_low_date: "2030-01-01" },
      "fixture.upperBound": { baseline: "high", baseline_low_date: "≤2030-01-01" },
    },
  },
}));

import { lintWithBaseline, reportingPolicyFor } from "./helpers";

const available = reportingPolicyFor("proxy-reflect");
const include = { includeJsBuiltins: { preset: "safe", only: ["proxy-reflect"] } };

describe("delegate ownership with controlled member statuses", () => {
  it("keeps a supported exact API silent despite the unsupported headline", async () => {
    await expect(
      lintWithBaseline("Reflect.get({}, 'key');", available, {}, include),
    ).resolves.toEqual([]);
  });

  it("does not let a supported match consume another exact warning", async () => {
    await expect(
      lintWithBaseline("Proxy.revocable({}, {});", available, {}, include),
    ).resolves.toEqual([
      `'Proxy.revocable' does not meet your Baseline ${available} target. Its Baseline year is 2030. Feature ID: proxy-reflect.`,
    ]);
  });

  it("reports an exact unknown status under widely without inheriting its headline", async () => {
    await expect(
      lintWithBaseline("Reflect.has({}, 'key');", "widely", {}, include),
    ).resolves.toEqual([
      "'Reflect.has' does not meet your Baseline Widely available target. Its Baseline status is unknown. Feature ID: proxy-reflect.",
    ]);
    await expect(
      lintWithBaseline("Reflect.has({}, 'key');", "newly", {}, include),
    ).resolves.toEqual([]);
  });

  it("reports a known year when the exact status flag is unknown", async () => {
    await expect(lintWithBaseline("Reflect.ownKeys({});", 2029, {}, include)).resolves.toEqual([
      "'Reflect.ownKeys' does not meet your Baseline 2029 target. Its Baseline year is 2030. Feature ID: proxy-reflect.",
    ]);
    await expect(lintWithBaseline("Reflect.ownKeys({});", 2030, {}, include)).resolves.toEqual([]);
  });

  it("preserves an upper-bound date in the diagnostic year", async () => {
    await expect(
      lintWithBaseline("Reflect.deleteProperty({}, 'key');", 2029, {}, include),
    ).resolves.toEqual([
      "'Reflect.deleteProperty' does not meet your Baseline 2029 target. Its Baseline year is ≤2030. Feature ID: proxy-reflect.",
    ]);
    await expect(
      lintWithBaseline("Reflect.deleteProperty({}, 'key');", 2030, {}, include),
    ).resolves.toEqual([]);
  });
});
