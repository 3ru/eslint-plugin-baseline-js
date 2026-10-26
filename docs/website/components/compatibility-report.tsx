import type { CompatibilityReport as Report } from "@/lib/compatibility";
import { snapshotEvidenceUrl, workflowUrl } from "@/lib/compatibility";
import {
  type HostMeasurement,
  type HostName,
  hosts,
  type Profile,
  type PublicCase,
  profiles,
  repository,
  statusText,
} from "@/lib/compatibility-report";

const hostNames = { eslint: "ESLint", oxlint: "Oxlint", bun: "Bun" } satisfies Record<
  HostName,
  string
>;
const maxAgeMs = 8 * 24 * 60 * 60 * 1000;
const scrollClass =
  "max-w-full overflow-auto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fd-primary";

function timestamp(value: string) {
  return (
    <time dateTime={value}>
      {new Date(value)
        .toISOString()
        .replace("T", " ")
        .replace(/\.\d{3}Z$/, " UTC")}
    </time>
  );
}

function observations(measurement: HostMeasurement): string {
  if (measurement.kind === "not-measured") return `Not measured. ${measurement.reason}`;
  const counts = new Map<string, number>();
  for (const result of Object.values(measurement.cases)) {
    const label = result.kind === "not-measured" ? "Not measured" : statusText[result.status];
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const unexpected = Object.values(measurement.cases).filter(
    (result) => result.kind === "observed" && !result.expectationMatched,
  ).length;
  const summary = Array.from(counts, ([label, count]) => `${count} ${label}`).join(", ");
  return unexpected ? `${summary}. ${unexpected} unexpected.` : summary;
}

function CaseResults({
  profile,
  host,
  measurement,
  cases,
  evidenceBaseUrl,
}: {
  profile: Profile;
  host: HostName;
  measurement: Extract<HostMeasurement, { kind: "measured" }>;
  cases: PublicCase[];
  evidenceBaseUrl: string;
}) {
  const captionId = `${profile}-${host}-cases`;
  return (
    <details className="my-4 rounded-lg border px-4">
      <summary className="cursor-pointer py-3 focus-visible:outline-2 focus-visible:outline-offset-2">
        {hostNames[host]} case results and evidence
      </summary>
      {/* biome-ignore lint/a11y/noNoninteractiveTabindex: Focus enables keyboard scrolling. https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/overflow#accessibility */}
      <section aria-labelledby={captionId} tabIndex={0} className={`${scrollClass} max-h-[32rem]`}>
        <table className="min-w-[40rem]">
          <caption id={captionId} className="text-start font-medium">
            {profile} toolchain, {hostNames[host]} case observations
          </caption>
          <thead className="sticky top-0 z-10 bg-fd-background">
            <tr>
              <th scope="col">Case</th>
              <th scope="col">Observed result</th>
              <th scope="col">Matches expectation</th>
              <th scope="col">Evidence</th>
            </tr>
          </thead>
          <tbody>
            {cases.map((testCase) => {
              const result = measurement.cases[testCase.id];
              const raw = `${evidenceBaseUrl}/${profile}/raw/${host}-${testCase.id}-inspect`;
              return (
                <tr key={testCase.id}>
                  <th
                    scope="row"
                    className="sticky start-0 bg-fd-background text-start font-normal"
                  >
                    {testCase.label}
                    <span className="block text-xs text-fd-muted-foreground">
                      {testCase.suite === "host" ? "Host API" : "Baseline check"}
                    </span>
                  </th>
                  <td>
                    {result.kind === "not-measured" ? "Not measured" : statusText[result.status]}
                    {result.kind === "observed" && (
                      <span className="block text-xs text-fd-muted-foreground">
                        Capability {result.capability}. Correctness {result.correctness}.
                      </span>
                    )}
                    {result.reason && <p className="my-1 text-sm">{result.reason}</p>}
                  </td>
                  <td>
                    {result.kind === "not-measured"
                      ? "Not assessed"
                      : result.expectationMatched
                        ? "Yes"
                        : "No, unexpected"}
                  </td>
                  <td>
                    {result.kind === "observed" ? (
                      <>
                        <a href={`${raw}.stdout`}>Standard output</a>
                        {" · "}
                        <a href={`${raw}.stderr`}>Standard error</a>
                      </>
                    ) : (
                      "No complete evidence"
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
      <p>
        <a href={`${evidenceBaseUrl}/${profile}/report.json`}>
          Full execution evidence for {profile}
        </a>
      </p>
    </details>
  );
}

export function CompatibilityReport({ report }: { report: Report }) {
  if (report.kind === "unavailable") {
    return (
      <div className="rounded-lg border p-4">
        <h2 className="mt-0">Report unavailable</h2>
        <p>{report.reason}</p>
        <p className="mb-0">
          <a href={workflowUrl}>Check the measurement workflow</a>.
        </p>
      </div>
    );
  }

  const { snapshot, manifest, evidenceBaseUrl } = report;
  const { run, subject } = snapshot;
  const stale = Date.now() - Date.parse(manifest.latest.capturedAt) > maxAgeMs;
  const lastComplete = manifest.lastComplete;
  const runUrl = `https://github.com/${repository}/actions/runs/${run.id}/attempts/${run.attempt}`;

  return (
    <>
      <h2 id="published-measurement">Published measurement</h2>
      {subject.kind === "npm" ? (
        <p>
          Selected npm release <strong>eslint-plugin-baseline-js {subject.version}</strong> for this
          attempt.
        </p>
      ) : (
        <p>
          <strong>Package not resolved.</strong> {subject.reason}
        </p>
      )}
      <p>
        Latest published attempt{" "}
        <a href={runUrl}>
          run {run.number}, attempt {run.attempt}
        </a>
        . Recorded {timestamp(manifest.latest.capturedAt)}.
      </p>
      {stale && (
        <p className="rounded-lg border p-3">
          <strong>Stale report.</strong> This published attempt is more than 8 days old.{" "}
          <a href={workflowUrl}>Check the measurement workflow</a> for newer or failed attempts.
        </p>
      )}
      {lastComplete?.commit !== manifest.latest.commit && (
        <p>
          {lastComplete ? (
            <>
              Last complete measurement{" "}
              <a href={`${snapshotEvidenceUrl(lastComplete)}/report.md`}>
                run {lastComplete.runNumber}, attempt {lastComplete.attempt}
              </a>
              , recorded {timestamp(lastComplete.capturedAt)}.
            </>
          ) : (
            "No complete measurement has been published."
          )}
        </p>
      )}
      <p>
        <a href={`${evidenceBaseUrl}/report.json`}>Snapshot JSON</a>
        {" · "}
        <a
          href={`https://github.com/${repository}/tree/${manifest.latest.commit}/runs/${run.id}/${run.attempt}`}
        >
          Saved inputs and lockfiles
        </a>
      </p>
      <p>
        <strong>Unsupported</strong> checks could not be verified, even when expected. Unexpected
        results differ from the case expectation.
      </p>
      {profiles.map((profile) => {
        const measurement = snapshot.profiles[profile];
        const title = profile === "pinned" ? "Pinned toolchain" : "Latest toolchain";
        const captionId = `${profile}-versions`;
        return (
          <section key={profile}>
            <h2 id={`${profile}-results`}>{title}</h2>
            {measurement.kind === "not-measured" ? (
              <p>
                <strong>Not measured.</strong> {measurement.reason}
              </p>
            ) : (
              <>
                <p>
                  Captured {timestamp(measurement.capturedAt)}. TypeScript parser{" "}
                  {measurement.parser}. TypeScript {measurement.typescript}.
                </p>
                {/* biome-ignore lint/a11y/noNoninteractiveTabindex: Focus enables keyboard scrolling. https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/overflow#accessibility */}
                <section aria-labelledby={captionId} tabIndex={0} className={scrollClass}>
                  <table>
                    <caption id={captionId} className="text-start font-medium">
                      {title} versions and observations
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">Linter</th>
                        <th scope="col">Version</th>
                        <th scope="col">Channel</th>
                        <th scope="col">Observed results</th>
                      </tr>
                    </thead>
                    <tbody>
                      {hosts.map((host) => {
                        const result = measurement.hosts[host];
                        return (
                          <tr key={host}>
                            <th scope="row" className="text-start">
                              {hostNames[host]}
                            </th>
                            <td>
                              {result.kind === "not-measured"
                                ? "Not measured"
                                : result.packageVersion}
                              {result.kind === "measured" &&
                                result.reportedVersion !== result.packageVersion && (
                                  <span className="block text-xs">
                                    Executable {result.reportedVersion}
                                  </span>
                                )}
                            </td>
                            <td>
                              {result.kind === "not-measured" ? "Not measured" : result.channel}
                            </td>
                            <td>{observations(result)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </section>
                {hosts.map((host) => {
                  const result = measurement.hosts[host];
                  return result.kind === "measured" ? (
                    <CaseResults
                      key={host}
                      profile={profile}
                      host={host}
                      measurement={result}
                      cases={snapshot.cases}
                      evidenceBaseUrl={evidenceBaseUrl}
                    />
                  ) : null;
                })}
              </>
            )}
          </section>
        );
      })}
      <details className="my-4 rounded-lg border px-4">
        <summary className="cursor-pointer py-3 focus-visible:outline-2 focus-visible:outline-offset-2">
          Measurement scope and reproduction
        </summary>
        <p>
          Results describe the listed cases, configurations, package, and tool versions. The fixed
          Baseline year is 2019. A complete measurement has observations for every case, including
          expected unsupported cases. Unknown, execution error, and not measured results prevent a
          complete measurement.
        </p>
        <p>
          Unknown means the probe could not establish the observation. Execution error means the
          check failed to run correctly. Not measured means no usable observation is available. A
          failed or canceled publication can leave an older result here; check its date and the
          workflow. Copy and download links keep the snapshot displayed on this page. A retry can
          reuse completed observations from the same workflow run; capture dates and saved
          identities retain their origin.
        </p>
        <p>
          Harness revision{" "}
          <a href={`https://github.com/${repository}/commit/${run.commit}`}>
            <code>{run.commit}</code>
          </a>
          . This revision identifies the measurement code, separately from the npm package under
          test.
        </p>
        {subject.kind === "npm" && (
          <>
            <p>
              <a href={subject.tarball}>Exact npm package</a>, resolved{" "}
              {timestamp(subject.resolvedAt)}.
            </p>
            <p className="break-all">
              Package integrity <code>{subject.integrity}</code>.
            </p>
          </>
        )}
        <p>
          The <a href={`${evidenceBaseUrl}/report.md`}>saved report and reproduction commands</a>{" "}
          use this same snapshot. These measurements do not imply endorsement by the linter
          maintainers or the Baseline project.
        </p>
      </details>
    </>
  );
}
