import { describe, expect, it } from "vitest";
import { lintWithBaseline } from "./helpers";

describe("use-baseline: JS builtins shadowing safety", () => {
  it("does not report shadowed static/member/newWithOptions patterns", async () => {
    const cases = [
      "const Iterator = { from: (v) => v }; Iterator.from([1]);",
      "const Symbol = { dispose: 1 }; Symbol.dispose;",
      "const ArrayBuffer = function () {}; new ArrayBuffer(8, { maxByteLength: 16 });",
      "const window = { Iterator: { from: (v) => v } }; window.Iterator.from([1]);",
      "const globalThis = { Iterator: { from: (v) => v } }; globalThis.Iterator.from([1]);",
    ];

    for (const code of cases) {
      const msgs = await lintWithBaseline(
        code,
        "widely",
        { sourceType: "module" },
        { includeJsBuiltins: { preset: "safe" } },
      );
      expect(msgs).toEqual([]);
    }
  });

  it("still reports real global usages", async () => {
    const iteratorMsgs = await lintWithBaseline(
      "Iterator.from([1]);",
      "widely",
      { sourceType: "module" },
      { includeJsBuiltins: { preset: "safe" } },
    );
    expect(iteratorMsgs.some((m) => m.includes("(iterator-methods)"))).toBe(true);

    const symbolMsgs = await lintWithBaseline(
      "Symbol.dispose;",
      "widely",
      { sourceType: "module" },
      { includeJsBuiltins: { preset: "safe" } },
    );
    expect(symbolMsgs.some((m) => m.includes("(explicit-resource-management)"))).toBe(true);

    const bufferMsgs = await lintWithBaseline(
      "new ArrayBuffer(8, { maxByteLength: 16 });",
      "widely",
      { sourceType: "module" },
      { includeJsBuiltins: { preset: "safe" } },
    );
    expect(bufferMsgs.some((m) => m.includes("(resizable-buffers)"))).toBe(true);
  });
});
