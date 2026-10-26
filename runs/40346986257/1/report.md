# Linter compatibility

Measured **eslint-plugin-baseline-js 0.7.6** from npm.
Run [9, attempt 1](https://github.com/3ru/eslint-plugin-baseline-js/actions/runs/40346986257/attempts/1) started 2026-10-26T15:12:10Z.

These cases use Baseline 2019. Results cover the code, configuration, and versions shown. They do not establish full compatibility.
Expected result refers to each recorded example. ✅ means the host ran the check and returned the correct result. ❌ Unsupported means the check could not be verified. A false positive is a warning where none is expected.

## Latest toolchain

Captured 2026-10-26T15:12:51.281Z.

ESLint 10.13.0 · Oxlint 1.89.0 · Bun 1.4.4-canary.20261026.1+449877f.

### Logical assignment

```js
let value;
value ||= 1;
```

Expected warning for logical-assignments at line 2, column 7.

| ESLint | Oxlint | Bun |
| --- | --- | --- |
| ✅ Warns | ✅ Warns | ✅ Warns |

### Static Object.groupBy

```js
Object.groupBy([], String);
```

Expected warning for array-group at line 1, column 8.

| ESLint | Oxlint | Bun |
| --- | --- | --- |
| ✅ Warns | ✅ Warns | ✅ Warns |

### Computed Object.groupBy

```js
Object['groupBy']([], String);
```

Expected warning for array-group at line 1, column 8.

| ESLint | Oxlint | Bun |
| --- | --- | --- |
| ✅ Warns | ✅ Warns | ✅ Warns |

### Shadowed Object parameter

```js
function local(Object) {
  Object.groupBy([], String);
}
```

Expected no warning.

| ESLint | Oxlint | Bun |
| --- | --- | --- |
| ✅ No warning | ✅ No warning | ✅ No warning |

### Shadowed Object binding

```js
const Object = { groupBy() {} };
Object.groupBy([], String);
```

Expected no warning.

| ESLint | Oxlint | Bun |
| --- | --- | --- |
| ✅ No warning | ✅ No warning | ✅ No warning |

### Global fetchLater

```js
fetchLater('/beacon');
```

Expected warning for fetchlater at line 1, column 1.

| ESLint | Oxlint | Bun |
| --- | --- | --- |
| ✅ Warns | ✅ Warns | ✅ Warns |

### TypeScript static Object.groupBy

```ts
declare const input: string[];
Object.groupBy(input, String);
export {};
```

Expected warning for array-group at line 2, column 8.

| ESLint | Oxlint | Bun |
| --- | --- | --- |
| ✅ Warns | ✅ Warns | ✅ Warns |

### Typed Element.checkVisibility

```ts
declare const element: Element;
element.checkVisibility();
export {};
```

Expected warning for check-visibility at line 2, column 9.

| ESLint | Oxlint | Bun |
| --- | --- | --- |
| ✅ Warns | ❌ Unsupported | ❌ Unsupported |

### Typed Set.union

```ts
declare const values: Set<unknown>;
values.union(new Set());
export {};
```

Expected warning for set-methods at line 2, column 8.

| ESLint | Oxlint | Bun |
| --- | --- | --- |
| ✅ Warns | ❌ Unsupported | ❌ Unsupported |

### Structural lookalike

```ts
const element = { checkVisibility() { return true; } };
element.checkVisibility();
export {};
```

Expected no warning.

| ESLint | Oxlint | Bun |
| --- | --- | --- |
| ✅ No warning | ❌ Unsupported | ❌ Unsupported |

### Named interface lookalike

```ts
interface Element { checkVisibility(): boolean }
declare const element: Element;
element.checkVisibility();
export {};
```

Expected no warning.

| ESLint | Oxlint | Bun |
| --- | --- | --- |
| ✅ No warning | ❌ Unsupported | ❌ Unsupported |

<details>
<summary>Host API checks</summary>

| Host API | ESLint | Oxlint | Bun |
| --- | --- | --- | --- |
| Plugin options | ✅ Works | ✅ Works | ✅ Works |
| AST selectors | ✅ Works | ✅ Works | ✅ Works |
| Function scope shadowing | ✅ Works | ✅ Works | ✅ Works |
| Top-level scope binding | ✅ Works | ✅ Works | ✅ Works |
| Source text and tokens | ✅ Works | ✅ Works | ✅ Works |
| Diagnostic locations | ✅ Works | ✅ Works | ✅ Works |
| Node ancestry | ✅ Works | ✅ Works | ✅ Works |
| TypeScript receiver services | ✅ Works | ❌ Unsupported | ❌ Unsupported |

</details>

<details>
<summary>Pinned toolchain</summary>

## Pinned toolchain

Captured 2026-10-26T15:12:52.558Z.

ESLint 10.13.0 · Oxlint 1.88.0 · Bun 1.4.3-canary.20261017.1+017b243.

### Logical assignment

```js
let value;
value ||= 1;
```

Expected warning for logical-assignments at line 2, column 7.

| ESLint | Oxlint | Bun |
| --- | --- | --- |
| ✅ Warns | ✅ Warns | ✅ Warns |

### Static Object.groupBy

```js
Object.groupBy([], String);
```

Expected warning for array-group at line 1, column 8.

| ESLint | Oxlint | Bun |
| --- | --- | --- |
| ✅ Warns | ✅ Warns | ✅ Warns |

### Computed Object.groupBy

```js
Object['groupBy']([], String);
```

Expected warning for array-group at line 1, column 8.

| ESLint | Oxlint | Bun |
| --- | --- | --- |
| ✅ Warns | ✅ Warns | ✅ Warns |

### Shadowed Object parameter

```js
function local(Object) {
  Object.groupBy([], String);
}
```

Expected no warning.

| ESLint | Oxlint | Bun |
| --- | --- | --- |
| ✅ No warning | ✅ No warning | ✅ No warning |

### Shadowed Object binding

```js
const Object = { groupBy() {} };
Object.groupBy([], String);
```

Expected no warning.

| ESLint | Oxlint | Bun |
| --- | --- | --- |
| ✅ No warning | ✅ No warning | ✅ No warning |

### Global fetchLater

```js
fetchLater('/beacon');
```

Expected warning for fetchlater at line 1, column 1.

| ESLint | Oxlint | Bun |
| --- | --- | --- |
| ✅ Warns | ✅ Warns | ✅ Warns |

### TypeScript static Object.groupBy

```ts
declare const input: string[];
Object.groupBy(input, String);
export {};
```

Expected warning for array-group at line 2, column 8.

| ESLint | Oxlint | Bun |
| --- | --- | --- |
| ✅ Warns | ✅ Warns | ✅ Warns |

### Typed Element.checkVisibility

```ts
declare const element: Element;
element.checkVisibility();
export {};
```

Expected warning for check-visibility at line 2, column 9.

| ESLint | Oxlint | Bun |
| --- | --- | --- |
| ✅ Warns | ❌ Unsupported | ❌ Unsupported |

### Typed Set.union

```ts
declare const values: Set<unknown>;
values.union(new Set());
export {};
```

Expected warning for set-methods at line 2, column 8.

| ESLint | Oxlint | Bun |
| --- | --- | --- |
| ✅ Warns | ❌ Unsupported | ❌ Unsupported |

### Structural lookalike

```ts
const element = { checkVisibility() { return true; } };
element.checkVisibility();
export {};
```

Expected no warning.

| ESLint | Oxlint | Bun |
| --- | --- | --- |
| ✅ No warning | ❌ Unsupported | ❌ Unsupported |

### Named interface lookalike

```ts
interface Element { checkVisibility(): boolean }
declare const element: Element;
element.checkVisibility();
export {};
```

Expected no warning.

| ESLint | Oxlint | Bun |
| --- | --- | --- |
| ✅ No warning | ❌ Unsupported | ❌ Unsupported |

<details>
<summary>Host API checks</summary>

| Host API | ESLint | Oxlint | Bun |
| --- | --- | --- | --- |
| Plugin options | ✅ Works | ✅ Works | ✅ Works |
| AST selectors | ✅ Works | ✅ Works | ✅ Works |
| Function scope shadowing | ✅ Works | ✅ Works | ✅ Works |
| Top-level scope binding | ✅ Works | ✅ Works | ✅ Works |
| Source text and tokens | ✅ Works | ✅ Works | ✅ Works |
| Diagnostic locations | ✅ Works | ✅ Works | ✅ Works |
| Node ancestry | ✅ Works | ✅ Works | ✅ Works |
| TypeScript receiver services | ✅ Works | ❌ Unsupported | ❌ Unsupported |

</details>

</details>

<details>
<summary>Versions, evidence, and reproduction</summary>

Harness commit [99db547e724cb9cec409bce7c0329b57800f040d](https://github.com/3ru/eslint-plugin-baseline-js/commit/99db547e724cb9cec409bce7c0329b57800f040d).
[Snapshot JSON](report.json).
A retry can reuse completed observations from the same workflow run. Capture dates and saved collection identities retain their origin.

### pinned execution evidence

Parser 8.71.2. TypeScript 6.0.3. [Collection identity](pinned/identity.json). [Execution report](pinned/report.json).

ESLint package 10.13.0, pinned channel. Executable v10.13.0.
Oxlint package 1.88.0, pinned channel. Executable 1.88.0.
Bun package 1.4.3-canary.20261017.1+017b243, canary channel. Executable 1.4.4-canary.1+5f5799ed1.

| Case | Linter | Observation | Evidence |
| --- | --- | --- | --- |
| TypeScript receiver services | Oxlint | ❌ Unsupported. typed parser services unavailable | [stdout](pinned/raw/oxlint-host-typescript-receiver-inspect.stdout), [stderr](pinned/raw/oxlint-host-typescript-receiver-inspect.stderr) |
| TypeScript receiver services | Bun | ❌ Unsupported. typed parser services unavailable | [stdout](pinned/raw/bun-host-typescript-receiver-inspect.stdout), [stderr](pinned/raw/bun-host-typescript-receiver-inspect.stderr) |
| Typed Element.checkVisibility | Oxlint | ❌ Unsupported. Required receiver analysis is unavailable; this case remains unverified | [stdout](pinned/raw/oxlint-baseline-typed-element-inspect.stdout), [stderr](pinned/raw/oxlint-baseline-typed-element-inspect.stderr) |
| Typed Element.checkVisibility | Bun | ❌ Unsupported. Required receiver analysis is unavailable; this case remains unverified | [stdout](pinned/raw/bun-baseline-typed-element-inspect.stdout), [stderr](pinned/raw/bun-baseline-typed-element-inspect.stderr) |
| Typed Set.union | Oxlint | ❌ Unsupported. Required receiver analysis is unavailable; this case remains unverified | [stdout](pinned/raw/oxlint-baseline-typed-set-union-inspect.stdout), [stderr](pinned/raw/oxlint-baseline-typed-set-union-inspect.stderr) |
| Typed Set.union | Bun | ❌ Unsupported. Required receiver analysis is unavailable; this case remains unverified | [stdout](pinned/raw/bun-baseline-typed-set-union-inspect.stdout), [stderr](pinned/raw/bun-baseline-typed-set-union-inspect.stderr) |
| Structural lookalike | Oxlint | ❌ Unsupported. Required receiver analysis is unavailable; this case remains unverified | [stdout](pinned/raw/oxlint-baseline-typed-lookalike-inspect.stdout), [stderr](pinned/raw/oxlint-baseline-typed-lookalike-inspect.stderr) |
| Structural lookalike | Bun | ❌ Unsupported. Required receiver analysis is unavailable; this case remains unverified | [stdout](pinned/raw/bun-baseline-typed-lookalike-inspect.stdout), [stderr](pinned/raw/bun-baseline-typed-lookalike-inspect.stderr) |
| Named interface lookalike | Oxlint | ❌ Unsupported. Required receiver analysis is unavailable; this case remains unverified | [stdout](pinned/raw/oxlint-baseline-typed-nominal-lookalike-inspect.stdout), [stderr](pinned/raw/oxlint-baseline-typed-nominal-lookalike-inspect.stderr) |
| Named interface lookalike | Bun | ❌ Unsupported. Required receiver analysis is unavailable; this case remains unverified | [stdout](pinned/raw/bun-baseline-typed-nominal-lookalike-inspect.stdout), [stderr](pinned/raw/bun-baseline-typed-nominal-lookalike-inspect.stderr) |

### latest execution evidence

Parser 8.72.0. TypeScript 6.0.3. [Collection identity](latest/identity.json). [Execution report](latest/report.json).

ESLint package 10.13.0, latest channel. Executable v10.13.0.
Oxlint package 1.89.0, latest channel. Executable 1.89.0.
Bun package 1.4.4-canary.20261026.1+449877f, canary channel. Executable 1.4.4-canary.1+a8fcd319b.

| Case | Linter | Observation | Evidence |
| --- | --- | --- | --- |
| TypeScript receiver services | Oxlint | ❌ Unsupported. typed parser services unavailable | [stdout](latest/raw/oxlint-host-typescript-receiver-inspect.stdout), [stderr](latest/raw/oxlint-host-typescript-receiver-inspect.stderr) |
| TypeScript receiver services | Bun | ❌ Unsupported. typed parser services unavailable | [stdout](latest/raw/bun-host-typescript-receiver-inspect.stdout), [stderr](latest/raw/bun-host-typescript-receiver-inspect.stderr) |
| Typed Element.checkVisibility | Oxlint | ❌ Unsupported. Required receiver analysis is unavailable; this case remains unverified | [stdout](latest/raw/oxlint-baseline-typed-element-inspect.stdout), [stderr](latest/raw/oxlint-baseline-typed-element-inspect.stderr) |
| Typed Element.checkVisibility | Bun | ❌ Unsupported. Required receiver analysis is unavailable; this case remains unverified | [stdout](latest/raw/bun-baseline-typed-element-inspect.stdout), [stderr](latest/raw/bun-baseline-typed-element-inspect.stderr) |
| Typed Set.union | Oxlint | ❌ Unsupported. Required receiver analysis is unavailable; this case remains unverified | [stdout](latest/raw/oxlint-baseline-typed-set-union-inspect.stdout), [stderr](latest/raw/oxlint-baseline-typed-set-union-inspect.stderr) |
| Typed Set.union | Bun | ❌ Unsupported. Required receiver analysis is unavailable; this case remains unverified | [stdout](latest/raw/bun-baseline-typed-set-union-inspect.stdout), [stderr](latest/raw/bun-baseline-typed-set-union-inspect.stderr) |
| Structural lookalike | Oxlint | ❌ Unsupported. Required receiver analysis is unavailable; this case remains unverified | [stdout](latest/raw/oxlint-baseline-typed-lookalike-inspect.stdout), [stderr](latest/raw/oxlint-baseline-typed-lookalike-inspect.stderr) |
| Structural lookalike | Bun | ❌ Unsupported. Required receiver analysis is unavailable; this case remains unverified | [stdout](latest/raw/bun-baseline-typed-lookalike-inspect.stdout), [stderr](latest/raw/bun-baseline-typed-lookalike-inspect.stderr) |
| Named interface lookalike | Oxlint | ❌ Unsupported. Required receiver analysis is unavailable; this case remains unverified | [stdout](latest/raw/oxlint-baseline-typed-nominal-lookalike-inspect.stdout), [stderr](latest/raw/oxlint-baseline-typed-nominal-lookalike-inspect.stderr) |
| Named interface lookalike | Bun | ❌ Unsupported. Required receiver analysis is unavailable; this case remains unverified | [stdout](latest/raw/bun-baseline-typed-nominal-lookalike-inspect.stdout), [stderr](latest/raw/bun-baseline-typed-nominal-lookalike-inspect.stderr) |

### Reproduce the measurement

[Exact npm package](https://registry.npmjs.org/eslint-plugin-baseline-js/-/eslint-plugin-baseline-js-0.7.6.tgz), resolved 2026-10-26T15:12:28.253Z. Integrity `sha512-z2PEC/N6WSrcmYunFVutSKRqWURnXbdkyDboal4dztiYdC8OjaiaaJ1xDtWCV1lXR8VWbcxosICzPNz0N9enPQ==`.
Check out harness commit `99db547e724cb9cec409bce7c0329b57800f040d`. Use the Node version recorded in the execution report.
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

</details>

