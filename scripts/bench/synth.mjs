#!/usr/bin/env node
/**
 * Generate the synthetic benchmark corpus from bench/profile.json and bench/synth-snippets.json.
 *
 *   node scripts/bench/synth.mjs --scale 3                   # ≈3,000 files in .bench-cache/synth/<id>/
 *   node scripts/bench/synth.mjs --scale 1 --size-mult 8      # fewer, much larger files
 *   node scripts/bench/synth.mjs --scale 1 --detections-mult 0 --collisions-mult 4
 *
 * The output is deterministic: the same profile, snippet list, generator source, seed and
 * options produce byte-identical files, and the corpus id is a hash of those inputs. The
 * manifest records, per file, how many detections were injected, so a benchmark run knows
 * the expected report count before linting. Nothing is downloaded or executed.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { globalBaseNames, listenerBuckets, loadDescriptors } from "./descriptors.mjs";
import {
  CACHE_DIR,
  createRng,
  createSampler,
  PROFILE_FILE,
  parseArgs,
  quantile,
  readJson,
  SNIPPETS_FILE,
  sha256,
  stable,
  writeJson,
} from "./lib.mjs";

const GENERATOR_SOURCE = readFileSync(fileURLToPath(import.meta.url), "utf8");

/** Expand the compact tuple form of bench/synth-snippets.json into objects. */
export function loadSnippets(file) {
  const raw = readJson(file);
  if (raw.version !== 2)
    throw new Error(`${file}: expected snippets version 2, run pnpm bench:snippets`);
  return {
    ...raw,
    untyped: raw.untyped.map(([kind, featureId, code, globals, needsLocal, typedReports]) => ({
      kind,
      featureId,
      code,
      globals,
      needsLocal: needsLocal === 1,
      typedReports,
    })),
    typed: raw.typed.map(([featureId, iface, prop, receiverType]) => ({
      featureId,
      iface,
      prop,
      receiverType: receiverType || iface,
    })),
  };
}

/** The one committed set: files per unit of scale and the language mix. */
export const STANDARD = { filesPerScale: 1000, langMix: { js: 0.5, ts: 0.3333, tsx: 0.1667 } };

export const DEFAULT_OPTIONS = {
  scale: 3,
  seed: 1,
  sizeMult: 1,
  detectionsMult: 1,
  collisionsMult: 1,
  shadowMult: 1,
  langMix: "",
  out: "",
  force: false,
  profile: PROFILE_FILE,
  snippets: SNIPPETS_FILE,
};

const IDENT = /^[A-Za-z_$][\w$]*$/;
// Names that are legal to access but not to declare as fields, methods or locals.
const UNSAFE_AS_NAME = new Set([
  "constructor",
  "prototype",
  "__proto__",
  "static",
  "get",
  "set",
  "async",
  "await",
  "of",
  "accessor",
]);
const RESERVED = new Set(
  "break case catch class const continue debugger default delete do else enum export extends false finally for function if import in instanceof new null return super switch this throw true try typeof var void while with yield let static implements interface package private protected public await arguments eval undefined NaN Infinity".split(
    " ",
  ),
);
const LOCALS = [
  "state",
  "config",
  "items",
  "cache",
  "payload",
  "result",
  "handler",
  "entry",
  "record",
  "buffer",
  "queue",
  "registry",
  "context",
  "source",
  "target",
  "values",
  "label",
  "bucket",
  "cursor",
  "segment",
  "pending",
  "snapshot",
];

function parseLangMix(text) {
  if (!text) return STANDARD.langMix;
  const mix = {};
  for (const part of text.split(",")) {
    const [lang, value] = part.split(":");
    mix[lang.trim()] = Number(value);
  }
  return mix;
}

function corpusId(inputs) {
  return sha256(JSON.stringify(stable(inputs))).slice(0, 16);
}

/**
 * Build the sampling tables once per corpus: identifier pools split by whether a name
 * collides with a listener bucket, snippet pools weighted by how often real code uses the
 * feature, and the local vocabulary that never shadows a global the detectors key on.
 */
function buildTables(profile, snippets, options) {
  const descriptors = loadDescriptors();
  const buckets = listenerBuckets(descriptors);
  const globals = globalBaseNames(descriptors);
  const collides = (name) => buckets.members.has(name) || buckets.typedMembers.has(name);
  const builtinTypedProps = new Set(
    descriptors
      .filter((d) => d.kind === "instanceMember" && d.domain === "jsbi")
      .map((d) => d.prop),
  );

  const validNames = Object.entries(profile.members.topNames).filter(
    ([n]) => IDENT.test(n) && !RESERVED.has(n) && !UNSAFE_AS_NAME.has(n),
  );
  const colliding = Object.fromEntries(validNames.filter(([n]) => collides(n)));
  const neutral = Object.fromEntries(validNames.filter(([n]) => !collides(n)));
  const collidingShare =
    Object.values(colliding).reduce((a, b) => a + b, 0) /
    Math.max(
      1e-9,
      validNames.reduce((a, [, w]) => a + w, 0),
    );
  const callNames = Object.fromEntries(
    Object.entries(profile.calls.topNames).filter(
      ([n]) => IDENT.test(n) && !RESERVED.has(n) && !UNSAFE_AS_NAME.has(n) && !globals.has(n),
    ),
  );
  const safeBuiltinProps = Object.fromEntries(
    validNames.filter(([n]) => !builtinTypedProps.has(n) && !collides(n)),
  );

  // Real usage is dominated by a few features (Number, console, Array.isArray); cap the
  // weight so the injected detections still cover the long tail of features.
  const featureWeight = (id) => Math.min(0.1, profile.detections.topFeatures[id] ?? 0.0005);
  const untypedWeights = Object.fromEntries(
    snippets.untyped.map((s, i) => [String(i), featureWeight(s.featureId)]),
  );
  const typedWeights = Object.fromEntries(
    snippets.typed.map((s, i) => [String(i), featureWeight(s.featureId)]),
  );
  const shadowable = snippets.untyped
    .map((s, i) => (s.globals.length ? i : -1))
    .filter((i) => i >= 0);

  return {
    locals: LOCALS.filter((n) => !globals.has(n)),
    pickMember(rng) {
      const share = Math.min(1, collidingShare * options.collisionsMult);
      return rng.chance(share) ? this.collidingSampler(rng) : this.neutralSampler(rng);
    },
    collidingSampler: createSampler(colliding),
    neutralSampler: createSampler(neutral),
    callSampler: createSampler(callNames),
    builtinPropSampler: createSampler(safeBuiltinProps),
    untypedSampler: createSampler(untypedWeights),
    typedSampler: createSampler(typedWeights),
    shadowable,
    nodeShare(type) {
      return profile.nodeMix[type] ?? 0;
    },
  };
}

/** Statement-level generator for one file. Costs are rough AST node estimates. */
class FileBuilder {
  constructor(rng, tables, profile, options, lang) {
    this.rng = rng;
    this.t = tables;
    this.p = profile;
    this.o = options;
    this.lang = lang;
    this.typed = lang !== "js";
    this.lines = [];
    this.nodes = 0;
    this.counter = 0;
    this.expected = { untyped: 0, typedExtra: 0, shadowed: 0, typedSnippets: 0 };
    this.declaredReceivers = [];
  }

  id(prefix) {
    return `${prefix}${this.counter++}`;
  }

  local() {
    return this.rng.pick(this.t.locals);
  }

  literal() {
    const r = this.rng.next();
    if (r < 0.4) return String(this.rng.int(1000));
    if (r < 0.7) return JSON.stringify(this.t.neutralSampler(this.rng) ?? "value");
    if (r < 0.85) return `\`${this.t.neutralSampler(this.rng) ?? "v"}-\${${this.local()}}\``;
    return this.rng.chance(0.5) ? "true" : "null";
  }

  /** A member chain on a receiver, with depth and root mix taken from the profile. */
  memberChain(receiver = null, { assignable = false } = {}) {
    const roots = this.p.members.roots;
    const r = this.rng.next();
    let base;
    if (receiver) base = receiver;
    else if (this.inMethod && r < roots.this) base = "this";
    else if (r < roots.this + roots.window)
      base = `${this.rng.pick(["window", "globalThis"])}.__app`;
    else base = this.local();
    const depthRoll = this.rng.next();
    const depth =
      depthRoll < this.p.members.chainDepth["1"]
        ? 1
        : depthRoll < this.p.members.chainDepth["1"] + this.p.members.chainDepth["2"]
          ? 2
          : 3;
    let expr = base;
    for (let i = 0; i < depth; i++) {
      const name = this.t.pickMember(this.rng) ?? "value";
      const computed = this.rng.chance(this.p.members.computedShare);
      const optional =
        !assignable &&
        this.rng.chance(
          Math.min(0.2, this.p.members.optionalPer1k / Math.max(1, this.p.members.per1k)),
        );
      expr += computed ? `[${JSON.stringify(name)}]` : optional ? `?.${name}` : `.${name}`;
      this.nodes += 2;
    }
    return expr;
  }

  expression(depth = 0) {
    const r = this.rng.next();
    this.nodes += 1;
    if (depth > 2 || r < 0.3) return this.literal();
    if (r < 0.55) return this.memberChain();
    if (r < 0.7)
      return `${this.memberChain()}.${this.t.callSampler(this.rng) ?? "get"}(${this.args(depth + 1)})`;
    if (r < 0.8) {
      // Parenthesised operands: `??` may not be mixed with `&&`/`||` without them.
      return `(${this.expression(depth + 1)}) ${this.rng.pick(["+", "-", "*", "&&", "||", "??", "===", "<"])} (${this.expression(depth + 1)})`;
    }
    if (r < 0.9)
      return `${this.rng.pick(this.helpers.length ? this.helpers : ["Number"])}(${this.args(depth + 1)})`;
    return `[${this.args(depth + 1)}]`;
  }

  args(depth) {
    const n = this.rng.int(3);
    const out = [];
    for (let i = 0; i < n; i++) out.push(this.expression(depth));
    return out.join(", ");
  }

  objectLiteral() {
    const n = 1 + this.rng.int(5);
    const props = [];
    for (let i = 0; i < n; i++) {
      const key = this.t.pickMember(this.rng) ?? `k${i}`;
      props.push(`${key}: ${this.expression(1)}`);
      this.nodes += 3;
    }
    return `{ ${props.join(", ")} }`;
  }

  statement(indent, depth) {
    const pad = "  ".repeat(indent);
    const r = this.rng.next();
    this.nodes += 3;
    if (r < 0.28) {
      const name = this.id("v");
      const init = this.rng.chance(0.3) ? this.objectLiteral() : this.expression();
      return `${pad}const ${name} = ${init};`;
    }
    if (r < 0.46)
      return `${pad}${this.memberChain(null, { assignable: true })} = ${this.expression()};`;
    if (r < 0.62)
      return `${pad}${this.memberChain()}.${this.t.callSampler(this.rng) ?? "set"}(${this.args(1)});`;
    if (r < 0.74 && depth < 2) {
      const body = this.block(indent + 1, depth + 1, 1 + this.rng.int(3));
      return `${pad}if (${this.expression(1)}) {\n${body}\n${pad}}${this.rng.chance(0.4) ? ` else {\n${this.block(indent + 1, depth + 1, 1 + this.rng.int(2))}\n${pad}}` : ""}`;
    }
    if (r < 0.84 && depth < 2) {
      const it = this.id("item");
      return `${pad}for (const ${it} of ${this.memberChain()}) {\n${this.block(indent + 1, depth + 1, 1 + this.rng.int(3), it)}\n${pad}}`;
    }
    if (r < 0.92)
      return `${pad}${this.local()}.${this.t.callSampler(this.rng) ?? "push"}(${this.rng.pick(this.helpers.length ? this.helpers : ["String"])}(${this.args(1)}));`;
    return `${pad}total += ${this.expression(1)};`;
  }

  block(indent, depth, count, extraLocal) {
    const saved = this.t.locals;
    if (extraLocal) this.t.locals = [...saved, extraLocal];
    const out = [];
    for (let i = 0; i < count; i++) out.push(this.statement(indent, depth));
    this.t.locals = saved;
    return out.join("\n");
  }

  functionDecl() {
    const name = this.id("fn");
    const params = this.rng.pick(this.t.locals.slice(0, 6));
    const ann = this.typed ? ": any" : "";
    const body = this.block(1, 0, 2 + this.rng.int(5), params);
    this.helpers.push(name);
    this.nodes += 6;
    return `function ${name}(${params}${ann}, index${this.typed ? ": number" : ""} = 0) {\n  let total = 0;\n${body}\n  return ${this.expression(1)};\n}`;
  }

  classDecl() {
    const name = this.id("Model");
    const fields = [];
    const n = 2 + this.rng.int(4);
    for (let i = 0; i < n; i++) fields.push(this.t.pickMember(this.rng) ?? `f${i}`);
    const unique = [...new Set(fields)];
    const methods = [];
    const m = 1 + this.rng.int(3);
    this.inMethod = true;
    for (let i = 0; i < m; i++) {
      const method = this.t.callSampler(this.rng) ?? `run${i}`;
      methods.push(
        `  ${method}(${this.local()}${this.typed ? ": any" : ""}) {\n    let total = 0;\n${this.block(2, 1, 1 + this.rng.int(3))}\n    return total;\n  }`,
      );
    }
    this.inMethod = false;
    this.nodes += 8 + unique.length * 3;
    const fieldLines = unique
      .map((f) => `  ${f}${this.typed ? ": any" : ""} = ${this.literal()};`)
      .join("\n");
    return `class ${name} {\n${fieldLines}\n${methods.join("\n")}\n}`;
  }

  /** Receivers for typed collisions: arrays, strings, maps and user classes, never DOM types. */
  typedReceivers() {
    if (!this.typed) return "";
    const lines = [
      `const list: number[] = [];`,
      `const names: string[] = [];`,
      `const lookup = new Map<string, number>();`,
      `let text = "";`,
    ];
    this.declaredReceivers = ["list", "names", "lookup", "text"];
    this.nodes += 16;
    return lines.join("\n");
  }

  builtinAccess() {
    if (!this.declaredReceivers.length) return null;
    const recv = this.rng.pick(this.declaredReceivers);
    const prop = this.t.builtinPropSampler(this.rng);
    if (!prop) return null;
    this.nodes += 3;
    return `void ${recv}.${prop};`;
  }

  /** One verified untyped detection; returns the statement and whether it counts. */
  detection(snippets, shadowed) {
    const index = shadowed
      ? this.rng.pick(this.t.shadowable)
      : Number(this.t.untypedSampler(this.rng));
    const s = snippets.untyped[index];
    const code = s.needsLocal ? `{ const x = { get: () => ({}) }; ${s.code} }` : s.code;
    this.nodes += 4;
    if (shadowed) {
      this.expected.shadowed++;
      const g = s.globals[0];
      return `function ${this.id("shadow")}(${g}${this.typed ? ": any" : ""}) {\n  ${code}\n}`;
    }
    this.expected.untyped++;
    this.expected.typedExtra += s.typedReports - 1;
    return code;
  }

  typedDetection(snippets) {
    const s = snippets.typed[Number(this.t.typedSampler(this.rng))];
    const r = this.id("r");
    this.expected.typedSnippets++;
    this.nodes += 5;
    return { declaration: `declare const ${r}: ${s.receiverType};`, use: `void ${r}.${s.prop};` };
  }

  jsxComponent() {
    const name = this.id("View");
    const key = this.t.neutralSampler(this.rng) ?? "label";
    this.nodes += 30;
    // Props stay `any`: typed array members would be real detections and skew the oracle.
    return `export function ${name}(props: any) {\n  const count = helperB(props.items);\n  return (\n    <section className={props.${key}} data-count={count}>\n      <h2>{props.title}</h2>\n      {props.first ? <li>{props.first}</li> : null}\n      {props.second ? <li>{props.second}</li> : null}\n    </section>\n  );\n}`;
  }

  build(targetNodes, snippets) {
    this.helpers = [];
    const header = [];
    header.push(`import { helperA, helperB } from "./shared${this.lang === "js" ? ".js" : ""}";`);
    if (this.typed) header.push(this.typedReceivers());
    const body = [];
    const perK = targetNodes / 1000;
    const untypedCount = Math.round(
      perK * this.p.detections.untypedPer1k * this.o.detectionsMult + this.rng.next() * 0.5,
    );
    const shadowCount = Math.round(
      perK * this.p.shadowing.globalNamesBoundLocallyPer1k * this.o.shadowMult +
        this.rng.next() * 0.5,
    );
    const typedCount =
      this.typed && snippets.typed.length
        ? Math.round(
            perK * (this.p.detections.typedPer1k ?? 0) * this.o.detectionsMult +
              this.rng.next() * 0.5,
          )
        : 0;
    const declarations = [];
    const uses = [];
    for (let i = 0; i < typedCount; i++) {
      const d = this.typedDetection(snippets);
      declarations.push(d.declaration);
      uses.push(d.use);
    }
    const pending = [];
    for (let i = 0; i < untypedCount; i++) pending.push(this.detection(snippets, false));
    for (let i = 0; i < shadowCount; i++) pending.push(this.detection(snippets, true));
    for (const u of uses) pending.push(u);
    if (this.typed)
      for (let i = 0; i < 1 + this.rng.int(4); i++) {
        const b = this.builtinAccess();
        if (b) pending.push(b);
      }
    // Shuffle detection statements among the filler so they land in varied positions.
    for (let i = pending.length - 1; i > 0; i--) {
      const j = this.rng.int(i + 1);
      [pending[i], pending[j]] = [pending[j], pending[i]];
    }
    let guard = 0;
    while (this.nodes < targetNodes && guard++ < 400) {
      const r = this.rng.next();
      if (r < 0.45) body.push(this.functionDecl());
      else if (r < 0.65) body.push(this.classDecl());
      else if (r < 0.9) body.push(`export const ${this.id("c")} = ${this.objectLiteral()};`);
      else body.push(`export const ${this.id("list")} = [${this.args(1)}];`);
      if (pending.length) body.push(pending.pop());
    }
    while (pending.length) body.push(pending.pop());
    if (this.lang === "tsx") body.push(this.jsxComponent());
    body.push(
      `export default { ${this.helpers.slice(0, 3).join(", ")}${this.helpers.length ? ", " : ""}helperA, helperB };`,
    );
    return `${[...header, ...declarations].join("\n")}\n\n${body.join("\n\n")}\n`;
  }
}

function sharedModule(typed) {
  const ann = typed ? ": any" : "";
  return `export function helperA(value${ann}, extra${typed ? ": number" : ""} = 0) {\n  return value == null ? extra : value;\n}\n\nexport function helperB(items${typed ? ": any[]" : ""}) {\n  return items.length;\n}\n`;
}

function countNodes(parser, source, lang) {
  const ast = parser.parse(source, {
    ecmaVersion: "latest",
    sourceType: "module",
    ecmaFeatures: { jsx: lang === "tsx" },
    loc: false,
    range: false,
    tokens: false,
    comment: false,
    filePath: `x.${lang}`,
  });
  let count = 0;
  const stack = [ast];
  while (stack.length) {
    const n = stack.pop();
    if (!n || typeof n.type !== "string") continue;
    count++;
    for (const key in n) {
      if (key === "parent" || key === "loc" || key === "range") continue;
      const v = n[key];
      if (Array.isArray(v)) {
        for (const c of v) if (c && typeof c.type === "string") stack.push(c);
      } else if (v && typeof v.type === "string") stack.push(v);
    }
  }
  return count;
}

/** Generate (or reuse) the corpus for the given options and return `{ dir, id, manifest }`. */
export function ensureSynthCorpus(userOptions = {}) {
  const options = { ...DEFAULT_OPTIONS, ...userOptions };
  const profile = readJson(resolve(options.profile));
  const snippets = loadSnippets(resolve(options.snippets));
  const langMix = parseLangMix(options.langMix);
  const inputs = {
    generator: sha256(GENERATOR_SOURCE),
    profile: sha256(JSON.stringify(profile)),
    snippets: sha256(JSON.stringify(snippets)),
    seed: options.seed,
    scale: options.scale,
    sizeMult: options.sizeMult,
    detectionsMult: options.detectionsMult,
    collisionsMult: options.collisionsMult,
    shadowMult: options.shadowMult,
    langMix,
  };
  const id = corpusId(inputs);
  const dir = options.out ? resolve(options.out) : join(CACHE_DIR, "synth", id);
  const manifestFile = join(dir, "manifest.json");
  if (!options.force && existsSync(manifestFile)) {
    const manifest = readJson(manifestFile);
    if (manifest.id === id) return { dir, id, manifest, reused: true };
  }
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, "src"), { recursive: true });

  const tables = buildTables(profile, snippets, options);
  const parser = createRequire(`${dirname(fileURLToPath(import.meta.url))}/../../package.json`)(
    "@typescript-eslint/parser",
  );
  const total = Math.max(1, Math.round(STANDARD.filesPerScale * options.scale));
  const langs = Object.keys(langMix).sort();
  const counts = Object.fromEntries(langs.map((l) => [l, Math.floor(total * langMix[l])]));
  let assigned = Object.values(counts).reduce((a, b) => a + b, 0);
  for (const l of langs) {
    if (assigned >= total) break;
    counts[l]++;
    assigned++;
  }
  const { mu, sigma } = profile.fileSize.nodesLogNormal;
  const files = [];
  let index = 0;
  for (const lang of langs) {
    for (let i = 0; i < counts[lang]; i++, index++) {
      const rng = createRng(`${options.seed}:${index}`);
      const target = Math.min(
        profile.fileSize.max,
        Math.max(40, Math.round(rng.logNormal(mu, sigma) * options.sizeMult)),
      );
      const builder = new FileBuilder(rng, tables, profile, options, lang);
      const source = builder.build(target, snippets);
      const path = `src/f${String(index).padStart(5, "0")}.${lang}`;
      writeFileSync(join(dir, path), source);
      const nodes = countNodes(parser, source, lang);
      const typedExpected =
        lang === "js"
          ? null
          : builder.expected.untyped + builder.expected.typedExtra + builder.expected.typedSnippets;
      files.push({
        path,
        lang,
        nodes,
        target,
        expected: {
          untyped: builder.expected.untyped,
          typed: typedExpected,
          shadowed: builder.expected.shadowed,
        },
      });
    }
  }
  writeFileSync(join(dir, "src", "shared.js"), sharedModule(false));
  writeFileSync(join(dir, "src", "shared.ts"), sharedModule(true));
  const byLang = Object.fromEntries(langs.map((l) => [l, counts[l]]));
  const nodesList = files.map((f) => f.nodes);
  const manifest = {
    id,
    generatedAt: new Date().toISOString().slice(0, 10),
    inputs,
    totals: {
      files: files.length,
      byLang,
      nodes: nodesList.reduce((a, b) => a + b, 0),
      nodesP50: Math.round(quantile(nodesList, 0.5)),
      nodesP90: Math.round(quantile(nodesList, 0.9)),
      expectedUntyped: files.reduce((n, f) => n + f.expected.untyped, 0),
      expectedTyped: files.reduce((n, f) => n + (f.expected.typed ?? 0), 0),
      shadowed: files.reduce((n, f) => n + f.expected.shadowed, 0),
    },
    files,
  };
  writeJson(manifestFile, manifest);
  return { dir, id, manifest, reused: false };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = parseArgs(process.argv.slice(2), DEFAULT_OPTIONS);
  const { dir, id, manifest, reused } = ensureSynthCorpus(args);
  const t = manifest.totals;
  console.log(
    `${reused ? "reusing" : "generated"} corpus ${id} in ${dir}\n` +
      `files ${t.files} (${Object.entries(t.byLang)
        .map(([l, n]) => `${l} ${n}`)
        .join(", ")}), nodes ${t.nodes} (p50 ${t.nodesP50}, p90 ${t.nodesP90})\n` +
      `expected reports: untyped ${t.expectedUntyped}, typed (ts+tsx files) ${t.expectedTyped}, shadowed decoys ${t.shadowed}`,
  );
}
