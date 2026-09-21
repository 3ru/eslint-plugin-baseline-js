import { describe, expect, it } from "vitest";
import { lintWithBaseline, reportingPolicyFor } from "./helpers";

// Regression tests for static methods on constructors that share a name with
// their ALLOWED_IFACE entries (e.g. `Promise.try` vs `Promise.prototype.then`).
// Before the fix these were classified as `instanceMember`, which silently
// disabled detection under `preset: "safe"` (the path used by plain ESLint
// and by oxlint, which never exposes parser services).

describe("use-baseline: JS builtins static methods (preset: safe)", () => {
  const safe = { includeJsBuiltins: { preset: "safe" } as const };

  // Each case lints under a year policy derived from its feature's own record,
  // so detection is asserted whatever the feature's current Baseline status is.
  // bigint and proxy-reflect are also syntax-mapped (es-x), so for those ids the
  // report may come from the delegate rather than from the static descriptor.
  describe("static methods are reported and mapped to their feature", () => {
    const cases: Array<{ code: string; featureId: string }> = [
      { code: "Promise.try(fn);", featureId: "promise-try" },
      { code: "Promise.withResolvers();", featureId: "promise-withresolvers" },
      { code: "Promise.all([p]);", featureId: "promise" },
      { code: "Promise.allSettled([p]);", featureId: "promise-allsettled" },
      { code: "Promise.any([p]);", featureId: "promise-any" },
      { code: "Map.groupBy(arr, fn);", featureId: "array-group" },
      { code: "Object.groupBy(arr, fn);", featureId: "array-group" },
      { code: "RegExp.escape(s);", featureId: "regexp-escape" },
      { code: "ArrayBuffer.isView(buf);", featureId: "typed-arrays" },
      { code: "BigInt.asIntN(1, 1n);", featureId: "bigint" },
      { code: "BigInt.asUintN(1, 1n);", featureId: "bigint" },
      { code: "Number.isInteger(x);", featureId: "number" },
      { code: "Number.parseInt('1');", featureId: "number" },
      { code: "Number.EPSILON;", featureId: "number" },
      { code: "Proxy.revocable({}, handler);", featureId: "proxy-reflect" },
      { code: "Symbol.for('x');", featureId: "symbol" },
      { code: "Symbol.keyFor(sym);", featureId: "symbol" },
      { code: "String.fromCharCode(65);", featureId: "strings" },
      { code: "String.fromCodePoint(0x41);", featureId: "string-codepoint" },
      { code: "Date.now();", featureId: "date" },
      { code: "Date.parse(s);", featureId: "date" },
      { code: "Date.UTC(2020, 0, 1);", featureId: "date" },
    ];
    for (const { code, featureId } of cases) {
      it(`reports ${featureId} for \`${code}\``, async () => {
        const msgs = await lintWithBaseline(
          code,
          reportingPolicyFor(featureId),
          { sourceType: "module" },
          safe,
        );
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
    const cases: Array<{ code: string; featureId: string }> = [
      // Prototype methods must not match callStatic descriptors.
      { code: "p.then(fn);", featureId: "promise-try" },
      { code: "p.catch(fn);", featureId: "promise-try" },
      // Shadowed constructors must not report the static.
      { code: "class Map {} Map.groupBy(arr, fn);", featureId: "array-group" },
      { code: "function Promise(){} Promise.try(fn);", featureId: "promise-try" },
      {
        code: "const ArrayBuffer = { isView: () => true }; ArrayBuffer.isView(buf);",
        featureId: "typed-arrays",
      },
      // plain numbers: a 1n literal would itself be reported as bigint by the syntax delegate
      { code: "const BigInt = { asIntN: () => 1 }; BigInt.asIntN(1, 1);", featureId: "bigint" },
      { code: "const Date = { now: () => 0 }; Date.now();", featureId: "date" },
      {
        code: "const Proxy = { revocable: () => ({}) }; Proxy.revocable({}, handler);",
        featureId: "proxy-reflect",
      },
      {
        code: "const RegExp = { escape: (s) => s }; RegExp.escape(s);",
        featureId: "regexp-escape",
      },
      { code: "const Symbol = { for: () => Symbol('x') }; Symbol.for('x');", featureId: "symbol" },
    ];
    for (const { code, featureId } of cases) {
      it(`stays silent for \`${code}\``, async () => {
        // The policy would report the feature if the static were resolved
        // through the real global, so no report for it means it was not.
        const msgs = await lintWithBaseline(
          code,
          reportingPolicyFor(featureId),
          { sourceType: "module" },
          safe,
        );
        expect(msgs.filter((m) => m.includes(`(${featureId})`))).toEqual([]);
      });
    }
  });
});
