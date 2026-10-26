import type {
  Capability,
  Correctness,
  HostName,
  NpmSubject,
  Profile,
  Status,
} from "../docs/website/lib/compatibility-report.ts";
import type { checks } from "./protocol.mjs";

export type {
  Capability,
  Correctness,
  HostName,
  Profile,
  Status,
} from "../docs/website/lib/compatibility-report.ts";

export type Check = (typeof checks)[number];
export type Extension = "js" | "ts";

export type Format = "eslint" | "oxlint";

export type Parsed<T> = { ok: true; value: T } | { ok: false; problem: string };

export interface Finding {
  featureId: string | null;
  line: number;
  column: number;
}

export interface ObservedFinding {
  featureId: string | null;
  line: number | undefined;
  column: number | undefined;
}

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
  ancestors: { ancestors: string[]; parentType: string | null };
  types: TypeServices & {
    receiverType: string;
    property: string;
    hasProperty: boolean;
    defaultLibrary: boolean;
  };
}

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

export type ProbeMessage =
  | { [C in Check]: Supported<C> | NotSupported<C> }[Check]
  | { check: undefined; supported: false; observed: { reason: string } };

export interface ProbeOptions {
  check: Check;
  member?: string;
}

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

type Member<C extends Check> = C extends "types"
  ? { member: string; extension: "ts" }
  : { member?: never };

type HostCheck = Exclude<Check, "execution">;

export type HostCase = {
  [C in HostCheck]: CaseBase & { suite: "host"; check: C; expected: Observations[C] } & Member<C>;
}[HostCheck];

export type BaselineCase = CaseBase & { suite: "baseline"; expected: readonly Finding[] } & (
    | { check: "types"; member: string; extension: "ts" }
    | { check: "execution"; member?: never }
  );

export type Case = HostCase | BaselineCase;

export interface ToolPaths {
  parser: string;
  executable: string;
  product: string;
}

export interface Command {
  command: string;
  args: string[];
}

export interface Host {
  format: Format;
  typeServices: boolean;
  typedFlags: readonly string[];
  invoke: (paths: ToolPaths, args: readonly string[]) => Command;
}

export type HostFacts = Pick<Host, "format" | "typeServices">;

export interface Diagnostic {
  ruleId?: string | null;
  message: string;
  severity?: number | string;
  fatal?: boolean;
  line?: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
}

export interface Run {
  command: string[];
  cwd: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  error?: string;
  stdout: string;
  stderr: string;
  raw?: { stdout: string; stderr: string };
  config?: string;
  configSha256?: string;
}

export type RunOutcome = Pick<Run, "exitCode" | "signal" | "error" | "stdout" | "stderr">;

export type RunRecord = Omit<Run, "stdout" | "stderr">;

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
}

export interface ResultRow extends Assessment {
  tool: HostName;
  expected: Case["expected"];
  fixtureSha256: string;
  run: RunRecord;
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
  tools?: Partial<Record<HostName, ToolVersion>>;
  hostErrors?: Partial<Record<HostName, string>>;
  subject?: NpmSubject;
  source?: { commit: string; dirty: string[] };
  environment?: { node: string; platform: NodeJS.Platform; architecture: NodeJS.Architecture };
  inputs?: Record<string, string>;
  product?: {
    source: string;
    version: string;
    imports: Record<string, string>;
    importPaths?: Record<string, string>;
  };
  dependencies?: Record<string, string>;
  dependencyManifestSha256?: string;
  dependencyLockSha256?: string;
  error?: string;
  expectationMatched?: boolean;
}
