/**
 * `pnpm bench:snippets`: writes bench/synth-snippets.json, one-statement snippets the current
 * build reports exactly once, verified as planted; `--check` fails if the committed file is stale.
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { countNodes, parseSource } from "./ast.mts";
import { option, parseCli } from "./cli.mts";
import {
  dataFingerprint,
  loadDescriptors,
  loadFeatures,
  oracleRuleOptions,
  syntaxMappingIds,
  timingRuleOptions,
} from "./descriptors.mts";
import {
  BENCH_COMPILER_OPTIONS,
  createBenchESLint,
  featureIdFromMessage,
  pluginExport,
  RULE_ID,
} from "./eslint-setup.mjs";
import { fillerProbe, IDENTIFIER_NAME, loadProfile } from "./generator.mts";
import { canonicalJson, compareText, DIST_PLUGIN, SNIPPETS_FILE, TMP_DIR } from "./lib.mts";
import { encodeSnippets, loadSnippets, plantTyped, plantUntyped } from "./snippet-codec.mts";
import type {
  BenchDescriptor,
  Snippets,
  TypedSnippet,
  UntypedKind,
  UntypedSnippet,
} from "./types.mts";

const USAGE = `usage: pnpm bench:snippets [options]

Verifies the snippets against the plugin build (run \`pnpm build\` first) and writes
bench/synth-snippets.json.

  --out <file>   where to write the snippets (default: bench/synth-snippets.json)
  --check        write nothing; exit 1 when the committed file would change, with the
                 per-feature difference`;

/** Lines per verification file: large enough to amortise ESLint's setup, small enough to read. */
const CHUNK = 400;

/** Generic lib interfaces need type arguments; Intl and WebAssembly ones live in namespaces. */
const RECEIVER_FORMS = (iface: string): string[] => [
  iface,
  `${iface}<any>`,
  `${iface}<any, any>`,
  `${iface}<any, any, any>`,
  `Intl.${iface}`,
  `WebAssembly.${iface}`,
];

/** web-features writes "≤YYYY-MM-DD" when only an upper bound is known. */
const BASELINE_DATE = /^≤?\d{4}/;

type Plugin = ReturnType<typeof pluginExport>;

type Candidate = Omit<UntypedSnippet, "nodes" | "typedReports">;

type TypedCandidate = Omit<TypedSnippet, "nodes">;

interface Workspace {
  dir: string;
  plugin: Plugin;
  /** Feature ids reported per line under the expected-report options. */
  lint(name: string, lines: readonly string[], pass: Pass): Promise<Map<number, string[]>>;
}

/** JavaScript untyped, TypeScript untyped, or TypeScript type-aware. */
type Pass = "js" | "ts" | "type-aware";

/** Descriptors the expected-report pass can see: a dated Baseline status and no syntax delegate. */
function eligible(descriptors: readonly BenchDescriptor[]): BenchDescriptor[] {
  const features = loadFeatures();
  const mapped = new Set(syntaxMappingIds().all);
  let undated = 0;

  const kept = descriptors.filter((d) => {
    const status = features[d.featureId]?.status;

    if (status === undefined || mapped.has(d.featureId)) return false;
    const date = status.baseline_low_date ?? status.baseline_high_date ?? "";

    // `widely` reports these, but a year policy cannot place them, so no snippet can cover them.
    if (status.baseline !== false && !BASELINE_DATE.test(date)) {
      undated++;

      return false;
    }

    return true;
  });

  console.error(
    `[snippets] ${undated} descriptors have a feature without a Baseline status or date (reported under "widely", silent under available: 1900)`,
  );

  return kept;
}

function renderObject(
  objectArg: NonNullable<Extract<BenchDescriptor, { kind: "newWithOptions" }>["objectArg"]>,
): string | null {
  const properties = (objectArg.hasKeys ?? []).map((key) => `${JSON.stringify(key)}: 0`);

  for (const { key, values } of objectArg.keyValues ?? []) {
    const value = values?.[0];

    if (value === undefined) return null;
    properties.push(`${JSON.stringify(key)}: ${JSON.stringify(value)}`);
  }

  return `{ ${properties.join(", ")} }`;
}

function renderArgs(d: Extract<BenchDescriptor, { kind: "callMemberWithArgs" }>): string | null {
  const length = Math.max((d.stringArg?.index ?? -1) + 1, (d.objectArg?.index ?? -1) + 1, 1);
  const args = Array.from({ length }, () => "0");

  if (d.stringArg) {
    const value = d.stringArg.values[0];

    if (value === undefined) return null;
    args[d.stringArg.index] = JSON.stringify(value);
  }

  if (d.objectArg) {
    const object = renderObject(d.objectArg);

    if (object === null) return null;
    args[d.objectArg.index] = object;
  }

  return args.join(", ");
}

function untypedCandidate(d: BenchDescriptor): Candidate | null {
  const of = (
    kind: UntypedKind,
    code: string,
    globals: string[],
    needsLocal = false,
  ): Candidate => ({
    kind,
    featureId: d.featureId,
    code,
    globals,
    needsLocal,
  });

  switch (d.kind) {
    case "callGlobal":
      return of(d.kind, `${d.name}(0);`, [d.name]);
    case "newIdent":
      return of(d.kind, `new ${d.name}(0);`, [d.name]);
    case "member":
    case "staticMember":
      // generator.mts parses this form (MEMBER_SNIPPET).
      return of(d.kind, `void ${d.base}.${d.prop};`, [d.base]);
    case "callStatic":
      return of(d.kind, `${d.base}.${d.prop}(0);`, [d.base]);
    case "newMember":
      return of(d.kind, `new ${d.base}.${d.prop}(0);`, [d.base]);
    case "callMemberWithArgs": {
      const args = renderArgs(d);

      if (args === null) return null;
      const receiver = d.viaCall?.prop === undefined ? "x" : `x.${d.viaCall.prop}()`;

      return of(d.kind, `${receiver}.${d.prop}(${args});`, [], true);
    }

    case "newWithOptions": {
      const parts = Array.from({ length: d.objectArg.index + 1 }, () => "0");
      const object = renderObject(d.objectArg);

      if (object === null) return null;
      parts[d.objectArg.index] = object;

      return of(d.kind, `new ${d.name}(${parts.join(", ")});`, [d.name]);
    }

    case "instanceMember":
      return null;
    default:
      throw new Error(`unsupported descriptor ${JSON.stringify(d satisfies never)}`);
  }
}

/** Without the Program node; null when the code does not parse. */
function plantedNodes(code: string, file: string): number | null {
  try {
    return countNodes(parseSource(code, file)) - 1;
  } catch (error) {
    if (error instanceof Error && error.name === "TSError") return null;
    throw error;
  }
}

function untypedCandidates(descriptors: readonly BenchDescriptor[]): Candidate[] {
  const byCode = new Map<string, Candidate>();

  for (const d of descriptors) {
    if (d.typedOnly) continue;
    const candidate = untypedCandidate(d);

    if (candidate === null || byCode.has(candidate.code)) continue;

    if (plantedNodes(plantUntyped(candidate), "x.js") === null) continue;
    byCode.set(candidate.code, candidate);
  }

  return [...byCode.values()];
}

async function lintInChunks(
  ws: Workspace,
  name: string,
  lines: readonly string[],
): Promise<string[][]> {
  const reports: string[][] = [];

  for (let start = 0; start < lines.length; start += CHUNK) {
    const chunk = lines.slice(start, start + CHUNK);
    const byLine = await ws.lint(`${name}-${start}`, chunk, "js");
    chunk.forEach((_, i) => {
      reports.push(byLine.get(i + 1) ?? []);
    });
  }

  return reports;
}

async function verifyUntyped(
  ws: Workspace,
  candidates: readonly Candidate[],
): Promise<Candidate[]> {
  const reports = await lintInChunks(ws, "untyped", candidates.map(plantUntyped));

  const kept = candidates.filter((c, i) => {
    const r = reports[i] ?? [];

    return r.length === 1 && r[0] === c.featureId;
  });

  console.error(`[snippets] untyped: ${kept.length} verified of ${candidates.length} candidates`);

  return kept;
}

/** Clears the globals of a snippet that a parameter named after its first global leaves loud. */
async function verifyDecoys(ws: Workspace, snippets: readonly Candidate[]): Promise<Candidate[]> {
  const shadowable = snippets.filter((s) => s.globals.length > 0);
  const lines = shadowable.map((s) => `function shadow(${s.globals[0]}) { ${plantUntyped(s)} }`);
  const reports = await lintInChunks(ws, "decoys", lines);
  const loud = new Set(shadowable.filter((_, i) => (reports[i] ?? []).length > 0));
  console.error(
    `[snippets] decoys: ${shadowable.length - loud.size} of ${shadowable.length} snippets are silenced by a parameter`,
  );

  return snippets.map((s) => (loud.has(s) ? { ...s, globals: [] } : s));
}

/** Counts type-aware reports per snippet; drops one that reports another feature there. */
async function recountWithTypes(
  ws: Workspace,
  snippets: readonly Candidate[],
): Promise<UntypedSnippet[]> {
  const byLine = await ws.lint("mixed", snippets.map(plantUntyped), "type-aware");
  const kept: UntypedSnippet[] = [];
  snippets.forEach((s, i) => {
    const reports = byLine.get(i + 1) ?? [];
    const nodes = plantedNodes(plantUntyped(s), "x.js");

    if (nodes === null) throw new Error(`a verified snippet stopped parsing: ${s.code}`);

    if (reports.every((id) => id === s.featureId))
      kept.push({ ...s, nodes, typedReports: reports.length });
  });
  console.error(
    `[snippets] untyped: ${snippets.length - kept.length} dropped for other features under types`,
  );

  return kept;
}

function diagnosticLines(file: string): Set<number> {
  const { options, errors } = ts.convertCompilerOptionsFromJson(BENCH_COMPILER_OPTIONS, TMP_DIR);

  if (errors.length > 0) throw new Error("BENCH_COMPILER_OPTIONS do not convert");
  const program = ts.createProgram([file], options);
  const lines = new Set<number>();

  for (const diagnostic of ts.getPreEmitDiagnostics(program)) {
    if (diagnostic.file?.fileName !== file.replaceAll("\\", "/") || diagnostic.start === undefined)
      continue;
    lines.add(diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line + 1);
  }

  return lines;
}

/** The first form of each interface that the installed TypeScript lib resolves. */
function resolveReceiverForms(ws: Workspace, ifaces: readonly string[]): Map<string, string> {
  const probes = ifaces.flatMap((iface) => RECEIVER_FORMS(iface).map((form) => ({ iface, form })));
  const file = join(ws.dir, "receivers.ts");
  writeFileSync(
    file,
    `${probes.map((p, i) => `declare const p${i}: ${p.form};`).join("\n")}\nexport {};\n`,
  );
  const rejected = diagnosticLines(file);
  const forms = new Map<string, string>();
  probes.forEach((p, i) => {
    if (!rejected.has(i + 1) && !forms.has(p.iface)) forms.set(p.iface, p.form);
  });
  console.error(
    `[snippets] typed: ${forms.size} of ${ifaces.length} interfaces resolve in the TypeScript lib`,
  );

  return forms;
}

async function verifyTyped(
  ws: Workspace,
  descriptors: readonly BenchDescriptor[],
): Promise<TypedSnippet[]> {
  const seen = new Set<string>();
  const members: Array<Extract<BenchDescriptor, { kind: "instanceMember" }>> = [];

  for (const d of descriptors) {
    if (
      d.kind !== "instanceMember" ||
      !IDENTIFIER_NAME.test(d.iface) ||
      !IDENTIFIER_NAME.test(d.prop)
    )
      continue;

    if (seen.has(`${d.iface}.${d.prop}`)) continue;
    seen.add(`${d.iface}.${d.prop}`);
    members.push(d);
  }

  const forms = resolveReceiverForms(
    ws,
    [...new Set(members.map((d) => d.iface))].sort(compareText),
  );

  const candidates: TypedCandidate[] = [];

  for (const d of members) {
    const receiverType = forms.get(d.iface);

    if (receiverType !== undefined)
      candidates.push({ featureId: d.featureId, iface: d.iface, prop: d.prop, receiverType });
  }

  const lines = candidates.map((c, i) => {
    const { declaration, use } = plantTyped(c, `r${i}`);

    return `${declaration} ${use}`;
  });

  const withTypes = await ws.lint("typed", lines, "type-aware");
  const rejected = diagnosticLines(join(ws.dir, "typed.ts"));
  const withoutTypes = await ws.lint("typed", lines, "ts");
  const kept: TypedSnippet[] = [];
  candidates.forEach((c, i) => {
    const reports = withTypes.get(i + 1) ?? [];

    if (rejected.has(i + 1) || reports.length !== 1 || reports[0] !== c.featureId) return;

    // Without types the snippet must be silent, or it would also count in the untyped pass.
    if ((withoutTypes.get(i + 1) ?? []).length > 0) return;
    const { declaration, use } = plantTyped(c, "r0");
    const nodes = plantedNodes(`${declaration}\n${use}`, "x.ts");

    if (nodes === null) throw new Error(`a typed snippet does not parse: ${declaration} ${use}`);
    kept.push({ ...c, nodes });
  });
  console.error(
    `[snippets] typed: ${kept.length} verified of ${candidates.length} candidates (${rejected.size} rejected by the compiler)`,
  );

  return kept;
}

async function checkFillerProbe(ws: Workspace): Promise<void> {
  const dir = join(ws.dir, "probe");
  mkdirSync(dir, { recursive: true });
  const files = fillerProbe(loadProfile());

  for (const file of files) writeFileSync(join(dir, file.path), file.text);
  const linted = files.map((f) => join(dir, f.path));
  const typedFiles = linted.filter((path) => /\.tsx?$/.test(path));
  const tsconfig = join(dir, "tsconfig.json");
  writeFileSync(
    tsconfig,
    JSON.stringify({ compilerOptions: BENCH_COMPILER_OPTIONS, files: typedFiles }),
  );
  const problems: string[] = [];

  for (const ruleOptions of [timingRuleOptions(), oracleRuleOptions()]) {
    for (const typed of [false, true]) {
      const eslint = createBenchESLint({
        cwd: dir,
        plugin: ws.plugin,
        ruleOptions,
        typed,
        tsconfig: typed ? tsconfig : null,
        stats: false,
      });

      for (const result of await eslint.lintFiles(typed ? typedFiles : linted)) {
        for (const m of result.messages) {
          problems.push(
            `${result.filePath}:${m.line} (${typed ? "type-aware" : "untyped"}): ${m.message}`,
          );
        }
      }
    }
  }

  if (problems.length > 0) {
    throw new Error(`the filler probe must be silent, but it reports:\n${problems.join("\n")}`);
  }

  console.error(
    `[snippets] filler probe: ${linted.length} files silent under both option sets, untyped and type-aware`,
  );
}

function byFeature<T extends { featureId: string }>(
  key: (item: T) => string,
): (a: T, b: T) => number {
  return (a, b) => compareText(a.featureId, b.featureId) || compareText(key(a), key(b));
}

/** Per-feature +/− counts between the committed and the regenerated snippets. */
function featureDiff(before: Snippets, after: Snippets): string[] {
  const keyOf = (s: UntypedSnippet | TypedSnippet): string => canonicalJson(s);
  const counts = new Map<string, { added: number; removed: number }>();

  const tally = (
    list: ReadonlyArray<UntypedSnippet | TypedSnippet>,
    other: ReadonlySet<string>,
    field: "added" | "removed",
  ) => {
    for (const s of list) {
      if (other.has(keyOf(s))) continue;
      const entry = counts.get(s.featureId) ?? { added: 0, removed: 0 };
      entry[field]++;
      counts.set(s.featureId, entry);
    }
  };

  const all = (s: Snippets) => [...s.untyped, ...s.typed];
  tally(all(after), new Set(all(before).map(keyOf)), "added");
  tally(all(before), new Set(all(after).map(keyOf)), "removed");

  return [...counts]
    .sort(([a], [b]) => compareText(a, b))
    .map(([id, { added, removed }]) => `  ${id}: +${added} −${removed}`);
}

async function createWorkspace(dir: string, plugin: Plugin): Promise<Workspace> {
  mkdirSync(dir, { recursive: true });

  return {
    dir,
    plugin,
    async lint(name, lines, pass) {
      const typed = pass === "type-aware";
      const file = join(dir, `${name}.${pass === "js" ? "js" : "ts"}`);
      // The marker keeps a TypeScript file a module, as every generated one is.
      writeFileSync(file, `${lines.join("\n")}\n${pass === "js" ? "" : "export {};\n"}`);
      const tsconfig = join(dir, `tsconfig.${name}.json`);

      if (typed)
        writeFileSync(
          tsconfig,
          JSON.stringify({ compilerOptions: BENCH_COMPILER_OPTIONS, files: [file] }),
        );

      const eslint = createBenchESLint({
        cwd: dir,
        plugin,
        ruleOptions: oracleRuleOptions(),
        typed,
        tsconfig: typed ? tsconfig : null,
        stats: false,
      });

      const byLine = new Map<number, string[]>();

      for (const result of await eslint.lintFiles([file])) {
        for (const message of result.messages) {
          if (message.fatal) throw new Error(`${file}:${message.line}: ${message.message}`);

          if (message.ruleId !== RULE_ID) continue;
          const id = featureIdFromMessage(message.message);

          if (id === null) throw new Error(`${file}: no feature id in "${message.message}"`);
          byLine.set(message.line, [...(byLine.get(message.line) ?? []), id]);
        }
      }

      return byLine;
    },
  };
}

async function main(): Promise<void> {
  const args = parseCli(
    process.argv.slice(2),
    { out: option.text(SNIPPETS_FILE), check: option.flag(false) },
    USAGE,
  );

  if (!existsSync(DIST_PLUGIN)) throw new Error("dist/index.mjs not found: run `pnpm build` first");
  const plugin = pluginExport(await import(pathToFileURL(DIST_PLUGIN).href));
  const dir = join(TMP_DIR, `snippets-${process.pid}`);
  let snippets: Snippets;

  try {
    const ws = await createWorkspace(dir, plugin);
    const descriptors = eligible(loadDescriptors());
    const verified = await verifyUntyped(ws, untypedCandidates(descriptors));
    const untyped = await recountWithTypes(ws, await verifyDecoys(ws, verified));
    const typed = await verifyTyped(ws, descriptors);
    await checkFillerProbe(ws);
    const version = plugin.meta.version;

    if (version === undefined) throw new Error("the plugin build has no meta.version");
    snippets = {
      version: 3,
      generatedAt: new Date().toISOString().slice(0, 10),
      plugin: version,
      typescript: ts.version,
      inputs: { data: dataFingerprint() },
      untyped: untyped.toSorted(byFeature((s) => s.code)),
      typed: typed.toSorted(byFeature((s) => `${s.iface}.${s.prop}`)),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  const out = resolve(args.out);

  if (args.check) {
    const committed = loadSnippets(out);
    const diff = featureDiff(committed, snippets);

    if (diff.length > 0 || committed.inputs.data !== snippets.inputs.data) {
      console.error(
        `[snippets] ${args.out} is out of date; run \`pnpm build && pnpm bench:snippets\` and commit it:\n${diff.join("\n")}`,
      );
      process.exitCode = 1;

      return;
    }

    console.error(`[snippets] ${args.out} is up to date`);

    return;
  }

  writeFileSync(out, encodeSnippets(snippets));
  console.error(
    `[snippets] written to ${args.out}: ${snippets.untyped.length} untyped, ${snippets.typed.length} typed`,
  );
}

await main();
