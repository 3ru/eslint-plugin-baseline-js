// A parameter shadows the global, so this call must not report.
export function abortLater(AbortSignal) {
  return AbortSignal.any(0);
}
