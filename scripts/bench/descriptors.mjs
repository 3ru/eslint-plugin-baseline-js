/**
 * Read-only access to the plugin's generated detection data for the benchmark tools:
 * descriptors, feature records, member statuses and the syntax mapping. The data files
 * are TypeScript modules with a JSON literal, so they are parsed as text rather than
 * imported, which keeps these scripts independent of the build.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./lib.mjs";

const DATA_DIR = join(ROOT, "src", "baseline", "data");

function readArrayModule(file) {
  const source = readFileSync(join(DATA_DIR, file), "utf8");
  const start = source.indexOf("= [");
  const end = source.lastIndexOf("];");
  if (start === -1 || end === -1) throw new Error(`${file}: unexpected data file shape`);
  return JSON.parse(source.slice(start + 2, end + 1));
}

function readObjectModule(file) {
  const source = readFileSync(join(DATA_DIR, file), "utf8");
  const match = /(?:export default|=)\s*\{/.exec(source);
  const asConst = source.lastIndexOf("} as const");
  const end = asConst !== -1 ? asConst + 1 : source.lastIndexOf("}") + 1;
  if (!match || end <= match.index) throw new Error(`${file}: unexpected data file shape`);
  return JSON.parse(source.slice(match.index + match[0].length - 1, end));
}

/** All generated descriptors, tagged with their domain (`api` or `jsbi`). */
export function loadDescriptors() {
  return [
    ...readArrayModule("descriptors.api.ts").map((d) => ({ ...d, domain: "api" })),
    ...readArrayModule("descriptors.jsbi.ts").map((d) => ({ ...d, domain: "jsbi" })),
  ];
}

/** Bundled feature records keyed by id (JavaScript, Web API and JS builtins). */
export function loadFeatures() {
  return {
    ...readObjectModule("features.javascript.ts"),
    ...readObjectModule("features.api.ts"),
    ...readObjectModule("features.jsbi.ts"),
  };
}

/** Member-level status overrides when the checkout ships them, else `{}`. */
export function loadCompatStatuses() {
  const file = join(DATA_DIR, "statuses.compat.ts");
  return existsSync(file) ? readObjectModule("statuses.compat.ts") : {};
}

/** Feature ids handled by syntax delegates; descriptor checks skip them. */
export function syntaxMappedFeatureIds() {
  const source = readFileSync(join(ROOT, "src", "baseline", "mapping", "syntax.ts"), "utf8");
  return new Set(
    [...source.matchAll(/^ {2}(?:"([a-z0-9-]+)"|([a-z][A-Za-z0-9_-]*)): \{/gm)].map(
      (m) => m[1] ?? m[2],
    ),
  );
}

/** Listener buckets exactly as the rule keys them: name → descriptors. */
export function listenerBuckets(descriptors) {
  const buckets = {
    calls: new Map(),
    constructions: new Map(),
    members: new Map(),
    typedMembers: new Map(),
  };
  const add = (map, key, d) => {
    const list = map.get(key);
    if (list) list.push(d);
    else map.set(key, [d]);
  };
  for (const d of descriptors) {
    switch (d.kind) {
      case "newIdent":
      case "newWithOptions":
        add(buckets.constructions, d.name, d);
        break;
      case "newMember":
        add(buckets.constructions, d.prop, d);
        break;
      case "callStatic":
      case "callMemberWithArgs":
        add(buckets.calls, d.prop, d);
        break;
      case "callGlobal":
        add(buckets.calls, d.name, d);
        break;
      case "member":
      case "staticMember":
        add(buckets.members, d.prop, d);
        break;
      case "instanceMember":
        add(buckets.typedMembers, d.prop, d);
        break;
      default:
        break;
    }
  }
  return buckets;
}

/** Global identifiers the untyped detectors key on (bases of members, constructors, global calls). */
export function globalBaseNames(descriptors) {
  const names = new Set(["window", "globalThis", "self", "document", "navigator"]);
  for (const d of descriptors) {
    if (d.base) names.add(d.base);
    if (d.kind === "callGlobal" || d.kind === "newIdent" || d.kind === "newWithOptions")
      names.add(d.name);
  }
  return names;
}

/**
 * Rule options shared by every benchmark pass. Syntax delegates (eslint-plugin-es-x rules
 * for newer syntax) are ignored so that the measurement and the report counts cover the
 * plugin's own detection path; `policy` is "widely" for timing and 1900 (report every
 * detection) for the expected-count check.
 */
export function benchRuleOptions(policy) {
  return {
    available: policy,
    includeWebApis: { preset: "auto" },
    includeJsBuiltins: { preset: "auto" },
    ignoreFeatures: [...syntaxMappedFeatureIds()].sort(),
  };
}
