export const repository = "3ru/eslint-plugin-baseline-js";
export const reportBranch = "toolchain-reports";
export const profiles = ["pinned", "latest"] as const;
export const hosts = ["eslint", "oxlint", "bun"] as const;
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

export interface PublicCase {
  id: string;
  label: string;
  suite: "host" | "baseline";
}

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
    return {
      id: string(testCase.id, "case.id", /^[a-z][a-z0-9-]*$/),
      label: string(testCase.label, "case.label"),
      suite: member(testCase.suite, ["host", "baseline"], "case.suite"),
    };
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
    `Run [${run.id}, attempt ${run.attempt}](https://github.com/${repository}/actions/runs/${run.id}/attempts/${run.attempt}) started ${run.startedAt}.`,
    `Harness commit [${run.commit}](https://github.com/${repository}/commit/${run.commit}).`,
    "",
    subject.kind === "npm"
      ? `Selected npm release **eslint-plugin-baseline-js ${markdown(subject.version)}**. [Exact package](${subject.tarball}) resolved ${subject.resolvedAt}. Integrity \`${subject.integrity}\`.`
      : `Package not resolved. ${markdown(subject.reason)}`,
    "",
    "These fixtures measure specific plugin and host behavior. An expected unsupported result is still unsupported. Expected result describes the harness expectation, not full compatibility.",
    "",
    "A retry can reuse completed observations from earlier attempts of the same workflow run. Each profile's capture date and collection identity retain the original provenance.",
    "",
  ];
  for (const profile of profiles) {
    const measurement = snapshot.profiles[profile];
    lines.push(`## ${profile}`, "");
    if (measurement.kind === "not-measured") {
      lines.push(`Not measured. ${markdown(measurement.reason)}`, "");
      continue;
    }
    const evidence = `${base}${profile}/report.json`;
    lines.push(
      `Captured ${measurement.capturedAt}. Parser ${markdown(measurement.parser)}. TypeScript ${markdown(measurement.typescript)}. [Collection identity](${base}${profile}/identity.json).`,
      "",
    );
    for (const host of hosts) {
      const result = measurement.hosts[host];
      lines.push(`### ${host}`, "");
      if (result.kind === "not-measured") {
        lines.push(`Not measured. ${markdown(result.reason)}`, "");
        continue;
      }
      lines.push(
        `Package ${markdown(result.packageVersion)}, ${result.channel} channel. Reported version ${markdown(result.reportedVersion)}. [Execution evidence](${evidence}).`,
        "",
        "| Case | Capability | Correctness | Status | Expected result | Reason | Evidence |",
        "| --- | --- | --- | --- | --- | --- | --- |",
      );
      for (const testCase of snapshot.cases) {
        const row = result.cases[testCase.id];
        if (!row || row.kind === "not-measured") {
          lines.push(
            `| ${markdown(testCase.label)} | Not measured | Not assessed | Not measured | Not assessed | ${markdown(row?.reason ?? "No observation.")} | |`,
          );
        } else {
          const raw = `${base}${profile}/raw/${host}-${testCase.id}-inspect`;
          lines.push(
            `| ${markdown(testCase.label)} | ${row.capability} | ${row.correctness} | ${statusText[row.status]} | ${row.expectationMatched ? "Yes" : "No"} | ${markdown(row.reason ?? "")} | [stdout](${raw}.stdout), [stderr](${raw}.stderr) |`,
          );
        }
      }
      lines.push("");
    }
  }
  if (subject.kind === "npm") {
    lines.push(
      "## Reproduce the measurement",
      "",
      `Check out harness commit \`${run.commit}\`. Use the Node version recorded in the profile's execution evidence.`,
      "",
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
  return `${lines.join("\n")}\n`;
}
