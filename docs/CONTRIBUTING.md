# Contributing to eslint-plugin-baseline-js

Thank you for contributing! This project is data‑driven. We take JavaScript feature metadata directly from web‑features and avoid hand‑maintaining feature lists. Please follow the flow below so we keep things simple and consistent.

## Source of truth
- web‑features package data: `node_modules/web-features/data.json`
- We do not hand‑add new feature IDs in this repo. New features enter our flow only when we update the `web-features` dependency.

## How the data flows
1) Update web‑features version (via Dependabot or a manual bump) in this package.
2) Run `pnpm gen:data` to regenerate feature data, descriptors, and API status overrides under `src/baseline/data/`.

Descriptors retain the exact `web-features` compatibility key they detect. Generation selects constructor keys before applying any Baseline policy and removes overlapping manual patterns. `statuses.compat.ts` contains only exact-key Baseline statuses that differ from the feature headline; omitted entries use that headline. Status overrides are atomic, including an explicitly unknown status. Browser support tables are not duplicated in this runtime projection.

Manual patterns live in `scripts/data/manual-descriptors.mjs` and declare their exact compatibility keys. Composite patterns require a reviewed key that represents the detected operation; do not borrow an arbitrary member's status. Generation rejects missing or unowned keys, and the compatibility check validates each selected key against its detection pattern.

The descriptor pipeline remains executable JavaScript on the supported Node versions. `pnpm typecheck` also checks its JSDoc contracts through `tsconfig.scripts.json`, including classifiers and manual mappings. Generated status overrides are checked as TypeScript. The large generated descriptor arrays retain `@ts-nocheck` because the 8,000+ element API array exceeds TypeScript's union complexity limit (TS2590); their producers are checked against the required-key `GeneratedDescriptor` contract and their emitted keys pass compatibility QA.

## Mapping drift and issue automation
- Workflow: `.github/workflows/mapping-drift.yml`
  - When feature data or generator scripts change, the workflow compares web‑features coverage with our mappings.
  - It outputs a drift report and automatically creates issues for any missing mappings.
- Until we update the web‑features version, coverage is expected to be 100%, so no issues are opened.

## What to change (and when)
- Do not manually add new feature IDs anywhere.
- When the automation opens an issue for a missing mapping:
  - JS syntax mapping: update `src/baseline/mapping/syntax.ts` to delegate to ESLint core or our internal rules as appropriate (prefer delegation).
  - Web APIs / JS builtins: most coverage comes from generated descriptors. Only extend detection patterns if the issue demonstrates a gap or a false positive/negative.
- Always add or update tests that reflect the mapping or detection change.

Classify new direct `api.Window.*` members in `scripts/data/classify-web-apis.mjs` against their Web IDL. Generation fails for unclassified members.

## Tests and checks
- Unit/integration tests: `pnpm test`
- Type check: `pnpm typecheck`
- Format check (Biome): `pnpm format:check`
- Descriptor and compat-key consistency: `pnpm check:descriptor-compat`
- Generated data matches the checked-in files: `pnpm check:generated-data`
- Coverage report (for docs): `pnpm gen:coverage`

## Scope
- Primary scope: JavaScript language features (`group: "javascript"`).
- Also supported: Web APIs (`api.*`) and JavaScript built‑ins (`javascript.*`) via generated descriptors.
- Meta/umbrella features (e.g., `functions`, `javascript`) are non‑actionable and skipped by the orchestrator.

Thanks again — by keeping feature data centralized in web‑features and leaning on automation, we avoid manual drift and preserve a clean contributor experience.
