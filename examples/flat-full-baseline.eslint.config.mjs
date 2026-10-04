import css from "@eslint/css";
import html from "@html-eslint/eslint-plugin";
import baselineJs, { BASELINE } from "eslint-plugin-baseline-js";
import globals from "globals";

const available = BASELINE.WIDELY;

export default [
  // JavaScript, including JSX.
  {
    ...baselineJs.configs.recommended({ available }),
    plugins: { "baseline-js": baselineJs },
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },

  // CSS files.
  {
    files: ["**/*.css"],
    plugins: { css },
    language: "css/css",
    rules: {
      "css/use-baseline": ["error", { available }],
    },
  },

  // HTML files.
  {
    files: ["**/*.html"],
    plugins: { "@html-eslint": html },
    language: "@html-eslint/html",
    rules: {
      "@html-eslint/use-baseline": ["error", { available }],
    },
  },
];
