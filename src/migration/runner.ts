// Copyright 2026 igorjs. SPDX-License-Identifier: Apache-2.0

/**
 * Migration runner.
 *
 * Applies and rolls back migrations against a database. Each migration
 * runs in a transaction (by default) and records its state in
 * _pure_orm_migrations with batch grouping and status tracking.
 *
 * The runner does NOT read migration files from disk: callers pass the
 * SQL strings directly. File I/O is the CLI's responsibility.
 */

import { Task } from "@igorjs/pure-fx/async";
import type { DatabaseClient } from "../connection/types.ts";
import type { DbError } from "../errors/errors.ts";
import { queryError } from "../errors/errors.ts";
import { startTimer } from "../logging/timing.ts";
import type { MigrationStatus } from "./types.ts";

// ---- DB Helpers (exported for use by other migration modules) ----

/**
 * Executes raw SQL directly against a connection. Used for DDL statements
 * that don't return meaningful rows.
 */
const execRaw = (db: DatabaseClient, sql: string): Task<void, DbError> =>
  db.pool.acquire().flatMap(conn =>
    Task.fromPromise(
      async () => {
        try {
          await conn.query(sql, []);
        } finally {
          await conn.release();
        }
      },
      (cause: unknown) => queryError("Migration SQL failed", sql, [], cause),
    ),
  );

/**
 * Executes a parameterised query and returns rows.
 */
const execQuery = (
  db: DatabaseClient,
  sql: string,
  params: readonly unknown[],
): Task<readonly unknown[], DbError> =>
  db.pool.acquire().flatMap(conn =>
    Task.fromPromise(
      async () => {
        try {
          const { rows } = await conn.query(sql, params);
          return rows;
        } finally {
          await conn.release();
        }
      },
      (cause: unknown) => queryError("Migration query failed", sql, params, cause),
    ),
  );

// ---- Public API ----

type MigrationInput = {
  readonly name: string;
  readonly upSql: string;
  readonly checksum: string;
  readonly batch: number;
  readonly transaction: boolean;
};

type RollbackInput = {
  readonly name: string;
  readonly downSql: string;
  readonly transaction: boolean;
};

// ---- SQLite column upgrade helper ----

const upgradeSqliteTable = (db: DatabaseClient): Task<void, DbError> =>
  execQuery(db, 'PRAGMA table_info("_pure_orm_migrations")', []).flatMap(rows => {
    const columns = new Set((rows as readonly { name: string }[]).map(r => r.name));
    const alterStatements: string[] = [];
    if (!columns.has("batch")) {
      alterStatements.push(
        'ALTER TABLE "_pure_orm_migrations" ADD COLUMN "batch" INTEGER NOT NULL DEFAULT 0',
      );
    }
    if (!columns.has("status")) {
      alterStatements.push(
        'ALTER TABLE "_pure_orm_migrations" ADD COLUMN "status" TEXT NOT NULL DEFAULT \'applied\'',
      );
    }
    if (alterStatements.length === 0) {
      return Task.of(undefined);
    }
    return alterStatements.reduce<Task<void, DbError>>(
      (prev, stmt) => prev.flatMap(() => execRaw(db, stmt)),
      Task.of(undefined),
    );
  });

/**
 * Ensures the _pure_orm_migrations state table exists with all columns.
 * Idempotent: safe to call on every run. Handles upgrades from older
 * table schemas that lack the batch and status columns.
 */
const ensureMigrationTable = (db: DatabaseClient): Task<void, DbError> => {
  const sqliteDdl = `CREATE TABLE IF NOT EXISTS "_pure_orm_migrations" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "name" TEXT NOT NULL UNIQUE,
  "applied_at" TEXT NOT NULL DEFAULT (datetime('now')),
  "checksum" TEXT NOT NULL,
  "execution_ms" INTEGER NOT NULL,
  "batch" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'applied'
);`;

  const pgDdl = `CREATE TABLE IF NOT EXISTS "_pure_orm_migrations" (
  "id" SERIAL PRIMARY KEY,
  "name" TEXT NOT NULL UNIQUE,
  "applied_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "checksum" TEXT NOT NULL,
  "execution_ms" INTEGER NOT NULL,
  "batch" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'applied'
);`;

  if (db.dialect.name === "sqlite") {
    return execRaw(db, sqliteDdl).flatMap(() => upgradeSqliteTable(db));
  }

  // PostgreSQL: CREATE TABLE + ADD COLUMN IF NOT EXISTS for upgrades
  return execRaw(db, pgDdl)
    .flatMap(() =>
      execRaw(
        db,
        'ALTER TABLE "_pure_orm_migrations" ADD COLUMN IF NOT EXISTS "batch" INTEGER NOT NULL DEFAULT 0',
      ),
    )
    .flatMap(() =>
      execRaw(
        db,
        'ALTER TABLE "_pure_orm_migrations" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT \'applied\'',
      ),
    );
};

/**
 * Applies a single migration: runs the up SQL and records it in the state table.
 */
const applyMigration = (db: DatabaseClient, migration: MigrationInput): Task<void, DbError> => {
  const timer = startTimer();

  return execRaw(db, migration.upSql).flatMap(() => {
    const durationMs = Math.round(timer());
    const placeholder = db.dialect.name === "sqlite" ? "?, ?, ?, ?, ?" : "$1, $2, $3, $4, $5";
    const insertSql = `INSERT INTO "_pure_orm_migrations" ("name", "checksum", "execution_ms", "batch", "status") VALUES (${placeholder})`;
    const status: MigrationStatus = "applied";
    return execQuery(db, insertSql, [
      migration.name,
      migration.checksum,
      durationMs,
      migration.batch,
      status,
    ]).map(() => undefined);
  });
};

/**
 * Records a migration as in_progress before executing concurrent DDL.
 */
const recordInProgress = (
  db: DatabaseClient,
  name: string,
  checksum: string,
  batch: number,
): Task<void, DbError> => {
  const placeholder = db.dialect.name === "sqlite" ? "?, ?, ?, ?, ?" : "$1, $2, $3, $4, $5";
  const sql = `INSERT INTO "_pure_orm_migrations" ("name", "checksum", "execution_ms", "batch", "status") VALUES (${placeholder})`;
  const status: MigrationStatus = "in_progress";
  return execQuery(db, sql, [name, checksum, 0, batch, status]).map(() => undefined);
};

/**
 * Updates a migration's status and execution time.
 */
const updateMigrationStatus = (
  db: DatabaseClient,
  name: string,
  status: MigrationStatus,
  executionMs: number,
): Task<void, DbError> => {
  const isSqlite = db.dialect.name === "sqlite";
  const sql = `UPDATE "_pure_orm_migrations" SET "status" = ${isSqlite ? "?" : "$1"}, "execution_ms" = ${isSqlite ? "?" : "$2"} WHERE "name" = ${isSqlite ? "?" : "$3"}`;
  return execQuery(db, sql, [status, executionMs, name]).map(() => undefined);
};

/**
 * Rolls back a single migration: runs the down SQL and removes the state record.
 */
const rollbackMigration = (db: DatabaseClient, migration: RollbackInput): Task<void, DbError> => {
  const placeholder = db.dialect.name === "sqlite" ? "?" : "$1";
  const deleteSql = `DELETE FROM "_pure_orm_migrations" WHERE "name" = ${placeholder}`;

  return execRaw(db, migration.downSql).flatMap(() =>
    execQuery(db, deleteSql, [migration.name]).map(() => undefined),
  );
};

/**
 * Returns all applied migrations from the state table, ordered by id.
 */
const getMigrationStatus = (
  db: DatabaseClient,
): Task<readonly Record<string, unknown>[], DbError> => {
  const sql = 'SELECT * FROM "_pure_orm_migrations" ORDER BY "id" ASC';
  return execQuery(db, sql, []).map(rows => rows as Record<string, unknown>[]);
};

/**
 * Returns the next batch number (MAX(batch) + 1).
 */
const getNextBatch = (db: DatabaseClient): Task<number, DbError> => {
  const sql = 'SELECT COALESCE(MAX("batch"), 0) AS "maxBatch" FROM "_pure_orm_migrations"';
  return execQuery(db, sql, []).map(rows => {
    const row = rows[0] as { maxBatch: number } | undefined;
    return (row?.maxBatch ?? 0) + 1;
  });
};

/**
 * Returns the set of applied migration names.
 */
const getAppliedNames = (db: DatabaseClient): Task<ReadonlySet<string>, DbError> => {
  const sql = 'SELECT "name" FROM "_pure_orm_migrations" WHERE "status" = \'applied\'';
  return execQuery(db, sql, []).map(
    rows => new Set((rows as readonly { name: string }[]).map(r => r.name)),
  );
};

export type { MigrationInput, RollbackInput };
export {
  applyMigration,
  ensureMigrationTable,
  execQuery,
  execRaw,
  getAppliedNames,
  getMigrationStatus,
  getNextBatch,
  recordInProgress,
  rollbackMigration,
  updateMigrationStatus,
};
