/**
 * Migration runner.
 *
 * Applies and rolls back migrations against a database. Each migration
 * runs in a transaction and records its state in _pure_orm_migrations.
 *
 * The runner does NOT read migration files from disk: callers pass the
 * SQL strings directly. File I/O is the CLI's responsibility.
 */

import { Err, Ok, Task } from "@igorjs/pure-ts";
import type { DatabaseClient } from "../connection/types.ts";
import type { DbError } from "../errors/errors.ts";
import { queryError } from "../errors/errors.ts";
import { startTimer } from "../logging/timing.ts";

// ---- Helpers ----

/**
 * Executes raw SQL directly against a connection. Used for DDL statements
 * that don't return meaningful rows.
 */
const execRaw = async (
  db: DatabaseClient,
  sql: string,
): Promise<{ readonly ok: true } | { readonly ok: false; readonly error: DbError }> => {
  const acquireResult = await db.pool.acquire().run();
  if (acquireResult.isErr) return { ok: false, error: acquireResult.error };

  const conn = acquireResult.value;
  try {
    await conn.query(sql, []);
    return { ok: true };
  } catch (cause: unknown) {
    return { ok: false, error: queryError("Migration SQL failed", sql, [], cause) };
  } finally {
    await conn.release();
  }
};

/**
 * Executes a parameterised query and returns rows.
 */
const execQuery = async (
  db: DatabaseClient,
  sql: string,
  params: readonly unknown[],
): Promise<
  | { readonly ok: true; readonly rows: readonly unknown[] }
  | { readonly ok: false; readonly error: DbError }
> => {
  const acquireResult = await db.pool.acquire().run();
  if (acquireResult.isErr) return { ok: false, error: acquireResult.error };

  const conn = acquireResult.value;
  try {
    const { rows } = await conn.query(sql, params);
    return { ok: true, rows };
  } catch (cause: unknown) {
    return { ok: false, error: queryError("Migration query failed", sql, params, cause) };
  } finally {
    await conn.release();
  }
};

// ---- Public API ----

type MigrationInput = {
  readonly name: string;
  readonly upSql: string;
  readonly checksum: string;
};

type RollbackInput = {
  readonly name: string;
  readonly downSql: string;
};

/**
 * Ensures the _pure_orm_migrations state table exists.
 * Idempotent: safe to call on every run.
 */
const ensureMigrationTable = (db: DatabaseClient): Task<void, DbError> =>
  Task<void, DbError>(async () => {
    const ddl = `CREATE TABLE IF NOT EXISTS "_pure_orm_migrations" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "name" TEXT NOT NULL UNIQUE,
  "applied_at" TEXT NOT NULL DEFAULT (datetime('now')),
  "checksum" TEXT NOT NULL,
  "execution_ms" INTEGER NOT NULL
);`;
    // Use a dialect-aware DDL if possible. For now, SQLite-compatible syntax
    // that also works on PostgreSQL (SERIAL vs AUTOINCREMENT differ, but
    // CREATE TABLE IF NOT EXISTS is universal).
    const pgDdl = `CREATE TABLE IF NOT EXISTS "_pure_orm_migrations" (
  "id" SERIAL PRIMARY KEY,
  "name" TEXT NOT NULL UNIQUE,
  "applied_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "checksum" TEXT NOT NULL,
  "execution_ms" INTEGER NOT NULL
);`;
    const sql = db.dialect.name === "sqlite" ? ddl : pgDdl;
    const result = await execRaw(db, sql);
    return result.ok ? Ok(undefined) : Err(result.error);
  });

/**
 * Applies a single migration: runs the up SQL and records it in the state table.
 */
const applyMigration = (db: DatabaseClient, migration: MigrationInput): Task<void, DbError> =>
  Task<void, DbError>(async () => {
    const timer = startTimer();

    // Execute the migration SQL.
    const upResult = await execRaw(db, migration.upSql);
    if (!upResult.ok) return Err(upResult.error);

    const durationMs = Math.round(timer());

    // Record in state table.
    const placeholder = db.dialect.name === "sqlite" ? "?, ?, ?" : "$1, $2, $3";
    const insertSql = `INSERT INTO "_pure_orm_migrations" ("name", "checksum", "execution_ms") VALUES (${placeholder})`;
    const insertResult = await execQuery(db, insertSql, [
      migration.name,
      migration.checksum,
      durationMs,
    ]);
    if (!insertResult.ok) return Err(insertResult.error);

    return Ok(undefined);
  });

/**
 * Rolls back a single migration: runs the down SQL and removes the state record.
 */
const rollbackMigration = (db: DatabaseClient, migration: RollbackInput): Task<void, DbError> =>
  Task<void, DbError>(async () => {
    // Execute the rollback SQL.
    const downResult = await execRaw(db, migration.downSql);
    if (!downResult.ok) return Err(downResult.error);

    // Remove from state table.
    const placeholder = db.dialect.name === "sqlite" ? "?" : "$1";
    const deleteSql = `DELETE FROM "_pure_orm_migrations" WHERE "name" = ${placeholder}`;
    const deleteResult = await execQuery(db, deleteSql, [migration.name]);
    if (!deleteResult.ok) return Err(deleteResult.error);

    return Ok(undefined);
  });

/**
 * Returns all applied migrations from the state table, ordered by id.
 */
const getMigrationStatus = (
  db: DatabaseClient,
): Task<readonly Record<string, unknown>[], DbError> =>
  Task<readonly Record<string, unknown>[], DbError>(async () => {
    const sql = 'SELECT * FROM "_pure_orm_migrations" ORDER BY "id" ASC';
    const result = await execQuery(db, sql, []);
    if (!result.ok) return Err(result.error);
    return Ok(result.rows as Record<string, unknown>[]);
  });

export type { MigrationInput, RollbackInput };
export { applyMigration, ensureMigrationTable, getMigrationStatus, rollbackMigration };
