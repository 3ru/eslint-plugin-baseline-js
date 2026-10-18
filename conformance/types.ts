// The contracts of the harness: what a case promises, what the probe reports, what a host is known
// to give, what a run produced and how a row is judged. Everything the runner, the probe, the
// assessment and the tests exchange is one of these shapes.
import type { checks } from "./protocol.mjs";

export type Check = (typeof checks)[number];
export type Extension = "js" | "ts";
export type HostName = "eslint" | "oxlint" | "bun";
export type Phase = "inspect" | "fix" | "suggest";
export type Profile = "pinned" | "latest";

// Configuration files and `-f json` output follow one of two tools' conventions; Bun reads
// ESLint configuration and prints ESLint's JSON.
export type Format = "eslint" | "oxlint";

// A parse of untrusted host output either yields the value or says why it could not.
export type Parsed<T> = { ok: true; value: T } | { ok: false; problem: string };

export interface Edit {
  range: readonly [number, number];
  text: string;
}

export interface Suggestion {
  desc: string;
  fix: Edit;
}

// One product diagnostic, reduced to what the expectations compare.
export interface Finding {
  featureId: string | null;
  line: number;
  column: number;
}

// The same, as a host reported it; a broken host may omit the position.
export interface ObservedFinding {
  featureId: string | null;
  line: number | undefined;
  column: number | undefined;
}

// What the probe observes for each check when the host supports it. Host cases state these same
// shapes as their expectations.
export interface TypeServices {
  hasProgram: boolean;
  hasNodeMap: boolean;
  hasChecker: boolean;
}

export interface Observations {
  options: { configuredCheck: "options"; visited: true };
  execution: { visited: true };
  selectors: { memberCalls: number; property: string | undefined; computed: boolean };
  scope: { shadowed: boolean[] };
  source: { text: string; firstToken: string | undefined; tokens: string[] };
  location: { line: number; column: number; endLine: number; endColumn: number };
  fixes: { literal: number; range: readonly [number, number] };
  ancestors: { ancestors: string[]; parentType: string | null };
  types: TypeServices & {
    receiverType: string;
    property: string;
    hasProperty: boolean;
    defaultLibrary: boolean;
  };
}

// What the probe can still say when a capability is missing: the reason or the error it hit,
// plus whatever it had observed up to that point.
export type Unavailable<C extends Check> = Partial<Observations[C]> &
  ({ reason: string } | { error: string });

export interface Supported<C extends Check> {
  check: C;
  supported: true;
  observed: Observations[C];
}

export interface NotSupported<C extends Check> {
  check: C;
  supported: false;
  observed: Unavailable<C>;
}

// The probe's whole message before it is serialised into the diagnostic. A probe that received
// no usable options reports without a check.
export type ProbeMessage =
  | { [C in Check]: Supported<C> | NotSupported<C> }[Check]
  | { check: undefined; supported: false; observed: { reason: string } };

// The rule options the runner writes for the probe.
export interface ProbeOptions {
  check: Check;
  member?: string;
  suggestionsOnly?: true;
}

// The probe's message as the assessment reads it back from the host's JSON: the observation is
// compared whole against the expectation, and the few facts the assessment acts on are checked
// for their type.
export interface ProbeEvidence {
  check: Check;
  supported: boolean;
  observed: unknown;
}

export interface ObservedFacts {
  reason?: string;
  error?: string;
  hasProgram?: boolean;
  hasNodeMap?: boolean;
}

interface CaseBase {
  id: string;
  code: string;
  extension: Extension;
}

type NoEdits = { expectedFix?: never; expectedSuggestions?: never };

// A typed case lives in a TypeScript fixture and names the member expression the probe inspects.
type Member<C extends Check> = C extends "types"
  ? { member: string; extension: "ts" }
  : { member?: never };

// Only the fixes check produces a fix and suggestions; a host applies the first suggestion.
type Edits<C extends Check> = C extends "fixes"
  ? { expectedFix?: Edit; expectedSuggestions?: readonly [Suggestion, ...Suggestion[]] }
  : NoEdits;

type HostCheck = Exclude<Check, "execution">;

export type HostCase = {
  [C in HostCheck]: CaseBase & { suite: "host"; check: C; expected: Observations[C] } & Member<C> &
    Edits<C>;
}[HostCheck];

export type BaselineCase = CaseBase & { suite: "baseline"; expected: readonly Finding[] } & (
    | { check: "types"; member: string; extension: "ts" }
    | { check: "execution"; member?: never }
  ) &
  NoEdits;

export type Case = HostCase | BaselineCase;

export interface ToolPaths {
  parser: string;
  eslint: string;
  oxlint: string;
  bun: string;
  product: string;
}

export interface Command {
  command: string;
  args: string[];
}

// What a host is known to give external JavaScript rules, and how to drive it.
export interface Host {
  format: Format;
  // Whether typescript-eslint parser services reach JavaScript rules. Sets the expectation a
  // typed row is judged against; the observation is recorded either way.
  typeServices: boolean;
  // `-f json` carries each suggestion's description and edit on the diagnostic.
  suggestionPayload: boolean;
  // The command line can apply suggestions with --fix-suggestions.
  appliesSuggestions: boolean;
  // Flags added for typed cases.
  typedFlags: readonly string[];
  invoke: (paths: ToolPaths, args: readonly string[]) => Command;
}

// What the assessment needs to know about a host.
export type HostFacts = Pick<Host, "format" | "typeServices">;

// A diagnostic after normalisation to ESLint's shape, built from checked fields only. Oxlint rows
// gain lines and columns from byte offsets; its own reports (no code) keep ruleId undefined.
export interface Diagnostic {
  ruleId?: string | null;
  message: string;
  severity?: number | string;
  fatal?: boolean;
  line?: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
  // Compared as a whole against the expected suggestions; never read field by field.
  suggestions?: unknown;
}

export interface Run {
  command: string[];
  cwd: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  error?: string;
  stdout: string;
  stderr: string;
  raw?: { stdout: string; stderr: string; result?: string };
  config?: string;
  configSha256?: string;
}

// The part of a run the assessment reads.
export type RunOutcome = Pick<Run, "exitCode" | "signal" | "error" | "stdout" | "stderr">;

// The part of a run the report keeps; stdout and stderr live under raw/.
export type RunRecord = Omit<Run, "stdout" | "stderr">;

// Why a fix or a suggestion method did not produce the expected file; absent when it did.
export interface SuggestionCheck {
  method: string;
  problem?: string;
}

export interface Fixes {
  fix?: { problem?: string };
  suggestions?: SuggestionCheck[];
}

export type Capability = "supported" | "unavailable" | "unknown";
export type Correctness =
  | "matched"
  | "mismatch"
  | "missing"
  | "unexpected"
  | "not-verified"
  | "not-assessed";
export type Status =
  | "matched"
  | "mismatch"
  | "coverage-loss"
  | "incorrect"
  | "unsupported"
  | "unknown"
  | "execution-error";

export interface Assessment {
  caseId: string;
  suite: Case["suite"];
  capability: Capability;
  correctness: Correctness;
  status: Status;
  expectationMatched: boolean;
  reason?: string;
  evidence?: ProbeEvidence;
  expectedCapability?: Exclude<Capability, "unknown">;
  diagnostics?: ObservedFinding[];
  missing?: Finding[];
  unexpected?: ObservedFinding[];
  unexpectedRules?: Diagnostic[];
  silentCoverageLoss?: boolean;
  fixes?: Fixes;
}

export interface ResultRow extends Assessment {
  tool: HostName;
  expected: Case["expected"];
  fixtureSha256: string;
  run: RunRecord;
  extraRuns: RunRecord[];
}

export interface ToolVersion {
  version: string;
  binarySha256?: string;
}

export interface Report {
  capturedAt: string;
  profile: Profile;
  policy: { available: number; includeWebApis: boolean; includeJsBuiltins: boolean };
  results: ResultRow[];
  tools?: Record<HostName, ToolVersion>;
  source?: { commit: string; dirty: string[]; pullRequest?: { head: string; base: string } };
  environment?: { node: string; platform: NodeJS.Platform; architecture: NodeJS.Architecture };
  inputs?: Record<string, string>;
  product?: { source: string; version: string; imports: Record<string, string> };
  dependencies?: Record<string, string>;
  dependencyManifestSha256?: string;
  dependencyLockSha256?: string;
  error?: string;
  expectationMatched?: boolean;
}
