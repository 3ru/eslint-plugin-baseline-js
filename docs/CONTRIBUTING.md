# Contributing to eslint-plugin-baseline-js

Thank you for contributing! This project is data‑driven. We take JavaScript feature metadata directly from web‑features and avoid hand‑maintaining feature lists. Please follow the flow below so we keep things simple and consistent.

## Source of truth
- web‑features package data: `node_modules/web-features/data.json`
- We do not hand‑add new feature IDs in this repo. New features enter our flow only when we update the `web-features` dependency.

## How the data flows
1) Update web‑features version (via Dependabot or a manual bump) in this package.
2) Run `pnpm gen:features` to regenerate our thin TypeScript mirrors under `src/baseline/data/features.*.ts`.

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

## Tests and checks
- Unit/integration tests: `pnpm test`
- Type check: `pnpm typecheck`
- Format check (Biome): `pnpm format:check`
- Coverage report (for docs): `pnpm gen:coverage`

## Scope
- Primary scope: JavaScript language features (`group: "javascript"`).
- Also supported: Web APIs (`api.*`) and JavaScript built‑ins (`javascript.*`) via generated descriptors.
- Meta/umbrella features (e.g., `functions`, `javascript`) are non‑actionable and skipped by the orchestrator.

Thanks again — by keeping feature data centralized in web‑features and leaning on automation, we avoid manual drift and preserve a clean contributor experience.
