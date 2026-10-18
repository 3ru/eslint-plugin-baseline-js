# Toolchain capability checks

This development-only harness checks which parts of Baseline detection are available when
`eslint-plugin-baseline-js` runs inside ESLint, Oxlint, or Bun. It lives beside the plugin so
contributors can reproduce compatibility findings with the exact plugin revision being reviewed.
It has its own dependencies and lockfile, and is excluded from the published package.

These are capability and conformance checks, not a performance ranking, a compatibility score, or
a claim that every ESLint plugin works on a given host. They are maintained by this project and do
not imply endorsement by Bun, Oxc, W3C, or the Baseline project.

## What is being checked

`cases.mjs` holds two groups of examples:

| Group | Examples |
| --- | --- |
| Host APIs | Plugin options, AST selectors, scope and shadowing through a parameter and through a top-level binding, source tokens, diagnostic locations after non-ASCII text, fixes and suggestions, ancestry, and TypeScript receiver information. |
| Baseline detection | Logical assignment, static and computed `Object.groupBy`, both shadowed `Object` bindings, global `fetchLater`, `Object.groupBy` in a TypeScript file, native `Element.checkVisibility`, native `Set.union`, and a structural and a nominal lookalike of `Element`. |

Each example has an explicit expectation independent of the output from the three tools.
Agreement between tools is insufficient: all three could miss the same feature.
The Baseline year is fixed at 2019, so these examples do not change meaning as Widely available
moves. Positions and ranges count UTF-16 code units, as ESLint reports them; Oxlint's byte
offsets are converted.

Host examples run only a small dedicated probe rule. Baseline examples run that probe together
with the locally built product rule. The probe's diagnostic shows that the file was actually
visited; typed examples also check whether usable TypeScript parser services are available for the
member the case names. This separates a missing host capability from a problem in Baseline
detection. Results preserve both the capability observation and the product diagnosis.

A host that cannot provide the required type information has unavailable coverage for a typed
example. An empty diagnostic list does not count as successful type-aware detection, including for
examples that should produce no Baseline diagnostic. For `values.union(new Set())` in a `.ts`
file, ESLint reports `set-methods`; Oxlint and Bun report nothing and the probe sees no program, so
their rows read `unavailable | unsupported` instead of passing.

`hosts.mjs` records what each host is expected to give JavaScript rules, following the host
documentation:

- [Bun plugin notes](https://bun.sh/docs/lint/plugins#notes): JavaScript rules get no type information.
- [Oxlint JavaScript plugin API support](https://oxc.rs/docs/guide/usage/linter/js-plugins.html#api-support): type-aware rules are not supported.
- [typescript-eslint typed linting](https://typescript-eslint.io/getting-started/typed-linting/): how ESLint gets type information.

The harness records actual behavior rather than assuming that documentation applies unchanged to
every future version. A host that starts providing type services, or stops providing something it
did, fails its rows with a reason that says so. Missing Baseline diagnostics on a capable host fail
the check. Expected type-service limitations cannot hide additional diagnostics or an execution
failure.

JavaScript fixtures are parsed by each host's own parser. TypeScript fixtures use
`@typescript-eslint/parser` under ESLint and Bun; Oxlint parses TypeScript itself. Oxlint's typed
rows run in its default mode, without `--type-aware`: that mode needs the separate
`oxlint-tsgolint` package and does not reach JavaScript plugins today.

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
installation. The plugin under test is the locally built `dist/index.mjs`; it imports ESLint and
`eslint-plugin-es-x` from the root install, and the report records both versions.

Stable Bun does not include `bun lint` yet, so the pin is a canary. Reports retain the executable's
own revision next to the npm package version, because the two differ.

To observe current host and parser releases against the same fixed TypeScript reference, without
changing either committed lockfile:

```sh
pnpm --dir conformance refresh
CONFORMANCE_PROFILE=latest pnpm --dir conformance check
```

`refresh` recreates `conformance/results/latest-tools/` from scratch, resolves `eslint`, `oxlint`
and `@typescript-eslint/parser` from `latest` and `bun` from `canary`, keeps TypeScript at the
committed conformance version, and enforces peer compatibility. It skips releases younger than one
day, so a build that is published and withdrawn the same morning never runs. The plugin and its
Baseline data still come from the current checkout. This is a discovery run, not a replacement for
a reproducible pinned run. Return to the pinned profile with `pnpm --dir conformance check`.

The harness supports macOS and glibc Linux on x64 and arm64. To save a report elsewhere, pass
`--out /absolute/path` to `node conformance/run.mjs`; tool resolution remains unchanged.

## Read the results

Each run writes ignored local output under `conformance/results/`:

- `report.md`: the comparison and findings for human review.
- `report.json`: structured observations and run metadata.
- `raw/`: tool output for every run, and the file a host produced after a fix or suggestion run.
- `work/`: generated fixtures, the configuration each phase used, and the TypeScript project.

Each row carries the observed host capability and a result:

| Result | Meaning |
| --- | --- |
| `matched` | The host provided the capability, and the observation or the diagnostics matched the expectation. |
| `mismatch` | A host example observed something else; the reason names the part that differed. |
| `coverage-loss` | A Baseline example on a capable host produced fewer diagnostics than expected. |
| `incorrect` | A Baseline example produced a diagnostic that was not expected, whatever the host's capability. |
| `unsupported` | The host lacks the capability. For the documented type gap this is the expected row under Oxlint and Bun, and the Baseline example stays unverified. |
| `unknown` | The probe did not report, or reported something the harness does not understand. |
| `execution-error` | The process failed, its output or the fixture could not be parsed, or an unexpected rule or exit code appeared. |

"Expected behavior observed" is `yes` when the row matched the declared expectation, including an
expected `unsupported` row. It never means that every check ran. Check the recorded versions and
configuration before comparing runs. A result describes that specific toolchain, configuration,
fixture set, and plugin build; it is not a permanent statement about a tool.

## CI profiles

The dedicated [Toolchain Capabilities workflow](../.github/workflows/toolchain-capabilities.yml)
uses read-only repository permissions and requires no secrets.

| Trigger | Profile | Purpose |
| --- | --- | --- |
| Relevant pull request, including drafts | Pinned | Catch changes against committed dependency versions. |
| Weekly schedule | Pinned and latest | Retain the reference result and discover host or parser changes. |
| Manual dispatch | Selected pinned or latest | Reproduce a reference result or investigate current releases. |

The latest profile updates the hosts and parser together, so a change is an investigation signal.
Use pinned versions or update one dependency at a time locally to identify its cause. It does not
update the product's runtime dependencies or Baseline data, and its downloads stay out of the pnpm
store cache that pinned runs restore.

The job summary shows the report, and an artifact retains the structured report, raw output and
generated configuration for seven days. Latest runs also retain their generated dependency manifest
and lockfile. Report publication runs even if a check fails; a failed check still fails its job.
Installation or setup failures may prevent report generation and remain visible in the job logs.

## Update the pins

`conformance/package.json` pins exact versions, and Dependabot does not cover this directory. To
move a pin, start from a reviewed latest run: its artifact contains the resolved
`latest-tools/package.json`. Change one tool at a time, re-run the pinned check, and keep

- `bun` on a canary until a stable release ships `bun lint`,
- `typescript` inside the range `@typescript-eslint/parser` declares as a peer, and
- `conformance/.npmrc`, which makes pinned installs fail on peer conflicts instead of warning.

## Maintain the boundary

- Keep host adapters, probes, fixtures, report logic, and their dependencies inside `conformance/`.
- Keep product behavior fixes and product regression tests in the existing `src/` and `tests/`.
- Give every new example an independently justified expectation; a typed example names the member
  the probe inspects.
- A new host needs an entry in `hosts.mjs` and its command in `run.mjs`; let the first run show what
  it provides, and never normalize an empty result into a pass.
- Turn actionable host findings into minimal upstream reproductions.
- Add performance measurements only with a separate design that controls the detection work being
  performed. This suite measures functionality.
