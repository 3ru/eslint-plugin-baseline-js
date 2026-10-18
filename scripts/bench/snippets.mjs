#!/usr/bin/env node
/**
 * Build bench/synth-snippets.json: one-line code samples that the current build reports
 * exactly once, with the feature id it reports. The generator injects them, so the number
 * of expected reports in a synthetic corpus is known before any build runs.
 *
 *   node scripts/bench/snippets.mjs [--plugin dist/index.mjs] [--out bench/synth-snippets.json]
 *
 * Candidates are derived from the generated descriptor data; features handled by syntax
 * delegates and members with an unknown status are skipped. Untyped samples are verified
 * by linting them; typed samples (instance members) are verified with the TypeScript
 * program the benchmark uses, so only interfaces and members the installed lib knows
 * remain. Re-run after a web-features update or a detector change and commit the result.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  benchRuleOptions,
  loadCompatStatuses,
  loadDescriptors,
  loadFeatures,
  syntaxMappedFeatureIds,
} from "./descriptors.mjs";
import { CACHE_DIR, parseArgs, ROOT, RULE_ID, SNIPPETS_FILE } from "./lib.mjs";

const args = parseArgs(process.argv.slice(2), { plugin: "dist/index.mjs", out: SNIPPETS_FILE });
const require = createRequire(`${ROOT}/package.json`);
const ts = require("typescript");
const tsParser = require("@typescript-eslint/parser");
const { ESLint } = require("eslint");
const plugin = (await import(pathToFileURL(resolve(ROOT, args.plugin)).href)).default;

const descriptors = loadDescriptors();
const features = loadFeatures();
const compat = loadCompatStatuses();
const mapped = syntaxMappedFeatureIds();

function eligible(d) {
  const feature = features[d.featureId];
  if (!feature || feature.status?.baseline === undefined) return false;
  if (mapped.has(d.featureId)) return false;
  if (d.typedOnly) return false;
  const override = d.compatKey ? compat[d.featureId]?.[d.compatKey] : undefined;
  if (override && Object.keys(override).length === 0) return false;
  return true;
}

function renderObject(objectArg) {
  const props = [];
  for (const key of objectArg.hasKeys ?? []) props.push(`${JSON.stringify(key)}: 0`);
  for (const kv of objectArg.keyValues ?? [])
    props.push(`${JSON.stringify(kv.key)}: ${JSON.stringify(kv.values?.[0] ?? "")}`);
  return `{ ${props.join(", ")} }`;
}

function renderArgs(d) {
  const length = Math.max(
    d.stringArg ? d.stringArg.index + 1 : 0,
    d.objectArg ? d.objectArg.index + 1 : 0,
    1,
  );
  const out = Array.from({ length }, () => "0");
  if (d.stringArg) out[d.stringArg.index] = JSON.stringify(d.stringArg.values[0]);
  if (d.objectArg) out[d.objectArg.index] = renderObject(d.objectArg);
  return out.join(", ");
}

/** Untyped candidates: code, the globals it relies on (for shadowed variants) and the expected feature. */
function untypedCandidate(d) {
  switch (d.kind) {
    case "callGlobal":
      return { code: `${d.name}(0);`, globals: [d.name] };
    case "newIdent":
      return { code: `new ${d.name}(0);`, globals: [d.name] };
    case "member":
    case "staticMember":
      return { code: `void ${d.base}.${d.prop};`, globals: [d.base] };
    case "callStatic":
      return { code: `${d.base}.${d.prop}(0);`, globals: [d.base] };
    case "newMember":
      return { code: `new ${d.base}.${d.prop}(0);`, globals: [d.base] };
    case "callMemberWithArgs":
      return {
        code: d.viaCall?.prop
          ? `x.${d.viaCall.prop}().${d.prop}(${renderArgs(d)});`
          : `x.${d.prop}(${renderArgs(d)});`,
        globals: [],
        needsLocal: true,
      };
    case "newWithOptions": {
      const length = d.objectArg.index + 1;
      const parts = Array.from({ length }, () => "0");
      parts[d.objectArg.index] = renderObject(d.objectArg);
      return { code: `new ${d.name}(${parts.join(", ")});`, globals: [d.name] };
    }
    default:
      return null;
  }
}

function parses(code, typescript = false) {
  try {
    tsParser.parse(code, {
      ecmaVersion: "latest",
      sourceType: "module",
      loc: false,
      range: false,
      tokens: false,
      comment: false,
      filePath: typescript ? "x.ts" : "x.js",
    });
    return true;
  } catch {
    return false;
  }
}

function eslintFor(cwd, typed, tsconfig) {
  return new ESLint({
    cwd,
    overrideConfigFile: true,
    allowInlineConfig: false,
    errorOnUnmatchedPattern: false,
    cache: false,
    overrideConfig: [
      { files: ["**/*.js"], languageOptions: { ecmaVersion: "latest", sourceType: "module" } },
      {
        files: ["**/*.ts"],
        languageOptions: {
          parser: tsParser,
          parserOptions: typed
            ? {
                project: [tsconfig],
                tsconfigRootDir: cwd,
                disallowAutomaticSingleRunInference: true,
              }
            : { projectService: false },
        },
      },
      {
        files: ["**/*.{js,ts}"],
        plugins: { "baseline-js": { meta: plugin.meta, rules: plugin.rules } },
        linterOptions: { reportUnusedDisableDirectives: "off" },
        rules: { [RULE_ID]: ["error", benchRuleOptions(1900)] },
      },
    ],
  });
}

function reportsByLine(results) {
  const map = new Map();
  for (const r of results) {
    for (const m of r.messages) {
      if (m.fatal) map.set(-1, (map.get(-1) ?? 0) + 1);
      if (m.ruleId !== RULE_ID) continue;
      const list = map.get(m.line) ?? [];
      list.push(/\(([a-z0-9-]+)\)\.$/.exec(m.message)?.[1] ?? "?");
      map.set(m.line, list);
    }
  }
  return map;
}

/** One tuple per line: compact to store, readable in diffs. */
function serializeSnippets(output) {
  const lines = ["{"];
  for (const key of ["version", "generatedAt", "plugin", "typescript"]) {
    lines.push(`  ${JSON.stringify(key)}: ${JSON.stringify(output[key])},`);
  }
  for (const [index, key] of ["untyped", "typed"].entries()) {
    lines.push(`  ${JSON.stringify(key)}: [`);
    output[key].forEach((tuple, i) =>
      lines.push(`    ${JSON.stringify(tuple)}${i < output[key].length - 1 ? "," : ""}`),
    );
    lines.push(index === 0 ? "  ]," : "  ]");
  }
  lines.push("}");
  return `${lines.join("\n")}\n`;
}

const tmp = join(CACHE_DIR, "tmp", `snippets-${process.pid}`);
mkdirSync(tmp, { recursive: true });
try {
  // ---- untyped ------------------------------------------------------------------------
  const untyped = new Map();
  for (const d of descriptors) {
    if (d.kind === "instanceMember" || !eligible(d)) continue;
    const c = untypedCandidate(d);
    if (!c || untyped.has(c.code) || !parses(c.code)) continue;
    untyped.set(c.code, {
      kind: d.kind,
      featureId: d.featureId,
      code: c.code,
      globals: c.globals,
      needsLocal: Boolean(c.needsLocal),
    });
  }
  const untypedList = [...untyped.values()];
  const chunk = 400;
  const keptUntyped = [];
  for (let i = 0; i < untypedList.length; i += chunk) {
    const slice = untypedList.slice(i, i + chunk);
    const file = join(tmp, `untyped-${i}.js`);
    const header = "const x = { get: () => ({}) };";
    writeFileSync(file, `${header}\n${slice.map((s) => s.code).join("\n")}\n`);
    const results = await eslintFor(tmp, false, null).lintFiles([file]);
    const byLine = reportsByLine(results);
    if (byLine.has(-1)) throw new Error(`untyped verification file ${file} has a parse error`);
    slice.forEach((s, idx) => {
      const reports = byLine.get(idx + 2) ?? [];
      if (reports.length === 1 && reports[0] === s.featureId) keptUntyped.push(s);
    });
  }
  console.error(
    `[snippets] untyped: ${keptUntyped.length} verified of ${untypedList.length} candidates`,
  );

  // ---- typed ----------------------------------------------------------------------------
  const IDENT = /^[A-Za-z_$][\w$]*$/;
  const typedCandidates = descriptors.filter(
    (d) => d.kind === "instanceMember" && eligible(d) && IDENT.test(d.prop) && IDENT.test(d.iface),
  );
  const ifaces = [...new Set(typedCandidates.map((d) => d.iface))].sort();
  const forms = (iface) => [
    iface,
    `${iface}<any>`,
    `${iface}<any, any>`,
    `${iface}<any, any, any>`,
    `Intl.${iface}`,
    `WebAssembly.${iface}`,
  ];
  const probeLines = [];
  const probeIndex = [];
  for (const iface of ifaces) {
    for (const form of forms(iface)) {
      probeIndex.push({ iface, form, line: probeLines.length + 1 });
      probeLines.push(`declare const p${probeLines.length}: ${form};`);
    }
  }
  const compilerOptions = {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    lib: ["lib.esnext.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts", "lib.dom.asynciterable.d.ts"],
    noEmit: true,
    skipLibCheck: true,
    types: [],
    strict: false,
  };
  function diagnosticLines(file) {
    const program = ts.createProgram([file], compilerOptions);
    const bad = new Set();
    for (const diag of ts.getPreEmitDiagnostics(program)) {
      if (!diag.file || diag.start === undefined) continue;
      if (diag.file.fileName !== file.replace(/\\/g, "/")) continue;
      bad.add(diag.file.getLineAndCharacterOfPosition(diag.start).line + 1);
    }
    return bad;
  }
  const probeFile = join(tmp, "probe.ts");
  writeFileSync(probeFile, `${probeLines.join("\n")}\nexport {};\n`);
  const badProbe = diagnosticLines(probeFile);
  const receiverForm = new Map();
  for (const p of probeIndex) {
    if (badProbe.has(p.line) || receiverForm.has(p.iface)) continue;
    receiverForm.set(p.iface, p.form);
  }
  console.error(
    `[snippets] typed: ${receiverForm.size} of ${ifaces.length} interfaces resolve in the TypeScript lib`,
  );

  const typedLines = [];
  const typedIndex = [];
  for (const d of typedCandidates) {
    const form = receiverForm.get(d.iface);
    if (!form) continue;
    const key = `${d.iface}.${d.prop}`;
    if (typedIndex.some((t) => t.key === key)) continue;
    const line = `declare const r${typedLines.length}: ${form}; void r${typedLines.length}.${d.prop};`;
    if (!parses(line, true)) continue;
    typedIndex.push({ key, d, form, line: typedLines.length + 1 });
    typedLines.push(line);
  }
  const typedFile = join(tmp, "typed.ts");
  writeFileSync(typedFile, `${typedLines.join("\n")}\nexport {};\n`);
  const badTyped = diagnosticLines(typedFile);
  const tsconfig = join(tmp, "tsconfig.json");
  writeFileSync(
    tsconfig,
    JSON.stringify({
      compilerOptions: {
        target: "ESNext",
        module: "ESNext",
        moduleResolution: "Bundler",
        lib: ["ESNext", "DOM", "DOM.Iterable", "DOM.AsyncIterable"],
        noEmit: true,
        skipLibCheck: true,
        types: [],
        strict: false,
      },
      files: [typedFile],
    }),
  );
  const typedResults = await eslintFor(tmp, true, tsconfig).lintFiles([typedFile]);
  const typedByLine = reportsByLine(typedResults);
  const keptTyped = [];
  for (const t of typedIndex) {
    if (badTyped.has(t.line)) continue;
    const reports = typedByLine.get(t.line) ?? [];
    if (reports.length === 1 && reports[0] === t.d.featureId) {
      keptTyped.push({
        featureId: t.d.featureId,
        iface: t.d.iface,
        receiverType: t.form,
        prop: t.d.prop,
      });
    }
  }
  console.error(
    `[snippets] typed: ${keptTyped.length} verified of ${typedIndex.length} candidates (${badTyped.size} rejected by the compiler)`,
  );

  // Untyped samples also run inside typed TypeScript files: record how many reports each
  // produces there (normally 1; 0 or 2 when typed descriptors change the picture), and
  // make sure typed samples stay silent without type information.
  const mixedFile = join(tmp, "mixed.ts");
  writeFileSync(
    mixedFile,
    `const x = { get: () => ({}) };\n${keptUntyped.map((s) => s.code).join("\n")}\nexport {};\n`,
  );
  const mixedConfig = join(tmp, "tsconfig.mixed.json");
  writeFileSync(
    mixedConfig,
    JSON.stringify({
      compilerOptions: {
        target: "ESNext",
        module: "ESNext",
        moduleResolution: "Bundler",
        lib: ["ESNext", "DOM", "DOM.Iterable", "DOM.AsyncIterable"],
        noEmit: true,
        skipLibCheck: true,
        types: [],
        strict: false,
      },
      files: [mixedFile],
    }),
  );
  const mixedByLine = reportsByLine(await eslintFor(tmp, true, mixedConfig).lintFiles([mixedFile]));
  keptUntyped.forEach((s, idx) => {
    s.typedReports = (mixedByLine.get(idx + 2) ?? []).length;
  });
  const typedUntypedByLine = reportsByLine(
    await eslintFor(tmp, false, null).lintFiles([typedFile]),
  );
  for (let i = keptTyped.length - 1; i >= 0; i--) {
    const t = typedIndex.find(
      (x) => x.d.iface === keptTyped[i].iface && x.d.prop === keptTyped[i].prop,
    );
    if (t && (typedUntypedByLine.get(t.line) ?? []).length) keptTyped.splice(i, 1);
  }

  const byFeature = (a, b) =>
    a.featureId < b.featureId
      ? -1
      : a.featureId > b.featureId
        ? 1
        : a.code < b.code
          ? -1
          : a.code > b.code
            ? 1
            : 0;
  const typedSorted = keptTyped.sort((a, b) =>
    a.featureId < b.featureId
      ? -1
      : a.featureId > b.featureId
        ? 1
        : `${a.iface}.${a.prop}` < `${b.iface}.${b.prop}`
          ? -1
          : 1,
  );
  // Compact tuple form: [kind, featureId, code, globals, needsLocal, typedReports] and
  // [featureId, iface, prop, receiverType-if-not-the-interface].
  const output = {
    version: 2,
    generatedAt: new Date().toISOString().slice(0, 10),
    plugin: plugin.meta?.version ?? null,
    typescript: ts.version,
    untyped: keptUntyped
      .sort(byFeature)
      .map(({ kind, featureId, code, globals, needsLocal, typedReports }) => [
        kind,
        featureId,
        code,
        globals,
        needsLocal ? 1 : 0,
        typedReports,
      ]),
    typed: typedSorted.map(({ featureId, iface, prop, receiverType }) => [
      featureId,
      iface,
      prop,
      receiverType === iface ? "" : receiverType,
    ]),
  };
  writeFileSync(resolve(args.out), serializeSnippets(output));
  console.error(
    `[snippets] written to ${args.out}: ${output.untyped.length} untyped, ${output.typed.length} typed`,
  );
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
