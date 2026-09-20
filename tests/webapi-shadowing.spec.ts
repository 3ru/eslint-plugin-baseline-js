import { describe, expect, it } from "vitest";
import { lintWithBaseline } from "./helpers";

describe("use-baseline: Web API shadowing safety", () => {
  it("does not report shadowed static global access patterns", async () => {
    const cases = [
      "const AbortSignal = { any: (v) => v }; AbortSignal.any([]);",
      "const window = { AbortSignal: { any: (v) => v } }; window.AbortSignal.any([]);",
      "const globalThis = { AbortSignal: { any: (v) => v } }; globalThis.AbortSignal.any([]);",
    ];

    for (const code of cases) {
      // Same 2023 year policy as the positive test below: it would report an
      // unshadowed AbortSignal.any() regardless of when abortsignal-any reaches
      // widely availability, so the shadowed forms must stay silent under it.
      const msgs = await lintWithBaseline(
        code,
        2023,
        { sourceType: "module" },
        { includeWebApis: { preset: "safe" }, includeJsBuiltins: false },
      );
      expect(msgs).toEqual([]);
    }
  });

  it("still reports real global API usage", async () => {
    // abortsignal-any became Baseline newly in 2024, so a 2023 year policy reports it
    // regardless of when it later reaches widely availability.
    const direct = await lintWithBaseline(
      "AbortSignal.any([]);",
      2023,
      { sourceType: "module" },
      { includeWebApis: { preset: "safe" }, includeJsBuiltins: false },
    );
    expect(direct.some((m) => m.includes("(abortsignal-any)"))).toBe(true);

    const qualified = await lintWithBaseline(
      "globalThis.AbortSignal.any([]);",
      2023,
      { sourceType: "module" },
      { includeWebApis: { preset: "safe" }, includeJsBuiltins: false },
    );
    expect(qualified.some((m) => m.includes("(abortsignal-any)"))).toBe(true);
  });
});
