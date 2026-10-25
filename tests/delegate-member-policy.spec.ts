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
  ],
}));
vi.mock("../src/baseline/data/statuses.compat", () => ({
  default: {
    "proxy-reflect": {
      "fixture.supported": { baseline: "high", baseline_low_date: "2010-01-01" },
      "fixture.recent": { baseline: "low", baseline_low_date: "2030-01-01" },
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
      `'revocable' on Proxy became Baseline in 2030 and exceeds ${available} (proxy-reflect).`,
    ]);
  });
});
