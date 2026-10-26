import "server-only";

import { createHash } from "node:crypto";
import {
  type Manifest,
  parseCaseExample,
  parseExampleEvidence,
  parseManifest,
  parseSnapshot,
  profiles,
  type Reference,
  reportBranch,
  repository,
  type Snapshot,
} from "@/lib/compatibility-report";

const rawOrigin = "https://raw.githubusercontent.com";
export const workflowUrl = `https://github.com/${repository}/actions/workflows/toolchain-capabilities.yml`;
export const reportUnavailableMessage =
  "The published report could not be loaded or validated. A first measurement may not have been published yet.";

export type SnapshotSelection = Pick<Reference, "commit" | "runId" | "attempt">;
export type CompatibilityReport =
  | {
      kind: "available";
      manifest: Manifest;
      snapshot: Snapshot;
      evidenceBaseUrl: string;
      markdownUrl: string;
    }
  | { kind: "unavailable"; reason: string };

function reportOrigin(): string {
  const origin = new URL(process.env.COMPATIBILITY_REPORT_ORIGIN ?? rawOrigin);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname);
  if (
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash ||
    (origin.protocol !== "https:" && !(origin.protocol === "http:" && local))
  ) {
    throw new Error("COMPATIBILITY_REPORT_ORIGIN must be an HTTPS origin or a local HTTP origin.");
  }
  return origin.origin;
}

function snapshotPath({ commit, runId, attempt }: SnapshotSelection): string {
  return `${repository}/${commit}/runs/${runId}/${attempt}`;
}

export function snapshotEvidenceUrl(selection: SnapshotSelection): string {
  return `${rawOrigin}/${snapshotPath(selection)}`;
}

async function readResponse(path: string): Promise<Response> {
  const response = await fetch(`${reportOrigin()}/${path}`, {
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok)
    throw new Error(`Published report request failed with HTTP ${response.status}.`);
  return response;
}

async function readJson(path: string): Promise<unknown> {
  return (await readResponse(path)).json();
}

export async function loadCompatibilitySnapshot(selection: SnapshotSelection): Promise<Snapshot> {
  const snapshot = parseSnapshot(await readJson(`${snapshotPath(selection)}/report.json`));
  if (snapshot.run.id !== selection.runId || snapshot.run.attempt !== selection.attempt) {
    throw new Error("The report does not match the selected workflow attempt.");
  }
  if (!snapshot.cases.some((testCase) => testCase.suite === "baseline" && !testCase.example)) {
    return snapshot;
  }
  const path = snapshotPath(selection);
  const evidence = await Promise.all(
    profiles.map(async (profile) => {
      if (snapshot.profiles[profile].kind === "not-measured") return { profile, input: null };
      try {
        return { profile, input: await readJson(`${path}/${profile}/report.json`) };
      } catch {
        return { profile, input: null };
      }
    }),
  );
  snapshot.cases = await Promise.all(
    snapshot.cases.map(async (testCase) => {
      if (testCase.suite !== "baseline" || testCase.example) return testCase;
      try {
        const examples = evidence.flatMap(({ profile, input }) => {
          const measurement = snapshot.profiles[profile];
          if (
            input === null ||
            measurement.kind === "not-measured" ||
            !Object.values(measurement.hosts).some(
              (host) => host.kind === "measured" && host.cases[testCase.id]?.kind === "observed",
            )
          ) {
            return [];
          }
          return [
            { profile, example: parseExampleEvidence({ input, snapshot, profile, testCase }) },
          ];
        });
        const first = examples[0];
        if (
          !first ||
          examples.some(({ example }) => JSON.stringify(example) !== JSON.stringify(first.example))
        ) {
          return testCase;
        }
        const response = await readResponse(
          `${path}/${first.profile}/work/${testCase.id}/input.${first.example.language}`,
        );
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (createHash("sha256").update(bytes).digest("hex") !== first.example.fixtureSha256) {
          return testCase;
        }
        const code = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
        return { ...testCase, example: parseCaseExample({ ...first.example, code }) };
      } catch {
        return testCase;
      }
    }),
  );
  return snapshot;
}

export async function loadCompatibilityReport(): Promise<CompatibilityReport> {
  try {
    const manifest = parseManifest(await readJson(`${repository}/${reportBranch}/latest.json`));
    const snapshot = await loadCompatibilitySnapshot(manifest.latest);
    if (snapshot.run.number !== manifest.latest.runNumber) {
      throw new Error("The report does not match the published workflow run.");
    }
    const query = new URLSearchParams({
      commit: manifest.latest.commit,
      run: manifest.latest.runId,
      attempt: String(manifest.latest.attempt),
    });
    return {
      kind: "available",
      manifest,
      snapshot,
      evidenceBaseUrl: snapshotEvidenceUrl(manifest.latest),
      markdownUrl: `/docs/raw/compatibility?${query}`,
    };
  } catch {
    return { kind: "unavailable", reason: reportUnavailableMessage };
  }
}
