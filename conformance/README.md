# Toolchain capability checks

This development-only harness checks which parts of Baseline detection are available when
`eslint-plugin-baseline-js` runs inside ESLint, Oxlint, or Bun. It lives beside the plugin so
contributors can reproduce compatibility findings with the exact plugin revision being reviewed.
It has its own dependencies and lockfile, and is excluded from the published package.

These are capability and conformance checks. They do not produce a performance ranking, a
compatibility score, or a claim that every ESLint plugin works on a given host. They are maintained
by this project and do not imply endorsement by Bun, Oxc, W3C, or the Baseline project.

## What is being checked

The initial set contains eight direct host probes and eight Baseline detection examples:

| Group | Examples |
| --- | --- |
| Host APIs | Plugin options, AST selectors, scope and shadowing, source tokens, diagnostic locations, fixes and suggestions, ancestry, and TypeScript receiver information. |
| Baseline detection | Logical assignment, static and computed `Object.groupBy`, shadowed `Object`, global `fetchLater`, native `Element.checkVisibility`, native `Set.union`, and a structural lookalike. |

Each example has an explicit expectation independent of the output from the three tools.
Agreement between tools is insufficient: all three could miss the same feature.
The Baseline year is fixed at 2019, so these examples do not change meaning as Widely available moves.

The eight host examples run only a small dedicated probe. The eight Baseline examples run that
probe together with the locally built product rule. A diagnostic sentinel shows that the file was
actually visited; typed examples also check whether usable TypeScript parser services are
available. This separates a missing host capability from a problem in Baseline detection. Results
preserve both the capability observation and the product diagnosis.

In particular, a host that cannot provide the required type information has unavailable coverage
for a typed example. An empty diagnostic list does not count as successful type-aware detection,
including for examples that should produce no Baseline diagnostic.

Current host documentation describes type-information limitations for external JavaScript rules:

- [Bun plugin notes](https://bun.sh/docs/lint/plugins#notes)
- [Oxlint JavaScript plugin API support](https://oxc.rs/docs/guide/usage/linter/js-plugins.html#api-support)
- [typescript-eslint typed linting](https://typescript-eslint.io/getting-started/typed-linting/)

The runner records actual behavior rather than assuming that documentation applies unchanged to
every future version. Unexpected capability changes and unknown observations require review.
Missing Baseline diagnostics on a capable host fail the check. Expected type-service limitations
cannot hide additional diagnostics or an execution failure.

## Run locally

Use the Node and pnpm versions in
[`toolchain-capabilities.yml`](../.github/workflows/toolchain-capabilities.yml) for the CI setup.
From the repository root:

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm build
pnpm --dir conformance install --frozen-lockfile --ignore-scripts
pnpm --dir conformance test
pnpm --dir conformance check
```

The harness resolves the pinned Bun executable from the `bun` package's native optional
dependency. Dependency installation does not execute install scripts or change a global Bun
installation. The plugin under test is the locally built `dist/index.mjs`.
The Bun pin is a canary with `bun lint`; reports retain the actual executable revision as well
as the npm package version.

To observe current host and parser dependencies against the same fixed TypeScript reference,
without changing either committed lockfile:

```sh
pnpm --dir conformance refresh
CONFORMANCE_PROFILE=latest pnpm --dir conformance check
```

The refresh command generates a separate manifest and installs current tools under the ignored
`conformance/results/latest-tools/` directory. It preserves the committed conformance manifest,
lockfile, and installed pinned tools. The `latest` profile resolves tools from that separate
installation. The plugin and its Baseline data still come from the current checkout. This is a
discovery run, not a replacement for a reproducible pinned run. TypeScript stays at the committed
conformance version, and refresh enforces dependency peer compatibility. Return to the pinned profile with:

```sh
pnpm --dir conformance check
```

The initial runner supports macOS and glibc Linux on x64 and arm64. To save a report elsewhere,
pass `--out /absolute/path` to `node conformance/run.mjs`; tool resolution remains unchanged.

## Read the results

Each run writes ignored local output under `conformance/results/`:

- `report.md`: the comparison and findings for human review.
- `report.json`: structured observations and run metadata.
- `raw/`: tool output used to diagnose differences and execution failures.
- `work/`: generated fixtures, configuration, and TypeScript project used for the run.

Check the recorded versions and configuration before comparing runs. A result describes that
specific toolchain, configuration, fixture set, and plugin build; it is not a permanent statement
about a tool. Review host support and Baseline correctness separately, and investigate execution
errors before drawing conclusions from diagnostic counts.

A successful CI job means that observations matched the declared expectations. It can include
explicitly expected unsupported capabilities. Those rows remain labeled unavailable coverage;
they do not become successful Baseline checks.

## CI profiles

The dedicated [Toolchain Capabilities workflow](../.github/workflows/toolchain-capabilities.yml)
uses read-only repository permissions and requires no secrets.

| Trigger | Profile | Purpose |
| --- | --- | --- |
| Relevant pull request, including drafts | Pinned | Catch changes against committed dependency versions. |
| Weekly schedule | Pinned and latest | Retain the baseline and discover host or parser changes. |
| Manual dispatch | Selected pinned or latest | Reproduce a baseline or investigate current releases. |

The latest profile updates the hosts and parser together, so a change is an investigation signal.
Use pinned versions or update one dependency at a time locally to identify its cause. It does not
update the product's runtime dependencies or Baseline data.

The job summary shows the report, and an artifact retains the structured report and raw output for
seven days. Latest runs also retain their generated dependency manifest and lockfile, excluding
installed `node_modules`. Report publication runs even if a check fails; a failed check still fails
its job. Installation or setup failures may prevent report generation and remain visible in the
job logs. Scheduled runs become active when the workflow is present on the default branch.

## Maintain the boundary

- Keep host adapters, probes, fixtures, report logic, and their dependencies inside `conformance/`.
- Keep product behavior fixes and product regression tests in the existing `src/` and `tests/`.
- Give every new example an independently justified expectation and its required capabilities.
- Record a known gap narrowly; do not normalize an empty result into a pass.
- Turn actionable host findings into minimal upstream reproductions.
- Add performance measurements only with a separate design that controls the detection work being
  performed. This suite currently measures functionality.

The harness has no production exports or runtime imports from product source, and the published
package's file allowlist remains unchanged. If additional consumers need the probes, this boundary
allows a later extraction without moving product regression tests.
