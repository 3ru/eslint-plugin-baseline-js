/**
 * The one ESLint setup that the worker, the profile and the snippet check all lint through.
 * JavaScript with JSDoc types, so the measured worker never loads Node's type stripper.
 */
import { dirname } from "node:path";
import * as tsParser from "@typescript-eslint/parser";
import { ESLint } from "eslint";

/** @import { Linter } from "eslint" */
/** @import { RuleOptions } from "./types.mts" */
/** @typedef {import("eslint").ESLint.Plugin} Plugin */
/**
 * @typedef {{ meta: NonNullable<Plugin["meta"]>, rules: NonNullable<Plugin["rules"]> }} RulePlugin
 */
/**
 * @typedef {{
 *   cwd: string,
 *   plugin: RulePlugin,
 *   ruleOptions: RuleOptions,
 *   typed: boolean,
 *   tsconfig: string | null,
 *   stats: boolean,
 *   extraPlugins?: Record<string, Plugin>,
 *   extraRules?: Linter.RulesRecord,
 * }} BenchESLintOptions
 */

const PLUGIN_NAMESPACE = "baseline-js";

export const RULE_ID = `${PLUGIN_NAMESPACE}/use-baseline`;

const LINTED_FILES = ["**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}"];

/** tsconfig JSON; `strict` and `types` are pinned because TypeScript 6 changed their defaults. */
export const BENCH_COMPILER_OPTIONS = /** @type {const} */ ({
  target: "ESNext",
  module: "ESNext",
  moduleResolution: "Bundler",
  lib: ["ESNext", "DOM"],
  jsx: "preserve",
  strict: false,
  skipLibCheck: true,
  types: [],
  noEmit: true,
  isolatedModules: true,
});

/**
 * @param {boolean} typed
 * @param {string | null} tsconfig
 * @returns {Linter.LanguageOptions}
 */
function languageOptions(typed, tsconfig) {
  if (!typed) return { parser: tsParser };

  if (tsconfig === null) throw new Error("a type-aware lint needs a tsconfig");

  return {
    parser: tsParser,
    parserOptions: {
      project: tsconfig,
      tsconfigRootDir: dirname(tsconfig),
      // Neither TYPESCRIPT_ESLINT_PROJECT_SERVICE nor single-run inference may change the program.
      projectService: false,
      disallowAutomaticSingleRunInference: true,
    },
  };
}

/**
 * Only this configuration applies, and a path that matches no file is an error, not a shorter run.
 * @param {BenchESLintOptions} options
 * @returns {ESLint}
 */
export function createBenchESLint({
  cwd,
  plugin,
  ruleOptions,
  typed,
  tsconfig,
  stats,
  extraPlugins = {},
  extraRules = {},
}) {
  return new ESLint({
    cwd,
    overrideConfigFile: true,
    allowInlineConfig: false,
    stats,
    overrideConfig: {
      files: LINTED_FILES,
      languageOptions: languageOptions(typed, tsconfig),
      plugins: { ...extraPlugins, [PLUGIN_NAMESPACE]: plugin },
      rules: { ...extraRules, [RULE_ID]: ["error", ruleOptions] },
    },
  });
}

/**
 * @param {string} message
 * @returns {string | null}
 */
export function featureIdFromMessage(message) {
  return (
    /\. Feature ID: ([a-z0-9-]+)\.$/.exec(message)?.[1] ??
    /\(([a-z0-9-]+)\)\.$/.exec(message)?.[1] ??
    null
  );
}

/**
 * @param {{ readonly default?: unknown }} moduleNamespace
 * @returns {RulePlugin}
 */
export function pluginExport(moduleNamespace) {
  const plugin = moduleNamespace.default;

  if (
    !(plugin instanceof Object && "meta" in plugin && "rules" in plugin) ||
    !(plugin.meta instanceof Object && plugin.rules instanceof Object)
  ) {
    throw new Error("the plugin build does not export { meta, rules } as its default export");
  }

  // SAFETY: the build is ours, and ESLint validates each rule when it loads the config.
  return /** @type {RulePlugin} */ (plugin);
}
