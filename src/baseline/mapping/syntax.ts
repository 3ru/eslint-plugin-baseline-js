/**
 * @fileoverview Mapping of web-features JavaScript feature IDs to delegate ESLint rules.
 */
import type { SyntaxMapping } from "./types";

export default {
  // TODO: Verify ??= is the target
  "nullish-coalescing": {
    kind: "syntax",
    delegates: [
      {
        plugin: "es-x",
        rule: "no-nullish-coalescing-operators",
        level: "error",
      },
    ],
  },

  "logical-assignments": {
    kind: "syntax",
    delegates: [
      {
        plugin: "es-x",
        rule: "no-logical-assignment-operators",
        level: "error",
      },
    ],
  },

  "top-level-await": {
    kind: "syntax",
    delegates: [
      {
        plugin: "es-x",
        rule: "no-top-level-await",
        level: "error",
      },
    ],
  },

  "hashbang-comments": {
    kind: "syntax",
    delegates: [
      {
        plugin: "es-x",
        rule: "no-hashbang",
        level: "error",
      },
    ],
  },

  // Numeric separators (web-features id uses 'separators')
  "numeric-separators": {
    kind: "syntax",
    delegates: [
      {
        plugin: "es-x",
        rule: "no-numeric-separators",
        level: "error",
      },
    ],
  },

  "weak-references": {
    kind: "syntax",
    delegates: [
      {
        plugin: "es-x",
        rule: "no-weakrefs",
        level: "error",
      },
    ],
  },
  "arguments-callee": {
    kind: "syntax",
    delegates: [
      {
        plugin: "core",
        rule: "no-caller",
        level: "error",
      },
    ],
  },

  with: {
    kind: "syntax",
    delegates: [
      {
        plugin: "core",
        rule: "no-with",
        level: "error",
      },
    ],
  },

  "date-get-year-set-year": {
    kind: "syntax",
    delegates: [
      {
        plugin: "es-x",
        rule: "no-date-prototype-getyear-setyear",
        level: "error",
      },
    ],
  },

  "escape-unescape": {
    kind: "syntax",
    delegates: [
      {
        plugin: "es-x",
        rule: "no-escape-unescape",
        level: "error",
      },
    ],
  },

  "async-await": {
    kind: "syntax",
    delegates: [
      {
        plugin: "es-x",
        rule: "no-async-functions",
        level: "error",
      },
    ],
  },

  "async-generators": {
    kind: "syntax",
    delegates: [
      {
        plugin: "es-x",
        rule: "no-async-iteration",
        level: "error",
      },
    ],
  },

  "atomics-wait-async": {
    kind: "syntax",
    delegates: [
      {
        plugin: "es-x",
        rule: "no-atomics-waitasync",
        level: "error",
      },
    ],
  },

  "atomics-pause": {
    kind: "syntax",
    delegates: [
      {
        plugin: "self",
        rule: "no-atomics-pause",
        level: "error",
      },
    ],
  },

  bigint: {
    kind: "syntax",
    delegates: [
      {
        plugin: "es-x",
        rule: "no-bigint",
        level: "error",
      },
    ],
  },

  "class-syntax": {
    kind: "syntax",
    delegates: [
      {
        plugin: "es-x",
        rule: "no-classes",
        level: "error",
      },
    ],
  },

  destructuring: {
    kind: "syntax",
    delegates: [
      {
        plugin: "es-x",
        rule: "no-destructuring",
        level: "error",
      },
    ],
  },

  exponentiation: {
    kind: "syntax",
    delegates: [
      {
        plugin: "es-x",
        rule: "no-exponential-operators",
        level: "error",
      },
    ],
  },

  generators: {
    kind: "syntax",
    delegates: [
      {
        plugin: "es-x",
        rule: "no-generators",
        level: "error",
      },
    ],
  },

  globalthis: {
    kind: "syntax",
    delegates: [
      {
        plugin: "es-x",
        rule: "no-global-this",
        level: "error",
      },
    ],
  },

  "html-wrapper-methods": {
    kind: "syntax",
    delegates: [
      {
        plugin: "es-x",
        rule: "no-string-create-html-methods",
        level: "error",
      },
    ],
  },

  "let-const": {
    kind: "syntax",
    delegates: [
      {
        plugin: "es-x",
        rule: "no-block-scoped-variables",
        level: "error",
      },
    ],
  },

  "optional-catch-binding": {
    kind: "syntax",
    delegates: [
      {
        plugin: "es-x",
        rule: "no-optional-catch-binding",
        level: "error",
      },
    ],
  },

  "proxy-reflect": {
    kind: "syntax",
    delegates: [
      {
        plugin: "es-x",
        rule: "no-proxy",
        level: "error",
      },
      {
        plugin: "es-x",
        rule: "no-reflect",
        level: "error",
      },
    ],
  },

  "shared-memory": {
    kind: "syntax",
    delegates: [
      {
        plugin: "es-x",
        rule: "no-shared-array-buffer",
        level: "error",
      },
      {
        plugin: "es-x",
        rule: "no-atomics",
        level: "error",
      },
    ],
  },

  spread: {
    kind: "syntax",
    delegates: [
      {
        plugin: "es-x",
        rule: "no-spread-elements",
        level: "error",
      },
      {
        plugin: "es-x",
        rule: "no-rest-spread-properties",
        level: "error",
      },
    ],
  },

  "template-literals": {
    kind: "syntax",
    delegates: [
      {
        plugin: "es-x",
        rule: "no-template-literals",
        level: "error",
      },
    ],
  },

  "unicode-point-escapes": {
    kind: "syntax",
    delegates: [
      {
        plugin: "es-x",
        rule: "no-unicode-codepoint-escapes",
        level: "error",
      },
    ],
  },

  bigint64array: {
    kind: "syntax",
    delegates: [
      {
        plugin: "self",
        rule: "no-bigint64array",
        level: "error",
      },
    ],
  },

  // https://eslint-community.github.io/eslint-plugin-es-x/rules/no-legacy-object-prototype-accessor-methods
  "accessor-methods": {
    kind: "syntax",
    delegates: [
      { plugin: "es-x", rule: "no-legacy-object-prototype-accessor-methods", level: "error" },
    ],
  },

  // https://eslint-community.github.io/eslint-plugin-es-x/rules/no-date-prototype-togmtstring
  "date-to-gmt-string": {
    kind: "syntax",
    delegates: [{ plugin: "es-x", rule: "no-date-prototype-togmtstring", level: "error" }],
  },

  // https://eslint-community.github.io/eslint-plugin-es-x/rules/no-error-cause
  "error-cause": {
    kind: "syntax",
    delegates: [{ plugin: "es-x", rule: "no-error-cause", level: "error" }],
  },

  // https://eslint-community.github.io/eslint-plugin-es-x/rules/no-error-iserror
  "is-error": {
    kind: "syntax",
    delegates: [{ plugin: "es-x", rule: "no-error-iserror", level: "error" }],
  },

  // https://eslint-community.github.io/eslint-plugin-es-x/rules/no-object-hasown
  "object-hasown": {
    kind: "syntax",
    delegates: [{ plugin: "es-x", rule: "no-object-hasown", level: "error" }],
  },

  // https://eslint.org/docs/latest/rules/no-proto
  proto: {
    kind: "syntax",
    delegates: [{ plugin: "core", rule: "no-proto", level: "error" }],
  },

  // Detection is covered by JS builtins descriptors (safe patterns only).
  // TODO
  "resizable-buffers": { kind: "meta", delegates: [] },

  // https://eslint-community.github.io/eslint-plugin-es-x/rules/no-arraybuffer-prototype-transfer
  "transferable-arraybuffer": {
    kind: "syntax",
    delegates: [{ plugin: "es-x", rule: "no-arraybuffer-prototype-transfer", level: "error" }],
  },

  // meta feature
  "object-object": { kind: "meta", delegates: [] },

  // [functions] meta feature, no direct delegate
  functions: { kind: "meta", delegates: [] },

  // [javascript] meta feature, no direct delegate
  javascript: { kind: "meta", delegates: [] },

  "functions-caller-arguments": {
    kind: "syntax",
    delegates: [
      {
        plugin: "self",
        rule: "no-function-caller-arguments",
        level: "error",
      },
    ],
  },

  "math-sum-precise": {
    kind: "syntax",
    delegates: [
      {
        plugin: "self",
        rule: "no-math-sum-precise",
        level: "error",
      },
    ],
  },

  temporal: {
    kind: "syntax",
    delegates: [
      {
        plugin: "self",
        rule: "no-temporal",
        level: "error",
      },
    ],
  },
} as const satisfies SyntaxMapping;
