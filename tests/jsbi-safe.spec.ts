import type { Rule } from "eslint";
import { RuleTester } from "eslint";
import { describe, it } from "vitest";
import plugin from "../dist/index.mjs";
import { reportingPolicyFor } from "./utils/policy";

const rule = (plugin as unknown as { rules: Record<string, Rule.RuleModule> }).rules[
  "use-baseline"
] as Rule.RuleModule;

const tester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: "module" },
});

// Every case lints under a policy that reports the feature it is about
// whatever that feature's current Baseline status is, so the valid cases prove
// that dynamic arguments and typed-only patterns are never matched and the
// invalid cases prove detection. Errors are matched on the feature id only:
// the message wording depends on the policy and the feature name is data.
const safe = { preset: "safe" } as const;
const errorCause = { available: reportingPolicyFor("error-cause"), includeJsBuiltins: safe };
const resizableBuffers = {
  available: reportingPolicyFor("resizable-buffers"),
  includeJsBuiltins: safe,
};

describe("use-baseline: JS builtins safe arg-based patterns", () => {
  it("detects safe patterns and ignores dynamic ones", () => {
    tester.run("baseline-js/use-baseline (jsbi safe)", rule, {
      valid: [
        {
          code: "const opts={cause:e}; new Error('x', opts);",
          options: [errorCause],
        },
        {
          code: "const opts={maxByteLength:256}; new ArrayBuffer(n, opts);",
          options: [resizableBuffers],
        },
        {
          code: "new SharedArrayBuffer(8, { maxByteLength: 16, growable: true });",
          options: [resizableBuffers],
        },
      ],
      invalid: [
        {
          code: "new Error('x', { cause: err });",
          options: [errorCause],
          errors: [{ message: /\(error-cause\)/ }],
        },
        {
          code: "new AggregateError([], 'x', { cause: err });",
          options: [errorCause],
          errors: [{ message: /\(error-cause\)/ }],
        },
        {
          code: "new ArrayBuffer(10, { maxByteLength: 20 });",
          options: [resizableBuffers],
          errors: [{ message: /\(resizable-buffers\)/ }],
        },
        {
          code: "Error.isError({});",
          options: [{ available: reportingPolicyFor("is-error"), includeJsBuiltins: safe }],
          errors: [{ message: /\(is-error\)/ }],
        },
        {
          code: "Uint8Array.fromBase64('');",
          options: [
            { available: reportingPolicyFor("uint8array-base64-hex"), includeJsBuiltins: safe },
          ],
          errors: [{ message: /\(uint8array-base64-hex\)/ }],
        },
        {
          code: "new WeakRef({}); new FinalizationRegistry(()=>{});",
          options: [{ available: reportingPolicyFor("weak-references"), includeJsBuiltins: safe }],
          errors: [{ message: /\(weak-references\)/ }, { message: /\(weak-references\)/ }],
        },
      ],
    });
  });
});
