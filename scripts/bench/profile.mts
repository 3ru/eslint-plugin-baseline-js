/**
 * `pnpm bench:profile`: measures the calibration repositories into bench/profile.json, which
 * keeps aggregates only (no paths or repository names). The realism test reuses StructureStats.
 */
import { existsSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { TSESTree } from "@typescript-eslint/types";
import { parseWithScope, walk } from "./ast.mts";
import { CliError, option, parseCli } from "./cli.mts";
import {
  globalBaseNames,
  listenerBuckets,
  loadDescriptors,
  oracleRuleOptions,
} from "./descriptors.mts";
import {
  BENCH_COMPILER_OPTIONS,
  createBenchESLint,
  featureIdFromMessage,
  pluginExport,
  RULE_ID,
} from "./eslint-setup.mjs";
import {
  EXPRESSION_KINDS,
  EXPRESSION_SLOTS,
  IDENTIFIER_NAME,
  MEMBER_ROOTS,
  memberNameClass,
  NAME_CLASSES,
  ProfileSchema,
  recordOf,
  STATEMENT_KINDS,
  TOP_LEVEL_DECLARATIONS,
} from "./generator.mts";
import {
  canonicalJson,
  compareText,
  DIST_PLUGIN,
  LOCAL_CORPUS_FILE,
  PROFILE_FILE,
  sha256,
  TMP_DIR,
} from "./lib.mts";
import { ensureRealCorpusDir, filterEntries, loadLocalManifest } from "./real-corpus.mts";
import { quantile } from "./stats.mts";
import type {
  CountShares,
  ExpressionKind,
  ExpressionSlot,
  FeatureCounts,
  ListenerBuckets,
  MemberRoot,
  NameClass,
  NameShares,
  Profile,
  ProfileLang,
  Shares,
  StatementKind,
  TopLevelDeclaration,
} from "./types.mts";

/** The detectors' global-object names (src/util/ast.ts). */
const WINDOW_NAMES = new Set(["window", "globalThis", "self"]);

/** Count distributions lump everything above this into one bucket. */
const COUNT_CAP = 16;

/** Long enough that each name class has a head to sample from, short enough to read. */
const TOP_MEMBER_NAMES = 600;
const TOP_CALL_NAMES = 300;
const TOP_CONSTRUCTION_NAMES = 100;
const TOP_FEATURES = 60;

/** Large repositories would otherwise dominate the aggregates. */
const FILES_PER_REPOSITORY = 600;

const SAMPLE_SALT = "profile";

export interface StructureTables {
  buckets: ListenerBuckets;
  /** A local binding of one of these is shadowing. */
  globals: ReadonlySet<string>;
}

export function structureTables(): StructureTables {
  const descriptors = loadDescriptors();

  return { buckets: listenerBuckets(descriptors), globals: globalBaseNames(descriptors) };
}

export type StructureSummary = Omit<Profile, "version" | "extractedAt" | "sources" | "detections">;

class Counter<K extends string = string> {
  readonly counts = new Map<K, number>();
  total = 0;

  add(key: K, n = 1): void {
    this.counts.set(key, (this.counts.get(key) ?? 0) + n);
    this.total += n;
  }

  get(key: K): number {
    return this.counts.get(key) ?? 0;
  }
}

const round = (x: number, digits = 6): number => Number(x.toFixed(digits));
const ratio = (part: number, whole: number): number => (whole === 0 ? 0 : part / whole);
const per1k = (n: number, nodes: number): number => round(ratio(n, nodes) * 1000, 3);

function present<K, V>(map: ReadonlyMap<K, V>, key: K): V {
  const value = map.get(key);

  if (value === undefined) throw new Error(`no entry for ${String(key)}`);

  return value;
}

function shares<K extends string>(counter: Counter<K>, keys: readonly K[]): Shares<K> {
  return recordOf(keys, (key) => round(ratio(counter.get(key), counter.total)));
}

function countShares(counter: Counter): CountShares {
  return Object.fromEntries(
    [...counter.counts]
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([key, n]) => [key, round(ratio(n, counter.total))]),
  );
}

/** The `n` most frequent keys that `keep` accepts, as shares of the whole counter. */
function topShares(counter: Counter, n: number, keep: (key: string) => boolean): NameShares {
  return Object.fromEntries(
    [...counter.counts]
      .filter(([key]) => keep(key))
      .sort(([a, x], [b, y]) => y - x || compareText(a, b))
      .slice(0, n)
      .map(([key, count]) => [key, round(ratio(count, counter.total))]),
  );
}

const isIdentifierName = (name: string): boolean => IDENTIFIER_NAME.test(name);
const anyFeature = (): boolean => true;

const capped = (n: number): string => String(Math.min(n, COUNT_CAP));

/** Wrappers that change neither the chain nor the kind of the expression inside. */
function unwrap(node: TSESTree.Node): TSESTree.Node {
  switch (node.type) {
    case "ChainExpression":
    case "TSAsExpression":
    case "TSNonNullExpression":
    case "TSSatisfiesExpression":
    case "TSTypeAssertion":
    case "TSInstantiationExpression":
    case "AwaitExpression":
      return unwrap(node.type === "AwaitExpression" ? node.argument : node.expression);
    default:
      return node;
  }
}

function expressionKind(node: TSESTree.Node): ExpressionKind {
  const inner = unwrap(node);

  switch (inner.type) {
    case "Identifier":
    case "ThisExpression":
    case "Super":
    case "MetaProperty":
    case "PrivateIdentifier":
      return "identifier";
    case "MemberExpression":
      return "member";
    case "CallExpression":
    case "NewExpression":
    case "ImportExpression":
      return "call";
    case "Literal":
      return "literal";
    case "TemplateLiteral":
    case "TaggedTemplateExpression":
      return "template";
    case "BinaryExpression":
    case "LogicalExpression":
    case "UnaryExpression":
    case "ConditionalExpression":
    case "AssignmentExpression":
    case "UpdateExpression":
    case "SequenceExpression":
    case "YieldExpression":
      return "binary";
    case "ArrowFunctionExpression":
    case "FunctionExpression":
    case "ClassExpression":
      return "arrow";
    case "ObjectExpression":
    case "JSXElement":
    case "JSXFragment":
      return "object";
    case "ArrayExpression":
      return "array";
    default:
      throw new Error(`unclassified expression ${inner.type}`);
  }
}

/** null for imports, export lists and type-only declarations. */
function statementKind(node: TSESTree.Node): StatementKind | null {
  switch (node.type) {
    case "ExportNamedDeclaration":
      return node.declaration === null ? null : statementKind(node.declaration);
    case "ExportDefaultDeclaration":
      return node.declaration.type === "FunctionDeclaration" ||
        node.declaration.type === "ClassDeclaration"
        ? "declaration"
        : "other";
    case "VariableDeclaration":
      return node.declare ? null : "declaration";
    case "FunctionDeclaration":
      return "declaration";
    case "ClassDeclaration":
      return node.declare ? null : "declaration";
    case "ImportDeclaration":
    case "ExportAllDeclaration":
    case "TSImportEqualsDeclaration":
    case "TSExportAssignment":
    case "TSNamespaceExportDeclaration":
    case "TSInterfaceDeclaration":
    case "TSTypeAliasDeclaration":
    case "TSEnumDeclaration":
    case "TSModuleDeclaration":
    case "TSDeclareFunction":
      return null;
    case "ExpressionStatement": {
      const expression = unwrap(node.expression);

      if (expression.type === "AssignmentExpression") return "assignment";

      if (expression.type === "CallExpression" || expression.type === "NewExpression")
        return "call";

      return "other";
    }

    case "IfStatement":
      return "if";
    case "ForStatement":
    case "ForInStatement":
    case "ForOfStatement":
    case "WhileStatement":
    case "DoWhileStatement":
      return "loop";
    case "TryStatement":
      return "try";
    case "SwitchStatement":
      return "switch";
    case "ReturnStatement":
      return "return";
    case "ThrowStatement":
      return "throw";
    default:
      return "other";
  }
}

function functionLike(node: TSESTree.Node | null): boolean {
  if (node === null) return false;
  const inner = unwrap(node);

  return (
    inner.type === "FunctionExpression" ||
    (inner.type === "ArrowFunctionExpression" && inner.body.type === "BlockStatement")
  );
}

function topLevelDeclaration(node: TSESTree.Node): TopLevelDeclaration | null {
  const declaration =
    node.type === "ExportNamedDeclaration" || node.type === "ExportDefaultDeclaration"
      ? node.declaration
      : node;

  if (declaration === null) return null;

  if (declaration.type === "FunctionDeclaration") return "function";

  if (declaration.type === "ClassDeclaration") return "class";

  if (declaration.type !== "VariableDeclaration" || declaration.declare) return null;
  const [only, ...rest] = declaration.declarations;

  if (only === undefined || rest.length > 0) return "variable";

  if (functionLike(only.init)) return "function";

  return only.init !== null && unwrap(only.init).type === "ClassExpression" ? "class" : "variable";
}

function rootKind(node: TSESTree.Node, declared: WeakSet<TSESTree.Node>): MemberRoot {
  if (node.type === "ThisExpression") return "this";

  if (node.type !== "Identifier") return "other";

  return WINDOW_NAMES.has(node.name) && !declared.has(node) ? "window" : "local";
}

/** A string literal is written with quotes; every other literal is not. */
function isStringLiteral(node: TSESTree.Node): node is TSESTree.StringLiteral {
  return node.type === "Literal" && (node.raw.startsWith('"') || node.raw.startsWith("'"));
}

function staticName(node: TSESTree.MemberExpression): string | null {
  if (!node.computed) return node.property.type === "Identifier" ? node.property.name : null;

  return isStringLiteral(node.property) ? node.property.value : null;
}

function slotOf(
  node: TSESTree.Node,
  parent: TSESTree.Node,
  objectProperties: WeakSet<TSESTree.Node>,
): ExpressionSlot | null {
  switch (parent.type) {
    case "VariableDeclarator":
      return parent.init === node ? "initializer" : null;
    case "CallExpression":
    case "NewExpression":
      return parent.arguments.some((argument) => argument === node) ? "argument" : null;
    case "AssignmentExpression":
      return parent.right === node ? "assignmentRight" : null;
    case "IfStatement":
    case "WhileStatement":
    case "DoWhileStatement":
    case "ForStatement":
    case "ConditionalExpression":
      return parent.test === node ? "test" : null;
    case "ReturnStatement":
      return "return";
    case "ArrowFunctionExpression":
      return parent.body === node && node.type !== "BlockStatement" ? "return" : null;
    case "Property":
      return parent.value === node && objectProperties.has(parent) ? "propertyValue" : null;
    case "BinaryExpression":
    case "LogicalExpression":
      return node.type === "PrivateIdentifier" ? null : "operand";
    default:
      return null;
  }
}

function languageOf(path: string): ProfileLang {
  switch (extname(path)) {
    case ".tsx":
      return "tsx";
    case ".jsx":
      return "jsx";
    case ".ts":
    case ".mts":
    case ".cts":
      return "ts";
    default:
      return "js";
  }
}

/** Per-file state of the walk. */
interface Marks {
  /** Members below the outermost member of their chain. */
  innerMembers: WeakSet<TSESTree.Node>;
  callees: WeakSet<TSESTree.Node>;
  /** Properties of object literals, not of destructuring patterns. */
  objectProperties: WeakSet<TSESTree.Node>;
  /** Initializers that are themselves the declaration (`const f = () => { … }`). */
  skippedSlots: WeakSet<TSESTree.Node>;
  /** Identifiers that resolve to a declaration in the file. */
  declared: WeakSet<TSESTree.Node>;
  inClass: boolean;
}

/** Accumulates the structural metrics of many files; `summary()` turns them into profile fields. */
export class StructureStats {
  readonly tables: StructureTables;
  readonly fileNodes: number[] = [];
  readonly languages: Record<ProfileLang, number> = { js: 0, jsx: 0, ts: 0, tsx: 0 };
  nodes = 0;
  readonly statements = {
    body: new Counter<StatementKind>(),
    topLevel: new Counter<StatementKind>(),
  };
  readonly topLevelDeclarations = new Counter<TopLevelDeclaration>();
  readonly slots = new Map<ExpressionSlot, Counter<ExpressionKind>>(
    EXPRESSION_SLOTS.map((slot) => [slot, new Counter<ExpressionKind>()]),
  );
  readonly argsPerCall = new Counter();
  readonly blockSize = new Counter();
  readonly bodySize = new Counter();
  readonly chainLength = new Counter();
  readonly paramsPerFunction = new Counter();
  readonly classMethods = new Counter();
  readonly objectProperties = new Counter();
  readonly arrayElements = new Counter();
  readonly switchCases = new Counter();
  readonly ifs = new Counter<"plain" | "else">();
  readonly members = {
    total: 0,
    computed: 0,
    computedNamed: 0,
    optional: 0,
    names: new Counter(),
    roots: { inClass: new Counter<MemberRoot>(), outside: new Counter<MemberRoot>() },
  };
  readonly calls = { total: 0, identifierCallee: 0, names: new Counter() };
  readonly constructions = { total: 0, names: new Counter() };
  /** Slots holding a call or `new`: where the generator writes every construction. */
  callExpressionsInSlots = 0;
  shadowing = 0;

  constructor(tables: StructureTables) {
    this.tables = tables;
  }

  /** Returns the file's node count; throws on a parse error. */
  add(source: string, path: string): number {
    const { ast, scopeManager } = parseWithScope(source, path);

    const marks: Marks = {
      innerMembers: new WeakSet(),
      callees: new WeakSet(),
      objectProperties: new WeakSet(),
      skippedSlots: new WeakSet(),
      declared: new WeakSet(),
      inClass: false,
    };

    for (const scope of scopeManager.scopes) {
      for (const reference of scope.references) {
        if ((reference.resolved?.defs.length ?? 0) > 0) marks.declared.add(reference.identifier);
      }
    }

    // The walk is in source order, so enclosing class bodies form a stack of end offsets.
    const classEnds: number[] = [];
    let nodes = 0;
    walk(ast, (node, parent) => {
      nodes++;

      for (
        let end = classEnds.at(-1);
        end !== undefined && node.range[0] >= end;
        end = classEnds.at(-1)
      ) {
        classEnds.pop();
      }

      if (node.type === "ClassBody") classEnds.push(node.range[1]);
      marks.inClass = classEnds.length > 0;

      if (parent !== null) this.visit(node, parent, marks);
    });

    for (const scope of scopeManager.scopes) {
      // A class or named function expression also binds its own name in an inner scope.
      if (
        scope.type === "global" ||
        scope.type === "class" ||
        scope.type === "function-expression-name"
      ) {
        continue;
      }

      for (const variable of scope.variables) {
        if (
          variable.defs.length > 0 &&
          variable.isValueVariable &&
          this.tables.globals.has(variable.name)
        ) {
          this.shadowing++;
        }
      }
    }

    this.fileNodes.push(nodes);
    this.nodes += nodes;
    this.languages[languageOf(path)]++;

    return nodes;
  }

  private visit(node: TSESTree.Node, parent: TSESTree.Node, marks: Marks): void {
    this.visitStatement(node, parent, marks.skippedSlots);
    const slot = marks.skippedSlots.has(node) ? null : slotOf(node, parent, marks.objectProperties);

    if (slot !== null) {
      const counter = this.slots.get(slot);

      if (counter === undefined) throw new Error(`no counter for slot ${slot}`);
      const kind = expressionKind(node.type === "SpreadElement" ? node.argument : node);
      counter.add(kind);

      if (kind === "call") this.callExpressionsInSlots++;
    }

    switch (node.type) {
      case "MemberExpression":
        this.visitMember(node, marks);
        break;
      case "CallExpression": {
        this.calls.total++;
        this.argsPerCall.add(capped(node.arguments.length));
        const callee = unwrap(node.callee);
        marks.callees.add(callee);

        if (callee.type === "Identifier") this.calls.identifierCallee++;
        const name = callee.type === "MemberExpression" ? staticName(callee) : null;

        if (name !== null) this.calls.names.add(name);
        break;
      }

      case "NewExpression": {
        this.constructions.total++;
        this.argsPerCall.add(capped(node.arguments.length));
        const callee = unwrap(node.callee);
        marks.callees.add(callee);
        const name = callee.type === "Identifier" ? callee.name : null;
        const member = callee.type === "MemberExpression" ? staticName(callee) : null;
        const constructed = name ?? member;

        if (constructed !== null) this.constructions.names.add(constructed);
        break;
      }

      case "BlockStatement": {
        const statements = node.body.filter((s) => statementKind(s) !== null).length;

        const isBody =
          (parent.type === "FunctionDeclaration" ||
            parent.type === "FunctionExpression" ||
            parent.type === "ArrowFunctionExpression") &&
          parent.body === node;

        (isBody ? this.bodySize : this.blockSize).add(capped(statements));
        break;
      }

      case "FunctionDeclaration":
      case "FunctionExpression":
      case "ArrowFunctionExpression":
        this.paramsPerFunction.add(capped(node.params.length));
        break;
      case "ClassBody":
        // `handle = () => { … }` is a method too, as `const f = () => { … }` is a function.
        this.classMethods.add(
          capped(
            node.body.filter(
              (m) =>
                m.type === "MethodDefinition" ||
                (m.type === "PropertyDefinition" && functionLike(m.value)),
            ).length,
          ),
        );
        break;
      case "ObjectExpression":
        this.objectProperties.add(capped(node.properties.length));

        for (const property of node.properties) marks.objectProperties.add(property);
        break;
      case "ArrayExpression":
        this.arrayElements.add(capped(node.elements.length));
        break;
      case "SwitchStatement":
        this.switchCases.add(capped(node.cases.length));
        break;
      default:
        break;
    }
  }

  private visitStatement(
    node: TSESTree.Node,
    parent: TSESTree.Node,
    skippedSlots: WeakSet<TSESTree.Node>,
  ): void {
    const inBody =
      parent.type === "BlockStatement" || (parent.type === "SwitchCase" && parent.test !== node);

    if (parent.type !== "Program" && !inBody) return;
    const kind = statementKind(node);

    if (kind === null) return;

    if (inBody) {
      this.statements.body.add(kind);
    } else {
      this.statements.topLevel.add(kind);
      const declaration = kind === "declaration" ? topLevelDeclaration(node) : null;

      if (declaration !== null) this.topLevelDeclarations.add(declaration);

      // The function or class is the declaration, not a sample of the initializer slot.
      if (declaration === "function" || declaration === "class") {
        const variable = node.type === "ExportNamedDeclaration" ? node.declaration : node;

        if (variable?.type === "VariableDeclaration") {
          for (const declarator of variable.declarations) {
            if (declarator.init !== null) skippedSlots.add(declarator.init);
          }
        }
      }
    }

    if (node.type === "IfStatement") this.ifs.add(node.alternate === null ? "plain" : "else");
  }

  private visitMember(node: TSESTree.MemberExpression, marks: Marks): void {
    const m = this.members;
    m.total++;

    if (node.computed) m.computed++;

    if (node.optional) m.optional++;
    const name = staticName(node);

    if (node.computed && name !== null) m.computedNamed++;

    // A callee's name is a call or constructor name, counted with calls and constructions.
    if (name !== null && !marks.callees.has(node)) m.names.add(name);

    if (marks.innerMembers.has(node)) return;
    // The outermost member: walk down to the root once, marking the inner levels.
    let length = 1;
    let object = unwrap(node.object);

    while (object.type === "MemberExpression") {
      marks.innerMembers.add(object);
      length++;
      object = unwrap(object.object);
    }

    this.chainLength.add(capped(length));
    (marks.inClass ? m.roots.inClass : m.roots.outside).add(rootKind(object, marks.declared));
  }

  /** `topMemberNames` splits "neither" from "tail"; the realism test passes the profile's list. */
  summary(topMemberNames?: ReadonlySet<string>): StructureSummary {
    const rate = (n: number): number => per1k(n, this.nodes);
    const memberTop = topShares(this.members.names, TOP_MEMBER_NAMES, isIdentifierName);
    const head = topMemberNames ?? new Set(Object.keys(memberTop));
    const classes = new Counter<NameClass>();

    for (const [name, n] of this.members.names.counts) {
      classes.add(memberNameClass(name, this.tables.buckets, head), n);
    }

    const statementShares = (counter: Counter<StatementKind>) => shares(counter, STATEMENT_KINDS);

    const quantiles = Array.from({ length: 101 }, (_, i) =>
      Math.round(quantile(this.fileNodes, i / 100)),
    );

    return {
      fileSize: {
        quantiles,
        p50: Math.round(quantile(this.fileNodes, 0.5)),
        p90: Math.round(quantile(this.fileNodes, 0.9)),
        max: Math.max(...this.fileNodes),
      },
      statementMix: {
        body: statementShares(this.statements.body),
        topLevel: statementShares(this.statements.topLevel),
      },
      topLevelDeclarations: shares(this.topLevelDeclarations, TOP_LEVEL_DECLARATIONS),
      expressionMix: recordOf(EXPRESSION_SLOTS, (slot) =>
        shares(present(this.slots, slot), EXPRESSION_KINDS),
      ),
      argsPerCall: countShares(this.argsPerCall),
      blockSize: countShares(this.blockSize),
      bodySize: countShares(this.bodySize),
      chainLength: countShares(this.chainLength),
      paramsPerFunction: countShares(this.paramsPerFunction),
      classMethods: countShares(this.classMethods),
      objectProperties: countShares(this.objectProperties),
      arrayElements: countShares(this.arrayElements),
      switchCases: countShares(this.switchCases),
      elseShare: round(ratio(this.ifs.get("else"), this.ifs.total)),
      members: {
        per1k: rate(this.members.total),
        namedPer1k: rate(this.members.names.total),
        computedShare: round(ratio(this.members.computed, this.members.total)),
        computedNamedShare: round(ratio(this.members.computedNamed, this.members.computed)),
        optionalPer1k: rate(this.members.optional),
        roots: {
          inClass: shares(this.members.roots.inClass, MEMBER_ROOTS),
          outside: shares(this.members.roots.outside, MEMBER_ROOTS),
          inClassShare: round(
            ratio(
              this.members.roots.inClass.total,
              this.members.roots.inClass.total + this.members.roots.outside.total,
            ),
          ),
        },
        nameClasses: shares(classes, NAME_CLASSES),
        topNames: memberTop,
      },
      calls: {
        per1k: rate(this.calls.total),
        identifierCalleeShare: round(ratio(this.calls.identifierCallee, this.calls.total)),
        topNames: topShares(this.calls.names, TOP_CALL_NAMES, isIdentifierName),
      },
      constructions: {
        per1k: rate(this.constructions.total),
        slotShare: round(ratio(this.constructions.total, this.callExpressionsInSlots)),
        topNames: topShares(this.constructions.names, TOP_CONSTRUCTION_NAMES, isIdentifierName),
      },
      shadowing: { globalNamesBoundLocallyPer1k: rate(this.shadowing) },
    };
  }
}

/** Absolute path → feature counts. */
async function lintReports(
  eslint: ReturnType<typeof createBenchESLint>,
  files: readonly string[],
): Promise<Map<string, FeatureCounts>> {
  const byFile = new Map<string, FeatureCounts>();

  for (const result of await eslint.lintFiles([...files])) {
    const counts: FeatureCounts = {};

    for (const message of result.messages) {
      if (message.fatal) throw new Error(`${result.filePath}: ${message.message}`);

      if (message.ruleId !== RULE_ID) continue;
      const id = featureIdFromMessage(message.message);

      if (id === null) throw new Error(`${result.filePath}: no feature id in "${message.message}"`);
      counts[id] = (counts[id] ?? 0) + 1;
    }

    byFile.set(result.filePath, counts);
  }

  return byFile;
}

const reportTotal = (counts: FeatureCounts): number =>
  Object.values(counts).reduce((sum, n) => sum + n, 0);

/** The first files by salted hash: deterministic and independent of path order. */
function hashSample(files: readonly string[], n: number): string[] {
  return files
    .map((file) => ({ file, key: sha256(`${SAMPLE_SALT}:${file}`) }))
    .sort((a, b) => compareText(a.key, b.key))
    .slice(0, n)
    .map(({ file }) => file)
    .sort(compareText);
}

const USAGE = `usage: pnpm bench:profile [options]

Extracts bench/profile.json from the calibration repositories listed in the calibration
manifest. Needs the plugin build (run \`pnpm build\` first).

  --manifest <file>     calibration manifest (default: bench/corpus.local.json)
  --only <id,id>        only these calibration entries
  --typed-sample <n>    TypeScript files per repository linted with types (default: 150; 0 skips)
  --out <file>          where to write the profile (default: bench/profile.json)`;

async function main(): Promise<void> {
  const args = parseCli(
    process.argv.slice(2),
    {
      manifest: option.text(LOCAL_CORPUS_FILE),
      only: option.text(""),
      typedSample: option.number(150),
      out: option.text(PROFILE_FILE),
    },
    USAGE,
    (options) => {
      if (!Number.isInteger(options.typedSample) || options.typedSample < 0) {
        throw new CliError(
          `--typed-sample expects a non-negative integer, got ${options.typedSample}`,
        );
      }

      return { ...options, only: options.only.split(",").filter((id) => id !== "") };
    },
  );

  if (!existsSync(DIST_PLUGIN)) throw new Error("dist/index.mjs not found: run `pnpm build` first");
  const plugin = pluginExport(await import(pathToFileURL(DIST_PLUGIN).href));
  const entries = filterEntries(loadLocalManifest(resolve(args.manifest)), args.only);
  const stats = new StructureStats(structureTables());
  const ruleOptions = oracleRuleOptions();

  const detections = {
    untyped: 0,
    typedExtra: 0,
    typedNodes: 0,
    features: new Counter(),
    typedFeatures: new Counter(),
  };

  let parseErrors = 0;
  const tmp = join(TMP_DIR, `profile-${process.pid}`);
  mkdirSync(tmp, { recursive: true });

  try {
    for (const [index, entry] of entries.entries()) {
      const repository = await ensureRealCorpusDir(entry);
      const nodesByFile = new Map<string, number>();

      for (const file of hashSample(repository.files, FILES_PER_REPOSITORY)) {
        const path = join(repository.dir, file);
        const source = await readFile(path, "utf8");

        try {
          nodesByFile.set(path, stats.add(source, path));
        } catch (error) {
          // Counted, not linted: real repositories hold the odd file the parser rejects.
          if (!(error instanceof Error) || error.name !== "TSError") throw error;
          parseErrors++;
        }
      }

      const files = [...nodesByFile.keys()];

      const untyped = await lintReports(
        createBenchESLint({
          cwd: repository.dir,
          plugin,
          ruleOptions,
          typed: false,
          tsconfig: null,
          stats: false,
        }),
        files,
      );

      for (const counts of untyped.values()) {
        for (const [id, n] of Object.entries(counts)) {
          detections.untyped += n;
          detections.features.add(id, n);
        }
      }

      const sample = hashSample(
        files.filter((file) => languageOf(file) === "ts" || languageOf(file) === "tsx"),
        args.typedSample,
      );

      if (sample.length > 0) {
        const tsconfig = join(tmp, `tsconfig.${index}.json`);
        writeFileSync(
          tsconfig,
          JSON.stringify({ compilerOptions: BENCH_COMPILER_OPTIONS, files: sample }),
        );

        const typed = await lintReports(
          createBenchESLint({
            cwd: repository.dir,
            plugin,
            ruleOptions,
            typed: true,
            tsconfig,
            stats: false,
          }),
          sample,
        );

        for (const file of sample) {
          const withTypes = present(typed, file);
          const without = present(untyped, file);
          detections.typedExtra += reportTotal(withTypes) - reportTotal(without);
          detections.typedNodes += present(nodesByFile, file);

          for (const [id, n] of Object.entries(withTypes)) {
            const extra = n - (without[id] ?? 0);

            if (extra > 0) detections.typedFeatures.add(id, extra);
          }
        }
      }

      console.error(
        `[profile] ${index + 1}/${entries.length}: ${files.length} files, ${sample.length} type-aware; untyped ${detections.untyped}, type-aware extra ${detections.typedExtra}`,
      );
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  const profile = ProfileSchema.parse({
    version: 2,
    extractedAt: new Date().toISOString().slice(0, 10),
    sources: {
      repositories: entries.length,
      files: stats.fileNodes.length,
      nodes: stats.nodes,
      parseErrors,
      languages: stats.languages,
    },
    ...stats.summary(),
    detections: {
      untypedPer1k: per1k(detections.untyped, stats.nodes),
      typedPer1k:
        detections.typedNodes > 0 ? per1k(detections.typedExtra, detections.typedNodes) : null,
      topFeatures: topShares(detections.features, TOP_FEATURES, anyFeature),
      topTypedFeatures: topShares(detections.typedFeatures, TOP_FEATURES, anyFeature),
    },
  });

  const out = resolve(args.out);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${canonicalJson(profile, 2)}\n`);
  console.error(
    `[profile] ${profile.sources.files} files, ${profile.sources.nodes} nodes, ${parseErrors} parse errors; written to ${args.out}`,
  );
}

if (process.argv[1] !== undefined && realpathSync(process.argv[1]) === import.meta.filename) {
  await main();
}
