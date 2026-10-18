/** The plugin's generated data, read as text so src stays out of the bench type check. */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { z } from "zod";
import type { Descriptor } from "../../src/baseline/types.ts";
import { compareText, type Parser, parseJson, ROOT, sha256, sha256File } from "./lib.mts";
import type {
  BenchDescriptor,
  Domain,
  FeatureMap,
  ListenerBuckets,
  OracleRuleOptions,
  SyntaxMappingIds,
  TimingRuleOptions,
} from "./types.mts";

export type { BenchDescriptor } from "./types.mts";

const DATA_DIR = join(ROOT, "src", "baseline", "data");
const SYNTAX_MAPPING = join(ROOT, "src", "baseline", "mapping", "syntax.ts");

const ObjectArgSchema = z.strictObject({
  index: z.number(),
  hasKeys: z.array(z.string()).exactOptional(),
  keyValues: z
    .array(z.strictObject({ key: z.string(), values: z.array(z.string()).exactOptional() }))
    .exactOptional(),
});

const common = { featureId: z.string(), typedOnly: z.boolean().exactOptional() };

// Strict, with no catch-all kind: the rule throws on data it does not know, so must the bench.
const DescriptorSchema = z.discriminatedUnion("kind", [
  z.strictObject({ ...common, kind: z.literal("newIdent"), name: z.string() }),
  z.strictObject({ ...common, kind: z.literal("newMember"), base: z.string(), prop: z.string() }),
  z.strictObject({ ...common, kind: z.literal("callStatic"), base: z.string(), prop: z.string() }),
  z.strictObject({ ...common, kind: z.literal("callGlobal"), name: z.string() }),
  z.strictObject({
    ...common,
    kind: z.literal("staticMember"),
    base: z.string(),
    prop: z.string(),
  }),
  z.strictObject({ ...common, kind: z.literal("member"), base: z.string(), prop: z.string() }),
  z.strictObject({
    ...common,
    kind: z.literal("instanceMember"),
    iface: z.string(),
    prop: z.string(),
  }),
  z.strictObject({
    ...common,
    kind: z.literal("callMemberWithArgs"),
    prop: z.string(),
    stringArg: z.strictObject({ index: z.number(), values: z.array(z.string()) }).exactOptional(),
    objectArg: ObjectArgSchema.exactOptional(),
    viaCall: z.strictObject({ prop: z.string() }).exactOptional(),
  }),
  z.strictObject({
    ...common,
    kind: z.literal("newWithOptions"),
    name: z.string(),
    objectArg: ObjectArgSchema,
  }),
]) satisfies z.ZodType<Descriptor>;

const DescriptorsSchema = z.array(DescriptorSchema);

export const FeatureMapSchema = z.record(
  z.string(),
  z.object({
    id: z.string(),
    status: z.object({
      baseline: z.literal(["high", "low", false]),
      baseline_low_date: z.string().exactOptional(),
      baseline_high_date: z.string().exactOptional(),
    }),
  }),
);

/** `open` ends with the first character of the JSON literal and `close` starts with its last. */
function readDataModule<T>(file: string, open: string, close: string, schema: Parser<T>): T {
  const source = readFileSync(join(DATA_DIR, file), "utf8");
  const start = source.indexOf(open);
  const end = source.lastIndexOf(close);

  if (start === -1 || end === -1) throw new Error(`${file}: no "${open}" … "${close}" literal`);

  return parseJson(source.slice(start + open.length - 1, end + 1), schema);
}

function tagged(file: string, domain: Domain): BenchDescriptor[] {
  return readDataModule(file, "= [", "];", DescriptorsSchema).map((d) => ({ ...d, domain }));
}

let descriptors: readonly BenchDescriptor[] | undefined;

export function loadDescriptors(): readonly BenchDescriptor[] {
  descriptors ??= [
    ...tagged("descriptors.api.ts", "api"),
    ...tagged("descriptors.jsbi.ts", "jsbi"),
  ];

  return descriptors;
}

const features = (file: string): FeatureMap =>
  readDataModule(file, "export default {", "} as const;", FeatureMapSchema);

export function loadFeatures(): FeatureMap {
  return {
    ...features("features.javascript.ts"),
    ...features("features.api.ts"),
    ...features("features.jsbi.ts"),
  };
}

export function syntaxMappingIds(): SyntaxMappingIds {
  const ids: SyntaxMappingIds = { all: [], syntax: [], meta: [] };

  // Each two-space-indented line opens an entry, so one the pattern cannot read fails loudly.
  const entries = readFileSync(SYNTAX_MAPPING, "utf8")
    .split(/^(?= {2}[^\s/}])/m)
    .slice(1);

  for (const entry of entries) {
    const match =
      /^ {2}(?:"([a-z0-9-]+)"|([a-z][a-z0-9]*)): \{[\s\S]*?\bkind: "(syntax|meta)"/.exec(entry);

    const id = match?.[1] ?? match?.[2];
    const kind = match?.[3];

    if (id === undefined || (kind !== "syntax" && kind !== "meta")) {
      throw new Error(`syntax.ts: unexpected mapping entry ${entry.split("\n", 1).join("")}`);
    }

    ids.all.push(id);
    ids[kind].push(id);
  }

  if (ids.all.length === 0) throw new Error("syntax.ts: no mapping entries found");

  return ids;
}

/** Keyed exactly as src/rules/feature-usage/builder.ts keys its listeners. */
export function listenerBuckets(list: readonly BenchDescriptor[]): ListenerBuckets {
  const buckets: ListenerBuckets = {
    calls: new Map(),
    constructions: new Map(),
    members: new Map(),
    typedMembers: new Map(),
  };

  const add = (map: Map<string, BenchDescriptor[]>, key: string, d: BenchDescriptor): void => {
    const bucket = map.get(key);

    if (bucket) bucket.push(d);
    else map.set(key, [d]);
  };

  for (const d of list) {
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
        throw new Error(`unsupported descriptor ${JSON.stringify(d satisfies never)}`);
    }
  }

  return buckets;
}

/** The global object names of src/util/ast.ts plus every base, constructor and global callee. */
export function globalBaseNames(list: readonly BenchDescriptor[]): Set<string> {
  const names = new Set(["window", "globalThis", "self"]);

  for (const d of list) {
    if ("base" in d) names.add(d.base);

    if (d.kind === "callGlobal" || d.kind === "newIdent" || d.kind === "newWithOptions") {
      names.add(d.name);
    }
  }

  return names;
}

/** What adopters run: the options of `recommendedConfig()` in src/configs/baseline.ts. */
export function timingRuleOptions(): TimingRuleOptions {
  return {
    available: "widely",
    includeWebApis: { preset: "auto" },
    includeJsBuiltins: { preset: "auto" },
  };
}

/** Every descriptor reports (nothing was Baseline in 1900) and every syntax.ts key is ignored. */
export function oracleRuleOptions(): OracleRuleOptions {
  // One regex: the timed create() tests each pattern against each descriptor. Keys are [a-z0-9-].
  const pattern = `/^(?:${syntaxMappingIds().all.join("|")})$/`;

  return { ...timingRuleOptions(), available: 1900, ignoreFeatures: [pattern] };
}

/** Changes with any descriptor, feature record or mapping entry. */
export function dataFingerprint(): string {
  const files = readdirSync(DATA_DIR)
    .values()
    .filter((name) => name.endsWith(".ts"))
    .map((name) => join(DATA_DIR, name))
    .toArray();

  const lines = [...files, SYNTAX_MAPPING]
    .map((file) => `${relative(ROOT, file).replaceAll("\\", "/")} ${sha256File(file)}`)
    .sort(compareText);

  return sha256(lines.join("\n"));
}
