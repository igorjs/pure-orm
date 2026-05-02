// Copyright 2026 igorjs. SPDX-License-Identifier: Apache-2.0

/**
 * Migration runner.
 *
 * Applies and rolls back migrations against a database. Each migration
 * runs in a transaction and records its state in _pure_orm_migrations.
 *
 * The runner does NOT read migration files from disk: callers pass the
 * SQL strings directly. File I/O is the CLI's responsibility.
 */

import { Task } from "@igorjs/pure-ts/async";
import type { DatabaseClient } from "../connection/types.ts";
import type { DbError } from "../errors/errors.ts";
import { queryError } from "../errors/errors.ts";
import { startTimer } from "../logging/timing.ts";

// ---- Helpers ----

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
};

type RollbackInput = {
  readonly name: string;
  readonly downSql: string;
};

/**
 * Ensures the _pure_orm_migrations state table exists.
 * Idempotent: safe to call on every run.
 */
const ensureMigrationTable = (db: DatabaseClient): Task<void, DbError> => {
  const ddl = `CREATE TABLE IF NOT EXISTS "_pure_orm_migrations" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "name" TEXT NOT NULL UNIQUE,
  "applied_at" TEXT NOT NULL DEFAULT (datetime('now')),
  "checksum" TEXT NOT NULL,
  "execution_ms" INTEGER NOT NULL
);`;
  const pgDdl = `CREATE TABLE IF NOT EXISTS "_pure_orm_migrations" (
  "id" SERIAL PRIMARY KEY,
  "name" TEXT NOT NULL UNIQUE,
  "applied_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "checksum" TEXT NOT NULL,
  "execution_ms" INTEGER NOT NULL
);`;
  const sql = db.dialect.name === "sqlite" ? ddl : pgDdl;
  return execRaw(db, sql);
};

/**
 * Applies a single migration: runs the up SQL and records it in the state table.
 */
const applyMigration = (db: DatabaseClient, migration: MigrationInput): Task<void, DbError> => {
  const timer = startTimer();

  return execRaw(db, migration.upSql).flatMap(() => {
    const durationMs = Math.round(timer());
    const placeholder = db.dialect.name === "sqlite" ? "?, ?, ?" : "$1, $2, $3";
    const insertSql = `INSERT INTO "_pure_orm_migrations" ("name", "checksum", "execution_ms") VALUES (${placeholder})`;
    return execQuery(db, insertSql, [migration.name, migration.checksum, durationMs]).map(
      () => undefined,
    );
  });
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

export type { MigrationInput, RollbackInput };
export { applyMigration, ensureMigrationTable, getMigrationStatus, rollbackMigration };
