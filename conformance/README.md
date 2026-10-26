# Linter compatibility measurements

This development package measures selected Baseline checks and host plugin APIs under ESLint, Oxlint, and Bun.
The [linter compatibility page](https://baselinejs.vercel.app/docs/compatibility) shows the published results and their scope.
The package has its own dependencies and lockfile. It is excluded from the npm release.

## Measure an npm release

Use Node 22.18 or later on the 22 line, or Node 23.6 or later, with the pnpm version in `package.json`.
Run these commands from the repository root:

```sh
pnpm --dir conformance install --frozen-lockfile --ignore-scripts
pnpm --dir conformance typecheck
pnpm --dir conformance test
node conformance/subject.ts --out conformance/results/subject
CONFORMANCE_PROFILE=pinned node conformance/run.ts --subject conformance/results/subject --out conformance/results/pinned
CONFORMANCE_PROFILE=latest node conformance/run.ts --subject conformance/results/subject --out conformance/results/latest
```

`subject.ts` resolves the published plugin once and saves its exact version, tarball URL, and integrity.
Both profiles use that package. Released-package measurements do not need a root install or build.

`pinned` installs the reviewed versions from the committed conformance manifest and lockfile.
`latest` resolves ESLint, Oxlint, and the TypeScript parser from `latest`, and Bun from `canary`.
The TypeScript reference stays fixed within the parser's peer range.
The report records package versions, executable versions, channels, and capture times.

## Diagnose the current checkout

For an unpublished plugin change, build the checkout before running without `--subject`:

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm build
pnpm --dir conformance install --frozen-lockfile --ignore-scripts
pnpm --dir conformance check
```

This measures the local `dist/index.mjs`. It does not update the public npm-release report.
The harness supports macOS and glibc Linux on x64 and arm64.

## Read and reproduce a measurement

Each profile saves these files below its output directory:

- `report.md` summarizes the observations.
- `report.json` records capabilities, diagnostics, expectations, and execution metadata.
- `raw/` contains each process's standard output and standard error.
- `work/` contains the generated inputs, linter configurations, and TypeScript project.
- `subject-input/` and `tools/` contain the exact dependency manifests and lockfiles.

Cases have independent expectations. A zero exit code or agreement between linters does not establish that a check ran.
An expected unsupported result can satisfy the harness expectation while the Baseline check remains unverified.
Unexpected diagnostics, missing diagnostics on a capable host, and execution failures remain visible.

Public snapshots live on the [`toolchain-reports` branch](https://github.com/3ru/eslint-plugin-baseline-js/tree/toolchain-reports) at `runs/<run-id>/<attempt>/`.
The latest pointer names an immutable Git commit. Each snapshot keeps both profiles, including failures and missing measurements.
Published snapshots store the shared package inputs once in `subject/`.
These records remain available after the workflow's temporary artifacts expire.

The saved Markdown report contains fixed evidence links and reproduction commands.
To replay a profile, use its harness commit, restore the shared `subject/` directory and that profile's `tools/` directory, and download the subject tarball from `subject.json`.
Save that tarball as `subject.tgz` in the restored `subject` directory. The runner verifies its integrity.
Pass the recorded profile and directories:

```sh
CONFORMANCE_PROFILE=latest node conformance/run.ts --subject /path/to/subject --tools /path/to/tools --out /tmp/baseline-replay
```

`--tools` installs from the saved lockfile. It does not resolve current release tags.
Compare the subject, harness revision, inputs, and configurations before attributing a change to a linter.

## Run in GitHub Actions

The [Linter Compatibility workflow](../.github/workflows/toolchain-capabilities.yml) runs weekly and on manual dispatch.
Every run measures both profiles against one npm package. Pull requests do not run the full measurement matrix.
Collectors have read-only repository permissions. A separate publisher validates and saves their evidence.

The page shows the latest published attempt, separately from the last complete measurement.
Publisher failure or cancellation can leave an older attempt visible. Reports older than eight days display a stale notice and a workflow link.
An older run's retry does not move the latest pointer backward.

## Maintain the cases and pins

Give each case in `cases.ts` an independently justified expectation and a readable label.
Typed cases name the member that the probe must inspect. An unavailable program, checker, or node map cannot count as successful type-aware detection.
Keep product behavior changes and product regression tests in `src/` and `tests/`.

To update a pin, start from the exact versions in a reviewed latest report.
Change one tool at a time in `conformance/package.json`, regenerate its lockfile, and rerun the pinned measurement.
Keep Bun on a canary until a reviewed stable release provides `bun lint`.
Keep TypeScript within the parser's peer range and retain strict peer checks in `.npmrc`.

These cases measure functionality in named configurations. They do not provide a performance ranking, a full ESLint compatibility score, or vendor endorsement.
