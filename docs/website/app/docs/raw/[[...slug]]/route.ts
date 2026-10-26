import { notFound } from "next/navigation";
import {
  loadCompatibilityReport,
  loadCompatibilitySnapshot,
  reportUnavailableMessage,
  snapshotEvidenceUrl,
} from "@/lib/compatibility";
import { renderSnapshotMarkdown, type Snapshot } from "@/lib/compatibility-report";
import { source } from "@/lib/source";

export async function GET(request: Request, { params }: { params: Promise<{ slug?: string[] }> }) {
  const { slug = [] } = await params;
  const page = source.getPage(slug);
  if (!page) notFound();

  if (slug.length === 1 && slug[0] === "compatibility") {
    const query = new URL(request.url).searchParams;
    const commit = query.get("commit");
    const runId = query.get("run");
    const attemptText = query.get("attempt");
    const selected = commit !== null || runId !== null || attemptText !== null;
    const headers = { "Content-Type": "text/markdown; charset=utf-8", "Cache-Control": "no-store" };
    try {
      let snapshot: Snapshot;
      let evidenceBaseUrl: string;
      if (selected) {
        const attempt = Number(attemptText);
        if (
          !commit ||
          !/^[0-9a-f]{40}$/.test(commit) ||
          !runId ||
          !/^[1-9]\d*$/.test(runId) ||
          !attemptText ||
          !/^[1-9]\d*$/.test(attemptText) ||
          !Number.isSafeInteger(attempt)
        ) {
          return new Response(
            "A fixed commit, workflow run, and positive attempt are required.\n",
            { status: 400, headers },
          );
        }
        const selection = { commit, runId, attempt };
        snapshot = await loadCompatibilitySnapshot(selection);
        evidenceBaseUrl = snapshotEvidenceUrl(selection);
      } else {
        const report = await loadCompatibilityReport();
        if (report.kind === "unavailable") {
          return new Response(`${report.reason}\n`, { status: 503, headers });
        }
        snapshot = report.snapshot;
        evidenceBaseUrl = report.evidenceBaseUrl;
      }
      const markdown = `${await page.data.getText("processed")}\n\n${renderSnapshotMarkdown({ snapshot, evidenceBaseUrl })}`;
      return new Response(markdown, { headers });
    } catch {
      return new Response(`${reportUnavailableMessage}\n`, { status: 503, headers });
    }
  }

  const markdown = [
    `# ${page.data.title}`,
    page.data.description,
    await page.data.getText("processed"),
  ]
    .filter(Boolean)
    .join("\n\n");

  return new Response(markdown, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
