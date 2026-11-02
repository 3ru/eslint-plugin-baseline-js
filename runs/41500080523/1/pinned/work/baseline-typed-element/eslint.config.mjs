import probe from "file://<repository>/conformance/probe.mjs";
import parser from "file://<profile>/tools/node_modules/.pnpm/@typescript-eslint+parser@8.71.2_eslint@10.13.0_typescript@6.0.3/node_modules/@typescript-eslint/parser/dist/index.js";
import baseline from "file://<profile>/subject-input/node_modules/.pnpm/eslint-plugin-baseline-js@file+subject.tgz_eslint@10.13.0/node_modules/eslint-plugin-baseline-js/dist/index.mjs";
const config = {"files":["**/*.{js,ts}"],"languageOptions":{"ecmaVersion":"latest","sourceType":"module","parserOptions":{"project":"<profile>/work/tsconfig.json","tsconfigRootDir":"<profile>/work"}},"rules":{"toolchain-probe/inspect":["warn",{"check":"types","member":"checkVisibility"}],"baseline-js/use-baseline":["error",{"available":2019,"includeWebApis":{"preset":"type-aware"},"includeJsBuiltins":{"preset":"type-aware"}}]}};
config.languageOptions.parser = parser;
config.plugins = { 'toolchain-probe': probe, 'baseline-js': baseline };
export default [config];
