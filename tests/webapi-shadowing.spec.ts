import { describe, expect, it } from "vitest";
import { lintWithBaseline, reportingPolicyFor } from "./helpers";

// Lint under a policy that reports abortsignal-any whatever its current
// Baseline status is, so silence can only come from the shadowing check.
const policy = reportingPolicyFor("abortsignal-any");
const webApis = { includeWebApis: { preset: "safe" } as const, includeJsBuiltins: false };

describe("use-baseline: Web API shadowing safety", () => {
  it("does not report shadowed static global access patterns", async () => {
    const cases = [
      "const AbortSignal = { any: (v) => v }; AbortSignal.any([]);",
      "const window = { AbortSignal: { any: (v) => v } }; window.AbortSignal.any([]);",
      "const globalThis = { AbortSignal: { any: (v) => v } }; globalThis.AbortSignal.any([]);",
    ];

    for (const code of cases) {
      const msgs = await lintWithBaseline(code, policy, { sourceType: "module" }, webApis);
      expect(msgs, code).toEqual([]);
    }
  });

  it("still reports real global API usage", async () => {
    const direct = await lintWithBaseline(
      "AbortSignal.any([]);",
      policy,
      { sourceType: "module" },
      webApis,
    );
    expect(direct.some((m) => m.includes("(abortsignal-any)"))).toBe(true);

    const qualified = await lintWithBaseline(
      "globalThis.AbortSignal.any([]);",
      policy,
      { sourceType: "module" },
      webApis,
    );
    expect(qualified.some((m) => m.includes("(abortsignal-any)"))).toBe(true);
  });
});
