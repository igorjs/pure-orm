/**
 * SQLite DatabaseDriver adapter wrapping 'better-sqlite3'.
 *
 * Implements DatabaseDriver and RawConnection from src/connection/types.ts
 * using a shared in-memory better-sqlite3 database. All connections from
 * a single driver instance share the same underlying database, which is
 * essential for in-memory SQLite (each ":memory:" database is unique and
 * isolated, so without sharing, the pool would create separate databases
 * per connection).
 *
 * All operations are synchronous under the hood but wrapped in
 * Promise.resolve() to satisfy the async RawConnection interface.
 */

import BetterSqlite from "better-sqlite3";

import type {
  ConnectionConfig,
  DatabaseDriver,
  RawConnection,
} from "../../src/connection/types.ts";

/**
 * Detect whether a SQL statement is a read query (SELECT, WITH, PRAGMA,
 * EXPLAIN) or a write mutation (INSERT, UPDATE, DELETE, CREATE, DROP, ALTER).
 *
 * better-sqlite3 requires different methods for reads (.all()) vs writes (.run()).
 */
const isReadQuery = (sql: string): boolean => {
  const trimmed = sql.trimStart().toUpperCase();
  return (
    trimmed.startsWith("SELECT") ||
    trimmed.startsWith("WITH") ||
    trimmed.startsWith("PRAGMA") ||
    trimmed.startsWith("EXPLAIN")
  );
};

/**
 * Creates a RawConnection backed by a better-sqlite3 Database instance.
 *
 * - query() uses .all() for reads and .run() for writes.
 * - For write operations, rows is empty and rowCount is the `changes` count.
 * - For read operations, rowCount is the number of returned rows.
 * - release() is a no-op: the pool layer manages the lifecycle.
 * - end() closes the database.
 */
const wrapDatabase = (db: BetterSqlite.Database, closeFn: () => void): RawConnection =>
  Object.freeze({
    query: async (
      sql: string,
      params: readonly unknown[],
    ): Promise<{ readonly rows: readonly unknown[]; readonly rowCount: number }> => {
      // Handle empty/whitespace-only SQL.
      const trimmed = sql.trim();
      if (trimmed.length === 0) {
        return { rows: [], rowCount: 0 };
      }

      // Transaction control statements (BEGIN, COMMIT, ROLLBACK, SAVEPOINT, RELEASE)
      // are executed directly without prepare() since they don't accept parameters.
      const upper = trimmed.toUpperCase();
      if (
        upper.startsWith("BEGIN") ||
        upper.startsWith("COMMIT") ||
        upper.startsWith("ROLLBACK") ||
        upper.startsWith("SAVEPOINT") ||
        upper.startsWith("RELEASE")
      ) {
        db.exec(trimmed);
        return { rows: [], rowCount: 0 };
      }

      if (isReadQuery(sql)) {
        const stmt = db.prepare(sql);
        const rows = stmt.all(...params);
        return { rows, rowCount: rows.length };
      }

      // Write operation: check if it contains RETURNING clause.
      if (upper.includes("RETURNING")) {
        const stmt = db.prepare(sql);
        const rows = stmt.all(...params);
        return { rows, rowCount: rows.length };
      }

      const stmt = db.prepare(sql);
      const result = stmt.run(...params);
      return { rows: [], rowCount: result.changes };
    },
    release: async (): Promise<void> => {
      // No-op: the connection pool controls the lifecycle.
    },
    end: async (): Promise<void> => {
      closeFn();
    },
  });

/**
 * SQLite driver adapter using a shared in-memory database.
 *
 * A single better-sqlite3 Database instance is created on the first
 * connect() call and shared across all subsequent connections. This
 * ensures that DDL statements (CREATE TABLE, etc.) and data mutations
 * are visible across all connections in the pool.
 *
 * The ConnectionConfig is ignored since SQLite in-memory databases
 * don't need host/port/credentials.
 */
const createSqliteDriver = (): DatabaseDriver => {
  let sharedDb: BetterSqlite.Database | null = null;

  return Object.freeze({
    connect: async (_config: ConnectionConfig): Promise<RawConnection> => {
      if (sharedDb === null) {
        sharedDb = new BetterSqlite(":memory:");
        sharedDb.pragma("journal_mode = WAL");
      }

      // Each connection wraps the same shared DB. end() closes the
      // shared DB only once, subsequent calls are no-ops.
      const closeFn = (): void => {
        if (sharedDb !== null) {
          sharedDb.close();
          sharedDb = null;
        }
      };

      return wrapDatabase(sharedDb, closeFn);
    },
  });
};

export { createSqliteDriver };
