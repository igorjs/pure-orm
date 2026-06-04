// Copyright 2026 igorjs. SPDX-License-Identifier: Apache-2.0

/**
 * @module @igorjs/pure-orm
 *
 * Functional-first, type-safe ORM built on @igorjs/pure-fx.
 * Pure query composition, PostgreSQL dialect, Lambda-ready connections.
 *
 * Complete public API: models, queries, mutations, relations, joins, aggregates,
 * window functions, CTEs, subqueries, soft deletes, audit, migrations.
 */

// ---- pure-fx re-exports (convenience for consumers) ----
export { flow, pipe } from "@igorjs/pure-fx/core";

export type { AuditCallback, AuditEntryInput } from "./audit/interceptor.ts";
// ---- Audit system (Phase 4) ----
export { createAuditHooks, withAuditContext } from "./audit/interceptor.ts";
export { auditLog } from "./audit/logger.ts";
export { AuditModel } from "./audit/table.ts";
export type { AuditContext, AuditEntry, AuditOperation } from "./audit/types.ts";
// ---- Connection layer (WU-6) ----
export { Database } from "./connection/database.ts";
export { createLambdaPool } from "./connection/lambda.ts";
export { createPool } from "./connection/pool.ts";
export type {
  IsolationLevel,
  TransactionClient,
  TransactionOptions,
} from "./connection/transaction.ts";
// ---- Transaction support (Phase 2) ----
export {
  createTransactionClient,
  isTransactionClient,
  transaction,
} from "./connection/transaction.ts";
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

// ---- Dialect types (implementations added in WU-4) ----
export type { Dialect } from "./dialect/dialect.ts";
// ---- Dialect implementations (WU-4) ----
export { createMysqlDialect } from "./dialect/mysql.ts";
export { createPostgresDialect } from "./dialect/postgresql.ts";
export { registerDialect, resolveDialect } from "./dialect/registry.ts";
export { createSqliteDialect } from "./dialect/sqlite.ts";
export type {
  ConnectionError,
  ConstraintError,
  DbError,
  MigrationError,
  QueryError,
  TransactionError,
  ValidationError,
} from "./errors/errors.ts";
// ---- Errors ----
export {
  connectionError,
  constraintError,
  migrationError,
  queryError,
  transactionError,
  validationError,
} from "./errors/errors.ts";
// ---- Query execution (WU-7) ----
export { compile } from "./execute/compile.ts";
export { execute, findOne } from "./execute/execute.ts";
export { mapRows, snakeToCamel } from "./execute/result-mapper.ts";
// ---- Logging implementations (WU-5) ----
export { dispatchHook } from "./logging/hooks.ts";
export { createConsoleLogger, createNoopLogger } from "./logging/logger.ts";
export { startTimer } from "./logging/timing.ts";
// ---- Logging types (implementations added in WU-5) ----
export type { Logger, LogLevel, QueryEvent, QueryHooks } from "./logging/types.ts";
// ---- Migration system ----
export { computeChecksum, validateChecksums } from "./migration/checksum.ts";
export { columnsEqual, diffSnapshots, diffTable } from "./migration/differ.ts";
export { discoverMigrations } from "./migration/discovery.ts";
export { executeBatch, rollbackBatch } from "./migration/executor.ts";
export type { RollbackTarget } from "./migration/executor.ts";
export { generateDown, generateMigration, generateUp } from "./migration/generator.ts";
export { acquireLock } from "./migration/locking.ts";
export type { LockHandle } from "./migration/locking.ts";
export { orderOperations } from "./migration/ordering.ts";
export type { MigrationInput, RollbackInput } from "./migration/runner.ts";
export {
  applyMigration,
  ensureMigrationTable,
  getAppliedNames,
  getMigrationStatus,
  getNextBatch,
  rollbackMigration,
} from "./migration/runner.ts";
export { createSnapshot, snapshotColumn, snapshotTable } from "./migration/snapshot.ts";
export { parseSqlMigration } from "./migration/sql-parser.ts";
export type { ParseError } from "./migration/sql-parser.ts";
export { MigrationModel } from "./migration/state.ts";
export type {
  BatchResult,
  ChangeOperation,
  ChecksumMismatch,
  ColumnSnapshot,
  ExecutorOptions,
  ForeignKeySnapshot,
  IndexSnapshot,
  Migration,
  MigrationFile,
  MigrationHookContext,
  MigrationHooks,
  MigrationRecord,
  MigrationResult,
  MigrationStatus,
  SchemaSnapshot,
  TableSnapshot,
} from "./migration/types.ts";
export type { InferModelType } from "./model/define.ts";
// ---- Model layer (WU-1) ----
export { camelToSnake, Model } from "./model/define.ts";
export { Field } from "./model/field.ts";
export type {
  BelongsToRelation,
  HasManyRelation,
  HasOneRelation,
  ManyToManyRelation,
  RelationDef,
  RelationMap,
} from "./model/relations.ts";
export { belongsTo, hasMany, hasOne, manyToMany } from "./model/relations.ts";
export { injectSoftDeleteColumn } from "./model/soft-delete.ts";
export { injectTimestampColumns } from "./model/timestamps.ts";
export type {
  ColumnMetadata,
  FieldConfig,
  FieldDef,
  FieldsRecord,
  ModelOptions,
  ModelRef,
} from "./model/types.ts";
export type { AggregateBuilder } from "./query/aggregates.ts";
// ---- Aggregate functions ----
export { avg, count, max, min, sum } from "./query/aggregates.ts";
export type { HasConditions } from "./query/builders.ts";
// ---- Query builder functions (WU-3 + Phase 6) ----
export { from, groupBy, having, limit, offset, orderBy, select, where } from "./query/builders.ts";
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
// ---- CTE and subquery builders ----
export { withCte } from "./query/cte.ts";
// ---- Eager and lazy loading ----
export { include } from "./query/include.ts";
// ---- Join builder functions (Phase 3) ----
export { fullJoin, join, leftJoin, on, rightJoin } from "./query/joins.ts";
export { lazy } from "./query/lazy.ts";
// ---- Mutation builder functions (Phase 2 + Phase 4) ----
export {
  hardRemove,
  insert,
  insertMany,
  onConflict,
  remove,
  restore,
  returning,
  update,
} from "./query/mutations.ts";
// ---- Raw SQL (Phase 6) ----
export { raw, sql } from "./query/raw.ts";
// ---- Soft delete query modifiers (Phase 4) ----
export { onlyDeleted, withDeleted } from "./query/soft-delete.ts";
export { exists, notExists } from "./query/subquery.ts";
// ---- Query types ----
export type {
  AggregateExpr,
  AggregateFn,
  CompiledQuery,
  ConditionNode,
  CteClause,
  DeleteNode,
  ExistsNode,
  InsertNode,
  JoinClause,
  JoinCondition,
  JoinType,
  NotExistsNode,
  OnConflictClause,
  OrderByClause,
  QueryNode,
  RawNode,
  ReturningClause,
  SelectColumn,
  SelectNode,
  SortDirection,
  UpdateNode,
  WindowExpr,
  WindowFn,
} from "./query/types.ts";
export type { WindowBuilder } from "./query/window.ts";
// ---- Window functions ----
export { denseRank, rank, rowNumber } from "./query/window.ts";
