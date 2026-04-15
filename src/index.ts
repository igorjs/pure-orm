/**
 * @module @igorjs/pure-orm
 *
 * Functional-first, type-safe ORM built on @igorjs/pure-ts.
 * Pure query composition, PostgreSQL dialect, Lambda-ready connections.
 *
 * Phase 1-5 public API -- foundation, mutations, transactions, relations, joins, soft deletes, audit, migrations.
 */

// ---- Errors ----
export {
  connectionError,
  constraintError,
  migrationError,
  queryError,
  transactionError,
  validationError,
} from "./errors/errors.ts";
export type {
  ConnectionError,
  ConstraintError,
  DbError,
  MigrationError,
  QueryError,
  TransactionError,
  ValidationError,
} from "./errors/errors.ts";

// ---- Model layer (WU-1) ----
export { camelToSnake, Model } from "./model/define.ts";
export type { InferModelType } from "./model/define.ts";
export { Field } from "./model/field.ts";
export { belongsTo, hasMany, hasOne, manyToMany } from "./model/relations.ts";
export type {
  BelongsToRelation,
  HasManyRelation,
  HasOneRelation,
  ManyToManyRelation,
  RelationDef,
  RelationMap,
} from "./model/relations.ts";
export { injectSoftDeleteColumn } from "./model/soft-delete.ts";
export { injectTimestampColumns } from "./model/timestamps.ts";
export type { ColumnMetadata, FieldConfig, FieldDef, FieldsRecord, ModelOptions, ModelRef } from "./model/types.ts";

// ---- Query types (implementations added in WU-2, WU-3, Phase 2, Phase 3) ----
export type {
  CompiledQuery,
  ConditionNode,
  DeleteNode,
  InsertNode,
  JoinClause,
  JoinCondition,
  JoinType,
  OnConflictClause,
  OrderByClause,
  QueryNode,
  ReturningClause,
  SelectNode,
  SortDirection,
  UpdateNode,
} from "./query/types.ts";

// ---- Dialect types (implementations added in WU-4) ----
export type { Dialect } from "./dialect/dialect.ts";

// ---- Connection types (implementations added in WU-6) ----
export type {
  ConnectionConfig,
  ConnectionPool,
  DatabaseClient,
  DatabaseConfig,
  DatabaseDriver,
  PoolConfig,
  RawConnection,
} from "./connection/types.ts";

// ---- Logging types (implementations added in WU-5) ----
export type { Logger, LogLevel, QueryEvent, QueryHooks } from "./logging/types.ts";

// ---- Query condition functions (WU-2) ----
export {
  and,
  between,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  like,
  lt,
  lte,
  ne,
  not,
  or,
} from "./query/conditions.ts";

// ---- Query builder functions (WU-3) ----
export { from, limit, offset, orderBy, select, where } from "./query/builders.ts";
export type { HasConditions } from "./query/builders.ts";

// ---- Join builder functions (Phase 3) ----
export { fullJoin, join, leftJoin, on, rightJoin } from "./query/joins.ts";

// ---- Soft delete query modifiers (Phase 4) ----
export { onlyDeleted, withDeleted } from "./query/soft-delete.ts";

// ---- Mutation builder functions (Phase 2 + Phase 4) ----
export { hardRemove, insert, insertMany, onConflict, remove, restore, returning, update } from "./query/mutations.ts";

// ---- Dialect implementations (WU-4) ----
export { createPostgresDialect } from "./dialect/postgresql.ts";
export { registerDialect, resolveDialect } from "./dialect/registry.ts";
export { createSqliteDialect } from "./dialect/sqlite.ts";

// ---- Logging implementations (WU-5) ----
export { dispatchHook } from "./logging/hooks.ts";
export { createConsoleLogger, createNoopLogger } from "./logging/logger.ts";
export { startTimer } from "./logging/timing.ts";

// ---- Query execution (WU-7) ----
export { compile } from "./execute/compile.ts";
export { execute, findOne } from "./execute/execute.ts";
export { mapRows, snakeToCamel } from "./execute/result-mapper.ts";

// ---- Connection layer (WU-6) ----
export { Database } from "./connection/database.ts";
export { createLambdaPool } from "./connection/lambda.ts";
export { createPool } from "./connection/pool.ts";

// ---- Transaction support (Phase 2) ----
export { createTransactionClient, isTransactionClient, transaction } from "./connection/transaction.ts";
export type { IsolationLevel, TransactionClient, TransactionOptions } from "./connection/transaction.ts";

// ---- Audit system (Phase 4) ----
export { auditLog } from "./audit/logger.ts";
export { AuditModel } from "./audit/table.ts";
export type { AuditContext, AuditEntry, AuditOperation } from "./audit/types.ts";

// ---- Migration system (Phase 5) ----
export { columnsEqual, diffSnapshots, diffTable } from "./migration/differ.ts";
export { generateDown, generateMigration, generateUp } from "./migration/generator.ts";
export { createSnapshot, snapshotColumn, snapshotTable } from "./migration/snapshot.ts";
export { MigrationModel } from "./migration/state.ts";
export type {
  ChangeOperation,
  ColumnSnapshot,
  ForeignKeySnapshot,
  IndexSnapshot,
  MigrationRecord,
  SchemaSnapshot,
  TableSnapshot,
} from "./migration/types.ts";
