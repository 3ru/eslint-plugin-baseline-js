import { Callout } from "fumadocs-ui/components/callout";
import { CodeBlock, Pre } from "fumadocs-ui/components/codeblock";
import { ServerCodeBlock } from "fumadocs-ui/components/codeblock.rsc";
import type { CompatibilityReport as Report } from "@/lib/compatibility";
import { snapshotEvidenceUrl, workflowUrl } from "@/lib/compatibility";
import {
  caseObservation,
  caseOutcome,
  expectedResultText,
  type Failure,
  hostNames,
  hosts,
  type Profile,
  type ProfileMeasurement,
  type PublicCase,
  type PublicObservation,
  profiles,
  repository,
  type Snapshot,
} from "@/lib/compatibility-report";
import styles from "./compatibility-report.module.css";

const maxAgeMs = 8 * 24 * 60 * 60 * 1000;

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

function Result({
  testCase,
  observation,
}: {
  testCase: PublicCase;
  observation: PublicObservation | Failure | undefined;
}) {
  const result = caseOutcome({ testCase, observation });
  return (
    <span className={`${styles.outcome} ${styles[result.tone]}`}>
      <span aria-hidden="true">{result.icon}</span>
      <span>{result.label}</span>
    </span>
  );
}

function CaseCard({
  testCase,
  profile,
  measurement,
}: {
  testCase: Extract<PublicCase, { suite: "baseline" }>;
  profile: Profile;
  measurement: ProfileMeasurement;
}) {
  const example = testCase.example;
  const expectedLines = new Set(example?.expected.map(({ line }) => line));
  return (
    <article className={styles.caseCard} data-case={testCase.id}>
      <h3 className={styles.caseTitle}>{testCase.label}</h3>
      {example ? (
        <ServerCodeBlock
          code={example.code}
          lang={example.language}
          transformers={[
            {
              line(node, line) {
                if (expectedLines.has(line)) this.addClassToHast(node, ["highlighted", "error"]);
              },
            },
          ]}
          components={{
            pre: (props) => (
              <CodeBlock
                className={[styles.codeBlock, props.className].join(" ")}
                style={props.style}
                title={example.expected.length > 0 ? "Expected warning" : "No warning expected"}
                viewportProps={{ "aria-label": `${testCase.label} source code` }}
              >
                <Pre>{props.children}</Pre>
                {example.expected.length > 0 && (
                  <Callout type="error" className={styles.expectedDiagnostic}>
                    <p>
                      {example.expected.length === 1 ? "This feature is" : "These features are"}{" "}
                      outside the Baseline 2019 target.
                    </p>
                    {example.expected.map(({ featureId, line, column }) => (
                      <p key={`${featureId}-${line}-${column}`}>
                        <code>{featureId}</code> at line {line}, column {column}.
                      </p>
                    ))}
                  </Callout>
                )}
              </CodeBlock>
            ),
          }}
        />
      ) : (
        <p className={styles.expected}>{expectedResultText(example)}</p>
      )}
      <table className={styles.results}>
        <caption className="sr-only">
          {testCase.label}, {profile} toolchain results
        </caption>
        <thead>
          <tr>
            {hosts.map((host) => (
              <th key={host} scope="col">
                {hostNames[host]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            {hosts.map((host) => (
              <td key={host}>
                <Result
                  testCase={testCase}
                  observation={caseObservation({ measurement, host, caseId: testCase.id })}
                />
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </article>
  );
}

function ProfileComparison({ snapshot, profile }: { snapshot: Snapshot; profile: Profile }) {
  const measurement = snapshot.profiles[profile];
  const captionId = `${profile}-host-api`;
  return (
    <section>
      <h2 id={`${profile}-results`}>
        {profile === "latest" ? "Latest toolchain" : "Pinned toolchain"}
      </h2>
      {measurement.kind === "not-measured" ? (
        <p>
          <strong>Not measured.</strong> {measurement.reason}
        </p>
      ) : (
        <>
          <p className={styles.metadata}>
            Captured {timestamp(measurement.capturedAt)}.
            <span className="block">
              {hosts.map((host, index) => {
                const result = measurement.hosts[host];
                return (
                  <span key={host}>
                    {index > 0 && " · "}
                    {hostNames[host]}{" "}
                    {result.kind === "measured" ? result.packageVersion : "not measured"}
                  </span>
                );
              })}
            </span>
          </p>
          <div className={styles.caseList}>
            {snapshot.cases.map((testCase) =>
              testCase.suite === "baseline" ? (
                <CaseCard
                  key={testCase.id}
                  testCase={testCase}
                  profile={profile}
                  measurement={measurement}
                />
              ) : null,
            )}
          </div>
          <details className={styles.disclosure}>
            <summary>Host API checks</summary>
            {/* biome-ignore lint/a11y/noNoninteractiveTabindex: Focus enables keyboard scrolling. https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/overflow#accessibility */}
            <section aria-labelledby={captionId} tabIndex={0} className={styles.tableRegion}>
              <table className={styles.apiTable}>
                <caption id={captionId} className="sr-only">
                  {profile} toolchain host API checks
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Host API</th>
                    {hosts.map((host) => (
                      <th key={host} scope="col">
                        {hostNames[host]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {snapshot.cases
                    .filter(({ suite }) => suite === "host")
                    .map((testCase) => (
                      <tr key={testCase.id}>
                        <th scope="row">{testCase.label}</th>
                        {hosts.map((host) => (
                          <td key={host}>
                            <Result
                              testCase={testCase}
                              observation={caseObservation({
                                measurement,
                                host,
                                caseId: testCase.id,
                              })}
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                </tbody>
              </table>
            </section>
          </details>
        </>
      )}
    </section>
  );
}

function ProfileEvidence({
  snapshot,
  profile,
  evidenceBaseUrl,
}: {
  snapshot: Snapshot;
  profile: Profile;
  evidenceBaseUrl: string;
}) {
  const measurement = snapshot.profiles[profile];
  if (measurement.kind === "not-measured") return null;
  const problems = snapshot.cases.flatMap((testCase) =>
    hosts.flatMap((host) => {
      const observation = caseObservation({ measurement, host, caseId: testCase.id });
      return caseOutcome({ testCase, observation }).tone === "success"
        ? []
        : [{ testCase, host, observation }];
    }),
  );
  return (
    <section>
      <h3>{profile === "latest" ? "Latest" : "Pinned"} execution evidence</h3>
      <p>
        Parser {measurement.parser}. TypeScript {measurement.typescript}.{" "}
        <a href={`${evidenceBaseUrl}/${profile}/report.json`}>Execution report</a>
        {" · "}
        <a href={`${evidenceBaseUrl}/${profile}/identity.json`}>Collection identity</a>.
      </p>
      <ul>
        {hosts.map((host) => {
          const result = measurement.hosts[host];
          return (
            <li key={host}>
              {hostNames[host]}{" "}
              {result.kind === "measured" ? (
                <>
                  package {result.packageVersion}, {result.channel} channel. Executable{" "}
                  {result.reportedVersion}.
                </>
              ) : (
                <>not measured. {result.reason}</>
              )}
            </li>
          );
        })}
      </ul>
      {problems.length > 0 && (
        <ul className={styles.problemList}>
          {problems.map(({ testCase, host, observation }) => {
            const raw = `${evidenceBaseUrl}/${profile}/raw/${host}-${testCase.id}-inspect`;
            return (
              <li key={`${host}-${testCase.id}`}>
                <strong>
                  {testCase.label}, {hostNames[host]}.
                </strong>{" "}
                <Result testCase={testCase} observation={observation} />
                {observation?.reason && <p>{observation.reason}</p>}
                {observation?.kind === "observed" && (
                  <p>
                    <a href={`${raw}.stdout`}>Standard output</a>
                    {" · "}
                    <a href={`${raw}.stderr`}>Standard error</a>
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
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
    <div className={styles.report}>
      <p>
        {subject.kind === "npm" ? (
          <>
            <strong>eslint-plugin-baseline-js {subject.version}</strong> from npm.
          </>
        ) : (
          <>
            <strong>Package not resolved.</strong> {subject.reason}
          </>
        )}
        <span className={`block ${styles.metadata}`}>
          Recorded {timestamp(manifest.latest.capturedAt)}.
        </span>
      </p>
      {stale && (
        <p className="rounded-lg border p-3">
          <strong>Stale report.</strong> This measurement is more than 8 days old.{" "}
          <a href={workflowUrl}>Check the measurement workflow</a>.
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
      <p className={styles.metadata}>
        Baseline 2019. Red lines show expected warnings. Tables show actual toolchain results. ✅
        Correct result. ❌ Unsupported checks could not be verified.
      </p>
      <ProfileComparison snapshot={snapshot} profile="latest" />
      <details className={styles.disclosure}>
        <summary>Pinned toolchain comparison</summary>
        <ProfileComparison snapshot={snapshot} profile="pinned" />
      </details>
      <details className={styles.disclosure}>
        <summary>Versions, evidence, and reproduction</summary>
        <p>
          The latest toolchain follows host and parser releases, including Bun canary. The pinned
          comparison uses reviewed, exact versions. Both test the same npm release with a fixed
          TypeScript version within the parser's supported range.
        </p>
        <p>
          These measurements cover the saved code, configuration, npm release, and tool versions.
          They do not establish full compatibility. Unknown means the observation could not be
          established. Run error means the check failed to run. Not measured means no usable
          observation is available. A false positive is a warning where none is expected.
        </p>
        <p>
          A failed or canceled publication can leave an older result here. Copy and download keep
          the snapshot displayed on this page. A retry can reuse completed observations from the
          same workflow run. Capture dates and collection identities retain their origin.
        </p>
        <p>
          <a href={runUrl}>
            Run {run.number}, attempt {run.attempt}
          </a>
          . Harness revision{" "}
          <a href={`https://github.com/${repository}/commit/${run.commit}`}>
            <code>{run.commit}</code>
          </a>
          .
        </p>
        <p>
          <a href={`${evidenceBaseUrl}/report.json`}>Snapshot JSON</a>
          {" · "}
          <a
            href={`https://github.com/${repository}/tree/${manifest.latest.commit}/runs/${run.id}/${run.attempt}`}
          >
            Saved inputs and lockfiles
          </a>
          {" · "}
          <a href={`${evidenceBaseUrl}/report.md`}>Reproduction commands</a>
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
        {profiles.map((profile) => (
          <ProfileEvidence
            key={profile}
            snapshot={snapshot}
            profile={profile}
            evidenceBaseUrl={evidenceBaseUrl}
          />
        ))}
      </details>
    </div>
  );
}
