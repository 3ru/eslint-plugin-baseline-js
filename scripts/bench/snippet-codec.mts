/**
 * bench/synth-snippets.json (version 3): the on-disk tuples, their schema, and the exact text
 * the generator plants for each snippet, which is what snippets.mts verifies.
 */
import { z } from "zod";
import { readJsonFile, SNIPPETS_FILE } from "./lib.mts";
import type {
  Snippets,
  SnippetsFile,
  TypedSnippet,
  TypedSnippetTuple,
  UntypedKind,
  UntypedSnippet,
  UntypedSnippetTuple,
} from "./types.mts";

/** The receiver that callMemberWithArgs snippets (`x.getContext("webgl2")`) need in scope. */
export const LOCAL_RECEIVER = "const x = { get: () => ({}) };";

const UNTYPED_KINDS = [
  "newIdent",
  "newMember",
  "callStatic",
  "callGlobal",
  "staticMember",
  "member",
  "callMemberWithArgs",
  "newWithOptions",
] as const satisfies readonly UntypedKind[];

const count = z.int().nonnegative();

const UntypedSnippetSchema = z
  .tuple([
    z.enum(UNTYPED_KINDS),
    z.string(),
    z.string(),
    count,
    z.array(z.string()),
    z.union([z.literal(0), z.literal(1)]),
    count,
  ])
  .transform(([kind, featureId, code, nodes, globals, needsLocal, typedReports]) => ({
    kind,
    featureId,
    code,
    nodes,
    globals,
    needsLocal: needsLocal === 1,
    typedReports,
  }));

/** An empty receiver type stands for the interface itself. */
const TypedSnippetSchema = z
  .tuple([z.string(), z.string(), z.string(), z.string(), count])
  .transform(([featureId, iface, prop, receiverType, nodes]) => ({
    featureId,
    iface,
    prop,
    receiverType: receiverType === "" ? iface : receiverType,
    nodes,
  }));

export const SnippetsFileSchema = z.object({
  version: z.literal(3, {
    error: "expected snippets version 3; run `pnpm build && pnpm bench:snippets`",
  }),
  generatedAt: z.string(),
  plugin: z.string(),
  typescript: z.string(),
  inputs: z.object({ data: z.string() }),
  untyped: z.array(UntypedSnippetSchema),
  typed: z.array(TypedSnippetSchema),
});

/** One statement: a block when the snippet needs the local receiver. */
export function plantUntyped(snippet: Pick<UntypedSnippet, "code" | "needsLocal">): string {
  return snippet.needsLocal ? `{ ${LOCAL_RECEIVER} ${snippet.code} }` : snippet.code;
}

export interface PlantedReceiver {
  /** Goes to the top of the file. */
  declaration: string;
  use: string;
}

export function plantTyped(
  snippet: Pick<TypedSnippet, "receiverType" | "prop">,
  name: string,
): PlantedReceiver {
  return {
    declaration: `declare const ${name}: ${snippet.receiverType};`,
    use: `void ${name}.${snippet.prop};`,
  };
}

function untypedTuple(s: UntypedSnippet): UntypedSnippetTuple {
  return [s.kind, s.featureId, s.code, s.nodes, s.globals, s.needsLocal ? 1 : 0, s.typedReports];
}

function typedTuple(s: TypedSnippet): TypedSnippetTuple {
  return [s.featureId, s.iface, s.prop, s.receiverType === s.iface ? "" : s.receiverType, s.nodes];
}

/** One tuple per line: compact on disk and readable in diffs. */
export function encodeSnippets(snippets: Snippets): string {
  const file: SnippetsFile = {
    version: snippets.version,
    generatedAt: snippets.generatedAt,
    plugin: snippets.plugin,
    typescript: snippets.typescript,
    inputs: snippets.inputs,
    untyped: snippets.untyped.map(untypedTuple),
    typed: snippets.typed.map(typedTuple),
  };

  const { untyped, typed, ...header } = file;
  const field = (key: string, value: string): string => `  ${JSON.stringify(key)}: ${value}`;

  const rows = (list: ReadonlyArray<UntypedSnippetTuple | TypedSnippetTuple>): string =>
    `[\n${list.map((row) => `    ${JSON.stringify(row)}`).join(",\n")}\n  ]`;

  const fields = [
    ...Object.entries(header).map(([key, value]) => field(key, JSON.stringify(value))),
    field("untyped", rows(untyped)),
    field("typed", rows(typed)),
  ];

  return `{\n${fields.join(",\n")}\n}\n`;
}

export function loadSnippets(file: string = SNIPPETS_FILE): Snippets {
  return readJsonFile(file, SnippetsFileSchema);
}
