<div align="center">

# eslint-plugin-baseline-js

![baseline](https://web-platform-dx.github.io/web-features/assets/img/baseline-wordmark-dark.svg)

Enforce the JavaScript Baseline (`widely` / `newly` / `year`) with a single ESLint rule powered by web‑features.
This plugin delegates detection to eslint-plugin-es-x and ESLint core (plus a few small gap‑filling rules) and reports with one consistent Baseline message.

[![npm](https://img.shields.io/npm/v/eslint-plugin-baseline-js?logoColor=green&color=green)](https://www.npmjs.com/package/eslint-plugin-baseline-js)
[![CI](https://github.com/3ru/eslint-plugin-baseline-js/actions/workflows/ci.yml/badge.svg)](https://github.com/3ru/eslint-plugin-baseline-js/actions/workflows/ci.yml)
[![Release](https://github.com/3ru/eslint-plugin-baseline-js/actions/workflows/release.yml/badge.svg)](https://github.com/3ru/eslint-plugin-baseline-js/actions/workflows/release.yml)
<img alt="License" src="https://img.shields.io/badge/license-MIT-blue" />

</div>

> [!NOTE]
> This project hasn’t reached a major release yet, so behavior and options may change. Please feel free to report false negatives/positives and any rough edges as [issues](https://github.com/3ru/eslint-plugin-baseline-js/issues).

## Install

- npm: `npm i -D eslint-plugin-baseline-js`
- pnpm: `pnpm add -D eslint-plugin-baseline-js`
- yarn: `yarn add -D eslint-plugin-baseline-js`

Recommended
- ESLint >= 8.57 (Flat Config)

## Quick Start (Flat Config)

```js
// eslint.config.js
import baselineJs from "eslint-plugin-baseline-js";

export default [
  {
    files: ["**/*.{js,ts,jsx,tsx}"],
    plugins: { "baseline-js": baselineJs },
    rules: {
      // Allow only "widely available" Baseline features
      "baseline-js/use-baseline": ["error", { available: "widely" }],
    },
  },
];
```

## Preset Configs

This plugin ships Flat Config presets you can call from `configs`:

```js
import baselineJs from "eslint-plugin-baseline-js";

export default [
  // Register the plugin once (required for Flat Config)
  { plugins: { "baseline-js": baselineJs } },

  // Recommended: enables Web APIs & JS builtins detection with `preset: 'auto'`.
  // Level defaults to 'error'; pass level to change severity
  baselineJs.configs.recommended({ available: "widely", level: "warn" }),

  // TypeScript-aware: requires type info for instance-member checks (`preset: 'type-aware'`).
  // Works best with @typescript-eslint/parser and a proper tsconfig.
  // baselineJs.configs["recommended-ts"]({ available: "widely", level: "error" }),
];
```

Note on plugin key
- Presets assume the plugin is registered under the key `"baseline-js"`.

See more real-world configs in [`examples/`](https://github.com/3ru/eslint-plugin-baseline-js/tree/main/examples)

## Common Configurations

```js
// Newly available (more permissive)
'baseline-js/use-baseline': ['warn', { available: 'newly' }];

// Year-based – allow features that became Baseline in or before 2020
'baseline-js/use-baseline': ['error', { available: 2020 }];

// Ignore knobs for pragmatic adoption
'baseline-js/use-baseline': [
  'error',
  {
    available: 2018,
    // Skip specific web-features by ID (or regex as '/.../')
    ignoreFeatures: ['nullish-coalescing', '/^optional-/'],
    // Skip reports produced on certain ESTree node types
    ignoreNodeTypes: ['WithStatement', '/Expression$/'],
  },
];

// Turn off in tests or generated folders (ESLint standard overrides)
export default [
  { /* project defaults ... */ },
  {
    files: ['**/*.test.*', 'coverage/**'],
    rules: { 'baseline-js/use-baseline': 'off' },
  },
];
```

## What Gets Reported?

> Features from web‑features (group: `"javascript"`) that exceed your configured Baseline.

| Baseline setting | Reports when...                     |
| ---------------- | ----------------------------------- |
| `"widely"`       | the feature is not in Baseline “high” |
| `"newly"`        | the feature is marked as limited (`false`) |
| `year` (number)  | the feature’s Baseline year is greater than `year` |


### Demo
<img width="963" height="192" alt="getYear is deprecated" src="https://github.com/user-attachments/assets/e04e4a5c-c104-4945-96d6-889a47b7bcde" />


## How It Works

1. Data → `scripts/build-features.mjs`
   - Extracts the minimal JavaScript subset from [`web‑features`](https://github.com/web-platform-dx/web-features) into `src/baseline/data/features.javascript.ts`.
2. Mapping → `src/baseline/mapping/syntax.ts`
   - Maps web‑features IDs to underlying rules (prefer `eslint-plugin-es-x` / ESLint core; custom rules only when necessary).
3. Resolution → `src/baseline/resolve.ts`
   - Classifies “beyond baseline” by bucket (`high/low/false → widely/newly/limited`) or year.

## Coverage

We publish a generated coverage report that lists all JavaScript features from web‑features
and shows which ones are currently mapped by this plugin.

- Report: [docs/coverage.md](docs/coverage.md)
- Regenerate locally: `pnpm gen:coverage`
  - The release workflow also regenerates and commits this file.

## Options (rule)

| Option                 | Type                      | Default    | Description |
| ---------------------- | ------------------------- | ---------- | ----------- |
| `baseline`             | `widely`, `newly`, `number`, `widely` | Baseline level or year (alias: `available`). |
| `ignoreFeatures`       | `string[]`                | —          | Skip specific web‑features by ID (supports regex `/.../`). |
| `ignoreNodeTypes`      | `string[]`                | —          | Suppress reports by ESTree `node.type` (supports regex `/.../`). |

## Baseline for HTML and CSS

Baseline works best when HTML, CSS, and JS all align. For markup and styles, enable the "use-baseline" rules from these ESLint plugins:

- ESLint for CSS: https://github.com/eslint/css
- HTML ESLint: https://github.com/yeonjuan/html-eslint

## Branding Note (Baseline)

The Baseline name and logos are Google trademarks. Logo assets are licensed under CC BY‑ND 4.0. If you use Baseline logos alongside this plugin, please follow the [official guidelines](https://web-platform-dx.github.io/web-features/name-and-logo-usage-guidelines/) and do not imply sponsorship, affiliation, or endorsement by Google. We embed the official Baseline icons via their published URLs (unmodified).

## License

MIT
