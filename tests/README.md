## Tests

Welcome! A quick note on how tests are organized and how to read them.

- File layout
  - `core.spec.ts`  → scenarios backed by ESLint core rules (e.g., `no-with`, `no-caller`, `no-restricted-*`).
  - `esx.spec.ts`   → scenarios backed by `eslint-plugin-es-x` (newer JS syntax).
  - Rule unit tests for our own custom rules live next to the rule implementation, e.g.:
    - `src/rules/no-foo/__tests__/rule.spec.ts`

- Titles and labels in tests
  - We prefix titles with the web‑features feature ID in square brackets, e.g. `[nullish-coalescing]`.

- Tests exercise plugin logic, never a feature's current Baseline status
  - A feature's status (`high = widely`, `low = newly`, `false = limited`) changes as web‑features data is refreshed, so an assertion such as "X is reported under `widely`" breaks or goes vacuous with time.
  - For detection, mapping, shadowing and option-gating cases, lint under `reportingPolicyFor("<id>")` from `tests/utils/policy.ts` (a year policy derived from the feature's own bundled record; Limited features fall back to `LIMITED_ONLY_YEAR`) and assert on the `(<id>)` suffix of the message.
  - For the year-policy message format, build the expectation with `yearPolicyMessage("<id>", policy)` so the name and year come from the record.
  - Only discouraged features (which never leave Limited) and widely features asserted as silent may use `"widely"` / `"newly"` literally.

- Running tests locally
  - Generate features (once or whenever web‑features updates):
    - `pnpm gen:features`
  - Run all tests:
    - `pnpm test`
  - Run a single file:
    - `pnpm test tests/core.spec.ts`
