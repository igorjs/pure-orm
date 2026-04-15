/**
 * Dialect registry.
 *
 * A simple name -> Dialect map. Dialects register themselves at module load
 * time so callers can resolve by name without importing each dialect directly.
 *
 * resolveDialect returns a discriminated Result so callers handle the missing-
 * dialect case explicitly rather than receiving null/undefined.
 */

import type { DbError } from "../errors/errors.ts";
import { validationError } from "../errors/errors.ts";
import type { Dialect } from "./dialect.ts";
import { createPostgresDialect } from "./postgresql.ts";

// ---- Result type (local, lightweight) ----

type Ok<T> = { readonly tag: "Ok"; readonly value: T };
type Err<E> = { readonly tag: "Err"; readonly error: E };
type Result<T, E> = Ok<T> | Err<E>;

const ok = <T>(value: T): Ok<T> => Object.freeze({ tag: "Ok" as const, value });
const err = <E>(error: E): Err<E> => Object.freeze({ tag: "Err" as const, error });

// ---- Registry ----

const dialects = new Map<string, Dialect>();

const registerDialect = (name: string, dialect: Dialect): void => {
  dialects.set(name, dialect);
};

const resolveDialect = (name: string): Result<Dialect, DbError> => {
  const dialect = dialects.get(name);
  if (dialect === undefined) {
    return err(validationError(`Unknown dialect: "${name}"`, "dialect", name));
  }
  return ok(dialect);
};

// Auto-register PostgreSQL dialect so it is available without explicit setup.
registerDialect("postgresql", createPostgresDialect());

export { registerDialect, resolveDialect };
export type { Result };
