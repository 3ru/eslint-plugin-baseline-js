/**
 * ESLint version compatibility layer for tests.
 *
 * ESLint v9+ ships a flat-config-native `RuleTester` and `ESLint` class.
 * ESLint v8 uses legacy config by default, but exposes flat-config variants
 * as `FlatRuleTester` and `FlatESLint` from `eslint/use-at-your-own-risk`.
 *
 * This module re-exports the correct class so tests work across v8, v9+,
 * without any config format changes.
 */

import { ESLint as DefaultESLint, RuleTester as DefaultRuleTester } from "eslint";
import eslintPkg from "eslint/package.json";

const major = Number(eslintPkg.version.split(".")[0]);

let _RuleTester = DefaultRuleTester;
let _ESLint = DefaultESLint;

if (major < 9) {
  const unstable = (await import("eslint/use-at-your-own-risk")) as unknown as {
    FlatRuleTester: typeof DefaultRuleTester;
    FlatESLint: typeof DefaultESLint;
  };
  _RuleTester = unstable.FlatRuleTester;
  _ESLint = unstable.FlatESLint;
}

export const RuleTester = _RuleTester;
export const ESLintCompat = _ESLint;
