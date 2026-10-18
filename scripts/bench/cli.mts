/** Bench CLI options over `node:util` parseArgs; each flag is the kebab-case form of its key. */
import { type ParseArgsOptionDescriptor, parseArgs } from "node:util";

interface NumberOption {
  readonly kind: "number";
  readonly default: number;
}

interface TextOption {
  readonly kind: "text";
  readonly default: string;
}

/** `--x` / `--no-x`; `--x=false` is rejected. */
interface FlagOption {
  readonly kind: "flag";
  readonly default: boolean;
}

/** Collects every repeat of the flag. */
interface ListOption {
  readonly kind: "list";
  readonly default: readonly string[];
}

export type OptionSpec = NumberOption | TextOption | FlagOption | ListOption;

export type OptionSpecs = Readonly<Record<string, OptionSpec>>;

export const option = {
  number: (value: number): NumberOption => ({ kind: "number", default: value }),
  text: (value: string): TextOption => ({ kind: "text", default: value }),
  flag: (value: boolean): FlagOption => ({ kind: "flag", default: value }),
  list: (value: readonly string[] = []): ListOption => ({ kind: "list", default: value }),
};

interface ValueOfKind {
  number: number;
  text: string;
  flag: boolean;
  list: string[];
}

export type Options<S extends OptionSpecs> = {
  -readonly [K in keyof S]: ValueOfKind[S[K]["kind"]];
};

export class CliError extends Error {}

type ParsedValue = string | boolean | Array<string | boolean> | undefined;

const kebab = (key: string): string => key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

function parseNumber(flag: string, text: string): number {
  const value = Number(text);

  // Number("") is 0, so an empty value would otherwise pass as zero.
  if (text.trim() === "" || !Number.isFinite(value)) {
    throw new CliError(`${flag} expects a number, got "${text}"`);
  }

  return value;
}

function descriptor(spec: OptionSpec): ParseArgsOptionDescriptor {
  if (spec.kind === "flag") return { type: "boolean" };

  return { type: "string", multiple: spec.kind === "list" };
}

function tokenize(argv: readonly string[], specs: OptionSpecs) {
  const options = Object.fromEntries(
    Object.entries(specs).map(([key, spec]) => [kebab(key), descriptor(spec)]),
  );

  try {
    return parseArgs({
      args: [...argv],
      options,
      strict: true,
      allowPositionals: false,
      allowNegative: true,
      tokens: true,
    });
  } catch (error) {
    if (
      error instanceof TypeError &&
      "code" in error &&
      String(error.code).startsWith("ERR_PARSE_ARGS")
    ) {
      throw new CliError(error.message);
    }

    throw error;
  }
}

/** parseArgs has already checked that `raw` matches the descriptor of `spec`. */
function optionValue(
  spec: OptionSpec,
  flag: string,
  raw: ParsedValue,
): ValueOfKind[OptionSpec["kind"]] {
  if (raw === undefined) return spec.kind === "list" ? [...spec.default] : spec.default;

  switch (spec.kind) {
    case "flag":
      return raw === true;
    case "number":
      return parseNumber(flag, String(raw));
    case "text":
      return String(raw);
    case "list":
      return Array.isArray(raw) ? raw.map(String) : [String(raw)];
  }
}

/** Pure: throws CliError on an unknown option, a positional, a non-number or a repeated scalar. */
export function parseOptions<S extends OptionSpecs>(argv: readonly string[], specs: S): Options<S> {
  const { values, tokens } = tokenize(argv, specs);
  const byFlag = new Map(Object.entries(specs).map(([key, spec]) => [kebab(key), spec]));
  const seen = new Set<string>();

  for (const token of tokens) {
    if (token.kind !== "option") continue;

    // parseArgs keeps the last value of a repeated scalar; a silent override hides typos.
    if (seen.has(token.name) && byFlag.get(token.name)?.kind !== "list") {
      throw new CliError(`--${token.name} given more than once`);
    }

    seen.add(token.name);
  }

  const parsed = Object.fromEntries(
    Object.entries(specs).map(([key, spec]) => {
      const flag = kebab(key);

      return [key, optionValue(spec, `--${flag}`, values[flag])];
    }),
  );

  // SAFETY: one entry per key of `specs`, each parsed by the branch of its own kind.
  return parsed as Options<S>;
}

/** `--help` prints the usage and exits 0; a CliError, also from `refine`, adds it and exits 2. */
export function parseCli<S extends OptionSpecs>(
  argv: readonly string[],
  specs: S,
  usage: string,
): Options<S>;
export function parseCli<S extends OptionSpecs, R>(
  argv: readonly string[],
  specs: S,
  usage: string,
  refine: (options: Options<S>) => R,
): R;
export function parseCli<S extends OptionSpecs, R>(
  argv: readonly string[],
  specs: S,
  usage: string,
  refine?: (options: Options<S>) => R,
): Options<S> | R {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(usage);
    process.exit(0);
  }

  try {
    const options = parseOptions(argv, specs);

    return refine ? refine(options) : options;
  } catch (error) {
    if (!(error instanceof CliError)) throw error;
    console.error(`${error.message}\n\n${usage}`);
    process.exit(2);
  }
}

/** "1,4,16" → [1, 4, 16]; "" → [], so `--typed-scales ""` turns a pass off. */
export function numberList(name: string, text: string): number[] {
  if (text.trim() === "") return [];

  return text.split(",").map((entry) => {
    const value = parseNumber(`--${name}`, entry);

    if (value <= 0) throw new CliError(`--${name} expects positive numbers, got "${entry}"`);

    return value;
  });
}
