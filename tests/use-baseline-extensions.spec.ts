import type { Rule } from "eslint";
import { RuleTester } from "eslint";
import { describe, it } from "vitest";
import vueParser from "vue-eslint-parser";
import plugin from "../dist/index.mjs";

const rule = (plugin as unknown as { rules: Record<string, Rule.RuleModule> }).rules[
  "use-baseline"
] as Rule.RuleModule;

const vueTester = new RuleTester({
  languageOptions: {
    parser: vueParser,
    parserOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
    },
  },
});

const reactTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: "module",
    parserOptions: {
      ecmaFeatures: { jsx: true },
    },
  },
});

describe("use-baseline across common frontend hosts", () => {
  it("lints Vue SFCs when the project supplies vue-eslint-parser", () => {
    vueTester.run("baseline-js/use-baseline (vue sfc)", rule, {
      valid: [
        {
          filename: "Component.vue",
          code: `<template><div>{{ foo ?? "fallback" }}</div></template>
<script setup>
const value = foo ?? "fallback";
</script>`,
          options: [{ available: "widely" }],
        },
      ],
      invalid: [
        {
          filename: "Component.vue",
          code: `<template><div>{{ foo }}</div></template>
<script setup>
const t = Temporal.Now.instant();
</script>`,
          options: [{ available: "widely" }],
          errors: [{ message: /temporal/i }],
        },
      ],
    });
  });

  it("lints React-style JSX files", () => {
    reactTester.run("baseline-js/use-baseline (react jsx)", rule, {
      valid: [
        {
          filename: "Component.jsx",
          code: "const App = () => <div>{foo ?? 'ok'}</div>;",
          options: [{ available: "widely" }],
        },
      ],
      invalid: [
        {
          filename: "Component.jsx",
          code: "const App = () => <div>{Temporal.Now.instant()}</div>;",
          options: [{ available: "widely" }],
          errors: [{ message: /temporal/i }],
        },
      ],
    });
  });
});
