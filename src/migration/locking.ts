// Copyright 2026 igorjs. SPDX-License-Identifier: Apache-2.0

/**
 * Migration locking.
 *
 * Prevents concurrent migration runners from operating on the same
 * database. Uses PostgreSQL advisory locks or SQLite lock rows.
 *
 * The LockHandle pattern holds the connection used for the advisory
 * lock so the same session releases it.
 */

import type { DatabaseClient, RawConnection } from "../connection/types.ts";
import type { DbError } from "../errors/errors.ts";
import { migrationError } from "../errors/errors.ts";
import { Task } from "../fx.ts";

// ---- Lock handle ----

type LockHandle = {
  readonly release: () => Task<void, DbError>;
};

// pi digits, truncated to fit a 32-bit signed integer
const PG_LOCK_ID = 314159265;

// ---- PostgreSQL advisory lock ----

const acquirePostgresLock = (db: DatabaseClient): Task<LockHandle, DbError> =>
  db.pool.acquire().flatMap(conn =>
    Task.fromPromise(
      async () => {
        const { rows } = await conn.query(
          `SELECT pg_try_advisory_lock(${PG_LOCK_ID}) AS "acquired"`,
          [],
        );
        const row = (rows as readonly { acquired: boolean }[])[0];
        if (row?.acquired !== true) {
          await conn.release();
          throw new Error("lock_not_acquired");
        }
        return createPostgresHandle(conn);
      },
      (cause: unknown) => {
        if (cause instanceof Error && cause.message === "lock_not_acquired") {
          return migrationError(
            "Migration lock is held by another process. Another migration may be in progress.",
            "_lock_",
          );
        }
        return migrationError("Failed to acquire migration lock", "_lock_", cause);
      },
    ),
  );

const createPostgresHandle = (conn: RawConnection): LockHandle =>
  Object.freeze({
    release: () =>
      Task.fromPromise(
        async () => {
          try {
            await conn.query(`SELECT pg_advisory_unlock(${PG_LOCK_ID})`, []);
          } finally {
            await conn.release();
          }
        },
        (cause: unknown) => migrationError("Failed to release migration lock", "_lock_", cause),
      ),
  });

// ---- SQLite lock row ----

const LOCK_ROW_NAME = "_pure_orm_lock_";

const acquireSqliteLock = (db: DatabaseClient): Task<LockHandle, DbError> =>
  db.pool.acquire().flatMap(conn =>
    Task.fromPromise(
      async () => {
        try {
          await conn.query(
            `INSERT INTO "_pure_orm_migrations" ("name", "checksum", "execution_ms", "batch", "status") VALUES (?, ?, ?, ?, ?)`,
            [LOCK_ROW_NAME, "", 0, 0, "locked"],
          );
        } catch {
          await conn.release();
          throw new Error("lock_not_acquired");
        }
        await conn.release();
        return createSqliteHandle(db);
      },
      (cause: unknown) => {
        if (cause instanceof Error && cause.message === "lock_not_acquired") {
          return migrationError(
            "Migration lock is held by another process. Another migration may be in progress.",
            "_lock_",
          );
        }
        return migrationError("Failed to acquire migration lock", "_lock_", cause);
      },
    ),
  );

const createSqliteHandle = (db: DatabaseClient): LockHandle =>
  Object.freeze({
    release: () =>
      db.pool.acquire().flatMap(conn =>
        Task.fromPromise(
          async () => {
            try {
              await conn.query(`DELETE FROM "_pure_orm_migrations" WHERE "name" = ?`, [
                LOCK_ROW_NAME,
              ]);
            } finally {
              await conn.release();
            }
          },
          (cause: unknown) => migrationError("Failed to release migration lock", "_lock_", cause),
        ),
      ),
  });

// ---- Public API ----

/**
 * Acquires a migration lock. Returns a LockHandle whose release()
 * method must be called when the migration batch is complete.
 *
 * Fails immediately if the lock is already held (no waiting).
 */
const acquireLock = (db: DatabaseClient): Task<LockHandle, DbError> =>
  db.dialect.name === "sqlite" ? acquireSqliteLock(db) : acquirePostgresLock(db);

export type { LockHandle };
export { acquireLock };
