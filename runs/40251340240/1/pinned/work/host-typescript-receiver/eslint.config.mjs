import probe from "file://<repository>/conformance/probe.mjs";
import parser from "file://<profile>/tools/node_modules/.pnpm/@typescript-eslint+parser@8.71.2_eslint@10.13.0_typescript@6.0.3/node_modules/@typescript-eslint/parser/dist/index.js";
const config = {"files":["**/*.{js,ts}"],"languageOptions":{"ecmaVersion":"latest","sourceType":"module","parserOptions":{"project":"<profile>/work/tsconfig.json","tsconfigRootDir":"<profile>/work"}},"rules":{"toolchain-probe/inspect":["warn",{"check":"types","member":"checkVisibility"}]}};
config.languageOptions.parser = parser;
config.plugins = { 'toolchain-probe': probe };
export default [config];
