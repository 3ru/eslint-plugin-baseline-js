import type { Rule } from "eslint";
import { describe, it } from "vitest";
import plugin from "../dist/index.mjs";
import { RuleTester } from "./compat";

const rule = (plugin as unknown as { rules: Record<string, Rule.RuleModule> }).rules[
  "use-baseline"
] as Rule.RuleModule;

const tester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: "module" },
});

describe("use-baseline: JS builtins safe arg-based patterns", () => {
  it("detects safe patterns and ignores dynamic ones", () => {
    tester.run("baseline-js/use-baseline (jsbi safe)", rule, {
      valid: [
        {
          code: "const opts={cause:e}; new Error('x', opts);",
          options: [{ available: "widely", includeJsBuiltins: { preset: "safe" } }],
        },
        {
          code: "const opts={maxByteLength:256}; new ArrayBuffer(n, opts);",
          options: [{ available: "widely", includeJsBuiltins: { preset: "safe" } }],
        },
        {
          code: "new SharedArrayBuffer(8, { maxByteLength: 16, growable: true });",
          options: [{ available: "widely", includeJsBuiltins: { preset: "safe" } }],
        },
      ],
      invalid: [
        {
          code: "new Error('x', { cause: err });",
          options: [{ available: 2020, includeJsBuiltins: { preset: "safe" } }],
          errors: [{ message: /Feature 'Error cause' \(error-cause\).*Baseline/i }],
        },
        {
          code: "new AggregateError([], 'x', { cause: err });",
          options: [{ available: 2020, includeJsBuiltins: { preset: "safe" } }],
          errors: [{ message: /Feature 'Error cause' \(error-cause\).*Baseline/i }],
        },
        {
          code: "new ArrayBuffer(10, { maxByteLength: 20 });",
          options: [{ available: "widely", includeJsBuiltins: { preset: "safe" } }],
          errors: [{ message: /Feature 'Resizable buffers' \(resizable-buffers\).*Baseline/i }],
        },
        {
          code: "Error.isError({});",
          options: [{ available: "widely", includeJsBuiltins: { preset: "safe" } }],
          errors: [{ message: /Feature 'Error\.isError\(\)' \(is-error\).*Baseline/i }],
        },
        {
          code: "Uint8Array.fromBase64('');",
          options: [{ available: "widely", includeJsBuiltins: { preset: "safe" } }],
          errors: [
            {
              message:
                /Feature 'Uint8Array base64 and hex conversion' \(uint8array-base64-hex\).*Baseline/i,
            },
          ],
        },
        {
          code: "new WeakRef({}); new FinalizationRegistry(()=>{});",
          options: [{ available: 2020, includeJsBuiltins: { preset: "safe" } }],
          errors: [
            { message: /Feature 'Weak references' \(weak-references\).*Baseline/i },
            { message: /Feature 'Weak references' \(weak-references\).*Baseline/i },
          ],
        },
      ],
    });
  });
});
