import "server-only";

import {
  type Manifest,
  parseManifest,
  parseSnapshot,
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

async function readJson(path: string): Promise<unknown> {
  const response = await fetch(`${reportOrigin()}/${path}`, {
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok)
    throw new Error(`Published report request failed with HTTP ${response.status}.`);
  return response.json();
}

export async function loadCompatibilitySnapshot(selection: SnapshotSelection): Promise<Snapshot> {
  const snapshot = parseSnapshot(await readJson(`${snapshotPath(selection)}/report.json`));
  if (snapshot.run.id !== selection.runId || snapshot.run.attempt !== selection.attempt) {
    throw new Error("The report does not match the selected workflow attempt.");
  }
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
