# Linter compatibility

Run [40268933218, attempt 1](https://github.com/3ru/eslint-plugin-baseline-js/actions/runs/40268933218/attempts/1) started 2026-10-26T04:24:43Z.
Harness commit [69686c6863122a725fb18ed0073835a8a6a7bcc3](https://github.com/3ru/eslint-plugin-baseline-js/commit/69686c6863122a725fb18ed0073835a8a6a7bcc3).

Selected npm release **eslint-plugin-baseline-js 0.7.6**. [Exact package](https://registry.npmjs.org/eslint-plugin-baseline-js/-/eslint-plugin-baseline-js-0.7.6.tgz) resolved 2026-10-26T04:25:01.981Z. Integrity `sha512-z2PEC/N6WSrcmYunFVutSKRqWURnXbdkyDboal4dztiYdC8OjaiaaJ1xDtWCV1lXR8VWbcxosICzPNz0N9enPQ==`.

These fixtures measure specific plugin and host behavior. An expected unsupported result is still unsupported. Expected result describes the harness expectation, not full compatibility.

A retry can reuse completed observations from earlier attempts of the same workflow run. Each profile's capture date and collection identity retain the original provenance.

## pinned

Captured 2026-10-26T04:25:26.753Z. Parser 8.71.2. TypeScript 6.0.3. [Collection identity](pinned/identity.json).

### eslint

Package 10.13.0, pinned channel. Reported version v10.13.0. [Execution evidence](pinned/report.json).

| Case | Capability | Correctness | Status | Expected result | Reason | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| Plugin options | supported | matched | Matched | Yes |  | [stdout](pinned/raw/eslint-host-plugin-options-inspect.stdout), [stderr](pinned/raw/eslint-host-plugin-options-inspect.stderr) |
| AST selectors | supported | matched | Matched | Yes |  | [stdout](pinned/raw/eslint-host-ast-selector-inspect.stdout), [stderr](pinned/raw/eslint-host-ast-selector-inspect.stderr) |
| Function scope shadowing | supported | matched | Matched | Yes |  | [stdout](pinned/raw/eslint-host-scope-shadowing-inspect.stdout), [stderr](pinned/raw/eslint-host-scope-shadowing-inspect.stderr) |
| Top-level scope binding | supported | matched | Matched | Yes |  | [stdout](pinned/raw/eslint-host-scope-binding-inspect.stdout), [stderr](pinned/raw/eslint-host-scope-binding-inspect.stderr) |
| Source text and tokens | supported | matched | Matched | Yes |  | [stdout](pinned/raw/eslint-host-source-tokens-inspect.stdout), [stderr](pinned/raw/eslint-host-source-tokens-inspect.stderr) |
| Diagnostic locations | supported | matched | Matched | Yes |  | [stdout](pinned/raw/eslint-host-diagnostic-location-inspect.stdout), [stderr](pinned/raw/eslint-host-diagnostic-location-inspect.stderr) |
| Node ancestry | supported | matched | Matched | Yes |  | [stdout](pinned/raw/eslint-host-ancestry-inspect.stdout), [stderr](pinned/raw/eslint-host-ancestry-inspect.stderr) |
| TypeScript receiver services | supported | matched | Matched | Yes |  | [stdout](pinned/raw/eslint-host-typescript-receiver-inspect.stdout), [stderr](pinned/raw/eslint-host-typescript-receiver-inspect.stderr) |
| Logical assignment | supported | matched | Matched | Yes |  | [stdout](pinned/raw/eslint-baseline-logical-assignment-inspect.stdout), [stderr](pinned/raw/eslint-baseline-logical-assignment-inspect.stderr) |
| Static Object.groupBy | supported | matched | Matched | Yes |  | [stdout](pinned/raw/eslint-baseline-static-groupby-inspect.stdout), [stderr](pinned/raw/eslint-baseline-static-groupby-inspect.stderr) |
| Computed Object.groupBy | supported | matched | Matched | Yes |  | [stdout](pinned/raw/eslint-baseline-computed-groupby-inspect.stdout), [stderr](pinned/raw/eslint-baseline-computed-groupby-inspect.stderr) |
| Shadowed Object parameter | supported | matched | Matched | Yes |  | [stdout](pinned/raw/eslint-baseline-shadowed-object-inspect.stdout), [stderr](pinned/raw/eslint-baseline-shadowed-object-inspect.stderr) |
| Shadowed Object binding | supported | matched | Matched | Yes |  | [stdout](pinned/raw/eslint-baseline-shadowed-binding-inspect.stdout), [stderr](pinned/raw/eslint-baseline-shadowed-binding-inspect.stderr) |
| Global fetchLater | supported | matched | Matched | Yes |  | [stdout](pinned/raw/eslint-baseline-global-fetchlater-inspect.stdout), [stderr](pinned/raw/eslint-baseline-global-fetchlater-inspect.stderr) |
| TypeScript static Object.groupBy | supported | matched | Matched | Yes |  | [stdout](pinned/raw/eslint-baseline-ts-static-groupby-inspect.stdout), [stderr](pinned/raw/eslint-baseline-ts-static-groupby-inspect.stderr) |
| Typed Element.checkVisibility | supported | matched | Matched | Yes |  | [stdout](pinned/raw/eslint-baseline-typed-element-inspect.stdout), [stderr](pinned/raw/eslint-baseline-typed-element-inspect.stderr) |
| Typed Set.union | supported | matched | Matched | Yes |  | [stdout](pinned/raw/eslint-baseline-typed-set-union-inspect.stdout), [stderr](pinned/raw/eslint-baseline-typed-set-union-inspect.stderr) |
| Structural lookalike | supported | matched | Matched | Yes |  | [stdout](pinned/raw/eslint-baseline-typed-lookalike-inspect.stdout), [stderr](pinned/raw/eslint-baseline-typed-lookalike-inspect.stderr) |
| Named interface lookalike | supported | matched | Matched | Yes |  | [stdout](pinned/raw/eslint-baseline-typed-nominal-lookalike-inspect.stdout), [stderr](pinned/raw/eslint-baseline-typed-nominal-lookalike-inspect.stderr) |

### oxlint

Package 1.88.0, pinned channel. Reported version 1.88.0. [Execution evidence](pinned/report.json).

| Case | Capability | Correctness | Status | Expected result | Reason | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| Plugin options | supported | matched | Matched | Yes |  | [stdout](pinned/raw/oxlint-host-plugin-options-inspect.stdout), [stderr](pinned/raw/oxlint-host-plugin-options-inspect.stderr) |
| AST selectors | supported | matched | Matched | Yes |  | [stdout](pinned/raw/oxlint-host-ast-selector-inspect.stdout), [stderr](pinned/raw/oxlint-host-ast-selector-inspect.stderr) |
| Function scope shadowing | supported | matched | Matched | Yes |  | [stdout](pinned/raw/oxlint-host-scope-shadowing-inspect.stdout), [stderr](pinned/raw/oxlint-host-scope-shadowing-inspect.stderr) |
| Top-level scope binding | supported | matched | Matched | Yes |  | [stdout](pinned/raw/oxlint-host-scope-binding-inspect.stdout), [stderr](pinned/raw/oxlint-host-scope-binding-inspect.stderr) |
| Source text and tokens | supported | matched | Matched | Yes |  | [stdout](pinned/raw/oxlint-host-source-tokens-inspect.stdout), [stderr](pinned/raw/oxlint-host-source-tokens-inspect.stderr) |
| Diagnostic locations | supported | matched | Matched | Yes |  | [stdout](pinned/raw/oxlint-host-diagnostic-location-inspect.stdout), [stderr](pinned/raw/oxlint-host-diagnostic-location-inspect.stderr) |
| Node ancestry | supported | matched | Matched | Yes |  | [stdout](pinned/raw/oxlint-host-ancestry-inspect.stdout), [stderr](pinned/raw/oxlint-host-ancestry-inspect.stderr) |
| TypeScript receiver services | unavailable | not-assessed | Unsupported | Yes | typed parser services unavailable | [stdout](pinned/raw/oxlint-host-typescript-receiver-inspect.stdout), [stderr](pinned/raw/oxlint-host-typescript-receiver-inspect.stderr) |
| Logical assignment | supported | matched | Matched | Yes |  | [stdout](pinned/raw/oxlint-baseline-logical-assignment-inspect.stdout), [stderr](pinned/raw/oxlint-baseline-logical-assignment-inspect.stderr) |
| Static Object.groupBy | supported | matched | Matched | Yes |  | [stdout](pinned/raw/oxlint-baseline-static-groupby-inspect.stdout), [stderr](pinned/raw/oxlint-baseline-static-groupby-inspect.stderr) |
| Computed Object.groupBy | supported | matched | Matched | Yes |  | [stdout](pinned/raw/oxlint-baseline-computed-groupby-inspect.stdout), [stderr](pinned/raw/oxlint-baseline-computed-groupby-inspect.stderr) |
| Shadowed Object parameter | supported | matched | Matched | Yes |  | [stdout](pinned/raw/oxlint-baseline-shadowed-object-inspect.stdout), [stderr](pinned/raw/oxlint-baseline-shadowed-object-inspect.stderr) |
| Shadowed Object binding | supported | matched | Matched | Yes |  | [stdout](pinned/raw/oxlint-baseline-shadowed-binding-inspect.stdout), [stderr](pinned/raw/oxlint-baseline-shadowed-binding-inspect.stderr) |
| Global fetchLater | supported | matched | Matched | Yes |  | [stdout](pinned/raw/oxlint-baseline-global-fetchlater-inspect.stdout), [stderr](pinned/raw/oxlint-baseline-global-fetchlater-inspect.stderr) |
| TypeScript static Object.groupBy | supported | matched | Matched | Yes |  | [stdout](pinned/raw/oxlint-baseline-ts-static-groupby-inspect.stdout), [stderr](pinned/raw/oxlint-baseline-ts-static-groupby-inspect.stderr) |
| Typed Element.checkVisibility | unavailable | not-verified | Unsupported | Yes | Required receiver analysis is unavailable; this case remains unverified | [stdout](pinned/raw/oxlint-baseline-typed-element-inspect.stdout), [stderr](pinned/raw/oxlint-baseline-typed-element-inspect.stderr) |
| Typed Set.union | unavailable | not-verified | Unsupported | Yes | Required receiver analysis is unavailable; this case remains unverified | [stdout](pinned/raw/oxlint-baseline-typed-set-union-inspect.stdout), [stderr](pinned/raw/oxlint-baseline-typed-set-union-inspect.stderr) |
| Structural lookalike | unavailable | not-verified | Unsupported | Yes | Required receiver analysis is unavailable; this case remains unverified | [stdout](pinned/raw/oxlint-baseline-typed-lookalike-inspect.stdout), [stderr](pinned/raw/oxlint-baseline-typed-lookalike-inspect.stderr) |
| Named interface lookalike | unavailable | not-verified | Unsupported | Yes | Required receiver analysis is unavailable; this case remains unverified | [stdout](pinned/raw/oxlint-baseline-typed-nominal-lookalike-inspect.stdout), [stderr](pinned/raw/oxlint-baseline-typed-nominal-lookalike-inspect.stderr) |

### bun

Package 1.4.3-canary.20261017.1+017b243, canary channel. Reported version 1.4.4-canary.1+5f5799ed1. [Execution evidence](pinned/report.json).

| Case | Capability | Correctness | Status | Expected result | Reason | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| Plugin options | supported | matched | Matched | Yes |  | [stdout](pinned/raw/bun-host-plugin-options-inspect.stdout), [stderr](pinned/raw/bun-host-plugin-options-inspect.stderr) |
| AST selectors | supported | matched | Matched | Yes |  | [stdout](pinned/raw/bun-host-ast-selector-inspect.stdout), [stderr](pinned/raw/bun-host-ast-selector-inspect.stderr) |
| Function scope shadowing | supported | matched | Matched | Yes |  | [stdout](pinned/raw/bun-host-scope-shadowing-inspect.stdout), [stderr](pinned/raw/bun-host-scope-shadowing-inspect.stderr) |
| Top-level scope binding | supported | matched | Matched | Yes |  | [stdout](pinned/raw/bun-host-scope-binding-inspect.stdout), [stderr](pinned/raw/bun-host-scope-binding-inspect.stderr) |
| Source text and tokens | supported | matched | Matched | Yes |  | [stdout](pinned/raw/bun-host-source-tokens-inspect.stdout), [stderr](pinned/raw/bun-host-source-tokens-inspect.stderr) |
| Diagnostic locations | supported | matched | Matched | Yes |  | [stdout](pinned/raw/bun-host-diagnostic-location-inspect.stdout), [stderr](pinned/raw/bun-host-diagnostic-location-inspect.stderr) |
| Node ancestry | supported | matched | Matched | Yes |  | [stdout](pinned/raw/bun-host-ancestry-inspect.stdout), [stderr](pinned/raw/bun-host-ancestry-inspect.stderr) |
| TypeScript receiver services | unavailable | not-assessed | Unsupported | Yes | typed parser services unavailable | [stdout](pinned/raw/bun-host-typescript-receiver-inspect.stdout), [stderr](pinned/raw/bun-host-typescript-receiver-inspect.stderr) |
| Logical assignment | supported | matched | Matched | Yes |  | [stdout](pinned/raw/bun-baseline-logical-assignment-inspect.stdout), [stderr](pinned/raw/bun-baseline-logical-assignment-inspect.stderr) |
| Static Object.groupBy | supported | matched | Matched | Yes |  | [stdout](pinned/raw/bun-baseline-static-groupby-inspect.stdout), [stderr](pinned/raw/bun-baseline-static-groupby-inspect.stderr) |
| Computed Object.groupBy | supported | matched | Matched | Yes |  | [stdout](pinned/raw/bun-baseline-computed-groupby-inspect.stdout), [stderr](pinned/raw/bun-baseline-computed-groupby-inspect.stderr) |
| Shadowed Object parameter | supported | matched | Matched | Yes |  | [stdout](pinned/raw/bun-baseline-shadowed-object-inspect.stdout), [stderr](pinned/raw/bun-baseline-shadowed-object-inspect.stderr) |
| Shadowed Object binding | supported | matched | Matched | Yes |  | [stdout](pinned/raw/bun-baseline-shadowed-binding-inspect.stdout), [stderr](pinned/raw/bun-baseline-shadowed-binding-inspect.stderr) |
| Global fetchLater | supported | matched | Matched | Yes |  | [stdout](pinned/raw/bun-baseline-global-fetchlater-inspect.stdout), [stderr](pinned/raw/bun-baseline-global-fetchlater-inspect.stderr) |
| TypeScript static Object.groupBy | supported | matched | Matched | Yes |  | [stdout](pinned/raw/bun-baseline-ts-static-groupby-inspect.stdout), [stderr](pinned/raw/bun-baseline-ts-static-groupby-inspect.stderr) |
| Typed Element.checkVisibility | unavailable | not-verified | Unsupported | Yes | Required receiver analysis is unavailable; this case remains unverified | [stdout](pinned/raw/bun-baseline-typed-element-inspect.stdout), [stderr](pinned/raw/bun-baseline-typed-element-inspect.stderr) |
| Typed Set.union | unavailable | not-verified | Unsupported | Yes | Required receiver analysis is unavailable; this case remains unverified | [stdout](pinned/raw/bun-baseline-typed-set-union-inspect.stdout), [stderr](pinned/raw/bun-baseline-typed-set-union-inspect.stderr) |
| Structural lookalike | unavailable | not-verified | Unsupported | Yes | Required receiver analysis is unavailable; this case remains unverified | [stdout](pinned/raw/bun-baseline-typed-lookalike-inspect.stdout), [stderr](pinned/raw/bun-baseline-typed-lookalike-inspect.stderr) |
| Named interface lookalike | unavailable | not-verified | Unsupported | Yes | Required receiver analysis is unavailable; this case remains unverified | [stdout](pinned/raw/bun-baseline-typed-nominal-lookalike-inspect.stdout), [stderr](pinned/raw/bun-baseline-typed-nominal-lookalike-inspect.stderr) |

## latest

Captured 2026-10-26T04:25:27.171Z. Parser 8.72.0. TypeScript 6.0.3. [Collection identity](latest/identity.json).

### eslint

Package 10.13.0, latest channel. Reported version v10.13.0. [Execution evidence](latest/report.json).

| Case | Capability | Correctness | Status | Expected result | Reason | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| Plugin options | supported | matched | Matched | Yes |  | [stdout](latest/raw/eslint-host-plugin-options-inspect.stdout), [stderr](latest/raw/eslint-host-plugin-options-inspect.stderr) |
| AST selectors | supported | matched | Matched | Yes |  | [stdout](latest/raw/eslint-host-ast-selector-inspect.stdout), [stderr](latest/raw/eslint-host-ast-selector-inspect.stderr) |
| Function scope shadowing | supported | matched | Matched | Yes |  | [stdout](latest/raw/eslint-host-scope-shadowing-inspect.stdout), [stderr](latest/raw/eslint-host-scope-shadowing-inspect.stderr) |
| Top-level scope binding | supported | matched | Matched | Yes |  | [stdout](latest/raw/eslint-host-scope-binding-inspect.stdout), [stderr](latest/raw/eslint-host-scope-binding-inspect.stderr) |
| Source text and tokens | supported | matched | Matched | Yes |  | [stdout](latest/raw/eslint-host-source-tokens-inspect.stdout), [stderr](latest/raw/eslint-host-source-tokens-inspect.stderr) |
| Diagnostic locations | supported | matched | Matched | Yes |  | [stdout](latest/raw/eslint-host-diagnostic-location-inspect.stdout), [stderr](latest/raw/eslint-host-diagnostic-location-inspect.stderr) |
| Node ancestry | supported | matched | Matched | Yes |  | [stdout](latest/raw/eslint-host-ancestry-inspect.stdout), [stderr](latest/raw/eslint-host-ancestry-inspect.stderr) |
| TypeScript receiver services | supported | matched | Matched | Yes |  | [stdout](latest/raw/eslint-host-typescript-receiver-inspect.stdout), [stderr](latest/raw/eslint-host-typescript-receiver-inspect.stderr) |
| Logical assignment | supported | matched | Matched | Yes |  | [stdout](latest/raw/eslint-baseline-logical-assignment-inspect.stdout), [stderr](latest/raw/eslint-baseline-logical-assignment-inspect.stderr) |
| Static Object.groupBy | supported | matched | Matched | Yes |  | [stdout](latest/raw/eslint-baseline-static-groupby-inspect.stdout), [stderr](latest/raw/eslint-baseline-static-groupby-inspect.stderr) |
| Computed Object.groupBy | supported | matched | Matched | Yes |  | [stdout](latest/raw/eslint-baseline-computed-groupby-inspect.stdout), [stderr](latest/raw/eslint-baseline-computed-groupby-inspect.stderr) |
| Shadowed Object parameter | supported | matched | Matched | Yes |  | [stdout](latest/raw/eslint-baseline-shadowed-object-inspect.stdout), [stderr](latest/raw/eslint-baseline-shadowed-object-inspect.stderr) |
| Shadowed Object binding | supported | matched | Matched | Yes |  | [stdout](latest/raw/eslint-baseline-shadowed-binding-inspect.stdout), [stderr](latest/raw/eslint-baseline-shadowed-binding-inspect.stderr) |
| Global fetchLater | supported | matched | Matched | Yes |  | [stdout](latest/raw/eslint-baseline-global-fetchlater-inspect.stdout), [stderr](latest/raw/eslint-baseline-global-fetchlater-inspect.stderr) |
| TypeScript static Object.groupBy | supported | matched | Matched | Yes |  | [stdout](latest/raw/eslint-baseline-ts-static-groupby-inspect.stdout), [stderr](latest/raw/eslint-baseline-ts-static-groupby-inspect.stderr) |
| Typed Element.checkVisibility | supported | matched | Matched | Yes |  | [stdout](latest/raw/eslint-baseline-typed-element-inspect.stdout), [stderr](latest/raw/eslint-baseline-typed-element-inspect.stderr) |
| Typed Set.union | supported | matched | Matched | Yes |  | [stdout](latest/raw/eslint-baseline-typed-set-union-inspect.stdout), [stderr](latest/raw/eslint-baseline-typed-set-union-inspect.stderr) |
| Structural lookalike | supported | matched | Matched | Yes |  | [stdout](latest/raw/eslint-baseline-typed-lookalike-inspect.stdout), [stderr](latest/raw/eslint-baseline-typed-lookalike-inspect.stderr) |
| Named interface lookalike | supported | matched | Matched | Yes |  | [stdout](latest/raw/eslint-baseline-typed-nominal-lookalike-inspect.stdout), [stderr](latest/raw/eslint-baseline-typed-nominal-lookalike-inspect.stderr) |

### oxlint

Package 1.89.0, latest channel. Reported version 1.89.0. [Execution evidence](latest/report.json).

| Case | Capability | Correctness | Status | Expected result | Reason | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| Plugin options | supported | matched | Matched | Yes |  | [stdout](latest/raw/oxlint-host-plugin-options-inspect.stdout), [stderr](latest/raw/oxlint-host-plugin-options-inspect.stderr) |
| AST selectors | supported | matched | Matched | Yes |  | [stdout](latest/raw/oxlint-host-ast-selector-inspect.stdout), [stderr](latest/raw/oxlint-host-ast-selector-inspect.stderr) |
| Function scope shadowing | supported | matched | Matched | Yes |  | [stdout](latest/raw/oxlint-host-scope-shadowing-inspect.stdout), [stderr](latest/raw/oxlint-host-scope-shadowing-inspect.stderr) |
| Top-level scope binding | supported | matched | Matched | Yes |  | [stdout](latest/raw/oxlint-host-scope-binding-inspect.stdout), [stderr](latest/raw/oxlint-host-scope-binding-inspect.stderr) |
| Source text and tokens | supported | matched | Matched | Yes |  | [stdout](latest/raw/oxlint-host-source-tokens-inspect.stdout), [stderr](latest/raw/oxlint-host-source-tokens-inspect.stderr) |
| Diagnostic locations | supported | matched | Matched | Yes |  | [stdout](latest/raw/oxlint-host-diagnostic-location-inspect.stdout), [stderr](latest/raw/oxlint-host-diagnostic-location-inspect.stderr) |
| Node ancestry | supported | matched | Matched | Yes |  | [stdout](latest/raw/oxlint-host-ancestry-inspect.stdout), [stderr](latest/raw/oxlint-host-ancestry-inspect.stderr) |
| TypeScript receiver services | unavailable | not-assessed | Unsupported | Yes | typed parser services unavailable | [stdout](latest/raw/oxlint-host-typescript-receiver-inspect.stdout), [stderr](latest/raw/oxlint-host-typescript-receiver-inspect.stderr) |
| Logical assignment | supported | matched | Matched | Yes |  | [stdout](latest/raw/oxlint-baseline-logical-assignment-inspect.stdout), [stderr](latest/raw/oxlint-baseline-logical-assignment-inspect.stderr) |
| Static Object.groupBy | supported | matched | Matched | Yes |  | [stdout](latest/raw/oxlint-baseline-static-groupby-inspect.stdout), [stderr](latest/raw/oxlint-baseline-static-groupby-inspect.stderr) |
| Computed Object.groupBy | supported | matched | Matched | Yes |  | [stdout](latest/raw/oxlint-baseline-computed-groupby-inspect.stdout), [stderr](latest/raw/oxlint-baseline-computed-groupby-inspect.stderr) |
| Shadowed Object parameter | supported | matched | Matched | Yes |  | [stdout](latest/raw/oxlint-baseline-shadowed-object-inspect.stdout), [stderr](latest/raw/oxlint-baseline-shadowed-object-inspect.stderr) |
| Shadowed Object binding | supported | matched | Matched | Yes |  | [stdout](latest/raw/oxlint-baseline-shadowed-binding-inspect.stdout), [stderr](latest/raw/oxlint-baseline-shadowed-binding-inspect.stderr) |
| Global fetchLater | supported | matched | Matched | Yes |  | [stdout](latest/raw/oxlint-baseline-global-fetchlater-inspect.stdout), [stderr](latest/raw/oxlint-baseline-global-fetchlater-inspect.stderr) |
| TypeScript static Object.groupBy | supported | matched | Matched | Yes |  | [stdout](latest/raw/oxlint-baseline-ts-static-groupby-inspect.stdout), [stderr](latest/raw/oxlint-baseline-ts-static-groupby-inspect.stderr) |
| Typed Element.checkVisibility | unavailable | not-verified | Unsupported | Yes | Required receiver analysis is unavailable; this case remains unverified | [stdout](latest/raw/oxlint-baseline-typed-element-inspect.stdout), [stderr](latest/raw/oxlint-baseline-typed-element-inspect.stderr) |
| Typed Set.union | unavailable | not-verified | Unsupported | Yes | Required receiver analysis is unavailable; this case remains unverified | [stdout](latest/raw/oxlint-baseline-typed-set-union-inspect.stdout), [stderr](latest/raw/oxlint-baseline-typed-set-union-inspect.stderr) |
| Structural lookalike | unavailable | not-verified | Unsupported | Yes | Required receiver analysis is unavailable; this case remains unverified | [stdout](latest/raw/oxlint-baseline-typed-lookalike-inspect.stdout), [stderr](latest/raw/oxlint-baseline-typed-lookalike-inspect.stderr) |
| Named interface lookalike | unavailable | not-verified | Unsupported | Yes | Required receiver analysis is unavailable; this case remains unverified | [stdout](latest/raw/oxlint-baseline-typed-nominal-lookalike-inspect.stdout), [stderr](latest/raw/oxlint-baseline-typed-nominal-lookalike-inspect.stderr) |

### bun

Package 1.4.4-canary.20261025.1+179664e, canary channel. Reported version 1.4.4-canary.1+a8fcd319b. [Execution evidence](latest/report.json).

| Case | Capability | Correctness | Status | Expected result | Reason | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| Plugin options | supported | matched | Matched | Yes |  | [stdout](latest/raw/bun-host-plugin-options-inspect.stdout), [stderr](latest/raw/bun-host-plugin-options-inspect.stderr) |
| AST selectors | supported | matched | Matched | Yes |  | [stdout](latest/raw/bun-host-ast-selector-inspect.stdout), [stderr](latest/raw/bun-host-ast-selector-inspect.stderr) |
| Function scope shadowing | supported | matched | Matched | Yes |  | [stdout](latest/raw/bun-host-scope-shadowing-inspect.stdout), [stderr](latest/raw/bun-host-scope-shadowing-inspect.stderr) |
| Top-level scope binding | supported | matched | Matched | Yes |  | [stdout](latest/raw/bun-host-scope-binding-inspect.stdout), [stderr](latest/raw/bun-host-scope-binding-inspect.stderr) |
| Source text and tokens | supported | matched | Matched | Yes |  | [stdout](latest/raw/bun-host-source-tokens-inspect.stdout), [stderr](latest/raw/bun-host-source-tokens-inspect.stderr) |
| Diagnostic locations | supported | matched | Matched | Yes |  | [stdout](latest/raw/bun-host-diagnostic-location-inspect.stdout), [stderr](latest/raw/bun-host-diagnostic-location-inspect.stderr) |
| Node ancestry | supported | matched | Matched | Yes |  | [stdout](latest/raw/bun-host-ancestry-inspect.stdout), [stderr](latest/raw/bun-host-ancestry-inspect.stderr) |
| TypeScript receiver services | unavailable | not-assessed | Unsupported | Yes | typed parser services unavailable | [stdout](latest/raw/bun-host-typescript-receiver-inspect.stdout), [stderr](latest/raw/bun-host-typescript-receiver-inspect.stderr) |
| Logical assignment | supported | matched | Matched | Yes |  | [stdout](latest/raw/bun-baseline-logical-assignment-inspect.stdout), [stderr](latest/raw/bun-baseline-logical-assignment-inspect.stderr) |
| Static Object.groupBy | supported | matched | Matched | Yes |  | [stdout](latest/raw/bun-baseline-static-groupby-inspect.stdout), [stderr](latest/raw/bun-baseline-static-groupby-inspect.stderr) |
| Computed Object.groupBy | supported | matched | Matched | Yes |  | [stdout](latest/raw/bun-baseline-computed-groupby-inspect.stdout), [stderr](latest/raw/bun-baseline-computed-groupby-inspect.stderr) |
| Shadowed Object parameter | supported | matched | Matched | Yes |  | [stdout](latest/raw/bun-baseline-shadowed-object-inspect.stdout), [stderr](latest/raw/bun-baseline-shadowed-object-inspect.stderr) |
| Shadowed Object binding | supported | matched | Matched | Yes |  | [stdout](latest/raw/bun-baseline-shadowed-binding-inspect.stdout), [stderr](latest/raw/bun-baseline-shadowed-binding-inspect.stderr) |
| Global fetchLater | supported | matched | Matched | Yes |  | [stdout](latest/raw/bun-baseline-global-fetchlater-inspect.stdout), [stderr](latest/raw/bun-baseline-global-fetchlater-inspect.stderr) |
| TypeScript static Object.groupBy | supported | matched | Matched | Yes |  | [stdout](latest/raw/bun-baseline-ts-static-groupby-inspect.stdout), [stderr](latest/raw/bun-baseline-ts-static-groupby-inspect.stderr) |
| Typed Element.checkVisibility | unavailable | not-verified | Unsupported | Yes | Required receiver analysis is unavailable; this case remains unverified | [stdout](latest/raw/bun-baseline-typed-element-inspect.stdout), [stderr](latest/raw/bun-baseline-typed-element-inspect.stderr) |
| Typed Set.union | unavailable | not-verified | Unsupported | Yes | Required receiver analysis is unavailable; this case remains unverified | [stdout](latest/raw/bun-baseline-typed-set-union-inspect.stdout), [stderr](latest/raw/bun-baseline-typed-set-union-inspect.stderr) |
| Structural lookalike | unavailable | not-verified | Unsupported | Yes | Required receiver analysis is unavailable; this case remains unverified | [stdout](latest/raw/bun-baseline-typed-lookalike-inspect.stdout), [stderr](latest/raw/bun-baseline-typed-lookalike-inspect.stderr) |
| Named interface lookalike | unavailable | not-verified | Unsupported | Yes | Required receiver analysis is unavailable; this case remains unverified | [stdout](latest/raw/bun-baseline-typed-nominal-lookalike-inspect.stdout), [stderr](latest/raw/bun-baseline-typed-nominal-lookalike-inspect.stderr) |

## Reproduce the measurement

Check out harness commit `69686c6863122a725fb18ed0073835a8a6a7bcc3`. Use the Node version recorded in the profile's execution evidence.

Save [subject.json](subject/subject.json), [package.json](subject/package.json), and [pnpm-lock.yaml](subject/pnpm-lock.yaml) together in a subject directory.
Download the [exact npm package](https://registry.npmjs.org/eslint-plugin-baseline-js/-/eslint-plugin-baseline-js-0.7.6.tgz) into that directory as `subject.tgz`. The collector checks its SHA-512 integrity before installation.

Save the pinned [tool manifest](pinned/tools/package.json) and [tool lock](pinned/tools/pnpm-lock.yaml) together. Use the pnpm version in that manifest.

```sh
CONFORMANCE_PROFILE=pinned node conformance/run.ts --subject /path/to/subject --tools /path/to/pinned/tools --out /path/to/reproduced/pinned
```

Save the latest [tool manifest](latest/tools/package.json) and [tool lock](latest/tools/pnpm-lock.yaml) together. Use the pnpm version in that manifest.

```sh
CONFORMANCE_PROFILE=latest node conformance/run.ts --subject /path/to/subject --tools /path/to/latest/tools --out /path/to/reproduced/latest
```

The saved locks select the measured package versions. Evidence replaces known local paths with `<repository>`, `<profile>`, `<home>`, `<node>`, and `<artifact>`. File URLs retain their `file://` prefix. Other output remains unchanged. Execution hashes describe the original inputs. The Git commit identifies the published text.

