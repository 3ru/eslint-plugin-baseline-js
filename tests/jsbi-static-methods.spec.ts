import { describe, expect, it } from "vitest";
import { lintWithBaseline } from "./helpers";

// Regression tests for static methods on constructors that share a name with
// their ALLOWED_IFACE entries (e.g. `Promise.try` vs `Promise.prototype.then`).
// Before the fix these were classified as `instanceMember`, which silently
// disabled detection under `preset: "safe"` (the path used by plain ESLint
// and by oxlint, which never exposes parser services).

describe("use-baseline: JS builtins static methods (preset: safe)", () => {
  const safe = { includeJsBuiltins: { preset: "safe" } as const };

  describe("newly features are flagged under available: widely", () => {
    const cases: Array<{ code: string; featureId: string }> = [
      { code: "Promise.try(fn);", featureId: "promise-try" },
      { code: "Promise.withResolvers();", featureId: "promise-withresolvers" },
      { code: "Map.groupBy(arr, fn);", featureId: "array-group" },
      { code: "RegExp.escape(s);", featureId: "regexp-escape" },
    ];
    for (const { code, featureId } of cases) {
      it(`reports ${featureId} for \`${code}\``, async () => {
        const msgs = await lintWithBaseline(code, "widely", { sourceType: "module" }, safe);
        expect(msgs.some((m) => m.includes(`(${featureId})`))).toBe(true);
      });
    }
  });

  describe("widely features are flagged under older numeric baselines", () => {
    const cases: Array<{ code: string; available: number; featureId: string }> = [
      { code: "Promise.all([p]);", available: 2014, featureId: "promise" },
      { code: "Promise.allSettled([p]);", available: 2019, featureId: "promise-allsettled" },
      { code: "Promise.any([p]);", available: 2019, featureId: "promise-any" },
      { code: "ArrayBuffer.isView(buf);", available: 2010, featureId: "typed-arrays" },
      { code: "BigInt.asIntN(1, 1n);", available: 2010, featureId: "bigint" },
      { code: "BigInt.asUintN(1, 1n);", available: 2010, featureId: "bigint" },
      { code: "Number.isInteger(x);", available: 2010, featureId: "number" },
      { code: "Number.parseInt('1');", available: 2010, featureId: "number" },
      { code: "Number.EPSILON;", available: 2010, featureId: "number" },
      { code: "Proxy.revocable({}, handler);", available: 2010, featureId: "proxy-reflect" },
      { code: "Symbol.for('x');", available: 2010, featureId: "symbol" },
      { code: "Symbol.keyFor(sym);", available: 2010, featureId: "symbol" },
      { code: "String.fromCharCode(65);", available: 2014, featureId: "strings" },
      { code: "String.fromCodePoint(0x41);", available: 2014, featureId: "string-codepoint" },
      { code: "Date.now();", available: 2008, featureId: "date" },
      { code: "Date.parse(s);", available: 2008, featureId: "date" },
      { code: "Date.UTC(2020, 0, 1);", available: 2008, featureId: "date" },
    ];
    for (const { code, available, featureId } of cases) {
      it(`reports ${featureId} for \`${code}\` under year ${available}`, async () => {
        const msgs = await lintWithBaseline(code, available, { sourceType: "module" }, safe);
        expect(msgs.some((m) => m.includes(`(${featureId})`))).toBe(true);
      });
    }
  });

  describe("widely features under available: widely stay silent", () => {
    const cases = [
      "Promise.all([p]);",
      "Promise.allSettled([p]);",
      "Promise.any([p]);",
      "Promise.race([p]);",
      "Promise.resolve(x);",
      "Promise.reject(e);",
      "ArrayBuffer.isView(buf);",
      "BigInt.asIntN(1, 1n);",
      "BigInt.asUintN(1, 1n);",
      "Number.isFinite(x);",
      "Number.isInteger(x);",
      "Number.isNaN(x);",
      "Number.isSafeInteger(x);",
      "Number.parseFloat('1');",
      "Number.parseInt('1');",
      "Number.EPSILON;",
      "Proxy.revocable({}, handler);",
      "Symbol.for('x');",
      "Symbol.keyFor(sym);",
      "String.fromCharCode(65);",
      "String.fromCodePoint(0x41);",
      "Date.now();",
      "Date.parse(s);",
      "Date.UTC(2020, 0, 1);",
    ];
    for (const code of cases) {
      it(`stays silent for \`${code}\``, async () => {
        const msgs = await lintWithBaseline(code, "widely", { sourceType: "module" }, safe);
        expect(msgs).toEqual([]);
      });
    }
  });

  describe("does not confuse instance usage or shadowed globals", () => {
    const cases = [
      // Prototype methods must not match callStatic descriptors.
      "p.then(fn);",
      "p.catch(fn);",
      // Shadowed constructors must not report the static.
      "class Map {} Map.groupBy(arr, fn);",
      "function Promise(){} Promise.try(fn);",
      "const ArrayBuffer = { isView: () => true }; ArrayBuffer.isView(buf);",
      "const BigInt = { asIntN: () => 1n }; BigInt.asIntN(1, 1n);",
      "const Date = { now: () => 0 }; Date.now();",
      "const Proxy = { revocable: () => ({}) }; Proxy.revocable({}, handler);",
      "const RegExp = { escape: (s) => s }; RegExp.escape(s);",
      "const Symbol = { for: () => Symbol('x') }; Symbol.for('x');",
    ];
    for (const code of cases) {
      it(`stays silent for \`${code}\``, async () => {
        const msgs = await lintWithBaseline(code, "widely", { sourceType: "module" }, safe);
        expect(msgs).toEqual([]);
      });
    }
  });
});
