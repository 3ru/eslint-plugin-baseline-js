/** @typedef {import("../../src/baseline/types").GeneratedDescriptor} GeneratedDescriptor */

/** @type {GeneratedDescriptor[]} */
export const manualApi = [
  {
    featureId: "canvas-2d-alpha",
    kind: "callMemberWithArgs",
    iface: "HTMLCanvasElement",
    typedOnly: true,
    prop: "getContext",
    stringArg: {
      index: 0,
      values: ["2d"],
    },
    objectArg: {
      index: 1,
      hasKeys: ["alpha"],
    },
    compatKey: "api.HTMLCanvasElement.getContext.2d_context.options_alpha_parameter",
  },
  {
    featureId: "canvas-2d-desynchronized",
    kind: "callMemberWithArgs",
    iface: "HTMLCanvasElement",
    typedOnly: true,
    prop: "getContext",
    stringArg: {
      index: 0,
      values: ["2d"],
    },
    objectArg: {
      index: 1,
      hasKeys: ["desynchronized"],
    },
    compatKey: "api.HTMLCanvasElement.getContext.2d_context.options_desynchronized_parameter",
  },
  {
    featureId: "canvas-2d-willreadfrequently",
    kind: "callMemberWithArgs",
    iface: "HTMLCanvasElement",
    typedOnly: true,
    prop: "getContext",
    stringArg: {
      index: 0,
      values: ["2d"],
    },
    objectArg: {
      index: 1,
      hasKeys: ["willReadFrequently"],
    },
    compatKey: "api.HTMLCanvasElement.getContext.2d_context.options_willReadFrequently_parameter",
  },
  {
    featureId: "canvas-2d-color-management",
    kind: "callMemberWithArgs",
    iface: "HTMLCanvasElement",
    typedOnly: true,
    prop: "getContext",
    stringArg: {
      index: 0,
      values: ["2d"],
    },
    objectArg: {
      index: 1,
      keyValues: [
        {
          key: "colorSpace",
          values: ["display-p3", "srgb"],
        },
      ],
    },
    compatKey: "api.HTMLCanvasElement.getContext.2d_context.options_colorSpace_parameter",
  },
  {
    featureId: "webgl-desynchronized",
    kind: "callMemberWithArgs",
    iface: "HTMLCanvasElement",
    typedOnly: true,
    prop: "getContext",
    stringArg: {
      index: 0,
      values: ["webgl", "experimental-webgl"],
    },
    objectArg: {
      index: 1,
      hasKeys: ["desynchronized"],
    },
    compatKey: "api.HTMLCanvasElement.getContext.webgl_context.options_desynchronized_parameter",
  },
  {
    featureId: "webgl2-desynchronized",
    kind: "callMemberWithArgs",
    iface: "HTMLCanvasElement",
    typedOnly: true,
    prop: "getContext",
    stringArg: {
      index: 0,
      values: ["webgl2"],
    },
    objectArg: {
      index: 1,
      hasKeys: ["desynchronized"],
    },
    compatKey: "api.HTMLCanvasElement.getContext.webgl2_context.options_desynchronized_parameter",
  },
  {
    featureId: "js-modules-workers",
    compatKey: "api.Worker.Worker.ecmascript_modules",
    kind: "newWithOptions",
    name: "Worker",
    objectArg: {
      index: 1,
      keyValues: [
        {
          key: "type",
          values: ["module"],
        },
      ],
    },
  },
  {
    featureId: "js-modules-shared-workers",
    compatKey: "api.SharedWorker.SharedWorker.ecmascript_modules",
    kind: "newWithOptions",
    name: "SharedWorker",
    objectArg: {
      index: 1,
      keyValues: [
        {
          key: "type",
          values: ["module"],
        },
      ],
    },
  },
  {
    featureId: "transformstream-transformer-cancel",
    kind: "newWithOptions",
    name: "TransformStream",
    objectArg: {
      index: 0,
      hasKeys: ["cancel"],
    },
    compatKey: "api.TransformStream.TransformStream.transformer_cancel",
  },
  {
    featureId: "ext-srgb",
    kind: "callMemberWithArgs",
    iface: "WebGLRenderingContextBase",
    typedOnly: true,
    prop: "getExtension",
    stringArg: {
      index: 0,
      values: ["EXT_sRGB"],
    },
    compatKey: "api.EXT_sRGB",
  },
  {
    featureId: "ext-srgb",
    kind: "callMemberWithArgs",
    iface: "WebGLRenderingContextBase",
    typedOnly: true,
    prop: "includes",
    stringArg: {
      index: 0,
      values: ["EXT_sRGB"],
    },
    viaCall: {
      prop: "getSupportedExtensions",
    },
    compatKey: "api.EXT_sRGB",
  },
];

/** @type {GeneratedDescriptor[]} */
export const manualJsbi = [
  {
    featureId: "error-cause",
    kind: "newWithOptions",
    name: "Error",
    objectArg: {
      index: 1,
      hasKeys: ["cause"],
    },
    compatKey: "javascript.builtins.Error.Error.options_cause_parameter",
  },
  {
    featureId: "error-cause",
    kind: "newWithOptions",
    name: "AggregateError",
    objectArg: {
      index: 2,
      hasKeys: ["cause"],
    },
    compatKey: "javascript.builtins.Error.Error.options_cause_parameter",
  },
  {
    featureId: "explicit-resource-management",
    kind: "newIdent",
    name: "DisposableStack",
    compatKey: "javascript.builtins.DisposableStack.DisposableStack",
  },
  {
    featureId: "explicit-resource-management",
    kind: "newIdent",
    name: "AsyncDisposableStack",
    compatKey: "javascript.builtins.AsyncDisposableStack.AsyncDisposableStack",
  },
  {
    featureId: "explicit-resource-management",
    kind: "newIdent",
    name: "SuppressedError",
    compatKey: "javascript.builtins.SuppressedError.SuppressedError",
  },
  {
    featureId: "explicit-resource-management",
    kind: "staticMember",
    base: "Symbol",
    prop: "dispose",
    compatKey: "javascript.builtins.Symbol.dispose",
  },
  {
    featureId: "explicit-resource-management",
    kind: "staticMember",
    base: "Symbol",
    prop: "asyncDispose",
    compatKey: "javascript.builtins.Symbol.asyncDispose",
  },
  {
    featureId: "is-error",
    kind: "callStatic",
    base: "Error",
    prop: "isError",
    compatKey: "javascript.builtins.Error.isError",
  },
  {
    featureId: "resizable-buffers",
    kind: "newWithOptions",
    name: "ArrayBuffer",
    objectArg: {
      index: 1,
      knownDefinedKeys: ["maxByteLength"],
    },
    compatKey: "javascript.builtins.ArrayBuffer.ArrayBuffer.maxByteLength_option",
  },
  {
    featureId: "resizable-buffers",
    kind: "newWithOptions",
    name: "SharedArrayBuffer",
    objectArg: {
      index: 1,
      knownDefinedKeys: ["maxByteLength"],
    },
    typedOnly: true,
    compatKey: "javascript.builtins.SharedArrayBuffer.SharedArrayBuffer.maxByteLength_option",
  },
  {
    featureId: "uint8array-base64-hex",
    kind: "callStatic",
    base: "Uint8Array",
    prop: "fromBase64",
    compatKey: "javascript.builtins.Uint8Array.fromBase64",
  },
  {
    featureId: "uint8array-base64-hex",
    kind: "callStatic",
    base: "Uint8Array",
    prop: "fromHex",
    compatKey: "javascript.builtins.Uint8Array.fromHex",
  },
  {
    featureId: "uint8array-base64-hex",
    kind: "instanceMember",
    iface: "Uint8Array",
    prop: "toBase64",
    compatKey: "javascript.builtins.Uint8Array.toBase64",
  },
  {
    featureId: "uint8array-base64-hex",
    kind: "instanceMember",
    iface: "Uint8Array",
    prop: "toHex",
    compatKey: "javascript.builtins.Uint8Array.toHex",
  },
  {
    featureId: "uint8array-base64-hex",
    kind: "instanceMember",
    iface: "Uint8Array",
    prop: "setFromBase64",
    compatKey: "javascript.builtins.Uint8Array.setFromBase64",
  },
  {
    featureId: "uint8array-base64-hex",
    kind: "instanceMember",
    iface: "Uint8Array",
    prop: "setFromHex",
    compatKey: "javascript.builtins.Uint8Array.setFromHex",
  },
  {
    featureId: "weak-references",
    kind: "newIdent",
    name: "WeakRef",
    compatKey: "javascript.builtins.WeakRef.WeakRef",
  },
  {
    featureId: "weak-references",
    kind: "newIdent",
    name: "FinalizationRegistry",
    compatKey: "javascript.builtins.FinalizationRegistry.FinalizationRegistry",
  },
  {
    featureId: "intl-locale-info",
    kind: "instanceMember",
    iface: "Locale",
    prop: "getCalendars",
    compatKey: "javascript.builtins.Intl.Locale.getCalendars",
  },
  {
    featureId: "intl-locale-info",
    kind: "instanceMember",
    iface: "Locale",
    prop: "getCollations",
    compatKey: "javascript.builtins.Intl.Locale.getCollations",
  },
  {
    featureId: "intl-locale-info",
    kind: "instanceMember",
    iface: "Locale",
    prop: "getHourCycles",
    compatKey: "javascript.builtins.Intl.Locale.getHourCycles",
  },
  {
    featureId: "intl-locale-info",
    kind: "instanceMember",
    iface: "Locale",
    prop: "getNumberingSystems",
    compatKey: "javascript.builtins.Intl.Locale.getNumberingSystems",
  },
  {
    featureId: "intl-locale-info",
    kind: "instanceMember",
    iface: "Locale",
    prop: "getTextInfo",
    compatKey: "javascript.builtins.Intl.Locale.getTextInfo",
  },
  {
    featureId: "intl-locale-info",
    kind: "instanceMember",
    iface: "Locale",
    prop: "getTimeZones",
    compatKey: "javascript.builtins.Intl.Locale.getTimeZones",
  },
  {
    featureId: "intl-locale-info",
    kind: "instanceMember",
    iface: "Locale",
    prop: "getWeekInfo",
    compatKey: "javascript.builtins.Intl.Locale.getWeekInfo",
  },
  {
    featureId: "iterator-methods",
    kind: "instanceMember",
    iface: "Iterator",
    prop: "map",
    compatKey: "javascript.builtins.Iterator.map",
  },
  {
    featureId: "iterator-methods",
    kind: "instanceMember",
    iface: "Iterator",
    prop: "filter",
    compatKey: "javascript.builtins.Iterator.filter",
  },
  {
    featureId: "iterator-methods",
    kind: "instanceMember",
    iface: "Iterator",
    prop: "take",
    compatKey: "javascript.builtins.Iterator.take",
  },
  {
    featureId: "iterator-methods",
    kind: "instanceMember",
    iface: "Iterator",
    prop: "drop",
    compatKey: "javascript.builtins.Iterator.drop",
  },
  {
    featureId: "iterator-methods",
    kind: "instanceMember",
    iface: "Iterator",
    prop: "flatMap",
    compatKey: "javascript.builtins.Iterator.flatMap",
  },
  {
    featureId: "iterator-methods",
    kind: "instanceMember",
    iface: "Iterator",
    prop: "reduce",
    compatKey: "javascript.builtins.Iterator.reduce",
  },
  {
    featureId: "iterator-methods",
    kind: "instanceMember",
    iface: "Iterator",
    prop: "toArray",
    compatKey: "javascript.builtins.Iterator.toArray",
  },
  {
    featureId: "iterator-methods",
    kind: "callStatic",
    base: "Iterator",
    prop: "from",
    compatKey: "javascript.builtins.Iterator.from",
  },
  {
    featureId: "iterator-concat",
    kind: "callStatic",
    base: "Iterator",
    prop: "concat",
    compatKey: "javascript.builtins.Iterator.concat",
  },
];

for (const prop of ["forEach", "some", "every", "find"]) {
  manualJsbi.push({
    featureId: "iterator-methods",
    kind: "instanceMember",
    iface: "Iterator",
    prop,
    compatKey: `javascript.builtins.Iterator.${prop}`,
  });
}

const TYPED_ARRAY_IFACES = [
  "Int8Array",
  "Uint8Array",
  "Uint8ClampedArray",
  "Int16Array",
  "Uint16Array",
  "Int32Array",
  "Uint32Array",
  "Float32Array",
  "Float64Array",
  "BigInt64Array",
  "BigUint64Array",
];
for (const iface of TYPED_ARRAY_IFACES) {
  for (const prop of ["entries", "keys", "values"]) {
    manualJsbi.push({
      featureId: "typed-array-iterators",
      kind: "instanceMember",
      iface,
      prop,
      compatKey: `javascript.builtins.TypedArray.${prop}`,
    });
  }
}
const TYPED_ITER_METHODS = [
  "every",
  "some",
  "forEach",
  "map",
  "filter",
  "reduce",
  "reduceRight",
  "indexOf",
  "lastIndexOf",
];
for (const iface of TYPED_ARRAY_IFACES) {
  for (const prop of TYPED_ITER_METHODS) {
    manualJsbi.push({
      featureId: "typed-array-iteration-methods",
      kind: "instanceMember",
      iface,
      prop,
      compatKey: `javascript.builtins.TypedArray.${prop}`,
    });
  }
}
