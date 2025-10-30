import type { Rule } from "eslint";

type ListenerMap = Rule.RuleListener;
type AnyListenerFn = (...args: unknown[]) => void;
type ListenerRecord = Record<string, unknown>;

/**
 * Merge one or more source listener maps into an existing map.
 * This preserves execution order (existing listeners run before new ones)
 * while keeping the original object reference intact.
 */
export function mergeRuleListeners(
  target: ListenerMap,
  ...sources: Array<ListenerMap | null | undefined>
): ListenerMap {
  const dest = target as unknown as ListenerRecord;
  for (const source of sources) {
    if (!source) continue;
    for (const [event, handler] of Object.entries(source)) {
      const prev = target[event as keyof ListenerMap] as unknown as AnyListenerFn | undefined;
      if (!prev) {
        dest[event] = handler;
        continue;
      }
      const next = handler as unknown as AnyListenerFn;
      dest[event] = function merged(this: unknown, ...args: unknown[]) {
        prev.apply(this as object, args);
        next.apply(this as object, args);
      };
    }
  }
  return target;
}
