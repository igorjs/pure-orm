/**
 * DbError: discriminated union for all ORM error types.
 *
 * Plain frozen objects (not class instances) to stay consistent with the
 * functional approach. Each variant carries only the context relevant to
 * its error category, keeping pattern matching straightforward.
 */

// ---- Variant types ----

type ConnectionError = {
  readonly tag: "ConnectionError";
  readonly message: string;
  readonly cause?: unknown;
};

type QueryError = {
  readonly tag: "QueryError";
  readonly message: string;
  readonly sql: string;
  readonly params: readonly unknown[];
  readonly cause?: unknown;
};

type ValidationError = {
  readonly tag: "ValidationError";
  readonly message: string;
  readonly field?: string;
  readonly value?: unknown;
};

type MigrationError = {
  readonly tag: "MigrationError";
  readonly message: string;
  readonly migration: string;
  readonly cause?: unknown;
};

type TransactionError = {
  readonly tag: "TransactionError";
  readonly message: string;
  readonly cause?: unknown;
};

type ConstraintError = {
  readonly tag: "ConstraintError";
  readonly message: string;
  readonly constraint: string;
  readonly table: string;
};

// ---- Union ----

type DbError =
  | ConnectionError
  | QueryError
  | ValidationError
  | MigrationError
  | TransactionError
  | ConstraintError;

// ---- Smart constructors ----

const connectionError = (message: string, cause?: unknown): ConnectionError =>
  Object.freeze({
    tag: "ConnectionError" as const,
    message,
    ...(cause !== undefined ? { cause } : {}),
  });

const queryError = (
  message: string,
  sql: string,
  params: readonly unknown[],
  cause?: unknown,
): QueryError =>
  Object.freeze({
    tag: "QueryError" as const,
    message,
    sql,
    params: Object.freeze([...params]),
    ...(cause !== undefined ? { cause } : {}),
  });

const validationError = (message: string, field?: string, value?: unknown): ValidationError =>
  Object.freeze({
    tag: "ValidationError" as const,
    message,
    ...(field !== undefined ? { field } : {}),
    ...(value !== undefined ? { value } : {}),
  });

const migrationError = (message: string, migration: string, cause?: unknown): MigrationError =>
  Object.freeze({
    tag: "MigrationError" as const,
    message,
    migration,
    ...(cause !== undefined ? { cause } : {}),
  });

const transactionError = (message: string, cause?: unknown): TransactionError =>
  Object.freeze({
    tag: "TransactionError" as const,
    message,
    ...(cause !== undefined ? { cause } : {}),
  });

const constraintError = (message: string, constraint: string, table: string): ConstraintError =>
  Object.freeze({ tag: "ConstraintError" as const, message, constraint, table });

export type {
  ConnectionError,
  ConstraintError,
  DbError,
  MigrationError,
  QueryError,
  TransactionError,
  ValidationError,
};
export {
  connectionError,
  constraintError,
  migrationError,
  queryError,
  transactionError,
  validationError,
};
