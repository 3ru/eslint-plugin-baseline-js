import ts from "typescript";

const PREFERRED_STATIC_BASES = new Set(["Atomics", "JSON", "Math", "Object", "Proxy", "Reflect"]);

const PREFERRED_INSTANCE_BASES = new Set([
  "Array",
  "BigInt",
  "Boolean",
  "Date",
  "Error",
  "Function",
  "Map",
  "Number",
  "Promise",
  "RegExp",
  "Set",
  "String",
  "WeakMap",
  "WeakSet",
]);

// Spec-stable builtin members that are not yet surfaced by TypeScript's lib
// declarations or by the current Node.js runtime used during generation.
// Keep this table explicit and small so every fallback remains auditable.
export const JS_BUILTIN_CLASSIFICATION_FALLBACKS = [
  {
    compatKey: "javascript.builtins.Map.getOrInsert",
    descriptor: { kind: "instanceMember", iface: "Map", prop: "getOrInsert" },
  },
  {
    compatKey: "javascript.builtins.Map.getOrInsertComputed",
    descriptor: { kind: "instanceMember", iface: "Map", prop: "getOrInsertComputed" },
  },
  {
    compatKey: "javascript.builtins.WeakMap.getOrInsert",
    descriptor: { kind: "instanceMember", iface: "WeakMap", prop: "getOrInsert" },
  },
  {
    compatKey: "javascript.builtins.WeakMap.getOrInsertComputed",
    descriptor: { kind: "instanceMember", iface: "WeakMap", prop: "getOrInsertComputed" },
  },
];

const jsBuiltinFallbackByCompatKey = new Map(
  JS_BUILTIN_CLASSIFICATION_FALLBACKS.map((entry) => [entry.compatKey, entry.descriptor]),
);

let tsLibContextCache = null;

function createDummyProgram() {
  const options = {
    target: ts.ScriptTarget.ESNext,
    lib: ["lib.esnext.full.d.ts"],
    noEmit: true,
  };
  const host = ts.createCompilerHost(options, true);
  const dummyFile = "__baseline_js_builtin_classifier__.ts";
  const dummyText = "export {};";

  const program = ts.createProgram([dummyFile], options, {
    ...host,
    getSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile) {
      if (fileName === dummyFile) {
        return ts.createSourceFile(fileName, dummyText, languageVersion, true);
      }
      return host.getSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile);
    },
    readFile(fileName) {
      if (fileName === dummyFile) return dummyText;
      return host.readFile(fileName);
    },
    fileExists(fileName) {
      if (fileName === dummyFile) return true;
      return host.fileExists(fileName);
    },
  });

  const sourceFile = program.getSourceFile(dummyFile);
  if (!sourceFile) {
    throw new Error("[baseline-js] failed to create TypeScript lib classifier source file");
  }

  const checker = program.getTypeChecker();
  const globals = new Map(
    checker
      .getSymbolsInScope(
        sourceFile,
        ts.SymbolFlags.Value | ts.SymbolFlags.Type | ts.SymbolFlags.Namespace,
      )
      .map((symbol) => [symbol.getName(), symbol]),
  );

  return { checker, sourceFile, globals };
}

function getTsLibContext() {
  if (!tsLibContextCache) {
    tsLibContextCache = createDummyProgram();
  }
  return tsLibContextCache;
}

function getTsValueKind(propSymbol, sourceFile, checker) {
  const propType = checker.getTypeOfSymbolAtLocation(propSymbol, sourceFile);
  const constructSigs = checker.getSignaturesOfType(propType, ts.SignatureKind.Construct).length;
  if (constructSigs > 0) return "newMember";
  const callSigs = checker.getSignaturesOfType(propType, ts.SignatureKind.Call).length;
  if (callSigs > 0) return "callStatic";
  return "staticMember";
}

function classifyWithTsLib(base, prop) {
  const { checker, sourceFile, globals } = getTsLibContext();
  const baseSymbol = globals.get(base);
  if (!baseSymbol) return null;

  const valueType = checker.getTypeOfSymbolAtLocation(baseSymbol, sourceFile);
  const declaredType = checker.getDeclaredTypeOfSymbol(baseSymbol);
  const valueProp = checker.getPropertyOfType(valueType, prop);
  const instanceProp = checker.getPropertyOfType(declaredType, prop);

  return {
    valueKind: valueProp ? getTsValueKind(valueProp, sourceFile, checker) : null,
    instanceKind: instanceProp ? "instanceMember" : null,
  };
}

function isConstructableRuntimeValue(value) {
  if (typeof value !== "function") return false;
  if (!Object.hasOwn(value, "prototype")) return false;
  const proto = value.prototype;
  return !!proto && typeof proto === "object";
}

function classifyWithRuntime(base, prop) {
  const target = globalThis[base];
  if (target == null) return null;

  const own = Object.getOwnPropertyDescriptor(target, prop);
  const prototype = target?.prototype;
  const proto =
    prototype && (typeof prototype === "object" || typeof prototype === "function")
      ? Object.getOwnPropertyDescriptor(prototype, prop)
      : undefined;

  let valueKind = null;
  if (own) {
    if ("value" in own) {
      if (typeof own.value === "function") {
        valueKind = isConstructableRuntimeValue(own.value) ? "newMember" : "callStatic";
      } else {
        valueKind = "staticMember";
      }
    } else if (typeof own.get === "function" || typeof own.set === "function") {
      valueKind = "staticMember";
    }
  }

  return {
    valueKind,
    instanceKind: proto ? "instanceMember" : null,
  };
}

function buildStaticDescriptor(kind, base, prop) {
  if (kind === "newMember" || kind === "callStatic" || kind === "staticMember") {
    return { kind, base, prop };
  }
  return null;
}

function getJsBuiltinClassificationFallback(base, prop) {
  return jsBuiltinFallbackByCompatKey.get(`javascript.builtins.${base}.${prop}`) ?? null;
}

/**
 * Classify `javascript.builtins.<Base>.<prop>` compat keys into the descriptor
 * DSL using a conservative evidence stack:
 * 1. TypeScript lib declarations (best static signal for value vs instance side)
 * 2. Runtime reflection on the current Node.js intrinsic objects
 * 3. Explicit ambiguity policy only when both sides exist
 *
 * Returning `null` means the key is ambiguous, unsupported by our detectors, or
 * should remain handled by a manual descriptor.
 *
 * @param {string} base
 * @param {string} prop
 * @returns {import("../../src/baseline/types").Descriptor | null}
 */
export function classifyJsBuiltinCompatFeature(base, prop) {
  if (!base || !prop) return null;
  if (prop.startsWith("@@")) return null;
  if (prop === base) return null;

  const tsMatch = classifyWithTsLib(base, prop);
  const runtimeMatch = classifyWithRuntime(base, prop);

  const valueKind = tsMatch?.valueKind ?? runtimeMatch?.valueKind ?? null;
  const instanceKind = tsMatch?.instanceKind ?? runtimeMatch?.instanceKind ?? null;

  if (valueKind && !instanceKind) {
    return buildStaticDescriptor(valueKind, base, prop);
  }
  if (!valueKind && instanceKind) {
    return { kind: "instanceMember", iface: base, prop };
  }
  if (valueKind && instanceKind) {
    if (PREFERRED_STATIC_BASES.has(base)) {
      return buildStaticDescriptor(valueKind, base, prop);
    }
    if (PREFERRED_INSTANCE_BASES.has(base)) {
      return { kind: "instanceMember", iface: base, prop };
    }
  }

  return getJsBuiltinClassificationFallback(base, prop);
}
