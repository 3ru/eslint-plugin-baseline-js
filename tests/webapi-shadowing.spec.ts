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
      const msgs = await lintWithBaseline(
        code,
        "widely",
        { sourceType: "module" },
        { includeWebApis: { preset: "safe" }, includeJsBuiltins: false },
      );
      expect(msgs).toEqual([]);
    }
  });

  it("still reports real global API usage", async () => {
    const direct = await lintWithBaseline(
      "AbortSignal.any([]);",
      "widely",
      { sourceType: "module" },
      { includeWebApis: { preset: "safe" }, includeJsBuiltins: false },
    );
    expect(direct.some((m) => m.includes("(abortsignal-any)"))).toBe(true);

    const qualified = await lintWithBaseline(
      "globalThis.AbortSignal.any([]);",
      "widely",
      { sourceType: "module" },
      { includeWebApis: { preset: "safe" }, includeJsBuiltins: false },
    );
    expect(qualified.some((m) => m.includes("(abortsignal-any)"))).toBe(true);
  });
});
