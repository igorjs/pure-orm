/**
 * Tests for src/connection/transaction.ts
 *
 * Uses mock connections (no real database). Each test verifies the SQL
 * statements that were executed against the connection, confirming that
 * BEGIN / COMMIT / ROLLBACK / SAVEPOINT semantics are correct.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { Task } from "@igorjs/pure-fx";
import type { TransactionClient } from "../src/connection/transaction.ts";
import { isTransactionClient, transaction } from "../src/connection/transaction.ts";
import type { DatabaseClient, RawConnection } from "../src/connection/types.ts";
import { createPostgresDialect } from "../src/dialect/postgresql.ts";
import { createNoopLogger } from "../src/logging/logger.ts";

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

/**
 * A mock RawConnection that records every SQL statement executed against it.
 * The `statements` array lets tests assert on the exact sequence of SQL.
 */
const createMockConnection = (): RawConnection & { readonly statements: string[] } => {
  const statements: string[] = [];
  return {
    statements,
    query: async (sql: string) => {
      statements.push(sql);
      return { rows: [], rowCount: 0 };
    },
    release: async () => undefined,
    end: async () => undefined,
  };
};

/**
 * Builds a mock DatabaseClient whose pool always provides the given connection.
 * The `released` flag is set to true when pool.release() is called, letting
 * tests verify that the connection was returned to the pool after the
 * transaction completes.
 */
const createMockDb = (
  conn: RawConnection,
): { db: DatabaseClient; released: { value: boolean } } => {
  const released = { value: false };
  const db: DatabaseClient = {
    dialect: createPostgresDialect(),
    pool: {
      acquire: () => Task.of(conn),
      release: (_c: RawConnection) => {
        released.value = true;
        return Task.of<void, never>(undefined);
      },
      end: () => Task.of<void, never>(undefined),
      mode: "pool",
    },
    logger: createNoopLogger(),
    hooks: {},
  };
  return { db, released };
};

// ---------------------------------------------------------------------------
// 1. Basic transaction: BEGIN + fn + COMMIT
// ---------------------------------------------------------------------------

describe("transaction(): basic success path", () => {
  it("executes BEGIN then COMMIT on success", async () => {
    const conn = createMockConnection();
    const { db } = createMockDb(conn);

    const result = await transaction(db, async () => "ok").run();

    assert.equal(result.isOk, true);
    assert.deepEqual(conn.statements, ["BEGIN", "COMMIT"]);
  });

  it("returns the value produced by fn", async () => {
    const conn = createMockConnection();
    const { db } = createMockDb(conn);

    const result = await transaction(db, async () => 42).run();

    assert.equal(result.isOk, true);
    if (result.isOk) {
      assert.equal(result.value, 42);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Rollback on thrown error
// ---------------------------------------------------------------------------

describe("transaction(): rollback on thrown error", () => {
  it("executes ROLLBACK when fn throws", async () => {
    const conn = createMockConnection();
    const { db } = createMockDb(conn);

    const result = await transaction(db, async () => {
      throw new Error("something went wrong");
    }).run();

    assert.equal(result.isErr, true);
    assert.deepEqual(conn.statements, ["BEGIN", "ROLLBACK"]);
  });

  it("returns Err(TransactionError) when fn throws", async () => {
    const conn = createMockConnection();
    const { db } = createMockDb(conn);

    const result = await transaction(db, async () => {
      throw new Error("boom");
    }).run();

    assert.equal(result.isErr, true);
    if (result.isErr) {
      assert.equal(result.error.tag, "TransactionError");
    }
  });
});

// ---------------------------------------------------------------------------
// 3. fn returns Err result -> still commits (fn owns error handling)
// ---------------------------------------------------------------------------

describe("transaction(): fn returning Err result still commits", () => {
  it("commits when fn returns normally even if the return value is an Err", async () => {
    const conn = createMockConnection();
    const { db } = createMockDb(conn);

    // fn returns normally (no throw) — the transaction layer should commit.
    // Error semantics inside the fn are the caller's responsibility.
    const result = await transaction(db, async () => ({ tag: "failure" })).run();

    assert.equal(result.isOk, true);
    assert.deepEqual(conn.statements, ["BEGIN", "COMMIT"]);
  });
});

// ---------------------------------------------------------------------------
// 4. Nested transaction (savepoint)
// ---------------------------------------------------------------------------

describe("transaction(): nested savepoint on success", () => {
  it("executes SAVEPOINT sp_1 then RELEASE SAVEPOINT sp_1 inside an outer tx", async () => {
    const conn = createMockConnection();
    const { db } = createMockDb(conn);

    const result = await transaction(db, async outerTx => {
      return transaction(outerTx, async () => "nested").run();
    }).run();

    assert.equal(result.isOk, true);
    // The outer transaction is at depth 1, so the nested savepoint is sp_2
    // (depth = outerTx._transactionDepth + 1 = 1 + 1 = 2).
    assert.deepEqual(conn.statements, [
      "BEGIN",
      "SAVEPOINT sp_2",
      "RELEASE SAVEPOINT sp_2",
      "COMMIT",
    ]);
  });
});

// ---------------------------------------------------------------------------
// 5. Nested rollback (savepoint rollback, outer continues)
// ---------------------------------------------------------------------------

describe("transaction(): nested savepoint rollback", () => {
  it("rolls back to savepoint when nested fn throws, outer transaction continues", async () => {
    const conn = createMockConnection();
    const { db } = createMockDb(conn);

    const result = await transaction(db, async outerTx => {
      // Nested transaction throws — expect ROLLBACK TO SAVEPOINT
      await transaction(outerTx, async () => {
        throw new Error("inner failure");
      }).run();
      // Outer transaction continues normally and commits
      return "outer ok";
    }).run();

    assert.equal(result.isOk, true);
    // The outer transaction is at depth 1, so the nested savepoint is sp_2
    // (depth = outerTx._transactionDepth + 1 = 1 + 1 = 2).
    assert.deepEqual(conn.statements, [
      "BEGIN",
      "SAVEPOINT sp_2",
      "ROLLBACK TO SAVEPOINT sp_2",
      "COMMIT",
    ]);
  });

  it("returns Err for the nested transaction when it throws", async () => {
    const conn = createMockConnection();
    const { db } = createMockDb(conn);

    let nestedResult: unknown;
    await transaction(db, async outerTx => {
      nestedResult = await transaction(outerTx, async () => {
        throw new Error("inner failure");
      }).run();
      return "outer ok";
    }).run();

    assert.ok(
      nestedResult !== null &&
        typeof nestedResult === "object" &&
        "isErr" in nestedResult &&
        (nestedResult as { isErr: boolean }).isErr === true,
    );
  });
});

// ---------------------------------------------------------------------------
// 6. Isolation level
// ---------------------------------------------------------------------------

describe("transaction(): isolation level", () => {
  it("appends ISOLATION LEVEL SERIALIZABLE to BEGIN", async () => {
    const conn = createMockConnection();
    const { db } = createMockDb(conn);

    await transaction(db, async () => undefined, { isolationLevel: "serializable" }).run();

    assert.equal(conn.statements[0], "BEGIN ISOLATION LEVEL SERIALIZABLE");
  });

  it("appends ISOLATION LEVEL REPEATABLE READ to BEGIN", async () => {
    const conn = createMockConnection();
    const { db } = createMockDb(conn);

    await transaction(db, async () => undefined, { isolationLevel: "repeatable read" }).run();

    assert.equal(conn.statements[0], "BEGIN ISOLATION LEVEL REPEATABLE READ");
  });

  it("appends ISOLATION LEVEL READ COMMITTED to BEGIN", async () => {
    const conn = createMockConnection();
    const { db } = createMockDb(conn);

    await transaction(db, async () => undefined, { isolationLevel: "read committed" }).run();

    assert.equal(conn.statements[0], "BEGIN ISOLATION LEVEL READ COMMITTED");
  });
});

// ---------------------------------------------------------------------------
// 7. Read only
// ---------------------------------------------------------------------------

describe("transaction(): read only", () => {
  it("appends READ ONLY to BEGIN", async () => {
    const conn = createMockConnection();
    const { db } = createMockDb(conn);

    await transaction(db, async () => undefined, { readOnly: true }).run();

    assert.equal(conn.statements[0], "BEGIN READ ONLY");
  });
});

// ---------------------------------------------------------------------------
// 8. Combined options
// ---------------------------------------------------------------------------

describe("transaction(): combined isolation level + read only", () => {
  it("appends both ISOLATION LEVEL and READ ONLY to BEGIN", async () => {
    const conn = createMockConnection();
    const { db } = createMockDb(conn);

    await transaction(db, async () => undefined, {
      isolationLevel: "repeatable read",
      readOnly: true,
    }).run();

    assert.equal(conn.statements[0], "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  });
});

// ---------------------------------------------------------------------------
// 9. Connection release: always released after top-level transaction
// ---------------------------------------------------------------------------

describe("transaction(): connection release", () => {
  it("releases connection after successful transaction", async () => {
    const conn = createMockConnection();
    const { db, released } = createMockDb(conn);

    await transaction(db, async () => "done").run();

    assert.equal(released.value, true);
  });

  it("releases connection even when fn throws", async () => {
    const conn = createMockConnection();
    const { db, released } = createMockDb(conn);

    await transaction(db, async () => {
      throw new Error("failure");
    }).run();

    assert.equal(released.value, true);
  });
});

// ---------------------------------------------------------------------------
// 10. isTransactionClient type guard
// ---------------------------------------------------------------------------

describe("isTransactionClient()", () => {
  it("returns false for a plain DatabaseClient", () => {
    const conn = createMockConnection();
    const { db } = createMockDb(conn);

    assert.equal(isTransactionClient(db), false);
  });

  it("returns true for a TransactionClient passed to fn", async () => {
    const conn = createMockConnection();
    const { db } = createMockDb(conn);

    let capturedTx: TransactionClient | null = null;
    await transaction(db, async tx => {
      capturedTx = tx;
    }).run();

    assert.ok(capturedTx !== null);
    assert.equal(isTransactionClient(capturedTx), true);
  });
});

// ---------------------------------------------------------------------------
// 11. TransactionClient pool behaviour
// ---------------------------------------------------------------------------

describe("TransactionClient pool", () => {
  it("acquire() always returns the same connection", async () => {
    const conn = createMockConnection();
    const { db } = createMockDb(conn);

    let acquiredConn: RawConnection | null = null;
    await transaction(db, async tx => {
      const r = await tx.pool.acquire().run();
      assert.equal(r.isOk, true);
      if (r.isOk) {
        acquiredConn = r.value;
      }
    }).run();

    // The connection acquired via tx.pool must be the same mock connection.
    assert.strictEqual(acquiredConn, conn);
  });

  it("release() is a no-op — does not affect the underlying connection", async () => {
    const conn = createMockConnection();
    const { db, released } = createMockDb(conn);

    await transaction(db, async tx => {
      // Manually call release on the tx pool — should be a no-op.
      const r = await tx.pool.release(conn).run();
      assert.equal(r.isOk, true);
      // The outer pool.release tracker must NOT have been triggered.
      assert.equal(released.value, false);
    }).run();
  });

  it("TransactionClient carries correct _transactionDepth", async () => {
    const conn = createMockConnection();
    const { db } = createMockDb(conn);

    let outerDepth = 0;
    let innerDepth = 0;

    await transaction(db, async outerTx => {
      outerDepth = outerTx._transactionDepth;
      await transaction(outerTx, async innerTx => {
        innerDepth = innerTx._transactionDepth;
      }).run();
    }).run();

    assert.equal(outerDepth, 1);
    assert.equal(innerDepth, 2);
  });
});
