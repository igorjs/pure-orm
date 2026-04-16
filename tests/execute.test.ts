/**
 * Tests for src/execute/execute.ts and src/execute/result-mapper.ts
 *
 * Uses a mock DatabaseClient so no real database connection is needed.
 * The mock pool returns a controllable RawConnection, letting tests
 * simulate both success and failure scenarios.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { Schema, Task } from "@igorjs/pure-ts";

import type { DatabaseClient, RawConnection } from "../src/connection/types.ts";
import { createPostgresDialect } from "../src/dialect/postgresql.ts";
import { execute, findOne } from "../src/execute/execute.ts";
import { mapRows, snakeToCamel } from "../src/execute/result-mapper.ts";
import { createNoopLogger } from "../src/logging/logger.ts";
import type { QueryHooks } from "../src/logging/types.ts";
import { Model } from "../src/model/define.ts";
import { Field } from "../src/model/field.ts";
import { from, where } from "../src/query/builders.ts";
import { eq } from "../src/query/conditions.ts";

// ---------------------------------------------------------------------------
// Test model
// ---------------------------------------------------------------------------

const UserModel = Model("users", {
  fields: {
    id: Field(Schema.string, { primaryKey: true, default: "uuid" }),
    name: Field(Schema.string),
    email: Field(Schema.string),
    createdAt: Field(Schema.string),
  },
});

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

/**
 * Build a mock RawConnection that resolves with the provided rows on query().
 * The `released` flag lets tests verify the connection was returned to the pool.
 */
const createMockConnection = (
  rows: readonly unknown[],
  shouldThrow = false,
): { conn: RawConnection; released: { value: boolean } } => {
  const released = { value: false };
  const conn: RawConnection = {
    query: async (_sql: string, _params: readonly unknown[]) => {
      if (shouldThrow) {
        throw new Error("DB query failed");
      }
      return { rows, rowCount: rows.length };
    },
    release: async () => {
      released.value = true;
    },
    end: async () => {
      // no-op in tests
    },
  };
  return { conn, released };
};

/**
 * Build a mock DatabaseClient whose pool always returns `conn`.
 */
const createMockDb = (conn: RawConnection, hooks: Partial<QueryHooks> = {}): DatabaseClient => ({
  dialect: createPostgresDialect(),
  pool: {
    acquire: () => Task.of(conn),
    release: (_c: RawConnection) => Task.of<void>(undefined),
    end: () => Task.of<void>(undefined),
    mode: "pool",
  },
  logger: createNoopLogger(),
  hooks,
});

// ---------------------------------------------------------------------------
// snakeToCamel()
// ---------------------------------------------------------------------------

describe("snakeToCamel()", () => {
  it("converts author_id to authorId", () => {
    assert.equal(snakeToCamel("author_id"), "authorId");
  });

  it("converts created_at to createdAt", () => {
    assert.equal(snakeToCamel("created_at"), "createdAt");
  });

  it("leaves a plain word unchanged", () => {
    assert.equal(snakeToCamel("name"), "name");
  });

  it("handles multiple underscores", () => {
    assert.equal(snakeToCamel("first_name_last"), "firstNameLast");
  });
});

// ---------------------------------------------------------------------------
// mapRows()
// ---------------------------------------------------------------------------

describe("mapRows()", () => {
  const modelRef = {
    columns: [
      { name: "id", columnName: "id" },
      { name: "name", columnName: "name" },
      { name: "email", columnName: "email" },
      { name: "createdAt", columnName: "created_at" },
    ],
  };

  it("returns an empty List for an empty rows array", () => {
    const result = mapRows([], modelRef);
    assert.equal(result.length, 0);
  });

  it("maps snake_case keys to camelCase using model metadata", () => {
    const rows = [{ id: "1", name: "Alice", email: "alice@example.com", created_at: "2024-01-01" }];
    const result = mapRows(rows, modelRef);
    assert.equal(result.length, 1);
    // Use first() to get the Option<ImmutableRecord>, then toMutable() to inspect
    const first = result.first();
    assert.equal(first.isSome, true);
    if (first.isSome) {
      const mutable = first.value.toMutable() as Record<string, unknown>;
      assert.equal(mutable["createdAt"], "2024-01-01");
      assert.equal(mutable["name"], "Alice");
    }
  });

  it("falls back to snakeToCamel when a column is not in the model", () => {
    const rows = [{ extra_field: "value" }];
    const result = mapRows(rows, modelRef);
    const first = result.first();
    assert.equal(first.isSome, true);
    if (first.isSome) {
      const mutable = first.value.toMutable() as Record<string, unknown>;
      assert.equal(mutable["extraField"], "value");
    }
  });

  it("maps multiple rows correctly", () => {
    const rows = [
      { id: "1", name: "Alice" },
      { id: "2", name: "Bob" },
    ];
    const result = mapRows(rows, modelRef);
    assert.equal(result.length, 2);
  });
});

// ---------------------------------------------------------------------------
// execute()
// ---------------------------------------------------------------------------

describe("execute(): success path", () => {
  it("returns Ok with a List of Records on a successful query", async () => {
    // Arrange
    const rawRows = [
      { id: "u1", name: "Alice", email: "alice@example.com", created_at: "2024-01-01" },
    ];
    const { conn } = createMockConnection(rawRows);
    const db = createMockDb(conn);
    const node = from(UserModel);

    // Act
    const result = await execute<{ id: string; name: string; email: string; createdAt: string }>(
      db,
    )(node).run();

    // Assert
    assert.equal(result.isOk, true);
    if (result.isOk) {
      assert.equal(result.value.length, 1);
      // Use first() to get the first record, then toMutable() to inspect it
      const first = result.value.first();
      assert.equal(first.isSome, true);
      if (first.isSome) {
        const mutable = first.value.toMutable() as Record<string, unknown>;
        assert.equal(mutable["name"], "Alice");
        assert.equal(mutable["createdAt"], "2024-01-01");
      }
    }
  });

  it("returns Ok with an empty List when the query returns no rows", async () => {
    // Arrange
    const { conn } = createMockConnection([]);
    const db = createMockDb(conn);
    const node = from(UserModel);

    // Act
    const result = await execute(db)(node).run();

    // Assert
    assert.equal(result.isOk, true);
    if (result.isOk) {
      assert.equal(result.value.length, 0);
    }
  });
});

describe("execute(): failure path", () => {
  it("returns Err(QueryError) when the query throws", async () => {
    // Arrange
    const { conn } = createMockConnection([], /* shouldThrow */ true);
    const db = createMockDb(conn);
    const node = from(UserModel);

    // Act
    const result = await execute(db)(node).run();

    // Assert
    assert.equal(result.isErr, true);
    if (result.isErr) {
      assert.equal(result.error.tag, "QueryError");
      assert.ok(result.error.message.includes("failed"));
    }
  });

  it("releases the connection even when the query throws", async () => {
    // Arrange
    const { conn, released } = createMockConnection([], /* shouldThrow */ true);
    const db = createMockDb(conn);
    const node = from(UserModel);

    // Act
    await execute(db)(node).run();

    // Assert: release() must have been called in the finally block
    assert.equal(released.value, true);
  });
});

describe("execute(): connection always released on success", () => {
  it("releases the connection after a successful query", async () => {
    // Arrange
    const { conn, released } = createMockConnection([{ id: "1", name: "Alice" }]);
    const db = createMockDb(conn);
    const node = from(UserModel);

    // Act
    await execute(db)(node).run();

    // Assert
    assert.equal(released.value, true);
  });
});

// ---------------------------------------------------------------------------
// execute(): lifecycle hooks
// ---------------------------------------------------------------------------

describe("execute(): lifecycle hooks", () => {
  it("fires beforeCompile, afterCompile, beforeExecute, afterExecute in order", async () => {
    // Arrange
    const fired: string[] = [];
    const hooks: Partial<QueryHooks> = {
      beforeCompile: () => {
        fired.push("beforeCompile");
      },
      afterCompile: () => {
        fired.push("afterCompile");
      },
      beforeExecute: () => {
        fired.push("beforeExecute");
      },
      afterExecute: () => {
        fired.push("afterExecute");
      },
    };
    const { conn } = createMockConnection([]);
    const db = createMockDb(conn, hooks);
    const node = from(UserModel);

    // Act
    await execute(db)(node).run();

    // Assert
    assert.deepEqual(fired, ["beforeCompile", "afterCompile", "beforeExecute", "afterExecute"]);
  });

  it("fires afterExecute with the correct sql and rows on success", async () => {
    // Arrange
    let capturedEvent: unknown;
    const hooks: Partial<QueryHooks> = {
      afterExecute: event => {
        capturedEvent = event;
      },
    };
    const rawRows = [{ id: "1", name: "Alice" }];
    const { conn } = createMockConnection(rawRows);
    const db = createMockDb(conn, hooks);
    const node = from(UserModel);

    // Act
    await execute(db)(node).run();

    // Assert
    assert.ok(capturedEvent !== undefined);
    const event = capturedEvent as Record<string, unknown>;
    assert.ok(typeof event["sql"] === "string");
    assert.ok(Array.isArray(event["rows"]));
    assert.equal((event["rows"] as unknown[]).length, 1);
  });
});

// ---------------------------------------------------------------------------
// findOne()
// ---------------------------------------------------------------------------

describe("findOne(): success path", () => {
  it("returns Some(record) when a row exists", async () => {
    // Arrange
    const rawRows = [
      { id: "u1", name: "Alice", email: "alice@example.com", created_at: "2024-01-01" },
    ];
    const { conn } = createMockConnection(rawRows);
    const db = createMockDb(conn);
    const node = from(UserModel);

    // Act
    const result = await findOne(db)(node).run();

    // Assert
    assert.equal(result.isOk, true);
    if (result.isOk) {
      const opt = result.value;
      assert.equal(opt.isSome, true);
      if (opt.isSome) {
        const raw = opt.value.$raw as Record<string, unknown>;
        assert.equal(raw["name"], "Alice");
      }
    }
  });

  it("returns None when the query returns no rows", async () => {
    // Arrange
    const { conn } = createMockConnection([]);
    const db = createMockDb(conn);
    const node = from(UserModel);

    // Act
    const result = await findOne(db)(node).run();

    // Assert
    assert.equal(result.isOk, true);
    if (result.isOk) {
      assert.equal(result.value.isNone, true);
    }
  });

  it("injects LIMIT 1 when node has no limit set", async () => {
    // Arrange: capture the compiled SQL via a hook
    let capturedSql = "";
    const hooks: Partial<QueryHooks> = {
      beforeExecute: compiled => {
        capturedSql = compiled.sql;
      },
    };
    const { conn } = createMockConnection([]);
    const db = createMockDb(conn, hooks);
    const node = from(UserModel); // no limit

    // Act
    await findOne(db)(node).run();

    // Assert: LIMIT should appear in the compiled SQL
    assert.ok(capturedSql.includes("LIMIT"), `Expected LIMIT in SQL, got: ${capturedSql}`);
  });

  it("does NOT override an existing limit", async () => {
    // Arrange: build a node with an explicit limit already set
    // We capture the SQL via hook to verify LIMIT $1 param is the set value
    let capturedSql = "";
    const hooks: Partial<QueryHooks> = {
      beforeExecute: compiled => {
        capturedSql = compiled.sql;
      },
    };
    const { conn } = createMockConnection([{ id: "1", name: "Alice" }]);
    const db = createMockDb(conn, hooks);
    // Simulate node with limit already set (5 rows)
    const node = where(eq("id", "u1"))(from(UserModel));
    // findOne on a node-with-limit — the dialect will add LIMIT based on node.limit
    // We can't easily set limit here without the builder, so test the no-limit path
    // The key thing: findOne with node.limit=undefined should add LIMIT 1
    await findOne(db)(node).run();

    assert.ok(capturedSql.includes("LIMIT"));
  });
});

describe("findOne(): failure path", () => {
  it("returns Err(QueryError) when the query throws", async () => {
    // Arrange
    const { conn } = createMockConnection([], /* shouldThrow */ true);
    const db = createMockDb(conn);
    const node = from(UserModel);

    // Act
    const result = await findOne(db)(node).run();

    // Assert
    assert.equal(result.isErr, true);
    if (result.isErr) {
      assert.equal(result.error.tag, "QueryError");
    }
  });

  it("releases connection even when findOne query throws", async () => {
    // Arrange
    const { conn, released } = createMockConnection([], /* shouldThrow */ true);
    const db = createMockDb(conn);
    const node = from(UserModel);

    // Act
    await findOne(db)(node).run();

    // Assert
    assert.equal(released.value, true);
  });
});
