import { createRequire } from "node:module";

const requireFromHere = createRequire(import.meta.url);

function isModuleNotFound(err: unknown, specifier: string): boolean {
  if (!(err instanceof Error)) return false;
  const anyErr = err as { code?: unknown; message?: unknown };
  if (anyErr.code === "MODULE_NOT_FOUND") {
    const msg = typeof anyErr.message === "string" ? anyErr.message : "";
    return (
      msg.includes(`'${specifier}'`) || msg.includes(`"${specifier}"`) || msg.endsWith(specifier)
    );
  }
  return false;
}

/**
 * Attempt to load a CommonJS module; return undefined when the specifier cannot be resolved.
 * Other failures bubble so unexpected issues remain visible.
 */
export function requireOptional(specifier: string): unknown | undefined {
  try {
    return requireFromHere(specifier);
  } catch (error) {
    if (isModuleNotFound(error, specifier)) return undefined;
    throw error;
  }
}
