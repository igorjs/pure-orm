/**
 * Hook dispatcher for the query lifecycle.
 *
 * Hooks are user-supplied callbacks. We must never let a misbehaving hook
 * crash the query pipeline, so every dispatch is wrapped in a try/catch.
 * Errors are reported via console.error directly — using the Logger would
 * create a circular dependency for callers that derive their logger from hooks.
 */

import type { QueryHooks } from "./types.ts";

const dispatchHook = <K extends keyof QueryHooks>(
  hooks: Partial<QueryHooks>,
  event: K,
  ...args: Parameters<QueryHooks[K]>
): void => {
  const hook = hooks[event];
  if (hook === undefined) return;

  try {
    // The cast is safe: we retrieved the hook by key K and pass the matching
    // parameter tuple, so the types align at runtime even though TypeScript
    // cannot narrow the variadic spread across the union of hook signatures.
    (hook as (...params: Parameters<QueryHooks[K]>) => void)(...args);
  } catch (err) {
    console.error("[pure-orm] hook error in", event, err);
  }
};

export { dispatchHook };
