/**
 * Dialect registry.
 *
 * A lazy name -> Dialect resolver. Built-in dialects are instantiated on
 * first use rather than at import time, so the module has no top-level
 * side effects. Bundlers can tree-shake unused dialect implementations
 * when consumers import createPostgresDialect or createSqliteDialect
 * directly instead of using resolveDialect.
 *
 * resolveDialect returns a pure-ts Result so callers handle the
 * missing-dialect case explicitly.
 */

import type { Result } from "@igorjs/pure-ts/core";
import { Err, Ok } from "@igorjs/pure-ts/core";
import type { DbError } from "../errors/errors.ts";
import { validationError } from "../errors/errors.ts";
import type { Dialect } from "./dialect.ts";
import { createPostgresDialect } from "./postgresql.ts";
import { createSqliteDialect } from "./sqlite.ts";

// ---- Built-in dialect factories (deferred instantiation) ----

const builtinFactories = new Map<string, () => Dialect>([
  ["postgresql", createPostgresDialect],
  ["sqlite", createSqliteDialect],
]);

// ---- Registry ----

const resolved = new Map<string, Dialect>();

/**
 * Registers a custom dialect under the given name. Overrides built-in
 * dialects if the name collides.
 */
const registerDialect = (name: string, dialect: Dialect): void => {
  resolved.set(name, dialect);
};

/**
 * Resolves a dialect by name. Custom registrations take precedence over
 * built-ins. Instances are cached after first resolution.
 */
const resolveDialect = (name: string): Result<Dialect, DbError> => {
  const cached = resolved.get(name);
  if (cached !== undefined) return Ok(cached);

  const factory = builtinFactories.get(name);
  if (factory !== undefined) {
    const dialect = factory();
    resolved.set(name, dialect);
    return Ok(dialect);
  }

  return Err(validationError(`Unknown dialect: "${name}"`, "dialect", name));
};

export { registerDialect, resolveDialect };
