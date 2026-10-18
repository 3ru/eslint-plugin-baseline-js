import type { PairedEstimate } from "./stats.mts";

const NOT_AVAILABLE = "n/a";

export function fmtMs(ms: number): string {
  if (!Number.isFinite(ms)) return NOT_AVAILABLE;

  return ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${ms.toFixed(1)} ms`;
}

/** Two significant digits: per-file costs range from tens of milliseconds to microseconds. */
export function fmtMsFine(ms: number): string {
  if (!Number.isFinite(ms)) return NOT_AVAILABLE;
  const size = Math.abs(ms);
  const digits = size >= 100 ? size.toFixed(0) : size.toPrecision(2);

  return `${ms < 0 ? "−" : ""}${digits} ms`;
}

/** `process.resourceUsage().maxRSS` is in KiB on every platform. */
export function fmtMb(kb: number): string {
  if (!Number.isFinite(kb)) return NOT_AVAILABLE;
  const mb = kb / 1024;

  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(0)} MB`;
}

export function fmtInt(n: number): string {
  return Number.isFinite(n) ? n.toLocaleString("en-US") : NOT_AVAILABLE;
}

/** A ratio as a signed change; an exact zero has no sign, so it never reads as noise. */
export function fmtPct(ratio: number): string {
  if (!Number.isFinite(ratio)) return NOT_AVAILABLE;
  const pct = (ratio - 1) * 100;

  if (pct === 0) return "0.0%";

  return `${pct > 0 ? "+" : "−"}${Math.abs(pct).toFixed(1)}%`;
}

export function fmtCi(e: PairedEstimate): string {
  if (!Number.isFinite(e.lo) || !Number.isFinite(e.hi)) return NOT_AVAILABLE;

  return `${fmtPct(e.lo)} … ${fmtPct(e.hi)}`;
}

/** Two significant digits, so 0.049 never prints as "0.05" next to a p < 0.05 verdict. */
export function fmtP(p: number): string {
  if (Number.isNaN(p)) return NOT_AVAILABLE;

  return p < 0.001 ? "p < 0.001" : `p = ${p.toPrecision(2)}`;
}

export interface Column<R> {
  title: string;
  align?: "left" | "right" | "center";
  cell(row: R): string;
}

const ALIGNMENT = { left: "---", right: "---:", center: ":---:" } as const;

export function markdownTable<R>(columns: ReadonlyArray<Column<R>>, rows: readonly R[]): string {
  const line = (cells: readonly string[]): string => `| ${cells.join(" | ")} |`;

  return [
    line(columns.map((column) => column.title)),
    `|${columns.map((column) => ALIGNMENT[column.align ?? "left"]).join("|")}|`,
    ...rows.map((row) => line(columns.map((column) => column.cell(row)))),
  ].join("\n");
}
