/**
 * The synthetic corpus: files built to the profile's statistics, with verified snippets planted
 * at its detection densities, so every file's node count and expected reports are exact.
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";
import {
  dataFingerprint,
  globalBaseNames,
  listenerBuckets,
  loadDescriptors,
} from "./descriptors.mts";
import {
  CACHE_DIR,
  canonicalJson,
  compareText,
  createRng,
  createSampler,
  drawCount,
  PROFILE_FILE,
  type Rng,
  readJsonFile,
  type Sampler,
  sha256,
  sha256File,
  writeJson,
} from "./lib.mts";
import { loadSnippets, plantTyped, plantUntyped } from "./snippet-codec.mts";
import { quantile } from "./stats.mts";
import type {
  CountShares,
  ExpressionKind,
  ExpressionSlot,
  FeatureCounts,
  Lang,
  LangMix,
  ListenerBuckets,
  MemberRoot,
  NameClass,
  NameShares,
  Profile,
  ProfileLang,
  Shares,
  Snippets,
  StatementKind,
  SynthFile,
  SynthInputs,
  SynthManifest,
  SynthOptions,
  TopLevelDeclaration,
  TypedSnippet,
  UntypedSnippet,
} from "./types.mts";

export const LANGS = ["js", "ts", "tsx"] as const satisfies readonly Lang[];

export const STATEMENT_KINDS = [
  "declaration",
  "assignment",
  "call",
  "if",
  "loop",
  "try",
  "switch",
  "return",
  "throw",
  "other",
] as const satisfies readonly StatementKind[];

export const EXPRESSION_SLOTS = [
  "initializer",
  "argument",
  "assignmentRight",
  "test",
  "return",
  "propertyValue",
  "operand",
] as const satisfies readonly ExpressionSlot[];

export const EXPRESSION_KINDS = [
  "identifier",
  "member",
  "call",
  "literal",
  "template",
  "binary",
  "arrow",
  "object",
  "array",
] as const satisfies readonly ExpressionKind[];

export const MEMBER_ROOTS = [
  "this",
  "local",
  "window",
  "other",
] as const satisfies readonly MemberRoot[];

export const NAME_CLASSES = [
  "typed",
  "untypedOnly",
  "neither",
  "tail",
] as const satisfies readonly NameClass[];

export const TOP_LEVEL_DECLARATIONS = [
  "function",
  "class",
  "variable",
] as const satisfies readonly TopLevelDeclaration[];

/** Names the generator writes after a dot and as class elements or object keys. */
export const IDENTIFIER_NAME = /^[A-Za-z_$][\w$]*$/;

/** Statement kinds that open blocks; past the nesting guard only the others are drawn. */
const NESTING_STATEMENTS = new Set<StatementKind>(["if", "loop", "try", "switch"]);

/** Expression kinds without expression children. */
const LEAF_EXPRESSIONS = [
  "identifier",
  "member",
  "literal",
] as const satisfies readonly ExpressionKind[];

const FILES_PER_SCALE = 1000;

/** JavaScript keeps half the corpus: every adopter runs the untyped pass. */
const DEFAULT_LANG_MIX: LangMix = { js: 3, ts: 2, tsx: 1 };

export const DEFAULT_SYNTH_OPTIONS: SynthOptions = {
  scale: 3,
  seed: 1,
  sizeMult: 1,
  detectionsMult: 1,
  collisionsMult: 1,
  shadowMult: 1,
  langMix: DEFAULT_LANG_MIX,
  out: "",
  force: false,
};

/** Never reached while the profile's mixes shrink with depth; past it only leaf forms are drawn. */
const NESTING_GUARD = 40;

/** Below this many nodes left, a file is topped up with one-line declarations. */
const TOP_UP_BELOW = 12;

/** Keeps `console`, `Number` and `JSON` from taking most of the planted detections. */
const FEATURE_SHARE_CAP = 0.1;

/** `f0`…`f9999`: unique enough per file to stand for the long tail of member names. */
const TAIL_NAMES = 10_000;
const TAIL_NAME = /^f\d+$/;

/** Names that change meaning as a class element or object key. */
const SPECIAL_KEYS = new Set(["constructor", "prototype", "__proto__"]);

/** Receivers of local member chains; buildPluginTables asserts none is a detector name. */
const ROOT_NAMES = [
  "model",
  "payload",
  "record",
  "registry",
  "bucket",
  "cursor",
  "segment",
  "snapshot",
  "handler",
  "settings",
  "meta",
  "params",
  "owner",
  "draft",
  "tracker",
  "graph",
] as const;

const HELPERS = ["helperA", "helperB"] as const;
const HELPER_NAMES: ReadonlySet<string> = new Set(HELPERS);
const LOOP_VARIABLE = "each";
const CATCH_PARAMETER = "caught";

/** The type of every TypeScript receiver: a user interface, so no lib type matches. */
const INTERFACE = "S0";

/** Chains on the global object stay off every detector behind this name. */
const WINDOW_ROOTS = ["window", "globalThis"] as const;
const WINDOW_INSULATION = "__app";

const PREFIXES = {
  function: "fn",
  class: "Model",
  variable: "v",
  topUp: "c",
  decoy: "shadow",
  receiver: "r",
  component: "View",
  arrowParam: "arg",
  tail: "f",
} as const;

/** Cosmetic: literal type changes neither node counts nor listener dispatch. */
const LITERAL_FORMS = [
  ["number", 4],
  ["string", 4],
  ["boolean", 1],
  ["null", 1],
] as const;

/** Cosmetic: every operator is one BinaryExpression or LogicalExpression node. */
const BINARY_OPERATORS = ["+", "-", "*", "===", "!==", "<", "&&", "||", "??"] as const;

/** Node counts of fixed forms as countNodes sees them; the generator test proves every total. */
const NODES = {
  program: 1,
  /** ImportDeclaration + source Literal. */
  importDeclaration: 2,
  /** ImportSpecifier + imported + local Identifier. */
  importSpecifier: 3,
  /** The VariableDeclaration of `declare const a: S0, b: S0;`. */
  declareStatement: 1,
  /** `a: S0` as a declarator: VariableDeclarator, Identifier, annotation, reference, Identifier. */
  typedDeclarator: 5,
  /** `a: S0` as a parameter: Identifier + TSTypeAnnotation + TSTypeReference + Identifier. */
  typedParam: 4,
  /** TSInterfaceDeclaration + Identifier + TSInterfaceBody. */
  interface: 3,
  /** `name: S0;` in an interface or a class: member, key, annotation, reference, Identifier. */
  typedMember: 5,
  /** `G: any`: Identifier + TSTypeAnnotation + TSAnyKeyword. */
  anyParam: 3,
  /** FileBuilder.component(). */
  component: 23,
  /** `export {};` keeps a TypeScript file's declarations file-local. */
  moduleMarker: 1,
} as const;

const PROFILE_LANGS = ["js", "jsx", "ts", "tsx"] as const satisfies readonly ProfileLang[];
const FEATURE_ID = /^[a-z0-9-]+$/;

const nonNegative = z.number().nonnegative();
const fraction = nonNegative.max(1);

const perKey = <K extends string>(keys: readonly [K, ...K[]]) =>
  z.record(z.enum(keys), nonNegative);

const perCount = z.record(z.string().regex(/^\d+$/), nonNegative);
const perName = z.record(z.string().regex(IDENTIFIER_NAME), nonNegative);
const perFeature = z.record(z.string().regex(FEATURE_ID), nonNegative);

export const ProfileSchema = z.object({
  version: z.literal(2, { error: "expected profile version 2; run `pnpm bench:profile`" }),
  extractedAt: z.string(),
  sources: z.object({
    repositories: nonNegative,
    files: nonNegative,
    nodes: nonNegative,
    parseErrors: nonNegative,
    languages: perKey(PROFILE_LANGS),
  }),
  fileSize: z.object({
    /** p0…p100 of nodes per file; targetSize interpolates between them. */
    quantiles: z
      .array(z.int().min(1))
      .length(101)
      .refine(
        (q) => q.every((n, i) => i === 0 || n >= (q[i - 1] ?? 0)),
        "expected 101 ascending positive integers",
      ),
    p50: nonNegative,
    p90: nonNegative,
    max: nonNegative,
  }),
  statementMix: z.object({ body: perKey(STATEMENT_KINDS), topLevel: perKey(STATEMENT_KINDS) }),
  topLevelDeclarations: perKey(TOP_LEVEL_DECLARATIONS),
  expressionMix: z.record(z.enum(EXPRESSION_SLOTS), perKey(EXPRESSION_KINDS)),
  argsPerCall: perCount,
  bodySize: perCount,
  blockSize: perCount,
  chainLength: perCount,
  paramsPerFunction: perCount,
  classMethods: perCount,
  objectProperties: perCount,
  arrayElements: perCount,
  switchCases: perCount,
  elseShare: fraction,
  members: z.object({
    per1k: nonNegative,
    /** Named reads that are not callees: the population of nameClasses. */
    namedPer1k: nonNegative,
    computedShare: fraction,
    computedNamedShare: fraction,
    optionalPer1k: nonNegative,
    /** Apart, because `this` means something else outside a class. */
    roots: z.object({
      inClass: perKey(MEMBER_ROOTS),
      outside: perKey(MEMBER_ROOTS),
      inClassShare: fraction,
    }),
    nameClasses: perKey(NAME_CLASSES),
    topNames: perName,
  }),
  calls: z.object({ per1k: nonNegative, identifierCalleeShare: fraction, topNames: perName }),
  constructions: z.object({ per1k: nonNegative, slotShare: fraction, topNames: perName }),
  shadowing: z.object({ globalNamesBoundLocallyPer1k: nonNegative }),
  detections: z.object({
    untypedPer1k: nonNegative,
    /** null when the profile sampled no TypeScript file. */
    typedPer1k: nonNegative.nullable(),
    topFeatures: perFeature,
    topTypedFeatures: perFeature,
  }),
});

export function loadProfile(file: string = PROFILE_FILE): Profile {
  return readJsonFile(file, ProfileSchema);
}

const LANG_NAMES: ReadonlySet<string> = new Set(LANGS);

/** Weights scaled to sum to 1; RangeError on an unknown language or a non-positive weight. */
export function normaliseLangMix(weights: Readonly<Record<string, number>>): LangMix {
  for (const lang of Object.keys(weights)) {
    if (!LANG_NAMES.has(lang)) {
      throw new RangeError(`unknown language "${lang}" (expected ${LANGS.join(", ")})`);
    }
  }

  const given = LANGS.flatMap((lang) => {
    const weight = weights[lang];

    return weight === undefined ? [] : [{ lang, weight }];
  });

  if (given.length === 0) throw new RangeError("the language mix is empty");
  let total = 0;

  for (const { lang, weight } of given) {
    if (!Number.isFinite(weight) || weight <= 0) {
      throw new RangeError(`the weight of ${lang} must be a finite positive number, got ${weight}`);
    }

    total += weight;
  }

  const mix: LangMix = {};

  for (const { lang, weight } of given) mix[lang] = weight / total;

  return mix;
}

function profileHash(profile: Profile): string {
  const { extractedAt: _date, ...content } = profile;

  return sha256(canonicalJson(content));
}

/** Without the header fields that change on every run. */
function snippetsHash(snippets: Snippets): string {
  const { generatedAt: _date, plugin: _plugin, typescript: _typescript, ...content } = snippets;

  return sha256(canonicalJson(content));
}

const SOURCES = {
  generator: import.meta.filename,
  codec: join(import.meta.dirname, "snippet-codec.mts"),
  lib: join(import.meta.dirname, "lib.mts"),
  descriptors: join(import.meta.dirname, "descriptors.mts"),
};

type GenerationOptions = Omit<SynthOptions, "out" | "force">;

export interface CorpusInputs {
  profile: Profile;
  snippets: Snippets;
}

function synthInputs(options: GenerationOptions, inputs: CorpusInputs): SynthInputs {
  return {
    generator: sha256File(SOURCES.generator),
    codec: sha256File(SOURCES.codec),
    lib: sha256File(SOURCES.lib),
    descriptors: sha256File(SOURCES.descriptors),
    data: dataFingerprint(),
    profile: profileHash(inputs.profile),
    snippets: snippetsHash(inputs.snippets),
    seed: options.seed,
    scale: options.scale,
    sizeMult: options.sizeMult,
    detectionsMult: options.detectionsMult,
    collisionsMult: options.collisionsMult,
    shadowMult: options.shadowMult,
    langMix: normaliseLangMix(options.langMix),
  };
}

const corpusId = (inputs: SynthInputs): string => sha256(canonicalJson(inputs)).slice(0, 16);

interface FillerTables {
  statementBody: Sampler<StatementKind>;
  statementLeaf: Sampler<StatementKind>;
  statementTop: Sampler<StatementKind>;
  topDeclaration: Sampler<TopLevelDeclaration>;
  expression: Record<ExpressionSlot, Sampler<ExpressionKind>>;
  leafExpression: Record<ExpressionSlot, Sampler<ExpressionKind>>;
  argsPerCall: Sampler<number>;
  bodySize: Sampler<number>;
  blockSize: Sampler<number>;
  chainLength: Sampler<number>;
  paramsPerFunction: Sampler<number>;
  classMethods: Sampler<number>;
  objectProperties: Sampler<number>;
  arrayElements: Sampler<number>;
  switchCases: Sampler<number>;
  elseShare: number;
  computedShare: number;
  computedNamedShare: number;
  optionalShare: number;
  identifierCalleeShare: number;
  constructionShare: number;
  rootsInClass: Sampler<MemberRoot>;
  rootsOutside: Sampler<MemberRoot>;
  nameClass: Sampler<NameClass>;
  names: Record<Exclude<NameClass, "tail">, Sampler<string> | null>;
  callName: Sampler<string>;
  methodName: Sampler<string>;
  constructionName: Sampler<string>;
  stringLiteral: Sampler<string>;
  objectKey: Sampler<string>;
  literalForm: Sampler<(typeof LITERAL_FORMS)[number][0]>;
  fileSize: readonly number[];
}

/** One entry per key; callers pass the full vocabulary of K (EXPRESSION_SLOTS, LANGS, ...). */
export function recordOf<K extends string, V>(
  keys: readonly K[],
  value: (key: K) => V,
): Record<K, V> {
  // SAFETY: fromEntries yields one entry per element of `keys`, which lists every K.
  return Object.fromEntries(keys.map((key) => [key, value(key)])) as Record<K, V>;
}

function sharesSampler<K extends string>(shares: Shares<K>, keys: readonly K[]): Sampler<K> {
  return createSampler(keys.map((key) => [key, shares[key]] as const));
}

function countSampler(shares: CountShares): Sampler<number> {
  return createSampler(
    Object.entries(shares)
      .map(([key, weight]) => [Number(key), weight] as const)
      .sort(([a], [b]) => a - b),
  );
}

function namesSampler(shares: NameShares, keep: (name: string) => boolean): Sampler<string> | null {
  const entries = Object.entries(shares)
    .filter(([name]) => keep(name))
    .sort(([a], [b]) => compareText(a, b));

  return entries.length === 0 ? null : createSampler(entries);
}

const tailName = (rng: Rng): string => `${PREFIXES.tail}${rng.int(TAIL_NAMES)}`;

/** The share a top list leaves uncovered goes to tail names, which no listener bucket holds. */
function headOrTail(
  shares: NameShares,
  keep: (name: string) => boolean,
  what: string,
): Sampler<string> {
  const head = required(namesSampler(shares, keep), what);
  // Rounded shares can sum to slightly more than 1.
  const tail = Math.max(0, 1 - Object.values(shares).reduce((sum, share) => sum + share, 0));

  return (rng) => (rng.chance(tail) ? tailName(rng) : head(rng));
}

function required<T>(value: T | null, what: string): T {
  if (value === null) throw new Error(`the profile has no ${what}`);

  return value;
}

interface PluginTables {
  nameClassOf(name: string): NameClass;
  /** Literal arguments and object keys that a descriptor matches on. */
  argumentStrings: ReadonlySet<string>;
}

function buildPluginTables(profile: Profile): PluginTables {
  const descriptors = loadDescriptors();
  const buckets = listenerBuckets(descriptors);
  const globals = globalBaseNames(descriptors);

  const bucketNames = new Set([
    ...buckets.calls.keys(),
    ...buckets.constructions.keys(),
    ...buckets.members.keys(),
    ...buckets.typedMembers.keys(),
  ]);

  // Filler must never be a detection.
  const fixed = [
    ...ROOT_NAMES,
    ...HELPERS,
    LOOP_VARIABLE,
    CATCH_PARAMETER,
    INTERFACE,
    WINDOW_INSULATION,
  ];

  for (const name of fixed) {
    if (globals.has(name) || bucketNames.has(name)) {
      throw new Error(`filler name "${name}" is a detector global or a listener bucket name`);
    }
  }

  const generated = new RegExp(`^(?:${Object.values(PREFIXES).join("|")})\\d+$`);

  for (const name of [...globals, ...bucketNames]) {
    if (generated.test(name)) throw new Error(`"${name}" collides with a generated filler name`);
  }

  // A tail name in the head list would count as a head in the realism test.
  const heads = [profile.members.topNames, profile.calls.topNames, profile.constructions.topNames];

  for (const name of heads.flatMap((names) => Object.keys(names))) {
    if (TAIL_NAME.test(name))
      throw new Error(`top name "${name}" looks like a generated tail name`);
  }

  const argumentStrings = new Set<string>();

  for (const d of descriptors) {
    if (d.kind !== "callMemberWithArgs") continue;

    for (const value of d.stringArg?.values ?? []) argumentStrings.add(value);

    for (const key of d.objectArg?.hasKeys ?? []) argumentStrings.add(key);

    for (const key of d.objectArg?.knownDefinedKeys ?? []) argumentStrings.add(key);

    for (const { key } of d.objectArg?.keyValues ?? []) argumentStrings.add(key);
  }

  const head = new Set(Object.keys(profile.members.topNames));

  return { nameClassOf: (name) => memberNameClass(name, buckets, head), argumentStrings };
}

/** `head` is the top-names list the generator draws member names from. */
export function memberNameClass(
  name: string,
  buckets: ListenerBuckets,
  head: ReadonlySet<string>,
): NameClass {
  if (buckets.typedMembers.has(name)) return "typed";

  if (buckets.members.has(name)) return "untypedOnly";

  return head.has(name) ? "neither" : "tail";
}

/** Leaves room in the name mix for `reads`: member reads per 1k nodes the detections add. */
function buildFillerTables(
  profile: Profile,
  plugin: PluginTables,
  collisionsMult: number,
  reads: Readonly<Record<NameClass, number>>,
): FillerTables {
  const { nameClassOf, argumentStrings } = plugin;
  const top = profile.members.topNames;

  const names = {
    typed: namesSampler(top, (name) => nameClassOf(name) === "typed"),
    untypedOnly: namesSampler(top, (name) => nameClassOf(name) === "untypedOnly"),
    neither: namesSampler(top, (name) => nameClassOf(name) === "neither"),
  };

  const { nameClasses, namedPer1k } = profile.members;

  const scaled: Record<NameClass, number> = {
    typed: nameClasses.typed * collisionsMult,
    untypedOnly: nameClasses.untypedOnly * collisionsMult,
    neither: nameClasses.neither,
    tail: nameClasses.tail,
  };

  const scaledTotal = NAME_CLASSES.reduce((sum, c) => sum + scaled[c], 0);
  const readsTotal = NAME_CLASSES.reduce((sum, c) => sum + reads[c], 0);

  const nameClass = createSampler<NameClass>(
    NAME_CLASSES.map((c) => {
      const drawable = c === "tail" || names[c] !== null;
      const room = (scaled[c] / scaledTotal) * (namedPer1k + readsTotal) - reads[c];

      return [c, drawable ? Math.max(0, room) : 0] as const;
    }),
  );

  const plainKey = (name: string): boolean => !SPECIAL_KEYS.has(name) && !argumentStrings.has(name);
  const { body, topLevel } = profile.statementMix;
  const expressionMix = profile.expressionMix;

  const { calls, constructions, members } = profile;

  return {
    statementBody: sharesSampler(body, STATEMENT_KINDS),
    statementLeaf: createSampler(
      STATEMENT_KINDS.values()
        .filter((kind) => !NESTING_STATEMENTS.has(kind))
        .map((kind) => [kind, body[kind]] as const)
        .toArray(),
    ),
    // `return` is a syntax error at module top level.
    statementTop: createSampler(
      STATEMENT_KINDS.values()
        .filter((kind) => kind !== "return")
        .map((kind) => [kind, topLevel[kind]] as const)
        .toArray(),
    ),
    topDeclaration: sharesSampler(profile.topLevelDeclarations, TOP_LEVEL_DECLARATIONS),
    expression: recordOf(EXPRESSION_SLOTS, (slot) =>
      sharesSampler(expressionMix[slot], EXPRESSION_KINDS),
    ),
    leafExpression: recordOf(EXPRESSION_SLOTS, (slot) =>
      sharesSampler(expressionMix[slot], LEAF_EXPRESSIONS),
    ),
    argsPerCall: countSampler(profile.argsPerCall),
    bodySize: countSampler(profile.bodySize),
    blockSize: countSampler(profile.blockSize),
    chainLength: countSampler(profile.chainLength),
    paramsPerFunction: countSampler(profile.paramsPerFunction),
    classMethods: countSampler(profile.classMethods),
    objectProperties: countSampler(profile.objectProperties),
    arrayElements: countSampler(profile.arrayElements),
    switchCases: countSampler(profile.switchCases),
    elseShare: profile.elseShare,
    computedShare: members.computedShare,
    computedNamedShare: members.computedNamedShare,
    optionalShare: members.optionalPer1k / members.per1k,
    identifierCalleeShare: calls.identifierCalleeShare,
    constructionShare: constructions.slotShare,
    rootsInClass: sharesSampler(members.roots.inClass, MEMBER_ROOTS),
    rootsOutside: sharesSampler(members.roots.outside, MEMBER_ROOTS),
    nameClass,
    names,
    callName: headOrTail(calls.topNames, () => true, "member call names"),
    methodName: headOrTail(calls.topNames, (name) => !SPECIAL_KEYS.has(name), "method names"),
    constructionName: headOrTail(constructions.topNames, () => true, "construction names"),
    stringLiteral: required(
      namesSampler(top, (name) => nameClassOf(name) === "neither" && !argumentStrings.has(name)),
      "neutral member names",
    ),
    objectKey: required(
      namesSampler(top, (name) => nameClassOf(name) === "neither" && plainKey(name)),
      "neutral member names",
    ),
    literalForm: createSampler(LITERAL_FORMS),
    fileSize: profile.fileSize.quantiles,
  };
}

interface DetectionTables {
  untyped: Sampler<UntypedSnippet>;
  /** Snippets whose first global a decoy parameter can shadow. */
  shadowable: readonly UntypedSnippet[];
  typed: Sampler<TypedSnippet> | null;
  untypedPer1k: number;
  typedPer1k: number;
  decoysPer1k: number;
  reads: Record<NameClass, number>;
}

interface FeatureDistribution<S> {
  snippet: Sampler<S>;
  probabilities: ReadonlyArray<readonly [S, number]>;
}

/** A feature by its capped share (unlisted features split the rest), then one of its snippets. */
function featureDistribution<S extends { featureId: string }>(
  snippets: readonly S[],
  shares: NameShares,
): FeatureDistribution<S> {
  const byFeature = new Map<string, S[]>();

  for (const snippet of snippets) {
    const list = byFeature.get(snippet.featureId);

    if (list) list.push(snippet);
    else byFeature.set(snippet.featureId, [snippet]);
  }

  const ids = [...byFeature.keys()].sort(compareText);
  const listed = Object.values(shares).reduce((sum, share) => sum + share, 0);
  const unlisted = ids.filter((id) => shares[id] === undefined).length;
  const tailShare = unlisted === 0 ? 0 : Math.max(0, 1 - listed) / unlisted;

  const weights = ids.map(
    (id) => [id, Math.min(FEATURE_SHARE_CAP, shares[id] ?? tailShare)] as const,
  );

  const feature = createSampler(weights);
  const total = weights.reduce((sum, [, weight]) => sum + weight, 0);

  const listOf = (id: string): S[] => {
    const list = byFeature.get(id);

    if (list === undefined) throw new Error(`no snippets for feature ${id}`);

    return list;
  };

  return {
    snippet: (rng) => rng.pick(listOf(feature(rng))),
    probabilities: weights.flatMap(([id, weight]) => {
      const list = listOf(id);

      return list.map((s) => [s, weight / total / list.length] as const);
    }),
  };
}

/** The form snippets.mts writes member and static-member snippets in. */
const MEMBER_SNIPPET = /^void [\w$]+\.([\w$]+);$/;

/** Member names the snippet reads that are not callees. */
function sampleReads(snippet: UntypedSnippet | TypedSnippet): string[] {
  if ("iface" in snippet) return [snippet.prop];

  if (snippet.kind !== "member" && snippet.kind !== "staticMember") return [];
  const prop = MEMBER_SNIPPET.exec(snippet.code)?.[1];

  if (prop === undefined) throw new Error(`unexpected ${snippet.kind} snippet: ${snippet.code}`);

  return [prop];
}

function buildDetectionTables(
  profile: Profile,
  snippets: Snippets,
  plugin: PluginTables,
  options: GenerationOptions,
  langMix: LangMix,
): DetectionTables {
  const { detections, shadowing } = profile;
  const untyped = featureDistribution(snippets.untyped, detections.topFeatures);
  const shadowable = snippets.untyped.filter((s) => s.globals.length > 0);

  const typed =
    snippets.typed.length === 0
      ? null
      : featureDistribution(snippets.typed, detections.topTypedFeatures);

  const untypedPer1k = detections.untypedPer1k * options.detectionsMult;
  const typedPer1k = (detections.typedPer1k ?? 0) * options.detectionsMult;
  const decoysPer1k = shadowing.globalNamesBoundLocallyPer1k * options.shadowMult;
  // Every language has the same size distribution, so a share of files is a share of nodes.
  const typedShare = (langMix.ts ?? 0) + (langMix.tsx ?? 0);
  const reads: Record<NameClass, number> = { typed: 0, untypedOnly: 0, neither: 0, tail: 0 };

  const add = <S extends UntypedSnippet | TypedSnippet>(
    probabilities: ReadonlyArray<readonly [S, number]>,
    per1k: number,
  ): void => {
    for (const [snippet, probability] of probabilities) {
      for (const name of sampleReads(snippet))
        reads[plugin.nameClassOf(name)] += per1k * probability;
    }
  };

  add(untyped.probabilities, untypedPer1k);
  add(
    shadowable.map((s) => [s, 1 / shadowable.length] as const),
    decoysPer1k,
  );

  if (typed !== null) add(typed.probabilities, typedPer1k * typedShare);

  return {
    untyped: untyped.snippet,
    shadowable,
    typed: typed === null ? null : typed.snippet,
    untypedPer1k,
    typedPer1k,
    decoysPer1k,
    reads,
  };
}

interface Code {
  readonly code: string;
  readonly nodes: number;
}

interface Line {
  readonly kind: "line";
  readonly text: string;
}

/** A statement position where the assembler may insert detections. */
interface Slot {
  readonly kind: "slot";
  readonly indent: string;
  readonly lines: string[];
}

type Part = Line | Slot;

const line = (text: string): Line => ({ kind: "line", text });
const slot = (indent: string): Slot => ({ kind: "slot", indent, lines: [] });

interface Block {
  readonly lines: readonly string[];
  readonly nodes: number;
}

/** The innermost object of a chain and what it resolves to under the type checker. */
interface Root extends Code {
  readonly receiver: Receiver;
}

interface Item {
  readonly parts: readonly Part[];
  readonly nodes: number;
}

interface ClassScope {
  readonly methods: ReadonlySet<string>;
  /** Names read on `this`; TypeScript declares them as fields of the interface type. */
  readonly fields: Set<string>;
}

interface Context {
  readonly cls: ClassScope | null;
}

/** What a TypeScript receiver resolves to: the file's interface, the class, or nothing typed. */
type Receiver = "interface" | "class" | "untyped";

/** How one member level is written. */
type LevelForm = "dot" | "optional" | "named" | "unnamed";

const TOP: Context = { cls: null };
const MODULE_MARKER = "export {};";
const INDENT = "  ";

function braces(lines: readonly string[], indent: string): string {
  return lines.length === 0 ? "{}" : `{\n${lines.join("\n")}\n${indent}}`;
}

class FileBuilder {
  private readonly rng: Rng;
  private readonly tables: FillerTables;
  readonly typed: boolean;
  readonly tsx: boolean;
  private readonly roots: Set<string>;
  private readonly helpers: Set<string>;
  private readonly interfaceNames: Set<string>;
  private interfaceDeclared: boolean;
  private readonly functions: string[];
  private counter: number;
  /** Nodes of the preamble: imports, the interface and the root declarations. */
  preambleNodes: number;
  /** Nodes of TypeScript class fields, declared as `this.name` reads appear. */
  fieldNodes: number;
  guardHits: number;

  constructor(rng: Rng, tables: FillerTables, lang: Lang) {
    this.rng = rng;
    this.tables = tables;
    this.typed = lang !== "js";
    this.tsx = lang === "tsx";
    this.roots = new Set();
    this.helpers = new Set();
    this.interfaceNames = new Set();
    this.interfaceDeclared = false;
    this.functions = [];
    this.counter = 0;
    this.preambleNodes = 0;
    this.fieldNodes = 0;
    this.guardHits = 0;
  }

  /** Nodes that items cause outside their own count; budgets subtract their growth. */
  overhead(): number {
    return this.preambleNodes + this.fieldNodes;
  }

  name(prefix: string): string {
    return `${prefix}${this.counter++}`;
  }

  private importName(): void {
    const imported = this.helpers.size + (this.typed ? 0 : this.roots.size);
    this.preambleNodes += NODES.importSpecifier + (imported === 1 ? NODES.importDeclaration : 0);
  }

  private useInterface(): void {
    if (this.interfaceDeclared) return;
    this.interfaceDeclared = true;
    this.preambleNodes += NODES.interface;
  }

  private declareName(name: string): void {
    this.useInterface();

    if (this.interfaceNames.has(name)) return;
    this.interfaceNames.add(name);
    this.preambleNodes += NODES.typedMember;
  }

  private useHelper(name: string): string {
    if (!this.helpers.has(name)) {
      this.helpers.add(name);
      this.importName();
    }

    return name;
  }

  /** A root identifier: imported in JavaScript, declared with the interface type in TypeScript. */
  root(): string {
    const name = this.rng.pick(ROOT_NAMES);

    if (this.roots.has(name)) return name;
    this.roots.add(name);

    if (this.typed) {
      this.useInterface();
      this.preambleNodes +=
        NODES.typedDeclarator + (this.roots.size === 1 ? NODES.declareStatement : 0);
    } else {
      this.importName();
    }

    return name;
  }

  preamble(): string[] {
    const lines: string[] = [];
    const imports = [...this.helpers, ...(this.typed ? [] : this.roots)].sort(compareText);

    if (imports.length > 0) {
      lines.push(`import { ${imports.join(", ")} } from "./shared${this.typed ? "" : ".js"}";`);
    }

    if (this.interfaceDeclared) {
      const members = [...this.interfaceNames]
        .sort(compareText)
        .map((n) => `${INDENT}${n}: ${INTERFACE};`);

      lines.push(`interface ${INTERFACE} ${braces(members, "")}`);
    }

    if (this.typed && this.roots.size > 0) {
      const declarators = [...this.roots].sort(compareText).map((n) => `${n}: ${INTERFACE}`);
      lines.push(`declare const ${declarators.join(", ")};`);
    }

    return lines;
  }

  expression(slot: ExpressionSlot, depth: number, ctx: Context): Code {
    const guarded = depth >= NESTING_GUARD;

    if (guarded) this.guardHits++;
    const kind = (guarded ? this.tables.leafExpression : this.tables.expression)[slot](this.rng);

    return this.expressionOf(kind, depth, ctx);
  }

  expressionOf(kind: ExpressionKind, depth: number, ctx: Context): Code {
    switch (kind) {
      case "identifier":
        return { code: this.root(), nodes: 1 };
      case "member":
        return this.chain(ctx, { assignable: false });
      case "call":
        return this.rng.chance(this.tables.constructionShare)
          ? this.construction(depth, ctx)
          : this.call(depth, ctx);
      case "literal":
        return this.literal();
      case "template": {
        // TemplateLiteral + two TemplateElements + the expression.
        const inner = this.expression("operand", depth + 1, ctx);

        return {
          code: `\`${this.tables.stringLiteral(this.rng)}-\${${inner.code}}\``,
          nodes: 3 + inner.nodes,
        };
      }

      case "binary": {
        // Parenthesised operands: `??` cannot mix with `&&` or `||` without them.
        const left = this.expression("operand", depth + 1, ctx);
        const right = this.expression("operand", depth + 1, ctx);
        const operator = this.rng.pick(BINARY_OPERATORS);

        return {
          code: `(${left.code}) ${operator} (${right.code})`,
          nodes: 1 + left.nodes + right.nodes,
        };
      }

      case "arrow": {
        const count = this.tables.paramsPerFunction(this.rng);
        const params = Array.from({ length: count }, (_, i) => `${PREFIXES.arrowParam}${i}`);
        const body = this.expression("return", depth + 1, ctx);
        const code = body.code.startsWith("{") ? `(${body.code})` : body.code;

        return { code: `(${params.join(", ")}) => ${code}`, nodes: 1 + count + body.nodes };
      }

      case "object": {
        const count = this.tables.objectProperties(this.rng);
        const properties: string[] = [];
        let nodes = 1;

        for (let i = 0; i < count; i++) {
          const value = this.expression("propertyValue", depth + 1, ctx);
          // Property + key Identifier + value.
          properties.push(`${this.tables.objectKey(this.rng)}: ${value.code}`);
          nodes += 2 + value.nodes;
        }

        return { code: count === 0 ? "{}" : `{ ${properties.join(", ")} }`, nodes };
      }

      case "array": {
        const elements = this.list("argument", this.tables.arrayElements(this.rng), depth + 1, ctx);

        return { code: `[${elements.code}]`, nodes: 1 + elements.nodes };
      }

      default:
        throw new Error(`unknown expression kind ${JSON.stringify(kind satisfies never)}`);
    }
  }

  private list(slot: ExpressionSlot, count: number, depth: number, ctx: Context): Code {
    const items: string[] = [];
    let nodes = 0;

    for (let i = 0; i < count; i++) {
      const item = this.expression(slot, depth, ctx);
      items.push(item.code);
      nodes += item.nodes;
    }

    return { code: items.join(", "), nodes };
  }

  literal(): Code {
    const form = this.tables.literalForm(this.rng);

    switch (form) {
      case "number":
        return { code: String(this.rng.int(1000)), nodes: 1 };
      case "string":
        return { code: JSON.stringify(this.tables.stringLiteral(this.rng)), nodes: 1 };
      case "boolean":
        return { code: this.rng.chance(0.5) ? "true" : "false", nodes: 1 };
      case "null":
        return { code: "null", nodes: 1 };
      default:
        throw new Error(`unknown literal form ${JSON.stringify(form satisfies never)}`);
    }
  }

  memberName(): string {
    const nameClass = this.tables.nameClass(this.rng);

    if (nameClass === "tail") return tailName(this.rng);
    const sampler = this.tables.names[nameClass];

    if (sampler === null) throw new Error(`name class ${nameClass} has no names`);

    return sampler(this.rng);
  }

  rootOf(kind: MemberRoot, ctx: Context): Root {
    switch (kind) {
      case "this":
        return {
          code: "this",
          nodes: 1,
          receiver: this.typed && ctx.cls !== null ? "class" : "untyped",
        };
      case "local":
        return { code: this.root(), nodes: 1, receiver: this.typed ? "interface" : "untyped" };
      case "window":
        // MemberExpression + two Identifiers; the global-object check stops at the insulation name.
        return {
          code: `${this.rng.pick(WINDOW_ROOTS)}.${WINDOW_INSULATION}`,
          nodes: 3,
          receiver: "untyped",
        };
      case "other":
        // Parenthesised so that `new (helperB()).X()` constructs `.X`, not helperB.
        return { code: `(${this.useHelper("helperB")}())`, nodes: 2, receiver: "untyped" };
      default:
        throw new Error(`unknown root ${JSON.stringify(kind satisfies never)}`);
    }
  }

  private levelForm(optionalAllowed: boolean): LevelForm {
    if (this.rng.chance(this.tables.computedShare)) {
      return this.rng.chance(this.tables.computedNamedShare) ? "named" : "unnamed";
    }

    return optionalAllowed && this.rng.chance(this.tables.optionalShare) ? "optional" : "dot";
  }

  /** Every name read on a typed receiver is declared, so the typed listeners resolve each level. */
  chain(
    ctx: Context,
    options: {
      assignable: boolean;
      lastName?: string;
      noOptional?: boolean;
      root?: MemberRoot;
      forms?: readonly LevelForm[];
    },
  ): Code {
    const rootKind =
      options.root ??
      (ctx.cls === null ? this.tables.rootsOutside : this.tables.rootsInClass)(this.rng);

    const root = this.rootOf(rootKind, ctx);
    const length = options.forms?.length ?? this.tables.chainLength(this.rng);
    const optionalAllowed = !options.assignable && options.noOptional !== true;
    let code = root.code;
    let receiver = root.receiver;
    let optional = false;

    for (let level = 1; level <= length; level++) {
      const name =
        level === length && options.lastName !== undefined ? options.lastName : this.memberName();

      const form = options.forms?.[level - 1] ?? this.levelForm(optionalAllowed);

      if (form === "unnamed") {
        code += `[${this.root()}]`;
        receiver = "untyped";
        continue;
      }

      code += { dot: `.${name}`, optional: `?.${name}`, named: `[${JSON.stringify(name)}]` }[form];
      optional ||= form === "optional";
      receiver = this.resolve(receiver, name, ctx);
    }

    // Two nodes per level (MemberExpression + key); one ChainExpression wraps an optional chain.
    return { code, nodes: root.nodes + 2 * length + (optional ? 1 : 0) };
  }

  private resolve(receiver: Receiver, name: string, ctx: Context): Receiver {
    if (receiver === "untyped" || SPECIAL_KEYS.has(name)) return "untyped";

    if (receiver === "class") {
      if (ctx.cls === null || ctx.cls.methods.has(name)) return "untyped";

      if (!ctx.cls.fields.has(name)) {
        ctx.cls.fields.add(name);
        this.fieldNodes += NODES.typedMember;
      }

      this.useInterface();

      return "interface";
    }

    this.declareName(name);

    return "interface";
  }

  call(depth: number, ctx: Context): Code {
    const callee = this.rng.chance(this.tables.identifierCalleeShare)
      ? { code: this.identifierCallee(), nodes: 1 }
      : this.chain(ctx, { assignable: false, lastName: this.tables.callName(this.rng) });

    const args = this.list("argument", this.tables.argsPerCall(this.rng), depth + 1, ctx);

    return { code: `${callee.code}(${args.code})`, nodes: 1 + callee.nodes + args.nodes };
  }

  /** `new root.….Name(…)`: a member callee, so no detector's global check can match it. */
  construction(depth: number, ctx: Context): Code {
    const callee = this.chain(ctx, {
      assignable: false,
      lastName: this.tables.constructionName(this.rng),
      noOptional: true,
    });

    const args = this.list("argument", this.tables.argsPerCall(this.rng), depth + 1, ctx);

    return { code: `new ${callee.code}(${args.code})`, nodes: 1 + callee.nodes + args.nodes };
  }

  identifierCallee(): string {
    const name = this.rng.pick([...HELPERS, ...this.functions]);

    return HELPER_NAMES.has(name) ? this.useHelper(name) : name;
  }

  statement(indent: string, depth: number, budget: number, ctx: Context): Code {
    const guarded = depth >= NESTING_GUARD;

    if (guarded) this.guardHits++;
    const kind = (guarded ? this.tables.statementLeaf : this.tables.statementBody)(this.rng);

    return this.statementOf(kind, indent, depth, budget, ctx);
  }

  statementOf(
    kind: StatementKind,
    indent: string,
    depth: number,
    budget: number,
    ctx: Context,
  ): Code {
    const inner = indent + INDENT;

    switch (kind) {
      case "declaration": {
        // VariableDeclaration + VariableDeclarator + Identifier + initializer.
        const init = this.expression("initializer", 0, ctx);

        return {
          code: `${indent}const ${this.name(PREFIXES.variable)} = ${init.code};`,
          nodes: 3 + init.nodes,
        };
      }

      case "assignment": {
        // ExpressionStatement + AssignmentExpression + target + value.
        const target = this.chain(ctx, { assignable: true });
        const value = this.expression("assignmentRight", 0, ctx);

        return {
          code: `${indent}${target.code} = ${value.code};`,
          nodes: 2 + target.nodes + value.nodes,
        };
      }

      case "call": {
        const call = this.call(0, ctx);

        return { code: `${indent}${call.code};`, nodes: 1 + call.nodes };
      }

      case "if": {
        // IfStatement + test + one block, or two with an else.
        const start = this.overhead();
        const test = this.expression("test", 0, ctx);
        const then = this.block(inner, depth + 1, budget - 1 - test.nodes, ctx);
        let code = `${indent}if (${test.code}) ${braces(then.lines, indent)}`;
        let nodes = 1 + test.nodes + then.nodes;

        if (this.rng.chance(this.tables.elseShare) && nodes + this.overhead() - start < budget) {
          const otherwise = this.block(inner, depth + 1, budget - nodes, ctx);
          code += ` else ${braces(otherwise.lines, indent)}`;
          nodes += otherwise.nodes;
        }

        return { code, nodes };
      }

      case "loop": {
        // ForOfStatement + VariableDeclaration + declarator + Identifier + iterable + block.
        const iterable = this.expression("argument", 0, ctx);
        const body = this.block(inner, depth + 1, budget - 4 - iterable.nodes, ctx);

        return {
          code: `${indent}for (const ${LOOP_VARIABLE} of ${iterable.code}) ${braces(body.lines, indent)}`,
          nodes: 4 + iterable.nodes + body.nodes,
        };
      }

      case "try": {
        // TryStatement + block + CatchClause + Identifier + block.
        const attempt = this.block(inner, depth + 1, budget - 3, ctx);
        const recover = this.block(inner, depth + 1, budget - 3 - attempt.nodes, ctx);

        return {
          code: `${indent}try ${braces(attempt.lines, indent)} catch (${CATCH_PARAMETER}) ${braces(recover.lines, indent)}`,
          nodes: 3 + attempt.nodes + recover.nodes,
        };
      }

      case "switch": {
        // SwitchStatement + discriminant; per case: SwitchCase, test, statement, BreakStatement.
        const discriminant = this.expression("test", 0, ctx);
        const lines = [`${indent}switch (${discriminant.code}) {`];
        let nodes = 1 + discriminant.nodes;
        const cases = this.tables.switchCases(this.rng);

        for (let i = 0; i < cases; i++) {
          const body = this.statementOf(
            this.tables.statementLeaf(this.rng),
            inner + INDENT,
            depth + 1,
            budget - nodes,
            ctx,
          );

          lines.push(`${inner}case ${i}:`, body.code, `${inner + INDENT}break;`);
          nodes += 3 + body.nodes;
        }

        lines.push(`${indent}}`);

        return { code: lines.join("\n"), nodes };
      }

      case "return": {
        const value = this.expression("return", 0, ctx);

        return { code: `${indent}return ${value.code};`, nodes: 1 + value.nodes };
      }

      case "throw": {
        const value = this.expression("argument", 0, ctx);

        return { code: `${indent}throw ${value.code};`, nodes: 1 + value.nodes };
      }

      case "other": {
        // ExpressionStatement + UnaryExpression + operand.
        const value = this.expression("operand", 0, ctx);

        return { code: `${indent}void (${value.code});`, nodes: 2 + value.nodes };
      }

      default:
        throw new Error(`unknown statement kind ${JSON.stringify(kind satisfies never)}`);
    }
  }

  /** Up to `count` statements, fewer when the budget runs out; nodes include the BlockStatement. */
  block(
    indent: string,
    depth: number,
    budget: number,
    ctx: Context,
    count = this.tables.blockSize(this.rng),
  ): Block {
    const start = this.overhead();
    const lines: string[] = [];
    let nodes = 1;

    for (let i = 0; i < count; i++) {
      const left = budget - nodes - (this.overhead() - start);

      if (left <= 0) break;
      const statement = this.statement(indent, depth, left, ctx);
      lines.push(statement.code);
      nodes += statement.nodes;
    }

    return { lines, nodes };
  }

  /** A function or method body with a slot before, between and after its statements. */
  private body(indent: string, budget: number, ctx: Context): Item {
    const block = this.block(indent, 1, budget, ctx, this.tables.bodySize(this.rng));
    const parts: Part[] = [slot(indent)];

    for (const text of block.lines) parts.push(line(text), slot(indent));

    return { parts, nodes: block.nodes };
  }

  private params(): Code {
    const count = Math.min(this.tables.paramsPerFunction(this.rng), ROOT_NAMES.length);
    const names: string[] = [];

    while (names.length < count) {
      const name = this.rng.pick(ROOT_NAMES);

      if (!names.includes(name)) names.push(name);
    }

    if (!this.typed) return { code: names.join(", "), nodes: count };

    if (count > 0) this.useInterface();

    return {
      code: names.map((n) => `${n}: ${INTERFACE}`).join(", "),
      nodes: NODES.typedParam * count,
    };
  }

  topLevelItem(budget: number): Item {
    const kind = this.tables.statementTop(this.rng);

    if (kind !== "declaration") {
      const statement = this.statementOf(kind, "", 0, budget, TOP);

      return { parts: [line(statement.code)], nodes: statement.nodes };
    }

    return this.declarationOf(this.tables.topDeclaration(this.rng), budget);
  }

  declarationOf(kind: TopLevelDeclaration, budget: number): Item {
    switch (kind) {
      case "function":
        return this.functionDeclaration(budget);
      case "class":
        return this.classDeclaration(budget);
      case "variable": {
        const statement = this.statementOf("declaration", "", 0, budget, TOP);

        return { parts: [line(statement.code)], nodes: statement.nodes };
      }

      default:
        throw new Error(`unknown declaration ${JSON.stringify(kind satisfies never)}`);
    }
  }

  private functionDeclaration(budget: number): Item {
    // FunctionDeclaration + Identifier + params + body.
    const name = this.name(PREFIXES.function);
    this.functions.push(name);
    const params = this.params();
    const body = this.body(INDENT, budget - 2 - params.nodes, TOP);

    return {
      parts: [line(`function ${name}(${params.code}) {`), ...body.parts, line("}")],
      nodes: 2 + params.nodes + body.nodes,
    };
  }

  private classDeclaration(budget: number): Item {
    // ClassDeclaration + Identifier + ClassBody, and per method
    // MethodDefinition + key + FunctionExpression + params + body.
    const name = this.name(PREFIXES.class);
    const count = this.tables.classMethods(this.rng);
    const methods: string[] = [];

    for (let i = 0; i < count; i++) {
      const method = this.tables.methodName(this.rng);
      // A repeated method name would only replace the earlier one; a tail name keeps the count.
      methods.push(methods.includes(method) ? this.name(PREFIXES.tail) : method);
    }

    const cls: ClassScope = { methods: new Set(methods), fields: new Set() };
    const ctx: Context = { cls };
    const start = this.overhead();
    const methodParts: Part[] = [];
    let nodes = 3;

    for (const method of methods) {
      const left = budget - nodes - (this.overhead() - start);

      // Methods past the budget are left out rather than written empty.
      if (left <= 0) break;
      const params = this.params();
      const body = this.body(INDENT + INDENT, left - 3 - params.nodes, ctx);
      methodParts.push(
        line(`${INDENT}${method}(${params.code}) {`),
        ...body.parts,
        line(`${INDENT}}`),
      );
      nodes += 3 + params.nodes + body.nodes;
    }

    // Field nodes are counted in fieldNodes as the reads appear.
    const fields = [...cls.fields]
      .sort(compareText)
      .map((f) => line(`${INDENT}${f}: ${INTERFACE};`));

    return { parts: [line(`class ${name} {`), ...fields, ...methodParts, line("}")], nodes };
  }

  /** One-line declarations of 3, 4 or 5 nodes; any remainder of 3 or more is filled exactly. */
  topUp(remaining: number): Item {
    const parts: Line[] = [];
    let left = remaining;
    let nodes = 0;

    const emit = (size: 3 | 4 | 5): void => {
      const name = this.name(PREFIXES.topUp);
      // VariableDeclaration + VariableDeclarator + Identifier, + Literal, + ExportNamedDeclaration.
      parts.push(
        line({ 3: `let ${name};`, 4: `let ${name} = 0;`, 5: `export let ${name} = 0;` }[size]),
      );
      left -= size;
      nodes += size;
    };

    // Fours while that leaves at least three, then threes; what remains is 3, 4 or 5 (or < 3).
    while (left > 5) emit(left - 4 >= 3 ? 4 : 3);

    if (left === 3 || left === 4 || left === 5) emit(left);

    return { parts, nodes };
  }

  component(): Item {
    const name = this.name(PREFIXES.component);

    return {
      parts: [
        line(`export function ${name}(props: any) {`),
        line(`${INDENT}return <section className={props.title}>{props.label}</section>;`),
        line("}"),
      ],
      nodes: NODES.component,
    };
  }

  /** `function shadowN(G) { <snippet> }`: the parameter shadows the snippet's global. */
  decoy(global: string, body: Code): Code {
    const name = this.name(PREFIXES.decoy);

    return {
      code: `function ${name}(${global}${this.typed ? ": any" : ""}) { ${body.code} }`,
      // FunctionDeclaration + Identifier + parameter (+ `: any`) + BlockStatement + the snippet.
      nodes: 3 + (this.typed ? NODES.anyParam : 1) + body.nodes,
    };
  }
}

interface PlannedFile {
  text: string;
  nodes: number;
  expected: SynthFile["expected"];
  decoys: number;
  guardHits: number;
}

function addCount(counts: FeatureCounts, id: string, n: number): void {
  if (n > 0) counts[id] = (counts[id] ?? 0) + n;
}

function sortedCounts(counts: FeatureCounts): FeatureCounts {
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => compareText(a, b)));
}

/** Linear interpolation between the profile's integer percentiles: only + − × ÷. */
function targetSize(rng: Rng, quantiles: readonly number[], sizeMult: number): number {
  const u = rng.next() * 100;
  const i = Math.floor(u);
  const lo = quantiles[i];
  const hi = quantiles[i + 1];

  if (lo === undefined || hi === undefined) throw new Error("the size model needs 101 quantiles");

  return Math.max(1, Math.round((lo + (hi - lo) * (u - i)) * sizeMult));
}

interface DetectionPlan {
  /** Statements for the slots. */
  planted: string[];
  /** Typed receiver declarations, which go to the top of the file. */
  receivers: string[];
  nodes: number;
  expected: SynthFile["expected"];
  decoys: number;
}

function planDetections(
  rng: Rng,
  builder: FileBuilder,
  detections: DetectionTables,
  target: number,
): DetectionPlan {
  const perK = target / 1000;
  const untyped: FeatureCounts = {};
  const typed: FeatureCounts | null = builder.typed ? {} : null;
  const planted: string[] = [];
  const receivers: string[] = [];
  let nodes = 0;

  for (let i = drawCount(rng, perK * detections.untypedPer1k); i > 0; i--) {
    const snippet = detections.untyped(rng);
    planted.push(plantUntyped(snippet));
    nodes += snippet.nodes;
    addCount(untyped, snippet.featureId, 1);

    if (typed !== null) addCount(typed, snippet.featureId, snippet.typedReports);
  }

  const decoys =
    detections.shadowable.length === 0 ? 0 : drawCount(rng, perK * detections.decoysPer1k);

  for (let i = 0; i < decoys; i++) {
    const snippet = rng.pick(detections.shadowable);
    const global = snippet.globals[0];

    if (global === undefined) throw new Error("a shadowable snippet without globals");
    const decoy = builder.decoy(global, { code: plantUntyped(snippet), nodes: snippet.nodes });
    planted.push(decoy.code);
    nodes += decoy.nodes;
  }

  if (typed !== null && detections.typed !== null) {
    for (let i = drawCount(rng, perK * detections.typedPer1k); i > 0; i--) {
      const snippet = detections.typed(rng);
      const { declaration, use } = plantTyped(snippet, builder.name(PREFIXES.receiver));
      receivers.push(declaration);
      planted.push(use);
      nodes += snippet.nodes;
      addCount(typed, snippet.featureId, 1);
    }
  }

  return {
    planted,
    receivers,
    nodes,
    expected: {
      untyped: sortedCounts(untyped),
      typed: typed === null ? null : sortedCounts(typed),
    },
    decoys,
  };
}

interface Filler {
  items: Item[];
  nodes: number;
}

/** Top-level items up to `budget` nodes, then one-line declarations to reach it exactly. */
function fill(builder: FileBuilder, budget: number): Filler {
  const items: Item[] = [];
  let nodes = 0;
  const remaining = (): number => budget - nodes - builder.overhead();

  const add = (item: Item): void => {
    items.push(item);
    nodes += item.nodes;
  };

  if (builder.tsx) add(builder.component());

  while (remaining() > TOP_UP_BELOW) add(builder.topLevelItem(remaining()));
  add(builder.topUp(remaining()));

  return { items, nodes };
}

function generateFile(
  rng: Rng,
  lang: Lang,
  tables: FillerTables,
  detections: DetectionTables,
  sizeMult: number,
): PlannedFile {
  const builder = new FileBuilder(rng, tables, lang);
  const target = targetSize(rng, tables.fileSize, sizeMult);
  // Planned first: the detections' nodes come out of the file's budget.
  const plan = planDetections(rng, builder, detections, target);
  const fixedNodes = NODES.program + (builder.typed ? NODES.moduleMarker : 0);
  const filler = fill(builder, target - fixedNodes - plan.nodes);

  // Every statement position is equally likely to receive each detection.
  const parts: Part[] = [slot("")];

  for (const item of filler.items) parts.push(...item.parts, slot(""));
  const slots = parts.flatMap((part) => (part.kind === "slot" ? [part] : []));

  for (const code of plan.planted) rng.pick(slots).lines.push(code);

  const lines = [...builder.preamble(), ...plan.receivers];

  for (const part of parts) {
    if (part.kind === "line") lines.push(part.text);
    else for (const code of part.lines) lines.push(part.indent + code);
  }

  if (builder.typed) lines.push(MODULE_MARKER);

  return {
    text: lines.length === 0 ? "" : `${lines.join("\n")}\n`,
    nodes: fixedNodes + builder.overhead() + filler.nodes + plan.nodes,
    expected: plan.expected,
    decoys: plan.decoys,
    guardHits: builder.guardHits,
  };
}

export interface SourceFile {
  path: string;
  text: string;
}

/** What every TypeScript and JavaScript file imports. */
function sharedModules(): SourceFile[] {
  const helpers = (typed: boolean): string[] =>
    HELPERS.map(
      (name) =>
        `export function ${name}(...args${typed ? ": unknown[]" : ""})${typed ? ": any" : ""} {\n${INDENT}return args;\n}`,
    );

  return [
    {
      path: "src/shared.js",
      text: `${[...ROOT_NAMES.map((name) => `export const ${name} = {};`), ...helpers(false)].join("\n")}\n`,
    },
    { path: "src/shared.ts", text: `${helpers(true).join("\n")}\n` },
  ];
}

/** Files per language for `total` files: floors first, then one more for the largest remainders. */
function fileCounts(total: number, mix: LangMix): Array<[Lang, number]> {
  const exact = LANGS.flatMap((lang) => {
    const weight = mix[lang];

    return weight === undefined ? [] : [{ lang, x: total * weight }];
  });

  const left = total - exact.reduce((sum, { x }) => sum + Math.floor(x), 0);

  const extra = new Set(
    exact
      .toSorted(
        (a, b) => b.x - Math.floor(b.x) - (a.x - Math.floor(a.x)) || compareText(a.lang, b.lang),
      )
      .slice(0, left)
      .map(({ lang }) => lang),
  );

  return exact.map(({ lang, x }) => [lang, Math.floor(x) + (extra.has(lang) ? 1 : 0)]);
}

export interface GeneratedFile extends SynthFile {
  text: string;
}

export interface GeneratedCorpus {
  id: string;
  manifest: SynthManifest;
  files: GeneratedFile[];
  /** Imported by the corpus files, not linted. */
  shared: SourceFile[];
}

/** The whole corpus in memory; nothing is written. */
export function generateCorpus(options: GenerationOptions, inputs: CorpusInputs): GeneratedCorpus {
  const synth = synthInputs(options, inputs);
  const id = corpusId(synth);
  const plugin = buildPluginTables(inputs.profile);

  const detections = buildDetectionTables(
    inputs.profile,
    inputs.snippets,
    plugin,
    options,
    synth.langMix,
  );

  const tables = buildFillerTables(
    inputs.profile,
    plugin,
    options.collisionsMult,
    detections.reads,
  );

  const total = Math.max(1, Math.round(FILES_PER_SCALE * options.scale));
  const files: GeneratedFile[] = [];
  let decoys = 0;
  let guardHits = 0;

  for (const [lang, count] of fileCounts(total, synth.langMix)) {
    for (let index = 0; index < count; index++) {
      const rng = createRng(`${options.seed}:${lang}:${index}`);
      const file = generateFile(rng, lang, tables, detections, options.sizeMult);
      decoys += file.decoys;
      guardHits += file.guardHits;
      files.push({
        path: `src/${lang}${String(index).padStart(5, "0")}.${lang}`,
        lang,
        nodes: file.nodes,
        expected: file.expected,
        text: file.text,
      });
    }
  }

  if (guardHits > 0) {
    console.warn(
      `[synth] the nesting guard (depth ${NESTING_GUARD}) fired ${guardHits} times; the profile's nesting mix may not shrink with depth`,
    );
  }

  const sum = (values: Iterable<number>): number => {
    let s = 0;

    for (const v of values) s += v;

    return s;
  };

  const nodes = files.map((f) => f.nodes);

  const manifest: SynthManifest = {
    version: 2,
    id,
    generatedAt: new Date().toISOString().slice(0, 10),
    inputs: synth,
    totals: {
      files: files.length,
      byLang: recordOf(LANGS, (lang) => files.filter((f) => f.lang === lang).length),
      nodes: sum(nodes),
      nodesP50: Math.round(quantile(nodes, 0.5)),
      nodesP90: Math.round(quantile(nodes, 0.9)),
      expectedUntyped: sum(files.map((f) => sum(Object.values(f.expected.untyped)))),
      expectedTyped: sum(files.map((f) => sum(Object.values(f.expected.typed ?? {})))),
      decoys,
    },
    files: files.map(({ text: _text, ...file }) => file),
  };

  return { id, manifest, files, shared: sharedModules() };
}

const LangSchema = z.enum(LANGS);
const FeatureCountsSchema = z.record(z.string().regex(FEATURE_ID), z.int().nonnegative());

export const SynthManifestSchema = z.object({
  version: z.literal(2, { error: "expected a version 2 synthetic manifest" }),
  id: z.string(),
  generatedAt: z.string(),
  /** Everything that determines the corpus bytes; the id hashes it. */
  inputs: z.object({
    /** Hashes of generator.mts, snippet-codec.mts, lib.mts and descriptors.mts. */
    generator: z.string(),
    codec: z.string(),
    lib: z.string(),
    descriptors: z.string(),
    data: z.string(),
    profile: z.string(),
    snippets: z.string(),
    seed: z.number(),
    scale: z.number(),
    sizeMult: z.number(),
    detectionsMult: z.number(),
    collisionsMult: z.number(),
    shadowMult: z.number(),
    langMix: z.partialRecord(LangSchema, z.number().positive()),
  }),
  totals: z.object({
    files: nonNegative,
    byLang: z.record(LangSchema, nonNegative),
    nodes: nonNegative,
    nodesP50: nonNegative,
    nodesP90: nonNegative,
    expectedUntyped: nonNegative,
    expectedTyped: nonNegative,
    decoys: nonNegative,
  }),
  files: z.array(
    z.object({
      /** Relative to the corpus directory. */
      path: z.string(),
      lang: LangSchema,
      nodes: nonNegative,
      /** `typed` is null for JavaScript files, which the type-aware pass does not lint. */
      expected: z.object({ untyped: FeatureCountsSchema, typed: FeatureCountsSchema.nullable() }),
    }),
  ),
});

export function loadManifest(file: string): SynthManifest {
  return readJsonFile(file, SynthManifestSchema);
}

export interface SynthCorpus {
  dir: string;
  id: string;
  manifest: SynthManifest;
  reused: boolean;
}

/** Reuses a directory holding the same corpus id; never replaces an `out` without manifest.json. */
export function ensureSynthCorpus(options: Partial<SynthOptions> = {}): SynthCorpus {
  const full: SynthOptions = { ...DEFAULT_SYNTH_OPTIONS, ...options };
  const inputs: CorpusInputs = { profile: loadProfile(), snippets: loadSnippets() };
  const id = corpusId(synthInputs(full, inputs));
  const dir = full.out === "" ? join(CACHE_DIR, "synth", id) : resolve(full.out);
  const manifestFile = join(dir, "manifest.json");

  if (existsSync(dir)) {
    if (full.out !== "" && !existsSync(manifestFile)) {
      throw new Error(`${dir} exists and holds no manifest.json; refusing to replace it`);
    }

    if (!full.force && existsSync(manifestFile)) {
      const manifest = loadManifest(manifestFile);

      if (manifest.id === id) return { dir, id, manifest, reused: true };
    }
  }

  const corpus = generateCorpus(full, inputs);
  rmSync(dir, { recursive: true, force: true });

  for (const file of [...corpus.files, ...corpus.shared]) {
    const path = join(dir, file.path);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, file.text);
  }

  // Written last: a directory without it is an interrupted generation.
  writeJson(manifestFile, corpus.manifest);

  return { dir, id, manifest: corpus.manifest, reused: false };
}

/** One file per language with every fixed filler construct, for snippets.mts to prove silent. */
export function fillerProbe(profile: Profile): SourceFile[] {
  const tables = buildFillerTables(profile, buildPluginTables(profile), 1, {
    typed: 0,
    untypedOnly: 0,
    neither: 0,
    tail: 0,
  });

  const files = LANGS.map((lang) => {
    const builder = new FileBuilder(createRng(`probe:${lang}`), tables, lang);
    const lines: string[] = [];

    const render = (item: Item): void => {
      for (const part of item.parts) if (part.kind === "line") lines.push(part.text);
    };

    for (const kind of TOP_LEVEL_DECLARATIONS) render(builder.declarationOf(kind, 400));
    const inFunction: string[] = [];

    for (const kind of STATEMENT_KINDS)
      inFunction.push(builder.statementOf(kind, INDENT, 1, 200, TOP).code);

    for (const kind of EXPRESSION_KINDS) {
      inFunction.push(`${INDENT}void (${builder.expressionOf(kind, 1, TOP).code});`);
    }

    for (const root of MEMBER_ROOTS) {
      const chain = builder.chain(TOP, {
        assignable: false,
        root,
        forms: ["dot", "optional", "named", "unnamed", "dot"],
      });

      inFunction.push(`${INDENT}void (${chain.code});`);
    }

    inFunction.push(
      `${INDENT}${builder.call(1, TOP).code};`,
      `${INDENT}void (${builder.construction(1, TOP).code});`,
      `${INDENT}${builder.identifierCallee()}();`,
      `${INDENT}${builder.decoy("window", { code: "void 0;", nodes: 3 }).code}`,
    );
    lines.push(`function ${builder.name(PREFIXES.function)}() {`, ...inFunction, "}");
    render(builder.topUp(3));
    render(builder.topUp(4));
    render(builder.topUp(5));

    if (builder.tsx) render(builder.component());

    if (builder.typed) lines.push(MODULE_MARKER);

    return { path: `probe.${lang}`, text: `${[...builder.preamble(), ...lines].join("\n")}\n` };
  });

  // The probe files import ./shared as corpus files do.
  return [
    ...files,
    ...sharedModules().map((m) => ({ path: m.path.replace("src/", ""), text: m.text })),
  ];
}
