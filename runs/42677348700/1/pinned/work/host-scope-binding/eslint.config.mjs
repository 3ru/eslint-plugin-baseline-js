import probe from "file://<repository>/conformance/probe.mjs";
const config = {"files":["**/*.{js,ts}"],"languageOptions":{"ecmaVersion":"latest","sourceType":"module"},"rules":{"toolchain-probe/inspect":["warn",{"check":"scope"}]}};
config.plugins = { 'toolchain-probe': probe };
export default [config];
