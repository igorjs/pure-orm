// Copyright 2026 igorjs. SPDX-License-Identifier: Apache-2.0

/**
 * Transaction support with savepoint-based nesting.
 *
 * The main entry point is `transaction()`, which wraps a user-provided async
 * function in a BEGIN/COMMIT/ROLLBACK envelope for top-level calls, or in a
 * SAVEPOINT/RELEASE/ROLLBACK TO SAVEPOINT envelope when called from inside an
 * existing transaction (nested case).
 *
 * A TransactionClient wraps a single dedicated connection behind a fake pool
 * so that `execute(tx)` and other pool-based helpers work transparently — they
 * call `tx.pool.acquire()`, which always returns the same connection, and
 * `tx.pool.release()`, which is a no-op (the outer transaction owns the
 * connection lifecycle).
 *
 * Connection release happens in a finally block at the top-level transaction
 * boundary only. Nested transactions (savepoints) never touch connection
 * lifecycle.
 */

import type { DbError } from "@/errors/errors";
import { transactionError } from "@/errors/errors";
import type { Result } from "@/fx";
import { Err, Ok, Task } from "@/fx";
import type { ConnectionPool, DatabaseClient, RawConnection } from "./types.ts";

// ---- Isolation levels ----

type IsolationLevel = "read committed" | "repeatable read" | "serializable";

// ---- Transaction options ----

type TransactionOptions = {
  readonly isolationLevel?: IsolationLevel;
  readonly readOnly?: boolean;
  readonly timeout?: number; // ms, auto-rollback after this duration
};

// ---- TransactionClient ----

/**
 * A DatabaseClient bound to a single dedicated connection.
 *
 * The extra fields (`_transactionDepth`, `_connection`) allow nested
 * transaction calls to detect that they are already inside a transaction and
 * switch to savepoint semantics. Depth starts at 1 for the outermost
 * transaction and increments for each nested level.
 */
type TransactionClient = DatabaseClient & {
  readonly _transactionDepth: number;
  readonly _connection: RawConnection;
};

// ---- Type guard ----

/**
 * Returns true when `db` is a TransactionClient (i.e. already inside a
 * transaction), false for a plain DatabaseClient.
 */
const isTransactionClient = (db: DatabaseClient): db is TransactionClient =>
  "_transactionDepth" in db && "_connection" in db;

// ---- Internal factory ----

/**
 * Wraps a single RawConnection in a fake ConnectionPool so that any code that
 * calls `db.pool.acquire()` gets the transaction's dedicated connection back.
 * `release()` is a no-op because the outer transaction boundary owns the
 * connection lifecycle — releasing it prematurely would corrupt the
 * transaction.
 */
const createTransactionClient = (
  base: DatabaseClient,
  conn: RawConnection,
  depth: number,
): TransactionClient => {
  const txPool: ConnectionPool = {
    acquire: () => Task.of(conn),
    release: () => Task.of(undefined),
    end: () => Task.of(undefined),
    mode: "pool",
  };
  return Object.freeze({
    dialect: base.dialect,
    pool: txPool,
    logger: base.logger,
    hooks: base.hooks,
    _transactionDepth: depth,
    _connection: conn,
  });
};

// ---- BEGIN statement builder ----

/**
 * Builds the BEGIN statement, appending ISOLATION LEVEL and/or READ ONLY
 * clauses as requested by the caller.
 */
const buildBeginStatement = (options?: TransactionOptions): string => {
  const parts: string[] = ["BEGIN"];

  if (options?.isolationLevel !== undefined) {
    parts.push(`ISOLATION LEVEL ${options.isolationLevel.toUpperCase()}`);
  }

  if (options?.readOnly === true) {
    parts.push("READ ONLY");
  }

  return parts.join(" ");
};

// ---- Nested transaction (savepoint) ----

/**
 * Handles the nested-transaction case: wraps `fn` in a SAVEPOINT / RELEASE
 * (success) or ROLLBACK TO SAVEPOINT (failure) block using the existing
 * connection. The connection is NOT acquired or released here — it belongs to
 * the outermost transaction.
 */
const runNestedTransaction = async <T>(
  db: TransactionClient,
  fn: (tx: TransactionClient) => Promise<T>,
): Promise<Result<T, DbError>> => {
  const depth = db._transactionDepth + 1;
  const savepointName = `sp_${depth}`;
  const conn = db._connection;

  await conn.query(`SAVEPOINT ${savepointName}`, []);

  const tx = createTransactionClient(db, conn, depth);

  try {
    const result = await fn(tx);
    await conn.query(`RELEASE SAVEPOINT ${savepointName}`, []);
    return Ok(result);
  } catch (cause: unknown) {
    await conn.query(`ROLLBACK TO SAVEPOINT ${savepointName}`, []);
    return Err(transactionError(`Nested transaction failed at depth ${depth}`, cause));
  }
};

// ---- Top-level transaction ----

/**
 * Handles the top-level transaction case: acquires a connection from the pool,
 * begins a transaction (with optional isolation level / read-only), runs `fn`,
 * then commits on success or rolls back on failure. The connection is always
 * released in a finally block.
 */
const runTopLevelTransaction = async <T>(
  db: DatabaseClient,
  fn: (tx: TransactionClient) => Promise<T>,
  options?: TransactionOptions,
): Promise<Result<T, DbError>> => {
  const acquireResult = await db.pool.acquire().run();
  if (acquireResult.isErr) {
    return Err(
      transactionError("Failed to acquire connection for transaction", acquireResult.error),
    );
  }

  const conn = acquireResult.value;
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  let timedOut = false;

  try {
    const beginSql = buildBeginStatement(options);
    await conn.query(beginSql, []);

    const tx = createTransactionClient(db, conn, 1);

    // Set up auto-rollback timer if a timeout was requested. The timer
    // sets a flag so the finally block knows to rollback rather than commit.
    if (options?.timeout !== undefined) {
      timeoutHandle = setTimeout(() => {
        timedOut = true;
        // Best-effort rollback — we cannot await here, but the flag ensures
        // the main flow picks it up before attempting a commit.
        void conn.query("ROLLBACK", []);
      }, options.timeout);
    }

    const result = await fn(tx);

    if (timedOut) {
      return Err(transactionError(`Transaction timed out after ${options?.timeout ?? 0}ms`));
    }

    await conn.query("COMMIT", []);
    return Ok(result);
  } catch (cause: unknown) {
    try {
      await conn.query("ROLLBACK", []);
    } catch {
      // Rollback failure is swallowed — the original error takes precedence.
    }
    return Err(transactionError("Transaction failed", cause));
  } finally {
    if (timeoutHandle !== null) {
      clearTimeout(timeoutHandle);
    }
    await db.pool.release(conn).run();
  }
};

// ---- Public API ----

/**
 * Runs `fn` inside a database transaction.
 *
 * - When `db` is a plain `DatabaseClient`, a new top-level transaction is
 *   started (BEGIN) and the connection is acquired from the pool then released
 *   in a finally block.
 *
 * - When `db` is a `TransactionClient` (i.e. the caller is already inside a
 *   transaction), a savepoint is used for nesting. The connection is NOT
 *   released — it belongs to the outermost transaction.
 *
 * The returned `Task` is lazy: the transaction does not start until `.run()`
 * is called.
 */
const transaction = <T>(
  db: DatabaseClient | TransactionClient,
  fn: (tx: TransactionClient) => Promise<T>,
  options?: TransactionOptions,
): Task<T, DbError> =>
  Task<T, DbError>(async () => {
    if (isTransactionClient(db)) {
      return runNestedTransaction(db, fn);
    }
    return runTopLevelTransaction(db, fn, options);
  });

export type { IsolationLevel, TransactionClient, TransactionOptions };
export { createTransactionClient, isTransactionClient, transaction };
