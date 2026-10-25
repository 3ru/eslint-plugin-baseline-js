/** Statistics for paired base/head measurements, on log ratios d = ln(head / base). */
import { createRng } from "./lib.mts";

export const SIGNIFICANCE = 0.05;

/** Smaller changes are not called slower or faster; about Criterion's ±2% noise band. */
const PRACTICAL_FLOOR = 0.03;

/** 2^20 sign masks are still cheap to enumerate exactly. */
const EXACT_PERMUTATION_LIMIT = 20;
const MONTE_CARLO_MASKS = 20_000;

export function mean(xs: readonly number[]): number {
  return xs.reduce((sum, x) => sum + x, 0) / xs.length;
}

export function stdev(xs: readonly number[]): number {
  if (xs.length < 2) return Number.NaN;
  const m = mean(xs);

  return Math.sqrt(xs.reduce((sum, x) => sum + (x - m) ** 2, 0) / (xs.length - 1));
}

export function quantile(xs: readonly number[], q: number): number {
  if (!(q >= 0 && q <= 1)) throw new RangeError(`quantile() needs q in [0, 1], got ${q}`);
  const sorted = xs.toSorted((a, b) => a - b);
  const position = (sorted.length - 1) * q;
  const lo = sorted[Math.floor(position)];
  const hi = sorted[Math.ceil(position)];

  if (lo === undefined || hi === undefined) return Number.NaN;

  return lo + (hi - lo) * (position - Math.floor(position));
}

export function median(xs: readonly number[]): number {
  return quantile(xs, 0.5);
}

/** Student's t 0.975 quantiles for 1…30 degrees of freedom. */
const T975 = [
  12.706204736, 4.30265273, 3.182446305, 2.776445105, 2.570581836, 2.446911851, 2.364624252,
  2.306004135, 2.262157163, 2.228138852, 2.20098516, 2.17881283, 2.160368656, 2.144786688,
  2.131449546, 2.119905299, 2.109815578, 2.10092204, 2.093024054, 2.085963447, 2.079613845,
  2.073873068, 2.06865761, 2.063898562, 2.059538553, 2.055529439, 2.051830516, 2.048407142,
  2.045229642, 2.042272456,
];

const Z975 = 1.959963984540054;

export function tQuantile975(df: number): number {
  if (!(df >= 1)) return Number.NaN;

  if (df <= T975.length) {
    const t = T975[df - 1];

    if (t === undefined) throw new RangeError(`tQuantile975() needs an integer df, got ${df}`);

    return t;
  }

  // Cornish–Fisher expansion in 1/df (Abramowitz & Stegun 26.7.5); error below 1e-6 above 30 df.
  const z = Z975;
  const z2 = z * z;
  const g1 = (z * (z2 + 1)) / 4;
  const g2 = (z * ((5 * z2 + 16) * z2 + 3)) / 96;
  const g3 = (z * (((3 * z2 + 19) * z2 + 17) * z2 - 15)) / 384;
  const g4 = (z * ((((79 * z2 + 776) * z2 + 1482) * z2 - 1920) * z2 - 945)) / 92160;

  return z + (g1 + (g2 + (g3 + g4 / df) / df) / df) / df;
}

export interface PairedEstimate {
  n: number;
  /** Geometric mean of head / base. */
  ratio: number;
  /** 95% t interval of the ratio. */
  lo: number;
  hi: number;
  /** Two-sided sign-flip permutation p-value of Σd. */
  p: number;
}

export function pairedLogRatio(
  pairs: ReadonlyArray<{ base: number; head: number }>,
  seed = "permutation",
): PairedEstimate {
  const d = pairs.map(({ base, head }) => {
    if (!(base > 0 && head > 0 && Number.isFinite(base) && Number.isFinite(head))) {
      throw new RangeError(`paired values must be finite and positive, got ${base} and ${head}`);
    }

    return Math.log(head / base);
  });

  const n = d.length;
  const m = mean(d);

  if (n < 2) return { n, ratio: Math.exp(m), lo: Number.NaN, hi: Number.NaN, p: Number.NaN };
  const half = (tQuantile975(n - 1) * stdev(d)) / Math.sqrt(n);

  return {
    n,
    ratio: Math.exp(m),
    lo: Math.exp(m - half),
    hi: Math.exp(m + half),
    p: signFlipP(d, seed),
  };
}

function signedSum(d: readonly number[], mask: number): number {
  let sum = 0;
  let bit = 1;

  for (const x of d) {
    sum += mask & bit ? -x : x;
    bit <<= 1;
  }

  return sum;
}

/** Share of sign flips with |Σd| at least the observed; the identity counts (Phipson & Smyth). */
function signFlipP(d: readonly number[], seed: string): number {
  // Same summation order as every mask, so the identity and its complement tie exactly.
  const observed = Math.abs(signedSum(d, 0));

  if (d.length <= EXACT_PERMUTATION_LIMIT) {
    const masks = 2 ** d.length;
    let extreme = 0;

    for (let mask = 0; mask < masks; mask++) {
      if (Math.abs(signedSum(d, mask)) >= observed) extreme++;
    }

    return extreme / masks;
  }

  const rng = createRng(seed);
  let extreme = 1;

  for (let draw = 0; draw < MONTE_CARLO_MASKS; draw++) {
    let sum = 0;

    for (const x of d) sum += rng.chance(0.5) ? -x : x;

    if (Math.abs(sum) >= observed) extreme++;
  }

  return extreme / (MONTE_CARLO_MASKS + 1);
}

/** Holm's step-down adjustment; NaN entries stay NaN and do not count towards m. */
export function holm(ps: readonly number[]): number[] {
  const ranked = ps
    .flatMap((p, index) => (Number.isNaN(p) ? [] : [{ p, index }]))
    .sort((a, b) => a.p - b.p);

  const adjusted = [...ps];
  let running = 0;

  for (const [rank, { p, index }] of ranked.entries()) {
    running = Math.max(running, Math.min(1, (ranked.length - rank) * p));
    adjusted[index] = running;
  }

  return adjusted;
}

export function pooledWithinSd(groups: ReadonlyArray<readonly number[]>): number | null {
  let squares = 0;
  let df = 0;

  for (const group of groups) {
    if (group.length === 0) throw new RangeError("pooledWithinSd() got an empty group");
    const m = mean(group);

    for (const x of group) squares += (x - m) ** 2;
    df += group.length - 1;
  }

  return df === 0 ? null : Math.sqrt(squares / df);
}

export interface LinearFit {
  intercept: number;
  slope: number;
}

export function linearFit(points: ReadonlyArray<readonly [x: number, y: number]>): LinearFit {
  const mx = mean(points.map(([x]) => x));
  const my = mean(points.map(([, y]) => y));
  let sxy = 0;
  let sxx = 0;

  for (const [x, y] of points) {
    sxy += (x - mx) * (y - my);
    sxx += (x - mx) ** 2;
  }

  const slope = sxy / sxx;

  return { intercept: my - slope * mx, slope };
}

export type Change = "regressed" | "slower" | "faster" | "inconclusive" | "unchanged" | "unknown";

/** From the interval rather than the point estimate, as Node's benchmark/compare.js does. */
export function classifyChange(
  e: PairedEstimate,
  {
    threshold,
    floor = PRACTICAL_FLOOR,
    pAdjusted = e.p,
  }: { threshold: number; floor?: number; pAdjusted?: number },
): Change {
  if (!(e.n >= 2)) return "unknown";

  if (e.lo > 1 + threshold && pAdjusted < SIGNIFICANCE) return "regressed";

  if (e.lo > 1 && e.ratio > 1 + floor) return "slower";

  if (e.hi < 1 && e.ratio < 1 - floor) return "faster";

  if ((e.hi - e.lo) / 2 > threshold) return "inconclusive";

  return "unchanged";
}
