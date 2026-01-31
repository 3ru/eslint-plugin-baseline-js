/**
 * Coverage configuration for docs/coverage.md generation.
 * - Provide per-domain exclusions with a short memo for why they are out-of-scope.
 * - Keep this small and curated; prefer explicit IDs for clarity/maintainability.
 */

export default {
  api: {
    byId: {
      // HTML root/structure elements — JS rule does not parse markup; use html-eslint?
      head: { memo: "HTML element — use `html-eslint`", exclude: true },
      body: { memo: "HTML element — use `html-eslint`", exclude: true },
      br: { memo: "HTML element — use `html-eslint`", exclude: true },
      div: { memo: "HTML element — use `html-eslint`", exclude: true },
      menu: { memo: "HTML element — use `html-eslint`", exclude: true },
      p: { memo: "HTML element — use `html-eslint`", exclude: true },
      picture: { memo: "HTML element — use `html-eslint`", exclude: true },
      pre: { memo: "HTML element — use `html-eslint`", exclude: true },
      headings: { memo: "HTML headings — use `html-eslint`", exclude: true },
      hr: { memo: "HTML element — use `html-eslint`", exclude: true },
      html: { memo: "HTML element — use `html-eslint`", exclude: true },
      span: { memo: "HTML element — use `html-eslint`", exclude: true },
      // HTML domain — handled better by html-eslint (markup semantics/attributes)
      "description-list": { memo: "HTML semantics — use `html-eslint`", exclude: true },
      "link-rel-prefetch": { memo: "HTML link rel — use `html-eslint`", exclude: true },
      "contenteditable-plaintextonly": {
        memo: "HTML attribute — use `html-eslint`",
        exclude: true,
      },
      "popover-hint": { memo: "HTML attribute — use `html-eslint`", exclude: true },

      // CSS domain — handled by stylelint or css-dedicated linters
      "starting-style": { memo: "CSS at-rule — use stylelint", exclude: true },
      "custom-media-queries": { memo: "CSS at-rule — use stylelint", exclude: true },

      // Runtime/permission/context dependent — not robust for static AST detection
      "clipboard-unsanitized-formats": {
        memo: "Permissioned/unsanitized data — not static-detectable",
        exclude: true,
      },
      "partitioned-cookies": {
        memo: "Storage/partitioning semantics — not static-detectable",
        exclude: true,
      },
      "webgl-sab": { memo: "SAB requires COOP/COEP — environment dependent", exclude: true },

      // scrollIntoView() option semantics — requires typed receiver validation
      "scroll-into-view-container": {
        memo: "Option detection requires typed receiver validation (Element.scrollIntoView) — future enhancement",
        exclude: true,
      },
    },
  },
  jsbi: {
    byId: {
      // Meta features — too broad for safe AST detection as builtins and conceptually covered by language syntax (e.g., for...of).
      iterators: {
        memo: "Meta feature",
        exclude: true,
      },
      // Syntax-level features — covered by es-x/core or non-AST safe
      "async-await": {
        memo: "Covered by JS Language (syntax);",
        exclude: true,
        mappedVia: "delegate",
      },
      "async-generators": {
        memo: "Covered by JS Language (syntax);",
        exclude: true,
        mappedVia: "delegate",
      },
      "async-iterators": {
        memo: "Covered by JS Language (syntax);",
        exclude: true,
        mappedVia: "delegate",
      },
      "escape-unescape": {
        memo: "Covered by JS Language (syntax);",
        exclude: true,
        mappedVia: "delegate",
      },
      "functions-caller-arguments": {
        memo: "Covered by JS Language (syntax);",
        exclude: true,
        mappedVia: "self",
      },
      "stable-array-sort": {
        memo: "Semantics not AST-detectable (stable behavior)",
        exclude: true,
      },

      // Runtime/semantics dependent — static detection not robust
      "serializable-errors": {
        memo: "Structured clone semantics — not static-detectable",
        exclude: true,
      },
      "transferable-arraybuffer": {
        memo: "Transfer semantics — not static-detectable",
        exclude: true,
      },

      // Typed array iteration coverage — now handled via typed member descriptors
    },
  },
};
