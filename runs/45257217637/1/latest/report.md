# Toolchain capability report

Profile: latest. Captured at: 2026-11-23T20:14:35.579Z.
Harness source: 1bb8308055fd434024347fa9eddd41d64c481e45.
Measured product: npm release. Version: 0.7.7.

This compares external JavaScript plugin capabilities and a small Baseline corpus. It is not a speed benchmark or browser compatibility certification.

Known missing receiver services remain **unsupported**, including negative cases. An expectation match means the recorded behavior was anticipated; it does not mean all checks ran.

| Tool | Package | Reported version |
| --- | --- | --- |
| eslint | 10.15.0 | v10.15.0 |
| oxlint | 1.95.0 | 1.95.0 |
| bun | 1.4.5-canary.20261123.1+dac8e3b | 1.4.6-canary.1+dac8e3b0f |

Parser: 8.74.0. TypeScript reference: 6.0.3.

| Case | Tool | Host capability | Result | Expected behavior observed |
| --- | --- | --- | --- | --- |
| host-plugin-options | eslint | supported | matched | yes |
| host-ast-selector | eslint | supported | matched | yes |
| host-scope-shadowing | eslint | supported | matched | yes |
| host-scope-binding | eslint | supported | matched | yes |
| host-source-tokens | eslint | supported | matched | yes |
| host-diagnostic-location | eslint | supported | matched | yes |
| host-ancestry | eslint | supported | matched | yes |
| host-typescript-receiver | eslint | supported | matched | yes |
| baseline-logical-assignment | eslint | supported | matched | yes |
| baseline-static-groupby | eslint | supported | matched | yes |
| baseline-computed-groupby | eslint | supported | matched | yes |
| baseline-shadowed-object | eslint | supported | matched | yes |
| baseline-shadowed-binding | eslint | supported | matched | yes |
| baseline-global-fetchlater | eslint | supported | matched | yes |
| baseline-ts-static-groupby | eslint | supported | matched | yes |
| baseline-typed-element | eslint | supported | matched | yes |
| baseline-typed-set-union | eslint | supported | matched | yes |
| baseline-typed-lookalike | eslint | supported | matched | yes |
| baseline-typed-nominal-lookalike | eslint | supported | matched | yes |
| host-plugin-options | oxlint | supported | matched | yes |
| host-ast-selector | oxlint | supported | matched | yes |
| host-scope-shadowing | oxlint | supported | matched | yes |
| host-scope-binding | oxlint | supported | matched | yes |
| host-source-tokens | oxlint | supported | matched | yes |
| host-diagnostic-location | oxlint | supported | matched | yes |
| host-ancestry | oxlint | supported | matched | yes |
| host-typescript-receiver | oxlint | unavailable | unsupported | yes |
| baseline-logical-assignment | oxlint | supported | matched | yes |
| baseline-static-groupby | oxlint | supported | matched | yes |
| baseline-computed-groupby | oxlint | supported | matched | yes |
| baseline-shadowed-object | oxlint | supported | matched | yes |
| baseline-shadowed-binding | oxlint | supported | matched | yes |
| baseline-global-fetchlater | oxlint | supported | matched | yes |
| baseline-ts-static-groupby | oxlint | supported | matched | yes |
| baseline-typed-element | oxlint | unavailable | unsupported | yes |
| baseline-typed-set-union | oxlint | unavailable | unsupported | yes |
| baseline-typed-lookalike | oxlint | unavailable | unsupported | yes |
| baseline-typed-nominal-lookalike | oxlint | unavailable | unsupported | yes |
| host-plugin-options | bun | supported | matched | yes |
| host-ast-selector | bun | supported | matched | yes |
| host-scope-shadowing | bun | supported | matched | yes |
| host-scope-binding | bun | supported | matched | yes |
| host-source-tokens | bun | supported | matched | yes |
| host-diagnostic-location | bun | supported | matched | yes |
| host-ancestry | bun | supported | matched | yes |
| host-typescript-receiver | bun | unavailable | unsupported | yes |
| baseline-logical-assignment | bun | supported | matched | yes |
| baseline-static-groupby | bun | supported | matched | yes |
| baseline-computed-groupby | bun | supported | matched | yes |
| baseline-shadowed-object | bun | supported | matched | yes |
| baseline-shadowed-binding | bun | supported | matched | yes |
| baseline-global-fetchlater | bun | supported | matched | yes |
| baseline-ts-static-groupby | bun | supported | matched | yes |
| baseline-typed-element | bun | unavailable | unsupported | yes |
| baseline-typed-set-union | bun | unavailable | unsupported | yes |
| baseline-typed-lookalike | bun | unavailable | unsupported | yes |
| baseline-typed-nominal-lookalike | bun | unavailable | unsupported | yes |

