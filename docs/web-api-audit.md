# Web API detection audit

The audit used the pinned `web-features@3.40.0` snapshot and the v0.7.4
descriptor data, before the fixes below. It inspected every `api.*` compat key
and exercised supported detector patterns. This is an inventory and regression
audit, not a guarantee that every JavaScript spelling or Web API behavior is
detected.

## Inventory

| Compat key shape | Keys | Existing generation behavior |
| --- | ---: | --- |
| `api.Name` | 1,007 | Global-call pattern; includes interface and singleton names that are not callable |
| `api.Interface.member` | 7,090 | Constructor, static, global member, or typed instance pattern |
| Four or more segments | 895 | Skipped unless an explicit argument or option pattern exists |
| Total | 8,992 | 547 feature IDs |

The 111 direct `api.Window.*` keys comprise 31 operations, 46 attributes, and
34 event compatibility labels. Only operations can safely become global-call
patterns. The generator and descriptor compatibility check now reject
unreviewed Window members during a data update.

The original 8,180 API descriptors included 1,757 safe patterns and 6,423 typed
instance patterns. The safe detector audit probed 12,654 expression shapes.
The typed audit matched 4,325 descriptors against TypeScript 6 DOM declarations
and checked 9,493 receiver/descriptor pairs across inherited interfaces;
2,098 descriptors had no corresponding declaration in that DOM snapshot.
After correcting mappings, the descriptor inventory is 8,212: 1,792 safe
patterns and 6,420 typed instance patterns. Declaration absence does not
establish a detector defect. Runtime behavior, receiver provenance, shadowing,
and the selected preset still determine
whether a particular use can be reported.

## Corrected generation gaps

The regression corpus lints actual source snippets under a policy that reports
each feature independently of its current Baseline status. It also checks
shadowed names and nearby unsupported or absent options.

- Bare calls to all 31 reviewed Window operations now receive global-call
  descriptors, including `fetchLater`, the file pickers, `queryLocalFonts`,
  `getScreenDetails`, `requestIdleCallback`, and `getComputedStyle`.
- Eight static attributes now receive read patterns instead of call patterns:
  `CSS.highlights`, `CSS.paintWorklet`, `MediaSource.canConstructInDedicatedWorker`,
  `Notification.permission`, `Notification.maxActions`,
  `PerformanceObserver.supportedEntryTypes`,
  `PushManager.supportedContentEncodings`, and `PressureObserver.knownSources`.
- The HTML legacy factories `new Audio()`, `new Image()`, and `new Option()`
  now map to their actual global constructor names.
- Literal `SharedWorker` options containing `extendedLifetime` now receive the
  existing constructor-option pattern.

The classification rules live in
[`classify-web-apis.mjs`](../scripts/data/classify-web-apis.mjs), with specification
links beside exceptions. Their corpus is
[`webapi-generation.spec.ts`](../tests/webapi-generation.spec.ts).

## Corrected access and type gaps

- Global calls and constructors recognize explicit `window`, `self`, and
  `globalThis` receivers, including nested global-object paths. Literal bracket
  properties and optional chains use the same matching rules as dot access.
  Locally shadowed roots and dynamic property names are excluded.
- Overlapping Window-call descriptors report a feature once at the same node.
- Typed instance checks follow the full inheritance chain and constrained
  generics, and remove nullish constituents before checking optional access.
  A property must still exist on the receiver type; `any`, `unknown`, and
  unrelated object types do not establish an API match.
- Web API and JS builtin type options are applied independently. Enabling
  typed checks for one domain no longer enables them for the other's safe preset.
- Literal options use the last matching property value. A later spread or
  dynamic key can obscure that value, so value-specific checks are suppressed
  when the final value is uncertain.

The regression suites include shadowing, dynamic keys, duplicate reports, and
option overrides as negative cases. The repeatable
[`safe corpus`](../tests/webapi-safe-corpus.spec.ts) checks all 1,792 safe API
descriptors across 28,443 syntax fixtures, plus 3,001 builtin fixtures affected
by the shared AST helpers. These are detector-shape checks, not evidence that a
mapping is semantically correct or that an API exists in a browser runtime.

The [`type declaration corpus`](../tests/webapi-dom-corpus.spec.ts) compiles and
lints separate DOM and Web Worker programs:

| Declaration environment | Resolvable descriptors | Direct/nullable/generic fixtures | Deeply inherited fixtures | Total |
| --- | ---: | ---: | ---: | ---: |
| DOM | 4,325 | 12,975 | 9,493 | 22,468 |
| Web Worker | 1,631 | 4,893 | 7 | 4,900 |

All 27,368 fixtures have zero TypeScript diagnostics and the expected feature ID
on their source line. This validates generated instance patterns; the independent
generation fixtures separately test mappings that were missing or incorrectly
classified. Unavailable declarations are counted and printed for each environment
rather than treated as detector failures.

## Remaining boundaries

Window attribute reads require an explicit receiver such as `window.cookieStore`;
bare identifiers such as `cookieStore` do not have a general property-read
descriptor. An operation descriptor also does not provide general function
reference or alias tracking. Event compat labels such as `beforeunload_event`
do not translate into `addEventListener("beforeunload", ...)` or `onbeforeunload`
detection. These need additional detector contracts, not a call pattern for
every Window member.

The 895 deeper keys include option values, argument types, returned values,
event details, and behavioral changes. Flattening these to a parent method
would report code that does not use the subfeature. After the constructor-option
fix, 15 API feature IDs still have no API descriptor:

| Status | Feature IDs |
| --- | --- |
| Explicit coverage exclusions | `clipboard-unsanitized-formats`, `contenteditable-plaintextonly`, `link-rel-prefetch`, `partitioned-cookies`, `popover-hint`, `scroll-into-view-container`, `webgl-sab` |
| Unmapped options, values, or behavior | `connection-allowlists`, `cookie-store-get-metadata`, `reporting-coep-violations`, `reporting-csp-violations`, `reporting-deprecation`, `reporting-integrity-violations`, `reporting-permissions-policy-violations`, `scroll-promises` |

The exclusions are recorded in
[`coverage/config.mjs`](../scripts/coverage/config.mjs). A feature with one
descriptor can still have unsupported subfeatures. Consequently, the generated
coverage percentage measures feature IDs with at least one mapping, not compat
keys or all source-code forms. Dynamic property names, reassigned aliases,
unresolved receiver types, and runtime-dependent behavior remain outside that
metric. Typed interface matching uses interface names and ancestry; it does not
prove that a same-named user declaration originated in the DOM library.

## Repeatable checks

Run `pnpm test` for runtime regressions, `pnpm check:descriptor-compat` for
descriptor/source consistency and the Window review gate, and
`pnpm check:generated-data` for deterministic generated output. Run
`pnpm gen:coverage` after changing mappings. New Window members require
classification against their specification before these checks can pass.
