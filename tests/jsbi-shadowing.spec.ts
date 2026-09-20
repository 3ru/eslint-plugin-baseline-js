import { describe, expect, it } from "vitest";
import { lintWithBaseline, reportingPolicyFor } from "./helpers";

const safe = { includeJsBuiltins: { preset: "safe" } as const };

describe("use-baseline: JS builtins shadowing safety", () => {
  it("does not report shadowed static/member/newWithOptions patterns", async () => {
    const cases = [
      {
        code: "const Iterator = { from: (v) => v }; Iterator.from([1]);",
        featureId: "iterator-methods",
      },
      {
        code: "const Symbol = { dispose: 1 }; Symbol.dispose;",
        featureId: "explicit-resource-management",
      },
      {
        code: "const ArrayBuffer = function () {}; new ArrayBuffer(8, { maxByteLength: 16 });",
        featureId: "resizable-buffers",
      },
      {
        code: "const window = { Iterator: { from: (v) => v } }; window.Iterator.from([1]);",
        featureId: "iterator-methods",
      },
      {
        code: "const globalThis = { Iterator: { from: (v) => v } }; globalThis.Iterator.from([1]);",
        featureId: "iterator-methods",
      },
    ];

    for (const { code, featureId } of cases) {
      // The policy would report the feature if the global were not shadowed.
      const msgs = await lintWithBaseline(
        code,
        reportingPolicyFor(featureId),
        { sourceType: "module" },
        safe,
      );
      expect(msgs, code).toEqual([]);
    }
  });

  it("still reports real global usages", async () => {
    const cases = [
      { code: "Iterator.from([1]);", featureId: "iterator-methods" },
      { code: "Symbol.dispose;", featureId: "explicit-resource-management" },
      { code: "new ArrayBuffer(8, { maxByteLength: 16 });", featureId: "resizable-buffers" },
    ];

    for (const { code, featureId } of cases) {
      const msgs = await lintWithBaseline(
        code,
        reportingPolicyFor(featureId),
        { sourceType: "module" },
        safe,
      );
      expect(
        msgs.some((m) => m.includes(`(${featureId})`)),
        code,
      ).toBe(true);
    }
  });
});
