# Benchmarks

`baseline-js/use-baseline` runs inside every adopter's lint step, so each change to the rule should answer one question: did it get slower, and does it still report exactly what it should? The benchmark answers both on a synthetic corpus that reproduces the shape of real code without copying any of it.

## Commands

| Command | What it does |
| --- | --- |
| `pnpm bench:compare` | Build `origin/main` and the working tree, lint the corpus with both and print a before/after table. The CI job runs this. |
| `pnpm bench:compare --base v0.7.5 --head . --scale 1 --iterations 5` | Compare any two refs; `--head .` includes uncommitted changes. |
| `pnpm bench` | Lint the corpus with `dist/index.mjs` only (totals, ms/file, expected vs actual reports). |
| `pnpm bench:sweep` | Lint at scales 1, 4 and 16 (typed: 1 and 4) and report whether ms/file and peak memory stay flat. Runs weekly in CI. |
| `pnpm bench:synth --scale 1 --size-mult 8` | Generate a corpus by hand, with overrides (`--size-mult`, `--detections-mult`, `--collisions-mult`, `--shadow-mult`, `--lang-mix`, `--seed`). |
| `pnpm bench:profile --manifest bench/corpus.local.json` | Re-extract `bench/profile.json` from real code (local only). |
| `pnpm bench:snippets` | Re-verify the detection samples in `bench/synth-snippets.json` against the current build. |
| `pnpm bench:calibrate` | Lint real repositories from the git-ignored local manifest next to the synthetic corpus and compare cost per file and per node (local only). |
| `pnpm bench:changed --base origin/main` | Say whether a change set would trigger the CI benchmark, and why. |

`--scale n` means about n × 1,000 files: 50% JavaScript, 33% TypeScript, 17% TSX. The pull-request job uses scale 3 (about 3,000 files), three untyped iterations and two type-aware iterations over the TypeScript files.

## How the corpus is made

**Profile.** `scripts/bench/profile.mjs` parses real repositories with the same parser the benchmark uses and keeps only aggregates in `bench/profile.json`: file-size distribution (log-normal fit over AST nodes), language mix, AST node-type shares, how often member and call expressions appear, which property and callee names occur (the top few hundred, as shares), how often those names collide with the names the rule's listeners key on, member-chain depth, how often chains start at `this`, a local, a global or `window`, how often a global name is rebound locally, and how dense real API usage is per 1,000 nodes (measured by the rule itself under a policy that reports everything). The file records only counts of repositories, files and nodes; no repository names, paths or code.

**Snippets.** `scripts/bench/snippets.mjs` derives one-line usages from the generated descriptor data (`URL.parse(0);`, `void navigator.clipboard;`, `new ResizeObserver(0);`, `declare const r: Element; void r.checkVisibility;`) and keeps the ones the current build reports exactly once, untyped and type-aware. `bench/synth-snippets.json` is the verified list with the feature each line reports. Re-run it after a web-features update or a detector change and commit the result; a run whose report count no longer matches is the signal to do so.

**Generator.** `scripts/bench/synth.mjs` turns profile + snippets + seed into files: modules with helpers, classes, object literals and loops whose property and callee names follow the profile's frequencies, so the rule's listeners collide with real-world names at the real-world rate; `window.__app` style accesses and `this` chains at the profile's rates; verified detections injected at the measured density (weighted by how often real code uses each feature, capped so the long tail stays covered); shadowed decoys (`function f(URL) { URL.parse(0); }`) that must stay silent; and, in TypeScript files, `declare const` receivers for type-aware detections plus array, string and `Map` receivers whose accessed names are never descriptors. Output is deterministic: the corpus id is a hash of the profile, the snippet list, the generator source, the seed and the options, and the files are regenerated only when that id changes. Each manifest entry records how many detections the file contains, so the expected report count is known before any build runs.

Nothing in the corpus is downloaded or executed. The pull-request job needs no network after `pnpm install`.

## What a run measures

Every (shard, build) pair is a fresh Node process that lints about 500 files through the ESLint API with an inline configuration (`overrideConfigFile: true`, `allowInlineConfig: false`, `stats: true`) after a short warm-up. Timing runs under `available: "widely"`, the common adopter setting. Syntax delegates (`eslint-plugin-es-x` rules for newer syntax) are ignored so the numbers cover the plugin's own detection path.

| Column | Source | Meaning |
| --- | --- | --- |
| use-baseline time | `stats.times.passes[].rules["baseline-js/use-baseline"]` | Time inside the rule, excluding parsing and other rules. The number to watch. |
| lint total | wall clock around `lintFiles()` | End-to-end cost adopters feel. |
| ms/file, ms per 1k nodes | rule time ÷ files, ÷ AST nodes | Normalised cost; the sweep checks they stay flat as the corpus grows. |
| max RSS | `process.resourceUsage().maxRSS` of the largest shard | Peak memory. |
| reports expected → base → head | one extra pass under `available: 1900` | Every build must report exactly the injected detections. A head mismatch fails the run; a base mismatch is shown but tolerated (an older build may see different data). |
| noise | run-to-run spread of one shard | Differences inside the noise band are not significant. |
| pairs | sign test over (shard, iteration) pairs | How consistently head was slower, with a two-sided p-value. |

`compare` alternates which build goes first on every iteration, so drift on the machine hits both sides equally, and each (shard, iteration) pair is an independent observation. A slowdown is flagged (⚠️) when the median ratio exceeds the threshold (10%) and the sign test is significant (p < 0.05); it is advisory until `--fail-on-regression` is enabled. Report-count mismatches fail immediately.

Design references: Node.js core's `benchmark/compare.js` (interleaved old/new runs with a significance test), ESLint's `perf` target (repeated runs of a fixed fixture, medians against the base branch), Oxc, Biome and Rolldown (fixed committed fixtures with per-PR comparison), mitata and tinybench (warm-up before timing, robust summaries), and evaluation practice for AI systems (fixed seeds, versioned inputs, several trials, an oracle independent of the system under test).

## Calibration

The synthetic corpus should cost about what real code costs. `pnpm bench:calibrate` lints the repositories listed in `bench/corpus.local.json` (git-ignored; entries are `{ id, repo, ref, include, exclude, maxFiles }` with a full commit SHA, fetched by SHA and only parsed) with the same build and prints ms/file and ms per 1k nodes next to the synthetic numbers. If they drift beyond about ±20%, re-extract the profile with `pnpm bench:profile --manifest bench/corpus.local.json` and commit the new `bench/profile.json`. Comparisons are only meaningful between runs on the same profile, snippets and generator; the corpus id in each report says which.

## CI

`.github/workflows/perf.yml` runs on every pull request in three jobs:

1. **needs benchmark?** reads the diff between the PR base and the merge commit with `scripts/bench/changed.mjs` and `bench/perf-triggers.json`. A changed file counts unless it is under an ignored directory (`docs/`, `examples/`, `tests/`, `.github/`, …) or has an ignored extension (`.md`, `.mdx`, images, …); `package.json`, the lockfile, the build config, `bench/` and the workflow itself always count. Documentation-only pull requests stop here. Run `pnpm bench:changed --base origin/main` locally to see the decision for a branch.
2. **before/after** generates the corpus and runs `pnpm bench:compare` against the PR base commit. The table goes to the job summary and to the `bench-results` artifact (30 days) together with the JSON report.
3. **pull request comment** posts the same table as one comment that is updated on every measured commit (`marocchino/sticky-pull-request-comment`, pinned to a commit). The comment names the commit it measured and links to the run, so a later documentation-only commit that skips the benchmark leaves it readable. Only this job has `pull-requests: write`, and it runs only for pull requests from this repository: forks and Dependabot get a read-only token, and for them the job summary carries the same table.

`.github/workflows/perf-sweep.yml` runs the scale sweep weekly and on demand (timeout 60 minutes). Both workflows are built for the current supply-chain threat model (tags of popular actions repointed to malicious commits in 2026, `pull_request_target` plus cache poisoning in the TanStack compromise, npm install-script worms):

| Control | Why |
| --- | --- |
| `permissions: {}` at the workflow level; `contents: read` on the benchmark jobs; `pull-requests: write` only on the comment job, for same-repository pull requests | A compromised step has nothing to exfiltrate or write beyond one comment. |
| `pull_request` only, never `pull_request_target` | Fork code never runs with repository privileges. |
| Actions pinned to full commit SHAs with the version in a comment | Mutable tags were the entry point; Dependabot keeps the pins updated. |
| `actions/checkout` with `persist-credentials: false` | No token left on disk for later steps or artifacts. |
| No `actions/cache` or `setup-node` cache | Cache poisoning is the second stage of the TanStack chain. |
| `pnpm install --frozen-lockfile --ignore-scripts` | Lifecycle scripts were the payload of the 2026 npm worms. |
| Corpus generated locally, nothing downloaded or executed | No third-party code enters the job. |
| Event data reaches the shell through environment variables; the comment body travels as a job output into an action input | No expression injection into `run:` steps. |
| `concurrency` and timeouts | Bounded cost and queue depth. |

Related hardening worth adopting repository-wide: pin the other workflows the same way (GitHub can enforce SHA pinning per repository), run zizmor over `.github/workflows`, give Dependabot a version-update cooldown, and set pnpm's `minimumReleaseAge`.

## Limitations

- The profile describes the repositories it was extracted from (27 adopters and large browser projects in October 2026). It is a model of their code, not the code itself.
- Type-aware filler never touches DOM receivers except through verified snippets, so the type checker sees fewer DOM types than in real code.
- GitHub-hosted runners vary by 5–15% run to run; read the noise and pairs columns before reading Δ.
