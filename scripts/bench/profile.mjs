#!/usr/bin/env node
/**
 * Extract bench/profile.json: the aggregate shape of real code that the synthetic corpus
 * reproduces. Only aggregates leave this script: counts, shares, distributions,
 * identifier-name frequencies and web-features ids. No paths, no repository names.
 *
 *   node scripts/bench/profile.mjs --manifest bench/corpus.local.json
 *   node scripts/bench/profile.mjs --from ../some-app --from ../some-lib --out bench/profile.json
 *
 * The structural pass parses every file with @typescript-eslint/parser and walks the AST.
 * The detection pass lints the same files with the current build under a policy that
 * reports every detection (`available: 1900`), untyped for all files and type-aware for a
 * sample of TypeScript files, to measure how dense real API usage is.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  benchRuleOptions,
  globalBaseNames,
  listenerBuckets,
  loadDescriptors,
} from "./descriptors.mjs";
import {
  CACHE_DIR,
  mean,
  PROFILE_FILE,
  parseArgs,
  quantile,
  ROOT,
  RULE_ID,
  stable,
  writeJson,
} from "./lib.mjs";
import { collectFiles, ensureRealCorpusDir, loadLocalManifest } from "./real-corpus.mjs";

const USAGE = `usage: node scripts/bench/profile.mjs [options]
  --from <dir>           a local source tree (repeatable)
  --manifest <file>      a local real-repository manifest (bench/corpus.local.json)
  --out <file>           where to write the profile (default: bench/profile.json)
  --max-files <n>        files per source (default: 600)
  --typed-sample <n>     TypeScript files per source linted with types (default: 150, 0 skips)
  --plugin <path>        plugin bundle for the detection pass (default: dist/index.mjs)`;

const args = parseArgs(
  process.argv.slice(2),
  {
    from: "",
    manifest: "",
    out: PROFILE_FILE,
    maxFiles: 600,
    typedSample: 150,
    plugin: "dist/index.mjs",
  },
  { usage: USAGE },
);
const fromDirs = process.argv
  .slice(2)
  .flatMap((a, i, all) =>
    a === "--from" ? [all[i + 1]] : a.startsWith("--from=") ? [a.slice(7)] : [],
  );
if (!fromDirs.length && !args.manifest) {
  console.error(USAGE);
  process.exit(2);
}

const require = createRequire(`${ROOT}/package.json`);
const tsParser = require("@typescript-eslint/parser");
const { ESLint } = require("eslint");
const plugin = (await import(pathToFileURL(resolve(ROOT, args.plugin)).href)).default;

const descriptors = loadDescriptors();
const buckets = listenerBuckets(descriptors);
const globals = globalBaseNames(descriptors);
const WINDOW_ROOTS = new Set(["window", "globalThis", "self"]);
const DOM_ROOTS = new Set([
  "document",
  "window",
  "navigator",
  "location",
  "history",
  "screen",
  "performance",
]);
const DOM_FACTORIES = new Set([
  "createElement",
  "querySelector",
  "querySelectorAll",
  "getElementById",
  "createElementNS",
  "getContext",
]);
const SOURCE_GLOBS = ["**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}"];
const SOURCE_EXCLUDE = [
  "**/*.test.*",
  "**/*.spec.*",
  "**/__tests__/**",
  "**/test/**",
  "**/tests/**",
  "**/*.stories.*",
];

// ---------------------------------------------------------------------------------------
// Sources

const sources = [];
for (const dir of fromDirs) {
  const abs = resolve(dir);
  sources.push({
    dir: abs,
    files: collectFiles(abs, {
      include: SOURCE_GLOBS,
      exclude: SOURCE_EXCLUDE,
      maxFiles: args.maxFiles,
    }),
  });
}
if (args.manifest) {
  const manifest = loadLocalManifest(resolve(args.manifest));
  for (const entry of manifest.entries) {
    const { dir, files } = await ensureRealCorpusDir(entry, { maxFiles: args.maxFiles });
    sources.push({ dir, files: files.slice(0, args.maxFiles) });
  }
}
console.error(
  `[profile] ${sources.length} sources, ${sources.reduce((n, s) => n + s.files.length, 0)} files`,
);

// ---------------------------------------------------------------------------------------
// Structural pass

const acc = {
  files: 0,
  parseErrors: 0,
  nodes: 0,
  nodeTypes: new Map(),
  languages: { js: 0, jsx: 0, ts: 0, tsx: 0 },
  fileNodes: [],
  member: {
    total: 0,
    computed: 0,
    optional: 0,
    depth: { 1: 0, 2: 0, "3+": 0 },
    roots: { this: 0, local: 0, global: 0, window: 0, other: 0 },
    names: new Map(),
    untypedCollisions: 0,
    typedCollisions: 0,
    typedHandlers: 0,
    typedBucketSize: { 1: 0, "2-10": 0, "11-30": 0, "31+": 0 },
    receivers: { primitive: 0, array: 0, dom: 0, userClass: 0, unknown: 0 },
  },
  call: { total: 0, identifierCallee: 0, names: new Map(), collisions: 0, handlers: 0 },
  construction: { total: 0, names: new Map(), collisions: 0 },
  shadowing: 0,
};

const SKIP_KEYS = new Set(["parent", "loc", "range", "tokens", "comments"]);
const bump = (map, key) => map.set(key, (map.get(key) ?? 0) + 1);

function strip(node) {
  let n = node;
  while (n && n.type === "ChainExpression") n = n.expression;
  return n;
}

function staticName(node) {
  if (node?.type !== "MemberExpression") return null;
  if (!node.computed && node.property.type === "Identifier") return node.property.name;
  if (
    node.computed &&
    node.property.type === "Literal" &&
    typeof node.property.value === "string"
  ) {
    return node.property.value;
  }
  return null;
}

function languageOf(file) {
  const ext = extname(file).slice(1);
  if (ext === "tsx") return "tsx";
  if (ext === "jsx") return "jsx";
  if (ext === "ts" || ext === "mts" || ext === "cts") return "ts";
  return "js";
}

function classifyInit(init) {
  const n = strip(init);
  if (!n) return "unknown";
  if (n.type === "ArrayExpression") return "array";
  if (n.type === "Literal" || n.type === "TemplateLiteral") return "primitive";
  if (n.type === "NewExpression") {
    const callee = strip(n.callee);
    const name = callee.type === "Identifier" ? callee.name : staticName(callee);
    return name === "Array"
      ? "array"
      : name === "Map" ||
          name === "Set" ||
          name === "Date" ||
          name === "RegExp" ||
          name === "Promise"
        ? "primitive"
        : "userClass";
  }
  if (n.type === "CallExpression") {
    const callee = strip(n.callee);
    const name = callee.type === "Identifier" ? callee.name : staticName(callee);
    if (name && DOM_FACTORIES.has(name)) return "dom";
    return "unknown";
  }
  if (n.type === "MemberExpression") {
    let o = n;
    while (o && o.type === "MemberExpression") o = strip(o.object);
    if (o && o.type === "Identifier" && DOM_ROOTS.has(o.name)) return "dom";
    return "unknown";
  }
  return "unknown";
}

function analyze(source, file) {
  const lang = languageOf(file);
  let ast;
  try {
    ast = tsParser.parse(source, {
      ecmaVersion: "latest",
      sourceType: "module",
      ecmaFeatures: { jsx: lang !== "ts" },
      loc: false,
      range: false,
      tokens: false,
      comment: false,
      filePath: file,
    });
  } catch {
    acc.parseErrors++;
    return;
  }
  acc.files++;
  acc.languages[lang]++;
  const declared = new Map();
  let count = 0;
  const stack = [ast];
  while (stack.length) {
    const n = stack.pop();
    if (!n || typeof n.type !== "string") continue;
    count++;
    bump(acc.nodeTypes, n.type);
    if (n.type === "VariableDeclarator" && n.id?.type === "Identifier") {
      declared.set(n.id.name, classifyInit(n.init));
      if (globals.has(n.id.name)) acc.shadowing++;
    } else if (
      (n.type === "FunctionDeclaration" ||
        n.type === "FunctionExpression" ||
        n.type === "ArrowFunctionExpression") &&
      n.params
    ) {
      for (const p of n.params) {
        const id = p.type === "AssignmentPattern" ? p.left : p;
        if (id?.type === "Identifier") {
          declared.set(id.name, "param");
          if (globals.has(id.name)) acc.shadowing++;
        }
      }
    } else if (n.type === "MemberExpression") {
      const m = acc.member;
      m.total++;
      if (n.computed) m.computed++;
      if (n.optional) m.optional++;
      let depth = 1;
      let o = strip(n.object);
      while (o && o.type === "MemberExpression") {
        depth++;
        o = strip(o.object);
      }
      m.depth[depth >= 3 ? "3+" : depth]++;
      const rootName = o?.type === "Identifier" ? o.name : null;
      if (o?.type === "ThisExpression") m.roots.this++;
      else if (rootName && WINDOW_ROOTS.has(rootName)) m.roots.window++;
      else if (rootName && globals.has(rootName)) m.roots.global++;
      else if (rootName) m.roots.local++;
      else m.roots.other++;
      const name = staticName(n);
      if (name) {
        bump(m.names, name);
        if (buckets.members.has(name)) m.untypedCollisions++;
        const typed = buckets.typedMembers.get(name);
        if (typed) {
          m.typedCollisions++;
          m.typedHandlers += typed.length;
          m.typedBucketSize[
            typed.length === 1
              ? 1
              : typed.length <= 10
                ? "2-10"
                : typed.length <= 30
                  ? "11-30"
                  : "31+"
          ]++;
          const object = strip(n.object);
          let receiver = "unknown";
          if (object.type === "ThisExpression") receiver = "userClass";
          else if (object.type === "Identifier") {
            const cls = declared.get(object.name);
            receiver =
              cls === "param" || cls === undefined
                ? globals.has(object.name) && DOM_ROOTS.has(object.name)
                  ? "dom"
                  : "unknown"
                : cls;
          } else if (object.type === "ArrayExpression") receiver = "array";
          else if (object.type === "Literal" || object.type === "TemplateLiteral")
            receiver = "primitive";
          else if (rootName && DOM_ROOTS.has(rootName)) receiver = "dom";
          m.receivers[receiver]++;
        }
      }
    } else if (n.type === "CallExpression") {
      acc.call.total++;
      const callee = strip(n.callee);
      const name = callee.type === "Identifier" ? callee.name : staticName(callee);
      if (callee.type === "Identifier") acc.call.identifierCallee++;
      if (name) {
        bump(acc.call.names, name);
        const b = buckets.calls.get(name);
        if (b) {
          acc.call.collisions++;
          acc.call.handlers += b.length;
        }
      }
    } else if (n.type === "NewExpression") {
      acc.construction.total++;
      const callee = strip(n.callee);
      const name = callee.type === "Identifier" ? callee.name : staticName(callee);
      if (name) {
        bump(acc.construction.names, name);
        if (buckets.constructions.has(name)) acc.construction.collisions++;
      }
    }
    for (const key in n) {
      if (SKIP_KEYS.has(key)) continue;
      const v = n[key];
      if (Array.isArray(v)) {
        for (const c of v) if (c && typeof c.type === "string") stack.push(c);
      } else if (v && typeof v.type === "string") stack.push(v);
    }
  }
  acc.nodes += count;
  acc.fileNodes.push(count);
}

for (const source of sources) {
  for (const file of source.files) analyze(readFileSync(join(source.dir, file), "utf8"), file);
}
console.error(
  `[profile] parsed ${acc.files} files (${acc.parseErrors} parse errors), ${acc.nodes} nodes`,
);

// ---------------------------------------------------------------------------------------
// Detection pass

const detections = {
  untyped: 0,
  typed: 0,
  typedNodes: 0,
  byClass: { global: 0, globalMember: 0, other: 0 },
  features: new Map(),
};

function lintConfig(typed, tsconfig, cwd) {
  const scriptFiles = ["**/*.{js,mjs,cjs,jsx}"];
  const typeScriptFiles = ["**/*.{ts,mts,cts,tsx}"];
  return new ESLint({
    cwd,
    overrideConfigFile: true,
    allowInlineConfig: false,
    errorOnUnmatchedPattern: false,
    cache: false,
    overrideConfig: [
      {
        files: scriptFiles,
        languageOptions: {
          ecmaVersion: "latest",
          sourceType: "module",
          parserOptions: { ecmaFeatures: { jsx: true } },
        },
      },
      {
        files: typeScriptFiles,
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
        files: [...scriptFiles, ...typeScriptFiles],
        plugins: { "baseline-js": { meta: plugin.meta, rules: plugin.rules } },
        linterOptions: { reportUnusedDisableDirectives: "off" },
        rules: { [RULE_ID]: ["error", benchRuleOptions(1900)] },
      },
    ],
  });
}

function classify(message) {
  const m = /^'([^']+)' on (\S+)/.exec(message);
  if (!m) return /^'[^']+' (is|became|has)/.test(message) ? "global" : "other";
  return "globalMember";
}

const tmp = join(CACHE_DIR, "tmp", `profile-${process.pid}`);
mkdirSync(tmp, { recursive: true });
try {
  for (const source of sources) {
    const eslint = lintConfig(false, null, source.dir);
    const results = await eslint.lintFiles(source.files.map((f) => join(source.dir, f)));
    for (const r of results) {
      for (const msg of r.messages) {
        if (msg.ruleId !== RULE_ID) continue;
        detections.untyped++;
        detections.byClass[classify(msg.message)]++;
        const id = /\(([a-z0-9-]+)\)\.$/.exec(msg.message)?.[1];
        if (id) bump(detections.features, id);
      }
    }
    if (args.typedSample > 0) {
      const tsFiles = source.files
        .filter((f) => /\.(ts|tsx|mts|cts)$/.test(f))
        .slice(0, args.typedSample);
      if (tsFiles.length) {
        const tsconfig = join(tmp, `tsconfig.${sources.indexOf(source)}.json`);
        writeFileSync(
          tsconfig,
          JSON.stringify({
            compilerOptions: {
              target: "ESNext",
              module: "ESNext",
              moduleResolution: "Bundler",
              lib: ["ESNext", "DOM", "DOM.Iterable"],
              jsx: "preserve",
              allowJs: true,
              noEmit: true,
              skipLibCheck: true,
              types: [],
            },
            files: tsFiles.map((f) => join(source.dir, f)),
          }),
        );
        const untypedOnSample = (
          await lintConfig(false, null, source.dir).lintFiles(
            tsFiles.map((f) => join(source.dir, f)),
          )
        ).reduce((n, r) => n + r.messages.filter((m) => m.ruleId === RULE_ID).length, 0);
        const typedResults = await lintConfig(true, tsconfig, source.dir).lintFiles(
          tsFiles.map((f) => join(source.dir, f)),
        );
        const typedTotal = typedResults.reduce(
          (n, r) => n + r.messages.filter((m) => m.ruleId === RULE_ID).length,
          0,
        );
        detections.typed += Math.max(0, typedTotal - untypedOnSample);
        // Node count of the sampled files, from the structural pass bookkeeping.
        for (const f of tsFiles) {
          const idx = source.files.indexOf(f);
          if (idx !== -1)
            detections.typedNodes +=
              acc.fileNodes[
                sources.slice(0, sources.indexOf(source)).reduce((n, s) => n + s.files.length, 0) +
                  idx
              ] ?? 0;
        }
      }
    }
    console.error(
      `[profile] detections after source ${sources.indexOf(source) + 1}/${sources.length}: untyped ${detections.untyped}, typed extra ${detections.typed}`,
    );
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------------------
// Aggregate

const per1k = (x) => Number(((x / acc.nodes) * 1000).toFixed(3));
const share = (x, total) => Number((total ? x / total : 0).toFixed(4));
const shares = (obj, total) =>
  Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, share(v, total)]));
const topShares = (map, total, n) =>
  Object.fromEntries(
    [...map]
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .slice(0, n)
      .map(([k, v]) => [k, share(v, total)]),
  );
const logs = acc.fileNodes.filter((n) => n > 0).map((n) => Math.log(n));
const mu = mean(logs);
const sigma = Math.sqrt(mean(logs.map((l) => (l - mu) ** 2)));
const filesTotal = Object.values(acc.languages).reduce((a, b) => a + b, 0);

const profile = {
  version: 1,
  extractedAt: new Date().toISOString().slice(0, 10),
  sources: {
    repositories: sources.length,
    files: acc.files,
    nodes: acc.nodes,
    parseErrors: acc.parseErrors,
  },
  languages: shares(acc.languages, filesTotal),
  fileSize: {
    nodesLogNormal: { mu: Number(mu.toFixed(3)), sigma: Number(Math.min(sigma, 1.6).toFixed(3)) },
    p50: Math.round(quantile(acc.fileNodes, 0.5)),
    p90: Math.round(quantile(acc.fileNodes, 0.9)),
    max: Math.max(...acc.fileNodes),
  },
  nodeMix: topShares(acc.nodeTypes, acc.nodes, 40),
  members: {
    per1k: per1k(acc.member.total),
    computedShare: share(acc.member.computed, acc.member.total),
    optionalPer1k: per1k(acc.member.optional),
    chainDepth: shares(acc.member.depth, acc.member.total),
    roots: shares(acc.member.roots, acc.member.total),
    nameClasses: {
      untypedBucket: share(acc.member.untypedCollisions, acc.member.total),
      typedBucket: share(acc.member.typedCollisions, acc.member.total),
    },
    typedBucketSize: shares(acc.member.typedBucketSize, acc.member.typedCollisions),
    typedHandlersPer1k: per1k(acc.member.typedHandlers),
    typedReceivers: shares(acc.member.receivers, acc.member.typedCollisions),
    topNames: topShares(acc.member.names, acc.member.total, 300),
  },
  calls: {
    per1k: per1k(acc.call.total),
    identifierCalleeShare: share(acc.call.identifierCallee, acc.call.total),
    collisionsPer1k: per1k(acc.call.collisions),
    handlersPer1k: per1k(acc.call.handlers),
    topNames: topShares(acc.call.names, acc.call.total, 200),
  },
  constructions: {
    per1k: per1k(acc.construction.total),
    collisionShare: share(acc.construction.collisions, acc.construction.total),
    topNames: topShares(acc.construction.names, acc.construction.total, 60),
  },
  shadowing: { globalNamesBoundLocallyPer1k: per1k(acc.shadowing) },
  detections: {
    untypedPer1k: per1k(detections.untyped),
    typedPer1k: detections.typedNodes
      ? Number(((detections.typed / detections.typedNodes) * 1000).toFixed(3))
      : null,
    byClass: shares(detections.byClass, detections.untyped),
    topFeatures: topShares(detections.features, detections.untyped, 40),
  },
};

writeJson(resolve(args.out), stable(profile));
console.error(`[profile] written to ${args.out}`);
console.log(
  JSON.stringify(
    {
      sources: profile.sources,
      languages: profile.languages,
      fileSize: profile.fileSize,
      membersPer1k: profile.members.per1k,
      callsPer1k: profile.calls.per1k,
      typedHandlersPer1k: profile.members.typedHandlersPer1k,
      detections: {
        untypedPer1k: profile.detections.untypedPer1k,
        typedPer1k: profile.detections.typedPer1k,
      },
    },
    null,
    2,
  ),
);
