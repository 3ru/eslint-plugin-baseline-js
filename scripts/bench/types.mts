/** Type-only shared types; each file format is the `z.infer` of its loader's schema. */

import type { z } from "zod";
import type { Descriptor, GeneratedDescriptor } from "../../src/baseline/types.ts";
import type { CommonRuleOptions } from "../../src/config.ts";
import type { FeatureMapSchema } from "./descriptors.mts";
import type { ProfileSchema, SynthManifestSchema } from "./generator.mts";
import type { JsonValue } from "./lib.mts";
import type { CalibrationManifestSchema } from "./real-corpus.mts";
import type { FileStatsSchema, WorkerResultSchema } from "./runner.mts";
import type { SnippetsFileSchema } from "./snippet-codec.mts";
import type { Change, PairedEstimate } from "./stats.mts";
import type { PerfTriggersSchema } from "./triggers.mts";

export type Lang = "js" | "ts" | "tsx";

export type ProfileLang = "js" | "jsx" | "ts" | "tsx";

export type PassName = "untyped" | "type-aware";

export type Side = "base" | "head";

export type Domain = "api" | "jsbi";

/** Shares (0..1) per fixed key. */
export type Shares<K extends string> = Record<K, number>;

export type NameShares = Record<string, number>;

/** Feature id → number of reports (a multiset). */
export type FeatureCounts = Record<string, number>;

export type BenchDescriptor = GeneratedDescriptor & { domain: Domain };

export type DescriptorKind = Descriptor["kind"];

export type FeatureMap = z.infer<typeof FeatureMapSchema>;

export interface SyntaxMappingIds {
  all: string[];
  syntax: string[];
  meta: string[];
}

/** Descriptors by the name the rule's listeners dispatch on; instance members need types. */
export interface ListenerBuckets {
  calls: Map<string, BenchDescriptor[]>;
  constructions: Map<string, BenchDescriptor[]>;
  members: Map<string, BenchDescriptor[]>;
  typedMembers: Map<string, BenchDescriptor[]>;
}

/** The timing passes: exactly the recommended config's options. */
export interface TimingRuleOptions extends CommonRuleOptions {
  available: "widely";
  includeWebApis: { preset: "auto" };
  includeJsBuiltins: { preset: "auto" };
  ignoreFeatures?: never;
}

/** The expected-report pass: every descriptor reports, syntax delegates are ignored. */
export interface OracleRuleOptions extends CommonRuleOptions {
  available: 1900;
  includeWebApis: { preset: "auto" };
  includeJsBuiltins: { preset: "auto" };
  ignoreFeatures: [pattern: string];
}

export type RuleOptions = TimingRuleOptions | OracleRuleOptions;

export type StatementKind =
  | "declaration"
  | "assignment"
  | "call"
  | "if"
  | "loop"
  | "try"
  | "switch"
  | "return"
  | "throw"
  | "other";

export type ExpressionSlot =
  | "initializer"
  | "argument"
  | "assignmentRight"
  | "test"
  | "return"
  | "propertyValue"
  /** Either side of a binary or logical expression. */
  | "operand";

export type ExpressionKind =
  | "identifier"
  | "member"
  | "call"
  | "literal"
  | "template"
  | "binary"
  | "arrow"
  | "object"
  | "array";

export type MemberRoot = "this" | "local" | "window" | "other";

/** By the listener buckets a member name hits; "tail" names are also outside the top-names list. */
export type NameClass = "typed" | "untypedOnly" | "neither" | "tail";

/** `const f = () => { … }` counts as a function. */
export type TopLevelDeclaration = "function" | "class" | "variable";

/** Integer value as a decimal string (the last key lumps everything above it) → share. */
export type CountShares = Record<string, number>;

export type Profile = z.infer<typeof ProfileSchema>;

/** Descriptor kinds that have an untyped one-line sample. */
export type UntypedKind = Exclude<DescriptorKind, "instanceMember">;

/** bench/synth-snippets.json as written: one tuple per snippet. */
export type SnippetsFile = z.input<typeof SnippetsFileSchema>;

export type UntypedSnippetTuple = SnippetsFile["untyped"][number];

export type TypedSnippetTuple = SnippetsFile["typed"][number];

export type Snippets = z.output<typeof SnippetsFileSchema>;

export type UntypedSnippet = Snippets["untyped"][number];

export type TypedSnippet = Snippets["typed"][number];

export type SynthManifest = z.infer<typeof SynthManifestSchema>;

export type SynthInputs = SynthManifest["inputs"];

export type SynthFile = SynthManifest["files"][number];

export type LangMix = SynthInputs["langMix"];

/** Options of `pnpm bench:synth`; see DEFAULT_SYNTH_OPTIONS in generator.mts. */
export interface SynthOptions {
  /** Thousands of files. */
  scale: number;
  seed: number;
  sizeMult: number;
  detectionsMult: number;
  collisionsMult: number;
  shadowMult: number;
  langMix: LangMix;
  /** "" means `.bench-cache/synth/<id>`. */
  out: string;
  force: boolean;
}

export type CalibrationManifest = z.infer<typeof CalibrationManifestSchema>;

export type CalibrationEntry = CalibrationManifest["entries"][number];

export type RemoteCalibrationEntry = Extract<CalibrationEntry, { repo: string }>;

export interface MaterializedRepository {
  dir: string;
  files: string[];
  hash: string;
}

/** What runner.mts sends worker.mjs; paths are relative to `cwd` with POSIX separators. */
export interface Job {
  pluginPath: string;
  cwd: string;
  files: string[];
  warmupFiles: string[];
  ruleOptions: RuleOptions;
  typed: boolean;
  /** Set for a type-aware run. */
  tsconfig: string | null;
  countNodes: boolean;
  reportDetails: boolean;
  perFileStats: boolean;
}

export type FileStats = z.infer<typeof FileStatsSchema>;

export type WorkerResult = z.infer<typeof WorkerResultSchema>;

export type MetricName = "rule_ms" | "lint_ms" | "thread_cpu_ms" | "max_rss_kb";

export interface Build {
  ref: string;
  sha: string;
  label: string;
  dirty: boolean;
  pluginPath: string;
  cleanup(): void;
}

export type BuildInfo = Omit<Build, "pluginPath" | "cleanup">;

export interface TimedRun {
  side: Side;
  shard: number;
  iteration: number;
  result: WorkerResult;
}

/** Least-squares line of per-file rule time over nodes / 1000: intercept and slope. */
export interface CostModel {
  fixedMs: number;
  perKNodesMs: number;
}

/** Totals are medians over iterations of the summed shards. */
export interface SideSummary {
  rule_ms: number;
  lint_ms: number;
  parse_ms: number;
  thread_cpu_ms: number | null;
  /** Median over iterations of the largest shard's peak. */
  max_rss_kb: number;
  cost: CostModel;
}

export interface PassComparison {
  metrics: Record<Exclude<MetricName, "thread_cpu_ms">, PairedEstimate> & {
    thread_cpu_ms: PairedEstimate | null;
  };
  /** (mean d | head first − mean d | base first) / 2 with d = ln(head / base) of rule time. */
  orderEffect: number;
}

export interface ReportMismatch {
  file: string;
  featureId: string;
  expected: number;
  actual: number;
}

export interface OracleSide {
  reports: number;
  fatals: number;
  mismatches: ReportMismatch[];
}

/** The expected-report check of one pass. */
export interface OraclePass {
  /** Warm-up files included. */
  expected: number;
  base: OracleSide | null;
  head: OracleSide;
  ruleTime: PairedEstimate | null;
}

export interface CorpusInfo {
  id: string;
  /** null for a calibration repository. */
  scale: number | null;
  sizeMult: number | null;
}

export interface PassResult {
  corpus: CorpusInfo;
  name: PassName;
  /** Timed files; warm-up files are not counted. */
  files: number;
  nodes: number;
  warmupFiles: number;
  shards: number;
  iterations: number;
  sides: { base: SideSummary | null; head: SideSummary };
  /** Pooled within-shard SD of ln(rule_ms) across iterations. */
  noise: number | null;
  comparison: PassComparison | null;
  oracle: OraclePass | null;
  runs: TimedRun[];
}

export type VerdictKind = "CAUTION" | "WARNING" | "NOTE" | "TIP";

export interface PassVerdict {
  pass: PassName;
  change: Change;
  /** Holm-adjusted across passes. */
  pAdjusted: number;
}

/** The worst pass decides the kind. */
export interface Verdict {
  kind: VerdictKind;
  lines: string[];
  passes: PassVerdict[];
  headMismatch: boolean;
}

/** The `--out` file of bench, bench:compare, bench:sweep and bench:calibrate. */
export interface BenchResults {
  tool: "bench" | "bench:compare" | "bench:sweep" | "bench:calibrate";
  version: 1;
  env: EnvironmentInfo;
  options: Readonly<Record<string, JsonValue>>;
  builds: { base: BuildInfo | null; head: BuildInfo };
  passes: PassResult[];
  /** bench:compare only. */
  verdict: Verdict | null;
}

export interface EnvironmentInfo {
  node: string;
  platform: string;
  cpu: string;
  cores: number;
  eslint: string;
  typescriptEslintParser: string;
  typescript: string;
  date: string;
}

export type PerfTriggers = z.infer<typeof PerfTriggersSchema>;
