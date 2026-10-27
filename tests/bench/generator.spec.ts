import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { countNodes, parseSource } from "../../scripts/bench/ast.mts";
import { oracleRuleOptions } from "../../scripts/bench/descriptors.mts";
import {
  BENCH_COMPILER_OPTIONS,
  createBenchESLint,
  featureIdFromMessage,
  pluginExport,
  RULE_ID,
} from "../../scripts/bench/eslint-setup.mjs";
import {
  type CorpusInputs,
  DEFAULT_SYNTH_OPTIONS,
  ensureSynthCorpus,
  type GeneratedCorpus,
  generateCorpus,
  LANGS,
  loadProfile,
} from "../../scripts/bench/generator.mts";
import { DIST_PLUGIN, TMP_DIR } from "../../scripts/bench/lib.mts";
import { StructureStats, structureTables } from "../../scripts/bench/profile.mts";
import { loadSnippets } from "../../scripts/bench/snippet-codec.mts";
import type { FeatureCounts, SynthOptions } from "../../scripts/bench/types.mts";

const inputs: CorpusInputs = { profile: loadProfile(), snippets: loadSnippets() };

const generate = (options: Partial<SynthOptions>): GeneratedCorpus =>
  generateCorpus({ ...DEFAULT_SYNTH_OPTIONS, ...options }, inputs);

const sum = (values: Iterable<number>): number => {
  let total = 0;

  for (const value of values) total += value;

  return total;
};

const reportTotal = (counts: FeatureCounts | null): number => sum(Object.values(counts ?? {}));

const workDir = join(TMP_DIR, `generator-spec-${process.pid}`);

afterAll(() => rmSync(workDir, { recursive: true, force: true }));

describe("diagnostic feature IDs", () => {
  it.each([
    ["API. Feature ID: array-group.", "array-group"],
    ["API (array-group).", "array-group"],
    ["API. Feature ID: .", null],
    ["API ().", null],
    ["API. Feature ID: array-group. extra text", null],
    ["API (array-group). extra text", null],
    ["API Feature ID: array-group.", null],
  ] as const)("reads only a complete feature suffix in %s", (message, expected) => {
    expect(featureIdFromMessage(message)).toBe(expected);
  });
});

describe("node counts", () => {
  it("equal what ESLint visits in every generated file", () => {
    for (const seed of [1, 2]) {
      const corpus = generate({ scale: 0.05, seed });
      expect(corpus.files).toHaveLength(50);

      for (const file of corpus.files) {
        expect({ path: file.path, nodes: countNodes(parseSource(file.text, file.path)) }).toEqual({
          path: file.path,
          nodes: file.nodes,
        });
      }
    }
  });
});

describe("determinism", () => {
  it("gives the same bytes and id for the same inputs", () => {
    const a = generate({ scale: 0.2 });
    const b = generate({ scale: 0.2 });
    expect(b.id).toBe(a.id);
    expect(b.files.map((f) => f.text)).toEqual(a.files.map((f) => f.text));
    expect(generate({ scale: 0.2, seed: 2 }).id).not.toBe(a.id);
  });

  it("nests scale 1 inside scale 2 per language", () => {
    const small = generate({ scale: 1 });
    const large = generate({ scale: 2 });
    expect(large.id).not.toBe(small.id);

    for (const lang of LANGS) {
      const smallFiles = small.files.filter((f) => f.lang === lang);
      const largeFiles = large.files.filter((f) => f.lang === lang);
      expect(smallFiles.length).toBeGreaterThan(0);
      expect(largeFiles.slice(0, smallFiles.length).map((f) => [f.path, f.text])).toEqual(
        smallFiles.map((f) => [f.path, f.text]),
      );
    }
  });
});

describe("realism", () => {
  // Scale 1: decoys are rare, and with fewer files their count alone varies by more than 25%.
  // Scale 1 keeps the decoy counts stable; parsing its 1,000 files takes ~15 s on a CI runner.
  it("matches the profile within 25%", { timeout: 60_000 }, () => {
    const { profile } = inputs;
    const corpus = generate({ scale: 1 });
    const stats = new StructureStats(structureTables());

    for (const file of corpus.files) stats.add(file.text, file.path);
    const measured = stats.summary(new Set(Object.keys(profile.members.topNames)));
    const typescript = corpus.files.filter((f) => f.lang !== "js");

    const typedExtra = sum(
      typescript.map((f) => reportTotal(f.expected.typed) - reportTotal(f.expected.untyped)),
    );

    const per1k = (n: number, nodes: number): number => (n / nodes) * 1000;
    const { totals } = corpus.manifest;

    const rows: Array<[string, number, number]> = [
      ["file size p50", profile.fileSize.p50, measured.fileSize.p50],
      ["file size p90", profile.fileSize.p90, measured.fileSize.p90],
      ["members per 1k", profile.members.per1k, measured.members.per1k],
      ["calls per 1k", profile.calls.per1k, measured.calls.per1k],
      ["constructions per 1k", profile.constructions.per1k, measured.constructions.per1k],
      [
        "roots in classes: this",
        profile.members.roots.inClass.this,
        measured.members.roots.inClass.this,
      ],
      [
        "roots in classes: local",
        profile.members.roots.inClass.local,
        measured.members.roots.inClass.local,
      ],
      [
        "roots elsewhere: local",
        profile.members.roots.outside.local,
        measured.members.roots.outside.local,
      ],
      [
        "member chains inside class bodies",
        profile.members.roots.inClassShare,
        measured.members.roots.inClassShare,
      ],
      [
        "roots elsewhere: other",
        profile.members.roots.outside.other,
        measured.members.roots.outside.other,
      ],
      ...(["1", "2", "3"] as const).map((length): [string, number, number] => [
        `chains of length ${length}`,
        profile.chainLength[length] ?? 0,
        measured.chainLength[length] ?? 0,
      ]),
      [
        "typed-bucket member names",
        profile.members.nameClasses.typed,
        measured.members.nameClasses.typed,
      ],
      [
        "untyped-bucket member names",
        profile.members.nameClasses.untypedOnly,
        measured.members.nameClasses.untypedOnly,
      ],
      [
        "untyped detections per 1k",
        profile.detections.untypedPer1k,
        per1k(totals.expectedUntyped, totals.nodes),
      ],
      [
        "type-aware detections per 1k (TypeScript)",
        profile.detections.typedPer1k ?? 0,
        per1k(typedExtra, sum(typescript.map((f) => f.nodes))),
      ],
      [
        "decoys per 1k",
        profile.shadowing.globalNamesBoundLocallyPer1k,
        per1k(totals.decoys, totals.nodes),
      ],
    ];

    const outside = rows.filter(
      ([, expected, actual]) => !(Math.abs(actual / expected - 1) <= 0.25),
    );

    expect(
      outside.map(([name, expected, actual]) => `${name}: profile ${expected}, corpus ${actual}`),
    ).toEqual([]);
    // Every decoy is a binding of a detector global, and nothing else in the filler is.
    expect(measured.shadowing.globalNamesBoundLocallyPer1k).toBeCloseTo(
      per1k(totals.decoys, totals.nodes),
      2,
    );
  });
});

describe("expected reports", () => {
  it("equal what the build reports, per file and feature", async () => {
    expect(existsSync(DIST_PLUGIN), "run `pnpm build` first").toBe(true);
    // Ten times the decoy density, so that a few files hold one.
    const corpus = generate({ scale: 0.04, seed: 3, shadowMult: 10 });
    expect(corpus.manifest.totals.decoys).toBeGreaterThan(0);
    const dir = join(workDir, "oracle");

    for (const file of [...corpus.files, ...corpus.shared]) {
      mkdirSync(dirname(join(dir, file.path)), { recursive: true });
      writeFileSync(join(dir, file.path), file.text);
    }

    const typescript = corpus.files.filter((f) => f.lang !== "js");
    const tsconfig = join(dir, "tsconfig.json");
    writeFileSync(
      tsconfig,
      JSON.stringify({
        compilerOptions: BENCH_COMPILER_OPTIONS,
        files: typescript.map((f) => join(dir, f.path)),
      }),
    );
    const plugin = pluginExport(await import(pathToFileURL(DIST_PLUGIN).href));

    for (const typed of [false, true]) {
      const files = typed ? typescript : corpus.files;

      const eslint = createBenchESLint({
        cwd: dir,
        plugin,
        ruleOptions: oracleRuleOptions(),
        typed,
        tsconfig: typed ? tsconfig : null,
        stats: false,
      });

      const reported = new Map<string, FeatureCounts>();

      for (const result of await eslint.lintFiles(files.map((f) => join(dir, f.path)))) {
        const counts: FeatureCounts = {};

        for (const message of result.messages) {
          expect(message.fatal ?? false, message.message).toBe(false);

          if (message.ruleId !== RULE_ID) continue;
          const id = featureIdFromMessage(message.message) ?? message.message;
          counts[id] = (counts[id] ?? 0) + 1;
        }

        reported.set(result.filePath, counts);
      }

      for (const file of files) {
        const expected = typed ? file.expected.typed : file.expected.untyped;
        expect({ file: file.path, typed, counts: reported.get(join(dir, file.path)) }).toEqual({
          file: file.path,
          typed,
          counts: expected,
        });
      }
    }
  });
});

describe("ensureSynthCorpus", () => {
  it("refuses to replace an --out directory that holds no manifest", () => {
    const dir = join(workDir, "not-a-corpus");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "precious.txt"), "keep me\n");
    expect(() => ensureSynthCorpus({ scale: 0.001, out: dir })).toThrow(/refusing to replace/);
    expect(existsSync(join(dir, "precious.txt"))).toBe(true);
  });

  it("writes a corpus into --out and reuses it for the same id", () => {
    const dir = join(workDir, "corpus");
    const first = ensureSynthCorpus({ scale: 0.002, out: dir });
    expect(first.reused).toBe(false);
    expect(first.manifest.files.every((f) => existsSync(join(dir, f.path)))).toBe(true);
    const second = ensureSynthCorpus({ scale: 0.002, out: dir });
    expect(second).toMatchObject({ id: first.id, reused: true });
    expect(ensureSynthCorpus({ scale: 0.002, out: dir, force: true }).reused).toBe(false);
  });
});
