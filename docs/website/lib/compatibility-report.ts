export const repository = "3ru/eslint-plugin-baseline-js";
export const reportBranch = "toolchain-reports";
export const profiles = ["pinned", "latest"] as const;
export const hosts = ["eslint", "oxlint", "bun"] as const;
export const hostNames = { eslint: "ESLint", oxlint: "Oxlint", bun: "Bun" };
export type Profile = (typeof profiles)[number];
export type HostName = (typeof hosts)[number];
export type Capability = "supported" | "unavailable" | "unknown";
export type Correctness =
  | "matched"
  | "mismatch"
  | "missing"
  | "unexpected"
  | "not-verified"
  | "not-assessed";
export const statusText = {
  matched: "Matched",
  mismatch: "Mismatch",
  "coverage-loss": "Coverage loss",
  incorrect: "Incorrect",
  unsupported: "Unsupported",
  unknown: "Unknown",
  "execution-error": "Execution error",
} as const;
export type Status = keyof typeof statusText;

export interface RunIdentity {
  repository: typeof repository;
  id: string;
  number: number;
  attempt: number;
  commit: string;
  startedAt: string;
}

export interface NpmSubject {
  kind: "npm";
  version: string;
  tarball: string;
  integrity: string;
  resolvedAt: string;
}

export interface Failure {
  kind: "not-measured";
  reason: string;
}

export interface CaseExample {
  code: string;
  language: "js" | "ts";
  expected: readonly { featureId: string; line: number; column: number }[];
}

export type PublicCase = {
  id: string;
  label: string;
} & ({ suite: "host"; example?: never } | { suite: "baseline"; example?: CaseExample });

export interface PublicObservation {
  kind: "observed";
  capability: Capability;
  correctness: Correctness;
  status: Status;
  expectationMatched: boolean;
  reason: string | null;
}

export type HostMeasurement =
  | Failure
  | {
      kind: "measured";
      packageVersion: string;
      reportedVersion: string;
      channel: "pinned" | "latest" | "canary";
      cases: Record<string, PublicObservation | Failure>;
    };

export type ProfileMeasurement =
  | Failure
  | {
      kind: "measured";
      capturedAt: string;
      parser: string;
      typescript: string;
      hosts: Record<HostName, HostMeasurement>;
    };

export interface Snapshot {
  schemaVersion: 1;
  run: RunIdentity;
  subject: NpmSubject | { kind: "unresolved"; reason: string };
  cases: PublicCase[];
  profiles: Record<Profile, ProfileMeasurement>;
}

export interface Reference {
  commit: string;
  runId: string;
  runNumber: number;
  attempt: number;
  capturedAt: string;
}

export interface Manifest {
  schemaVersion: 1;
  latest: Reference;
  lastComplete: Reference | null;
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${path} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, path: string, pattern?: RegExp): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 8192 ||
    (pattern && !pattern.test(value))
  ) {
    throw new Error(`${path} is not a valid string.`);
  }
  return value;
}

function positiveInteger(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${path} must be a positive integer.`);
  }
  return value;
}

function timestamp(value: unknown, path: string): string {
  const result = string(value, path, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/);
  if (
    !Number.isFinite(Date.parse(result)) ||
    new Date(result).toISOString() !== result.replace(/(?<!\.\d{3})Z$/, ".000Z")
  )
    throw new Error(`${path} must be an ISO UTC timestamp.`);
  return result;
}

function member<T extends string>(value: unknown, allowed: readonly T[], path: string): T {
  const result = allowed.find((candidate) => candidate === value);
  if (result === undefined) throw new Error(`${path} must be one of ${allowed.join(", ")}.`);
  return result;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  path: string,
): void {
  if (
    Object.keys(value).length !== expected.length ||
    expected.some((key) => !Object.hasOwn(value, key))
  ) {
    throw new Error(`${path} must contain exactly ${expected.join(", ")}.`);
  }
}

function failure(value: Record<string, unknown>, path: string): Failure {
  if (value.kind !== "not-measured")
    throw new Error(`${path}.kind must be not-measured or measured.`);
  return { kind: "not-measured", reason: string(value.reason, `${path}.reason`) };
}

function expectedFindings(input: unknown, path: string): CaseExample["expected"] {
  if (!Array.isArray(input) || input.length > 100) {
    throw new Error(`${path} must be an array of at most 100 findings.`);
  }
  return input.map((input: unknown) => {
    const finding = object(input, path);
    return {
      featureId: string(finding.featureId, `${path}.featureId`),
      line: positiveInteger(finding.line, `${path}.line`),
      column: positiveInteger(finding.column, `${path}.column`),
    };
  });
}

export function parseCaseExample(input: unknown): CaseExample {
  const value = object(input, "example");
  return {
    code: string(value.code, "example.code"),
    language: member(value.language, ["js", "ts"], "example.language"),
    expected: expectedFindings(value.expected, "example.expected"),
  };
}

export function parseRunIdentity(input: unknown): RunIdentity {
  const value = object(input, "run");
  if (value.repository !== repository) throw new Error(`run.repository must be ${repository}.`);
  return {
    repository,
    id: string(value.id, "run.id", /^[1-9]\d*$/),
    number: positiveInteger(value.number, "run.number"),
    attempt: positiveInteger(value.attempt, "run.attempt"),
    commit: string(value.commit, "run.commit", /^[0-9a-f]{40}$/),
    startedAt: timestamp(value.startedAt, "run.startedAt"),
  };
}

export function parseNpmSubject(input: unknown): NpmSubject {
  const value = object(input, "subject");
  if (value.kind !== "npm") throw new Error("subject.kind must be npm.");
  const version = string(value.version, "subject.version", /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
  const tarball = string(value.tarball, "subject.tarball");
  if (
    tarball !==
    `https://registry.npmjs.org/eslint-plugin-baseline-js/-/eslint-plugin-baseline-js-${version}.tgz`
  ) {
    throw new Error(
      "subject.tarball must identify the exact eslint-plugin-baseline-js npm release.",
    );
  }
  return {
    kind: "npm",
    version,
    tarball,
    integrity: string(value.integrity, "subject.integrity", /^sha512-[A-Za-z0-9+/]{86}==$/),
    resolvedAt: timestamp(value.resolvedAt, "subject.resolvedAt"),
  };
}

function observation(input: unknown, path: string): PublicObservation | Failure {
  const value = object(input, path);
  if (value.kind === "not-measured") return failure(value, path);
  if (value.kind !== "observed") throw new Error(`${path}.kind must be observed or not-measured.`);
  if (typeof value.expectationMatched !== "boolean")
    throw new Error(`${path}.expectationMatched must be boolean.`);
  return {
    kind: "observed",
    capability: member(
      value.capability,
      ["supported", "unavailable", "unknown"],
      `${path}.capability`,
    ),
    correctness: member(
      value.correctness,
      ["matched", "mismatch", "missing", "unexpected", "not-verified", "not-assessed"],
      `${path}.correctness`,
    ),
    status: member(value.status, Object.keys(statusText) as Status[], `${path}.status`),
    expectationMatched: value.expectationMatched,
    reason: value.reason === null ? null : string(value.reason, `${path}.reason`),
  };
}

export function parseProfileMeasurement(
  input: unknown,
  cases: readonly PublicCase[],
): ProfileMeasurement {
  const value = object(input, "profile");
  if (value.kind !== "measured") return failure(value, "profile");
  const hostValues = object(value.hosts, "profile.hosts");
  exactKeys(hostValues, hosts, "profile.hosts");
  const readHost = (host: HostName): HostMeasurement => {
    const path = `profile.hosts.${host}`;
    const hostValue = object(hostValues[host], path);
    if (hostValue.kind !== "measured") return failure(hostValue, path);
    const rows = object(hostValue.cases, `${path}.cases`);
    exactKeys(
      rows,
      cases.map(({ id }) => id),
      `${path}.cases`,
    );
    return {
      kind: "measured",
      packageVersion: string(hostValue.packageVersion, `${path}.packageVersion`),
      reportedVersion: string(hostValue.reportedVersion, `${path}.reportedVersion`),
      channel: member(hostValue.channel, ["pinned", "latest", "canary"], `${path}.channel`),
      cases: Object.fromEntries(
        cases.map(({ id }) => [id, observation(rows[id], `${path}.cases.${id}`)]),
      ),
    };
  };
  return {
    kind: "measured",
    capturedAt: timestamp(value.capturedAt, "profile.capturedAt"),
    parser: string(value.parser, "profile.parser"),
    typescript: string(value.typescript, "profile.typescript"),
    hosts: { eslint: readHost("eslint"), oxlint: readHost("oxlint"), bun: readHost("bun") },
  };
}

export function parseSnapshot(input: unknown): Snapshot {
  const value = object(input, "snapshot");
  if (value.schemaVersion !== 1) throw new Error("snapshot.schemaVersion must be 1.");
  if (!Array.isArray(value.cases) || value.cases.length === 0 || value.cases.length > 100) {
    throw new Error("snapshot.cases must contain between 1 and 100 cases.");
  }
  const cases = value.cases.map((input: unknown): PublicCase => {
    const testCase = object(input, "case");
    const base = {
      id: string(testCase.id, "case.id", /^[a-z][a-z0-9-]*$/),
      label: string(testCase.label, "case.label"),
    };
    const suite = member(testCase.suite, ["host", "baseline"], "case.suite");
    if (suite === "host") {
      if (testCase.example !== undefined) throw new Error("A host case cannot have an example.");
      return { ...base, suite };
    }
    return testCase.example === undefined
      ? { ...base, suite }
      : { ...base, suite, example: parseCaseExample(testCase.example) };
  });
  if (new Set(cases.map(({ id }) => id)).size !== cases.length)
    throw new Error("snapshot.cases has duplicate IDs.");
  const profileValues = object(value.profiles, "snapshot.profiles");
  exactKeys(profileValues, profiles, "snapshot.profiles");
  const subject = object(value.subject, "subject");
  return {
    schemaVersion: 1,
    run: parseRunIdentity(value.run),
    subject:
      subject.kind === "unresolved"
        ? { kind: "unresolved", reason: string(subject.reason, "subject.reason") }
        : parseNpmSubject(subject),
    cases,
    profiles: {
      pinned: parseProfileMeasurement(profileValues.pinned, cases),
      latest: parseProfileMeasurement(profileValues.latest, cases),
    },
  };
}

export function parseExampleEvidence({
  input,
  snapshot,
  profile,
  testCase,
}: {
  input: unknown;
  snapshot: Snapshot;
  profile: Profile;
  testCase: Extract<PublicCase, { suite: "baseline" }>;
}): Omit<CaseExample, "code"> & { fixtureSha256: string } {
  const value = object(input, "evidence");
  const measurement = snapshot.profiles[profile];
  if (
    measurement.kind !== "measured" ||
    value.profile !== profile ||
    value.capturedAt !== measurement.capturedAt ||
    object(value.source, "evidence.source").commit !== snapshot.run.commit ||
    snapshot.subject.kind !== "npm"
  ) {
    throw new Error("Example evidence does not match the measured profile and harness revision.");
  }
  const subject = parseNpmSubject(value.subject);
  if (
    Object.entries(snapshot.subject).some(([key, value]) => Reflect.get(subject, key) !== value)
  ) {
    throw new Error("Example evidence does not match the measured npm release.");
  }
  if (!Array.isArray(value.results)) throw new Error("Example evidence has no result rows.");
  const observedHosts = hosts.filter((host) => {
    const result = measurement.hosts[host];
    return result.kind === "measured" && result.cases[testCase.id]?.kind === "observed";
  });
  const rows = value.results
    .filter(
      (row: unknown) =>
        typeof row === "object" && row !== null && "caseId" in row && row.caseId === testCase.id,
    )
    .map((row: unknown) => object(row, "evidence.result"));
  if (rows.length === 0 || rows.length !== observedHosts.length) {
    throw new Error("Example evidence must include each observed host exactly once.");
  }
  const examples = observedHosts.map((host) => {
    const matches = rows.filter((row) => row.tool === host && row.suite === "baseline");
    const row = matches[0];
    if (matches.length !== 1 || !row) {
      throw new Error("Example evidence must include each observed host exactly once.");
    }
    const command = object(row.run, "evidence.result.run").command;
    if (!Array.isArray(command) || !command.every((part) => typeof part === "string")) {
      throw new Error("Example evidence has an invalid command.");
    }
    const filename: unknown = command.at(-1);
    if (filename !== "input.js" && filename !== "input.ts") {
      throw new Error("The measured command must end with input.js or input.ts.");
    }
    return {
      language: filename === "input.js" ? ("js" as const) : ("ts" as const),
      expected: expectedFindings(row.expected, "evidence.result.expected"),
      fixtureSha256: string(row.fixtureSha256, "evidence.result.fixtureSha256", /^[0-9a-f]{64}$/),
    };
  });
  const example = examples[0];
  if (!example || examples.some((value) => JSON.stringify(value) !== JSON.stringify(example))) {
    throw new Error("The observed hosts disagree about the measured example.");
  }
  return example;
}

export function caseOutcome({
  testCase,
  observation,
}: {
  testCase: PublicCase;
  observation: PublicObservation | Failure | undefined;
}): {
  icon: "✅" | "❌" | "⚠️";
  label: string;
  tone: "success" | "failure" | "neutral" | "warning";
} {
  if (!observation || observation.kind === "not-measured") {
    return { icon: "⚠️", label: "Not measured", tone: "warning" };
  }
  if (observation.status === "execution-error") {
    return { icon: "⚠️", label: "Run error", tone: "warning" };
  }
  if (observation.status === "unknown" || observation.capability === "unknown") {
    return { icon: "⚠️", label: "Unknown", tone: "warning" };
  }
  if (observation.status === "unsupported" || observation.capability === "unavailable") {
    return { icon: "❌", label: "Unsupported", tone: "neutral" };
  }
  if (
    observation.capability === "supported" &&
    observation.status === "matched" &&
    observation.correctness === "matched"
  ) {
    return {
      icon: "✅",
      label:
        testCase.suite === "host"
          ? "Works"
          : testCase.example
            ? testCase.example.expected.length > 0
              ? "Warns"
              : "No warning"
            : "Correct",
      tone: "success",
    };
  }
  if (observation.status === "coverage-loss" || observation.correctness === "missing") {
    return { icon: "❌", label: "Missed warning", tone: "failure" };
  }
  if (
    observation.status === "incorrect" &&
    testCase.suite === "baseline" &&
    testCase.example?.expected.length === 0
  ) {
    return { icon: "❌", label: "False positive", tone: "failure" };
  }
  return { icon: "❌", label: "Wrong result", tone: "failure" };
}

export function expectedResultText(example: CaseExample | undefined): string {
  if (!example) return "Recorded example unavailable. See the saved execution evidence.";
  return example.expected.length === 0
    ? "Expected no warning."
    : example.expected
        .map(
          ({ featureId, line, column }) =>
            `Expected warning for ${featureId} at line ${line}, column ${column}.`,
        )
        .join(" ");
}

export function caseObservation({
  measurement,
  host,
  caseId,
}: {
  measurement: ProfileMeasurement;
  host: HostName;
  caseId: string;
}): PublicObservation | Failure | undefined {
  if (measurement.kind === "not-measured") return measurement;
  const result = measurement.hosts[host];
  return result.kind === "not-measured" ? result : result.cases[caseId];
}

export function parseManifest(input: unknown): Manifest {
  const value = object(input, "manifest");
  if (value.schemaVersion !== 1) throw new Error("manifest.schemaVersion must be 1.");
  const reference = (input: unknown): Reference => {
    const ref = object(input, "reference");
    return {
      commit: string(ref.commit, "reference.commit", /^[0-9a-f]{40}$/),
      runId: string(ref.runId, "reference.runId", /^[1-9]\d*$/),
      runNumber: positiveInteger(ref.runNumber, "reference.runNumber"),
      attempt: positiveInteger(ref.attempt, "reference.attempt"),
      capturedAt: timestamp(ref.capturedAt, "reference.capturedAt"),
    };
  };
  return {
    schemaVersion: 1,
    latest: reference(value.latest),
    lastComplete: value.lastComplete === null ? null : reference(value.lastComplete),
  };
}

function markdown(text: string): string {
  return text
    .replace(/[\\`*_[\]{}()#!]/g, "\\$&")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("|", "&#124;")
    .replace(/\r?\n/g, " ");
}

function fencedExample(example: CaseExample): string {
  const longest = Math.max(0, ...Array.from(example.code.matchAll(/`+/g), ([run]) => run.length));
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}${example.language}\n${example.code}${example.code.endsWith("\n") ? "" : "\n"}${fence}`;
}

export function renderSnapshotMarkdown({
  snapshot,
  evidenceBaseUrl,
}: {
  snapshot: Snapshot;
  evidenceBaseUrl: string;
}): string {
  const { run, subject } = snapshot;
  const base = evidenceBaseUrl ? `${evidenceBaseUrl.replace(/\/$/, "")}/` : "";
  const lines = [
    "# Linter compatibility",
    "",
    subject.kind === "npm"
      ? `Measured **eslint-plugin-baseline-js ${markdown(subject.version)}** from npm.`
      : `Package not resolved. ${markdown(subject.reason)}`,
    `Run [${run.number}, attempt ${run.attempt}](https://github.com/${repository}/actions/runs/${run.id}/attempts/${run.attempt}) started ${run.startedAt}.`,
    "",
    "These cases use Baseline 2019. Results cover the code, configuration, and versions shown. They do not establish full compatibility.",
    "Expected result refers to each recorded example. ✅ means the host ran the check and returned the correct result. ❌ Unsupported means the check could not be verified. A false positive is a warning where none is expected.",
    "",
  ];
  const outcomeText = (profile: Profile, testCase: PublicCase, host: HostName): string => {
    const result = caseOutcome({
      testCase,
      observation: caseObservation({
        measurement: snapshot.profiles[profile],
        host,
        caseId: testCase.id,
      }),
    });
    return `${result.icon} ${result.label}`;
  };
  for (const profile of ["latest", "pinned"] as const) {
    const title = profile === "latest" ? "Latest toolchain" : "Pinned toolchain";
    if (profile === "pinned") lines.push("<details>", `<summary>${title}</summary>`, "");
    lines.push(`## ${title}`, "");
    const measurement = snapshot.profiles[profile];
    if (measurement.kind === "not-measured") {
      lines.push(`⚠️ Not measured. ${markdown(measurement.reason)}`, "");
    } else {
      lines.push(`Captured ${measurement.capturedAt}.`, "");
      lines.push(
        `${hosts
          .map((host) => {
            const result = measurement.hosts[host];
            return `${hostNames[host]} ${result.kind === "measured" ? markdown(result.packageVersion) : "not measured"}`;
          })
          .join(" · ")}.`,
        "",
      );
      for (const testCase of snapshot.cases) {
        if (testCase.suite !== "baseline") continue;
        lines.push(`### ${markdown(testCase.label)}`, "");
        if (testCase.example) lines.push(fencedExample(testCase.example), "");
        lines.push(
          markdown(expectedResultText(testCase.example)),
          "",
          "| ESLint | Oxlint | Bun |",
          "| --- | --- | --- |",
          `| ${hosts.map((host) => outcomeText(profile, testCase, host)).join(" | ")} |`,
          "",
        );
      }
      const hostCases = snapshot.cases.filter(({ suite }) => suite === "host");
      if (hostCases.length > 0) {
        lines.push(
          "<details>",
          "<summary>Host API checks</summary>",
          "",
          "| Host API | ESLint | Oxlint | Bun |",
          "| --- | --- | --- | --- |",
          ...hostCases.map(
            (testCase) =>
              `| ${markdown(testCase.label)} | ${hosts.map((host) => outcomeText(profile, testCase, host)).join(" | ")} |`,
          ),
          "",
          "</details>",
          "",
        );
      }
    }
    if (profile === "pinned") lines.push("</details>", "");
  }
  lines.push(
    "<details>",
    "<summary>Versions, evidence, and reproduction</summary>",
    "",
    `Harness commit [${run.commit}](https://github.com/${repository}/commit/${run.commit}).`,
    `[Snapshot JSON](${base}report.json).`,
    "A retry can reuse completed observations from the same workflow run. Capture dates and saved collection identities retain their origin.",
    "",
  );
  for (const profile of profiles) {
    const measurement = snapshot.profiles[profile];
    if (measurement.kind === "not-measured") continue;
    lines.push(
      `### ${profile} execution evidence`,
      "",
      `Parser ${markdown(measurement.parser)}. TypeScript ${markdown(measurement.typescript)}. [Collection identity](${base}${profile}/identity.json). [Execution report](${base}${profile}/report.json).`,
      "",
    );
    for (const host of hosts) {
      const result = measurement.hosts[host];
      lines.push(
        result.kind === "measured"
          ? `${hostNames[host]} package ${markdown(result.packageVersion)}, ${result.channel} channel. Executable ${markdown(result.reportedVersion)}.`
          : `${hostNames[host]} not measured. ${markdown(result.reason)}`,
      );
    }
    lines.push("", "| Case | Linter | Observation | Evidence |", "| --- | --- | --- | --- |");
    for (const testCase of snapshot.cases) {
      for (const host of hosts) {
        const row = caseObservation({ measurement, host, caseId: testCase.id });
        if (caseOutcome({ testCase, observation: row }).tone === "success") continue;
        const raw = `${base}${profile}/raw/${host}-${testCase.id}-inspect`;
        const observed = row?.kind === "observed";
        const detail = observed
          ? markdown(row.reason ?? "")
          : markdown(row?.reason ?? "No observation.");
        lines.push(
          `| ${markdown(testCase.label)} | ${hostNames[host]} | ${outcomeText(profile, testCase, host)}. ${detail} | ${observed ? `[stdout](${raw}.stdout), [stderr](${raw}.stderr)` : "No complete evidence"} |`,
        );
      }
    }
    lines.push("");
  }
  if (subject.kind === "npm") {
    lines.push(
      "### Reproduce the measurement",
      "",
      `[Exact npm package](${subject.tarball}), resolved ${subject.resolvedAt}. Integrity \`${subject.integrity}\`.`,
      `Check out harness commit \`${run.commit}\`. Use the Node version recorded in the execution report.`,
      `Save [subject.json](${base}subject/subject.json), [package.json](${base}subject/package.json), and [pnpm-lock.yaml](${base}subject/pnpm-lock.yaml) together in a subject directory.`,
      `Download the [exact npm package](${subject.tarball}) into that directory as \`subject.tgz\`. The collector checks its SHA-512 integrity before installation.`,
      "",
    );
    for (const profile of profiles) {
      if (snapshot.profiles[profile].kind === "not-measured") continue;
      lines.push(
        `Save the ${profile} [tool manifest](${base}${profile}/tools/package.json) and [tool lock](${base}${profile}/tools/pnpm-lock.yaml) together. Use the pnpm version in that manifest.`,
        "",
        "```sh",
        `CONFORMANCE_PROFILE=${profile} node conformance/run.ts --subject /path/to/subject --tools /path/to/${profile}/tools --out /path/to/reproduced/${profile}`,
        "```",
        "",
      );
    }
    lines.push(
      "The saved locks select the measured package versions. Evidence replaces known local paths with `<repository>`, `<profile>`, `<home>`, `<node>`, and `<artifact>`. File URLs retain their `file://` prefix. Other output remains unchanged. Execution hashes describe the original inputs. The Git commit identifies the published text.",
      "",
    );
  }
  lines.push("</details>", "");
  return `${lines.join("\n")}\n`;
}
