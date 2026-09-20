import { describe, expect, it } from "vitest";
import { lintWithBaseline, reportingPolicyFor } from "./helpers";

// Each feature is linted under a policy that reports it whatever its current
// Baseline status is, so the only thing that can silence it is ignoreFeatures.
describe("ignoreFeatures across descriptor-based detection", () => {
  it("skips Web API descriptors when ignored", async () => {
    const code = "const dpr = window.devicePixelRatio;";
    const policy = reportingPolicyFor("devicepixelratio");
    const msgs = await lintWithBaseline(code, policy, {}, { includeWebApis: { preset: "auto" } });
    expect(msgs.some((m) => m.includes("(devicepixelratio)"))).toBe(true);

    const ignored = await lintWithBaseline(
      code,
      policy,
      {},
      { includeWebApis: { preset: "auto" }, ignoreFeatures: ["devicepixelratio"] },
    );
    expect(ignored.length).toBe(0);
  });

  it("skips JS builtin descriptors when ignored", async () => {
    const code = "Array.fromAsync([]);";
    const policy = reportingPolicyFor("array-fromasync");
    const msgs = await lintWithBaseline(
      code,
      policy,
      {},
      { includeJsBuiltins: { preset: "auto" } },
    );
    expect(msgs.some((m) => m.includes("(array-fromasync)"))).toBe(true);

    const ignored = await lintWithBaseline(
      code,
      policy,
      {},
      {
        includeJsBuiltins: { preset: "auto" },
        ignoreFeatures: ["array-fromasync"],
      },
    );
    expect(ignored.length).toBe(0);
  });
});
