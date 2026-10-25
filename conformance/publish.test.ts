import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { type TestContext, test } from "node:test";
import { pathToFileURL } from "node:url";
import {
  hosts,
  type NpmSubject,
  type Profile,
  type ProfileMeasurement,
  parseManifest,
  parseSnapshot,
  profiles,
  type RunIdentity,
} from "../docs/website/lib/compatibility-report.ts";
import { cases } from "./cases.ts";
import { type PublishOptions, publish } from "./publish.ts";

const subject: NpmSubject = {
  kind: "npm",
  version: "0.7.5",
  tarball:
    "https://registry.npmjs.org/eslint-plugin-baseline-js/-/eslint-plugin-baseline-js-0.7.5.tgz",
  integrity: `sha512-${Buffer.alloc(64).toString("base64")}`,
  resolvedAt: "2026-10-25T00:00:00.000Z",
};
const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
const git = (directory: string, ...args: string[]): string =>
  execFileSync("git", ["-C", directory, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trimEnd();

function measurement(profile: Profile): ProfileMeasurement {
  const host = (name: (typeof hosts)[number]) => ({
    kind: "measured" as const,
    packageVersion: "1.0.0",
    reportedVersion: "1.0.0",
    channel: name === "bun" ? ("canary" as const) : profile,
    cases: Object.fromEntries(
      cases.map(({ id, check }) => [
        id,
        {
          kind: "observed" as const,
          capability:
            check === "types" && name !== "eslint"
              ? ("unavailable" as const)
              : ("supported" as const),
          correctness:
            check === "types" && name !== "eslint"
              ? ("not-verified" as const)
              : ("matched" as const),
          status:
            check === "types" && name !== "eslint"
              ? ("unsupported" as const)
              : ("matched" as const),
          expectationMatched: true,
          reason: null,
        },
      ]),
    ),
  });
  return {
    kind: "measured",
    capturedAt: "2026-10-25T00:01:00.000Z",
    parser: "8.72.0",
    typescript: "6.0.3",
    hosts: { eslint: host("eslint"), oxlint: host("oxlint"), bun: host("bun") },
  };
}

function jobRecords(input: PublishOptions) {
  return [
    { name: "Resolve released plugin", source: input.sources.prepare },
    ...profiles.map((profile) => ({
      name: `Measure (${profile})`,
      source: input.sources.profiles[profile],
    })),
  ].flatMap(({ name, source }) =>
    source
      ? [
          {
            run_id: Number(input.run.id),
            run_attempt: source.attempt,
            name,
            conclusion: source.conclusion,
          },
        ]
      : [],
  );
}

async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "publication-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const remote = join(directory, "remote.git");
  const caller = join(directory, "caller");
  await mkdir(remote);
  await mkdir(caller);
  git(remote, "init", "--bare", "--quiet");
  git(caller, "init", "--quiet");
  git(caller, "config", "user.name", "Test");
  git(caller, "config", "user.email", "test@example.test");
  git(caller, "remote", "add", "origin", remote);
  await writeFile(join(caller, "source.txt"), "Keep the caller checkout.\n");
  git(caller, "add", "source.txt");
  git(caller, "commit", "--quiet", "-m", "Initial source");
  const sourceCommit = git(caller, "rev-parse", "HEAD");
  const input = async (number: number, attempt = 1): Promise<PublishOptions> => {
    const inputDirectory = join(directory, `input-${number}-${attempt}`);
    const run: RunIdentity = {
      repository: "3ru/eslint-plugin-baseline-js",
      id: `${100 + number}`,
      number,
      attempt,
      commit: sourceCommit,
      startedAt: "2026-10-25T00:00:00.000Z",
    };
    await mkdir(join(inputDirectory, "subject"), { recursive: true });
    await writeFile(join(inputDirectory, "context.json"), json(run));
    await writeFile(join(inputDirectory, "subject", "subject.json"), json(subject));
    await writeFile(
      join(inputDirectory, "subject", "package.json"),
      json({ dependencies: { "eslint-plugin-baseline-js": "file:subject.tgz" } }),
    );
    await writeFile(join(inputDirectory, "subject", "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    await writeFile(join(inputDirectory, "subject", "subject.tgz"), Buffer.from([0, 1, 255]));
    for (const profile of profiles) {
      await mkdir(join(inputDirectory, profile, "raw"), { recursive: true });
      await mkdir(join(inputDirectory, profile, "tools"), { recursive: true });
      await writeFile(
        join(inputDirectory, profile, "tools/package.json"),
        json({ packageManager: "pnpm@10.34.5" }),
      );
      await writeFile(
        join(inputDirectory, profile, "tools/pnpm-lock.yaml"),
        "lockfileVersion: '9.0'\n",
      );
      await writeFile(
        join(inputDirectory, profile, "identity.json"),
        json({
          run,
          profile,
          subject,
          paths: {
            repository: caller,
            output: join(inputDirectory, profile),
            home: homedir(),
            node: process.execPath,
          },
        }),
      );
      await writeFile(join(inputDirectory, profile, "profile.json"), json(measurement(profile)));
      await writeFile(
        join(inputDirectory, profile, "report.json"),
        json({ profile, source: { commit: sourceCommit }, results: [] }),
      );
      for (const host of hosts) {
        for (const { id } of cases) {
          await writeFile(
            join(inputDirectory, profile, "raw", `${host}-${id}-inspect.stdout`),
            "[]\n",
          );
          await writeFile(join(inputDirectory, profile, "raw", `${host}-${id}-inspect.stderr`), "");
        }
      }
    }
    return {
      inputDirectory,
      repositoryDirectory: caller,
      run,
      sources: {
        prepare: { attempt, conclusion: "success" },
        profiles: {
          pinned: { attempt, conclusion: "success" },
          latest: { attempt, conclusion: "success" },
        },
      },
    };
  };
  const manifest = () =>
    parseManifest(JSON.parse(git(remote, "show", "toolchain-reports:latest.json")));
  const readSnapshot = (commit: string, run: RunIdentity) =>
    parseSnapshot(
      JSON.parse(git(remote, "show", `${commit}:runs/${run.id}/${run.attempt}/report.json`)),
    );
  const cli = async (input: PublishOptions, jobs: unknown = jobRecords(input)) => {
    const context = join(directory, `publication-${input.run.number}-${input.run.attempt}.json`);
    const trustedJobs = join(directory, `jobs-${input.run.number}-${input.run.attempt}.json`);
    await writeFile(context, json(input.run));
    await writeFile(trustedJobs, json(jobs));
    return execFileSync(
      process.execPath,
      [
        new URL("./publish.ts", import.meta.url).pathname,
        "--input",
        input.inputDirectory,
        "--context",
        context,
        "--jobs",
        trustedJobs,
      ],
      { cwd: caller, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
  };
  return { directory, remote, caller, sourceCommit, input, manifest, readSnapshot, cli };
}

test("publishes an immutable paired snapshot and reuses an identical attempt through the caller origin", async (t) => {
  const f = await fixture(t);
  const input = await f.input(1);
  const result = await publish(input);
  assert.equal(result.published, true);
  assert.equal(f.manifest().latest.commit, result.snapshotCommit);
  assert.equal(f.manifest().lastComplete?.commit, result.snapshotCommit);
  assert.equal(git(f.remote, "rev-parse", "toolchain-reports^"), result.snapshotCommit);
  const reader = join(f.directory, "reader");
  git(f.directory, "clone", "--quiet", "--branch", "toolchain-reports", f.remote, reader);
  assert.equal(
    JSON.parse(await readFile(join(reader, "latest.json"), "utf8")).latest.commit,
    result.snapshotCommit,
  );
  assert.equal(
    JSON.parse(git(reader, "show", `${result.snapshotCommit}:runs/101/1/report.json`)).profiles
      .latest.kind,
    "measured",
  );
  const snapshot = f.readSnapshot(result.snapshotCommit, input.run);
  assert.equal(snapshot.profiles.pinned.kind, "measured");
  assert.equal(snapshot.profiles.latest.kind, "measured");
  assert.equal(
    git(
      f.remote,
      "show",
      `${result.snapshotCommit}:runs/101/1/pinned/raw/eslint-host-plugin-options-inspect.stdout`,
    ),
    "[]",
  );
  const paths = git(f.remote, "ls-tree", "-r", "--name-only", "toolchain-reports");
  assert.doesNotMatch(paths, /subject\.tgz|node_modules|source\.txt/);
  assert.deepEqual(
    JSON.parse(git(f.remote, "show", "toolchain-reports:docs/website/vercel.json")),
    { git: { deploymentEnabled: false } },
  );
  assert.equal(git(f.caller, "rev-parse", "HEAD"), f.sourceCommit);
  assert.equal(git(f.caller, "status", "--porcelain"), "");
  const originalHead = git(f.remote, "rev-parse", "toolchain-reports");
  const replay = await publish(input);
  assert.equal(replay.published, false);
  assert.equal(replay.snapshotCommit, result.snapshotCommit);
  assert.equal(git(f.remote, "rev-parse", "toolchain-reports"), originalHead);
  const evidence = join(
    input.inputDirectory,
    "pinned/raw/eslint-host-plugin-options-inspect.stdout",
  );
  await rm(evidence);
  await assert.rejects(publish(input), /already published with different content/);
  await writeFile(evidence, "changed\n");
  await assert.rejects(publish(input), /already published with different content/);
  assert.equal(git(f.remote, "rev-parse", "toolchain-reports"), originalHead);
});

test("publishes newer failure and partial results without rolling the latest pointer back for an older rerun", async (t) => {
  const f = await fixture(t);
  const first = await publish(await f.input(1));
  const failure = await f.input(3);
  await rm(join(failure.inputDirectory, "latest"), { recursive: true });
  failure.sources.profiles.latest = { attempt: 1, conclusion: "failure" };
  const failed = await publish(failure);
  assert.equal(f.manifest().latest.commit, failed.snapshotCommit);
  assert.equal(f.manifest().lastComplete?.commit, first.snapshotCommit);
  const snapshot = f.readSnapshot(failed.snapshotCommit, failure.run);
  assert.equal(snapshot.profiles.pinned.kind, "measured");
  assert.equal(snapshot.profiles.latest.kind, "not-measured");
  if (snapshot.profiles.latest.kind === "not-measured")
    assert.match(snapshot.profiles.latest.reason, /Collector job conclusion was failure/);
  const olderRerun = await publish(await f.input(1, 2));
  assert.equal(f.manifest().latest.commit, failed.snapshotCommit);
  assert.equal(f.manifest().lastComplete?.commit, olderRerun.snapshotCommit);
  assert.equal(
    f.readSnapshot(olderRerun.snapshotCommit, { ...failure.run, id: "101", attempt: 2 }).run.number,
    1,
  );
});

test("complete observations can disagree with expectations; unknown or interrupted cases are incomplete", async (t) => {
  const f = await fixture(t);
  const unexpected = await f.input(1);
  const value = measurement("pinned");
  if (value.kind === "measured" && value.hosts.eslint.kind === "measured") {
    value.hosts.eslint.cases["host-plugin-options"] = {
      kind: "observed",
      capability: "supported",
      correctness: "mismatch",
      status: "mismatch",
      expectationMatched: false,
      reason: "Unexpected option value.",
    };
  }
  await writeFile(join(unexpected.inputDirectory, "pinned/profile.json"), json(value));
  const complete = await publish(unexpected);
  assert.equal(f.manifest().lastComplete?.commit, complete.snapshotCommit);
  const interrupted = await f.input(2);
  interrupted.sources.profiles.pinned = { attempt: 1, conclusion: "failure" };
  if (value.kind === "measured" && value.hosts.eslint.kind === "measured") {
    value.hosts.eslint.cases["host-plugin-options"] = {
      kind: "not-measured",
      reason: "Interrupted.",
    };
  }
  await writeFile(join(interrupted.inputDirectory, "pinned/profile.json"), json(value));
  const partial = await publish(interrupted);
  assert.equal(f.manifest().latest.commit, partial.snapshotCommit);
  assert.equal(f.manifest().lastComplete?.commit, complete.snapshotCommit);
  const parsed = f.readSnapshot(partial.snapshotCommit, interrupted.run);
  assert.equal(parsed.profiles.pinned.kind, "measured");
  const absent = await f.input(3);
  await rm(join(absent.inputDirectory, "pinned/raw/eslint-host-plugin-options-inspect.stdout"));
  const absentResult = await publish(absent);
  const absentSnapshot = f.readSnapshot(absentResult.snapshotCommit, absent.run);
  const pinned = absentSnapshot.profiles.pinned;
  assert.equal(pinned.kind, "measured");
  if (pinned.kind === "measured" && pinned.hosts.eslint.kind === "measured") {
    assert.equal(pinned.hosts.eslint.cases["host-plugin-options"]?.kind, "not-measured");
    assert.equal(pinned.hosts.eslint.cases["host-ast-selector"]?.kind, "observed");
  }
  assert.equal(f.manifest().lastComplete?.commit, complete.snapshotCommit);
  for (const [index, status] of ["unknown", "execution-error"].entries()) {
    const unknown = await f.input(4 + index);
    const observed = measurement("pinned");
    if (observed.kind === "measured" && observed.hosts.eslint.kind === "measured") {
      observed.hosts.eslint.cases["host-plugin-options"] = {
        kind: "observed",
        capability: "unknown",
        correctness: "not-assessed",
        status: status === "unknown" ? "unknown" : "execution-error",
        expectationMatched: false,
        reason: "The host did not complete the check.",
      };
    }
    await writeFile(join(unknown.inputDirectory, "pinned/profile.json"), json(observed));
    await publish(unknown);
    assert.equal(f.manifest().lastComplete?.commit, complete.snapshotCommit);
  }
});

test("a failed new prepare invalidates leftover subject and collector artifacts", async (t) => {
  const f = await fixture(t);
  const input = await f.input(1);
  const first = await publish(input);
  const retry = {
    ...input,
    run: { ...input.run, attempt: 2 },
    sources: {
      prepare: { attempt: 2, conclusion: "failure" },
      profiles: {
        pinned: { attempt: 2, conclusion: "skipped" },
        latest: { attempt: 2, conclusion: "skipped" },
      },
    },
  };
  const result = await publish(retry);
  const snapshot = f.readSnapshot(result.snapshotCommit, retry.run);
  assert.equal(snapshot.subject.kind, "unresolved");
  assert.equal(snapshot.profiles.pinned.kind, "not-measured");
  assert.equal(snapshot.profiles.latest.kind, "not-measured");
  if (snapshot.profiles.latest.kind === "not-measured")
    assert.match(snapshot.profiles.latest.reason, /prepare job concluded failure/);
  assert.equal(f.manifest().lastComplete?.commit, first.snapshotCommit);
  assert.equal(git(f.remote, "ls-tree", result.snapshotCommit, "runs/101/2/subject"), "");
  assert.match(
    await f.cli(retry, [...jobRecords(input), ...jobRecords(retry)]),
    /^Already published/,
  );
});

test("a failed new collector cannot reuse its old artifact while a collector not rerun remains valid", async (t) => {
  const f = await fixture(t);
  const input = await f.input(1);
  const first = await publish(input);
  const retry = {
    ...input,
    run: { ...input.run, attempt: 2 },
    sources: {
      prepare: { attempt: 1, conclusion: "success" },
      profiles: {
        pinned: { attempt: 1, conclusion: "success" },
        latest: { attempt: 2, conclusion: "failure" },
      },
    },
  };
  const result = await publish(retry);
  const snapshot = f.readSnapshot(result.snapshotCommit, retry.run);
  assert.equal(snapshot.subject.kind, "npm");
  assert.equal(snapshot.profiles.pinned.kind, "measured");
  assert.equal(snapshot.profiles.latest.kind, "not-measured");
  if (snapshot.profiles.latest.kind === "not-measured")
    assert.match(snapshot.profiles.latest.reason, /Collector job conclusion was failure/);
  assert.equal(f.manifest().lastComplete?.commit, first.snapshotCommit);
  assert.equal(git(f.remote, "ls-tree", result.snapshotCommit, "runs/101/2/latest"), "");
  assert.match(
    await f.cli(retry, [...jobRecords(input), ...jobRecords(retry)]),
    /^Already published/,
  );
});

test("a retry reuses earlier observations from the same logical run without changing their identity or date", async (t) => {
  const f = await fixture(t);
  const input = await f.input(1);
  await publish(input);
  const retry = {
    ...input,
    run: { ...input.run, attempt: 2, startedAt: "2026-10-26T00:00:00.000Z" },
  };
  const result = await publish(retry);
  const snapshot = f.readSnapshot(result.snapshotCommit, retry.run);
  assert.equal(snapshot.run.attempt, 2);
  for (const profile of profiles) {
    assert.equal(snapshot.profiles[profile].kind, "measured");
    const identity = JSON.parse(
      git(f.remote, "show", `${result.snapshotCommit}:runs/101/2/${profile}/identity.json`),
    );
    assert.equal(identity.run.attempt, 1);
    assert.equal(identity.run.startedAt, input.run.startedAt);
  }
  assert.equal(f.manifest().latest.capturedAt, "2026-10-25T00:01:00.000Z");
  assert.equal(f.manifest().lastComplete?.commit, result.snapshotCommit);
  const preparedContext = JSON.parse(
    git(f.remote, "show", `${result.snapshotCommit}:runs/101/2/subject/context.json`),
  );
  assert.deepEqual(preparedContext, input.run);
  const jobs = jobRecords(input);
  assert.match(
    await f.cli(retry, [
      ...jobs.map((job) => ({ ...job, run_attempt: 3 })),
      ...jobs.map((job) => ({ ...job, run_id: 999 })),
      {
        run_id: Number(input.run.id),
        run_attempt: 2,
        name: "Publish compatibility snapshot",
        conclusion: null,
      },
      ...jobs,
    ]),
    /^Already published/,
  );
  assert.equal(f.manifest().latest.capturedAt, "2026-10-25T00:01:00.000Z");
  const identityPath = join(input.inputDirectory, "pinned/identity.json");
  const future = JSON.parse(await readFile(identityPath, "utf8"));
  future.run.attempt = 4;
  await writeFile(identityPath, json(future));
  const next = { ...input, run: { ...input.run, attempt: 3 } };
  const rejected = await publish(next);
  const rejectedSnapshot = f.readSnapshot(rejected.snapshotCommit, next.run);
  assert.equal(rejectedSnapshot.profiles.pinned.kind, "not-measured");
  assert.equal(rejectedSnapshot.profiles.latest.kind, "measured");
  if (rejectedSnapshot.profiles.pinned.kind === "not-measured")
    assert.match(rejectedSnapshot.profiles.pinned.reason, /identity does not match/);
});

test("prepared input must match the exact successful prepare execution", async (t) => {
  const f = await fixture(t);
  const mutations = [
    async (input: PublishOptions) => rm(join(input.inputDirectory, "context.json")),
    async (input: PublishOptions) => {
      input.run = { ...input.run, attempt: 2 };
      input.sources.prepare = { attempt: 2, conclusion: "success" };
    },
    async (input: PublishOptions) =>
      writeFile(join(input.inputDirectory, "context.json"), json({ ...input.run, id: "999" })),
  ];
  for (const [index, mutate] of mutations.entries()) {
    const input = await f.input(index + 1);
    await mutate(input);
    const result = await publish(input);
    const snapshot = f.readSnapshot(result.snapshotCommit, input.run);
    assert.equal(snapshot.subject.kind, "unresolved");
    assert.equal(snapshot.profiles.pinned.kind, "not-measured");
    assert.equal(snapshot.profiles.latest.kind, "not-measured");
    assert.equal(f.manifest().lastComplete, null);
  }
});

test("missing or skipped trusted jobs cannot certify artifacts left on disk", async (t) => {
  const f = await fixture(t);
  for (const [index, source] of [null, { attempt: 1, conclusion: "skipped" }].entries()) {
    const input = await f.input(index + 1);
    input.sources.profiles.latest = source;
    await f.cli(input);
    const snapshot = f.readSnapshot(f.manifest().latest.commit, input.run);
    assert.equal(snapshot.subject.kind, "npm");
    assert.equal(snapshot.profiles.pinned.kind, "measured");
    assert.equal(snapshot.profiles.latest.kind, "not-measured");
    assert.equal(f.manifest().lastComplete, null);
  }
  const input = await f.input(3);
  await f.cli(
    input,
    jobRecords(input).map((job) => ({ ...job, name: "Unknown producer" })),
  );
  const snapshot = f.readSnapshot(f.manifest().latest.commit, input.run);
  assert.equal(snapshot.subject.kind, "unresolved");
  assert.equal(snapshot.profiles.pinned.kind, "not-measured");
  assert.equal(snapshot.profiles.latest.kind, "not-measured");
  assert.equal(f.manifest().lastComplete, null);
});

test("malformed, mismatched, linked, binary, and oversized artifacts become explicit profile failures", async (t) => {
  const f = await fixture(t);
  const changes = [
    async (input: PublishOptions) =>
      writeFile(join(input.inputDirectory, "pinned/profile.json"), "{bad"),
    async (input: PublishOptions) => {
      const path = join(input.inputDirectory, "pinned/identity.json");
      const identity = JSON.parse(await readFile(path, "utf8"));
      identity.run.id = "999";
      await writeFile(path, json(identity));
    },
    async (input: PublishOptions) =>
      symlink(
        join(input.inputDirectory, "subject/subject.json"),
        join(input.inputDirectory, "pinned/raw/linked.stdout"),
      ),
    async (input: PublishOptions) =>
      writeFile(join(input.inputDirectory, "pinned/raw/binary.stdout"), Buffer.from([0, 1, 2])),
    async (input: PublishOptions) =>
      writeFile(
        join(input.inputDirectory, "pinned/raw/oversized.stdout"),
        "x".repeat(2 * 1024 * 1024 + 1),
      ),
  ];
  for (const [index, change] of changes.entries()) {
    const input = await f.input(index + 1);
    await change(input);
    const result = await publish(input);
    const snapshot = f.readSnapshot(result.snapshotCommit, input.run);
    assert.equal(snapshot.profiles.pinned.kind, "not-measured");
    assert.equal(snapshot.profiles.latest.kind, "measured");
    if (snapshot.profiles.pinned.kind === "not-measured")
      assert.match(snapshot.profiles.pinned.reason, /artifact was rejected/);
    assert.equal(
      git(f.remote, "ls-tree", result.snapshotCommit, `runs/${input.run.id}/1/pinned`),
      "",
    );
  }
  const linked = await f.input(changes.length + 1);
  const outside = join(f.directory, "outside-subject");
  await rename(join(linked.inputDirectory, "subject"), outside);
  await symlink(outside, join(linked.inputDirectory, "subject"));
  const result = await publish(linked);
  const snapshot = f.readSnapshot(result.snapshotCommit, linked.run);
  assert.equal(snapshot.subject.kind, "unresolved");
  assert.equal(snapshot.profiles.latest.kind, "not-measured");
  assert.equal(snapshot.profiles.pinned.kind, "not-measured");
});

test("concurrent ordinary pushes retain both runs and the newer pointer", async (t) => {
  const f = await fixture(t);
  await writeFile(
    join(f.remote, "hooks/pre-receive"),
    `#!${process.execPath}
const fs = require("node:fs");
fs.appendFileSync("push-attempts", process.pid + "\\n");
if (!fs.existsSync("push-barrier-done")) {
  fs.writeFileSync("push-barrier-" + process.pid, "");
  const deadline = Date.now() + 10000;
  while (fs.readdirSync(".").filter(name => /^push-barrier-\\d+$/.test(name)).length < 2) {
    if (Date.now() > deadline) process.exit(1);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
  }
  fs.writeFileSync("push-barrier-done", "");
}
`,
    { mode: 0o755 },
  );
  const inputs = await Promise.all([f.input(1), f.input(2)]);
  const results = await Promise.all(inputs.map((input) => publish(input)));
  assert.equal(f.manifest().latest.runNumber, 2);
  assert.equal(f.manifest().lastComplete?.runNumber, 2);
  for (const result of results) assert.equal(result.published, true);
  for (const input of inputs)
    assert.match(
      git(f.remote, "show", `toolchain-reports:runs/${input.run.id}/1/report.json`),
      /"schemaVersion": 1/,
    );
  assert.equal(git(f.remote, "rev-list", "--count", "toolchain-reports"), "4");
  assert.equal(
    (await readFile(join(f.remote, "push-attempts"), "utf8")).trim().split("\n").length,
    3,
  );
});

test("published evidence removes known local paths and preserves diagnostics and execution hashes", async (t) => {
  const f = await fixture(t);
  const input = await f.input(1);
  const localFile = join(input.inputDirectory, "pinned/work/host-plugin-options/input.js");
  const raw = {
    filePath: localFile,
    importUrl: pathToFileURL(localFile).href,
    message: "Expected marker was not reported.",
    configSha256: "a".repeat(64),
  };
  await writeFile(
    join(input.inputDirectory, "pinned/raw/eslint-host-plugin-options-inspect.stdout"),
    json(raw),
  );
  const profile = measurement("pinned");
  if (profile.kind === "measured" && profile.hosts.eslint.kind === "measured") {
    profile.hosts.eslint.cases["host-plugin-options"] = {
      kind: "observed",
      capability: "supported",
      correctness: "missing",
      status: "coverage-loss",
      expectationMatched: false,
      reason: `No marker in ${localFile}.`,
    };
  }
  await writeFile(join(input.inputDirectory, "pinned/profile.json"), json(profile));
  const result = await publish(input);
  const published = JSON.parse(
    git(
      f.remote,
      "show",
      `${result.snapshotCommit}:runs/101/1/pinned/raw/eslint-host-plugin-options-inspect.stdout`,
    ),
  );
  assert.equal(published.filePath, "<profile>/work/host-plugin-options/input.js");
  assert.equal(published.importUrl, "file://<profile>/work/host-plugin-options/input.js");
  assert.equal(published.message, raw.message);
  assert.equal(published.configSha256, raw.configSha256);
  assert.throws(
    () => git(f.remote, "grep", "-F", f.directory, result.snapshotCommit),
    (error: unknown) => error instanceof Error && "status" in error && error.status === 1,
  );
  const snapshot = f.readSnapshot(result.snapshotCommit, input.run);
  if (
    snapshot.profiles.pinned.kind === "measured" &&
    snapshot.profiles.pinned.hosts.eslint.kind === "measured"
  ) {
    assert.equal(
      snapshot.profiles.pinned.hosts.eslint.cases["host-plugin-options"]?.reason,
      "No marker in <profile>/work/host-plugin-options/input.js.",
    );
  }
});

test("the paired text limit includes generated JSON and Markdown", async (t) => {
  const f = await fixture(t);
  const input = await f.input(1);
  await writeFile(join(input.inputDirectory, "pinned/raw/padding.stdout"), "x".repeat(2_040_000));
  const result = await publish(input);
  const snapshot = f.readSnapshot(result.snapshotCommit, input.run);
  assert.ok(profiles.some((profile) => snapshot.profiles[profile].kind === "not-measured"));
  const bytes = git(f.remote, "ls-tree", "-r", "-l", result.snapshotCommit, "runs/101/1")
    .split("\n")
    .reduce((total, line) => total + Number(line.trim().split(/\s+/)[3]), 0);
  assert.ok(bytes <= 2 * 1024 * 1024);
});

test("the CLI publishes against a local origin and reports invalid arguments without changing the remote", async (t) => {
  const f = await fixture(t);
  const input = await f.input(1);
  const script = new URL("./publish.ts", import.meta.url);
  const output = await f.cli(input);
  assert.match(output, /^Published [0-9a-f]{40}/);
  assert.equal(f.manifest().latest.runId, input.run.id);
  const head = git(f.remote, "rev-parse", "toolchain-reports");
  for (const args of [
    [],
    ["--input", input.inputDirectory, "--context", join(f.directory, "publication-1-1.json")],
  ]) {
    assert.throws(
      () =>
        execFileSync(process.execPath, [script.pathname, ...args], {
          cwd: f.caller,
          stdio: ["ignore", "pipe", "pipe"],
        }),
      /--jobs TRUSTED_JOBS_JSON/,
    );
  }
  await assert.rejects(f.cli(input, { jobs: jobRecords(input) }), /JSON array/);
  await assert.rejects(
    f.cli(input, [
      {
        run_id: Number(input.run.id),
        name: "Resolve released plugin",
        run_attempt: 0,
        conclusion: "success",
      },
    ]),
    /invalid run_attempt/,
  );
  assert.equal(git(f.remote, "rev-parse", "toolchain-reports"), head);
  assert.equal(await readFile(join(f.caller, "source.txt"), "utf8"), "Keep the caller checkout.\n");
});
