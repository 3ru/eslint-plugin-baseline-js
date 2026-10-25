/** `pnpm bench:synth`: generates the synthetic corpus and prints where it is and what it holds. */
import { CliError, option, parseCli } from "./cli.mts";
import { DEFAULT_SYNTH_OPTIONS, ensureSynthCorpus, normaliseLangMix } from "./generator.mts";
import type { LangMix } from "./types.mts";

const USAGE = `usage: pnpm bench:synth [options]

Writes the synthetic corpus to .bench-cache/synth/<id>/ (or --out) and prints its id and
totals. The same options, profile, snippets, plugin data and generator give the same id
and the same bytes; an existing corpus with that id is reused.

  --scale <n>             files in thousands (default: ${DEFAULT_SYNTH_OPTIONS.scale})
  --seed <n>              seed of every random draw (default: ${DEFAULT_SYNTH_OPTIONS.seed})
  --size-mult <n>         multiply every file's target size (default: 1)
  --detections-mult <n>   multiply the untyped and typed detection densities (default: 1)
  --collisions-mult <n>   multiply the share of member names that hit a listener bucket (default: 1)
  --shadow-mult <n>       multiply the density of shadowed decoys (default: 1)
  --lang-mix <mix>        language weights, e.g. js:3,ts:2,tsx:1 (the default); js, ts and tsx only
  --out <dir>             write here instead; a directory without manifest.json is never replaced
  --force                 regenerate even when the directory holds a corpus with the same id`;

function langMix(text: string): LangMix {
  if (text === "") return DEFAULT_SYNTH_OPTIONS.langMix;
  const weights: Record<string, number> = {};

  for (const part of text.split(",")) {
    const match = /^\s*([a-z]+)\s*:\s*([^\s,]+)\s*$/.exec(part);
    const lang = match?.[1];
    const weight = match?.[2];

    if (lang === undefined || weight === undefined || lang in weights) {
      throw new CliError(
        `--lang-mix expects lang:weight pairs such as js:3,ts:2,tsx:1, got "${text}"`,
      );
    }

    weights[lang] = Number(weight);
  }

  try {
    return normaliseLangMix(weights);
  } catch (error) {
    if (error instanceof RangeError) throw new CliError(`--lang-mix: ${error.message}`);
    throw error;
  }
}

const positive = (name: string, value: number): number => {
  if (!(value > 0)) throw new CliError(`--${name} expects a positive number, got ${value}`);

  return value;
};

const nonNegative = (name: string, value: number): number => {
  if (!(value >= 0)) throw new CliError(`--${name} expects a non-negative number, got ${value}`);

  return value;
};

const SPECS = {
  scale: option.number(DEFAULT_SYNTH_OPTIONS.scale),
  seed: option.number(DEFAULT_SYNTH_OPTIONS.seed),
  sizeMult: option.number(DEFAULT_SYNTH_OPTIONS.sizeMult),
  detectionsMult: option.number(DEFAULT_SYNTH_OPTIONS.detectionsMult),
  collisionsMult: option.number(DEFAULT_SYNTH_OPTIONS.collisionsMult),
  shadowMult: option.number(DEFAULT_SYNTH_OPTIONS.shadowMult),
  langMix: option.text(""),
  out: option.text(DEFAULT_SYNTH_OPTIONS.out),
  force: option.flag(DEFAULT_SYNTH_OPTIONS.force),
};

const options = parseCli(process.argv.slice(2), SPECS, USAGE, (o) => ({
  ...o,
  scale: positive("scale", o.scale),
  sizeMult: positive("size-mult", o.sizeMult),
  detectionsMult: nonNegative("detections-mult", o.detectionsMult),
  collisionsMult: nonNegative("collisions-mult", o.collisionsMult),
  shadowMult: nonNegative("shadow-mult", o.shadowMult),
  langMix: langMix(o.langMix),
}));

const { dir, id, manifest, reused } = ensureSynthCorpus(options);
const t = manifest.totals;

const byLang = Object.entries(t.byLang)
  .map(([lang, n]) => `${lang} ${n}`)
  .join(", ");

console.log(`${reused ? "reused" : "generated"} corpus ${id} in ${dir}`);

console.log(
  `files ${t.files} (${byLang}), nodes ${t.nodes} (p50 ${t.nodesP50}, p90 ${t.nodesP90})`,
);

console.log(
  `expected reports: untyped ${t.expectedUntyped}, type-aware ${t.expectedTyped} (TypeScript files); decoys ${t.decoys}`,
);
