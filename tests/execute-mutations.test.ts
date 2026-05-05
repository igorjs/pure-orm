/**
 * Tests for mutation execution in src/execute/execute.ts and
 * compile() for mutation nodes in src/execute/compile.ts.
 *
 * Uses a mock DatabaseClient so no real database connection is needed.
 * The mock pool returns a controllable RawConnection, letting tests
 * simulate both success and failure scenarios.
 */

import { Schema, Task } from "@igorjs/pure-fx";
import { describe, expect, it } from "@igorjs/pure-test";

import type { DatabaseClient, RawConnection } from "../src/connection/types.ts";
import { createPostgresDialect } from "../src/dialect/postgresql.ts";
import { compile } from "../src/execute/compile.ts";
import { execute, findOne } from "../src/execute/execute.ts";
import { createNoopLogger } from "../src/logging/logger.ts";
import { Model } from "../src/model/define.ts";
import { Field } from "../src/model/field.ts";
import { where } from "../src/query/builders.ts";
import { eq } from "../src/query/conditions.ts";
import {
  hardRemove,
  insert,
  insertMany,
  remove,
  returning,
  update,
} from "../src/query/mutations.ts";

// ---------------------------------------------------------------------------
// Test models
// ---------------------------------------------------------------------------

const UserModel = Model("users", {
  fields: {
    id: Field(Schema.string, { primaryKey: true, default: "uuid" }),
    email: Field(Schema.string, { unique: true }),
    name: Field(Schema.string),
    createdAt: Field(Schema.string, { default: "now" }),
  },
  options: { softDelete: true },
});

const PostModel = Model("posts", {
  fields: {
    id: Field(Schema.string, { primaryKey: true, default: "uuid" }),
    title: Field(Schema.string),
    authorId: Field(Schema.string),
  },
});

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

/**
 * Build a mock RawConnection that resolves with the provided rows on query().
 * The `released` flag lets tests verify the connection was returned to the pool.
 * `rowCount` defaults to rows.length but can be overridden to test mutations
 * that return rowCount without rows (no RETURNING clause).
 */
const createMockConnection = (
  rows: readonly Record<string, unknown>[],
  rowCount?: number,
  shouldThrow = false,
): { conn: RawConnection; released: { value: boolean } } => {
  const released = { value: false };
  const conn: RawConnection = {
    query: async (_sql: string, _params: readonly unknown[]) => {
      if (shouldThrow) {
        throw new Error("DB mutation failed");
      }
      return { rows, rowCount: rowCount ?? rows.length };
    },
    release: async () => {
      released.value = true;
    },
    end: async () => undefined,
  };
  return { conn, released };
};

/**
 * Build a mock DatabaseClient whose pool always returns `conn`.
 */
const createMockDb = (conn: RawConnection): DatabaseClient => ({
  dialect: createPostgresDialect(),
  pool: {
    acquire: () => Task.of(conn),
    release: () => Task.of<void>(undefined),
    end: () => Task.of<void>(undefined),
    mode: "pool" as const,
  },
  logger: createNoopLogger(),
  hooks: {},
});

// ---------------------------------------------------------------------------
// execute() — InsertNode
// ---------------------------------------------------------------------------

describe("execute(): InsertNode with RETURNING", () => {
  it("returns Ok with a List of Records when RETURNING * is used", async () => {
    // Arrange
    const rawRows = [
      { id: "u1", email: "alice@example.com", name: "Alice", created_at: "2024-01-01" },
    ];
    const { conn } = createMockConnection(rawRows);
    const db = createMockDb(conn);
    const node = returning()(insert(UserModel, { email: "alice@example.com", name: "Alice" }));

    // Act
    const result = await execute<{ id: string; email: string; name: string; createdAt: string }>(
      db,
    )(node).run();

    // Assert
    expect(result.isOk).toBe(true);
    if (result.isOk) {
      expect(result.value.length).toBe(1);
      const first = result.value.first();
      expect(first.isSome).toBe(true);
      if (first.isSome) {
        const mutable = first.value.toMutable() as Record<string, unknown>;
        expect(mutable["id"]).toBe("u1");
        expect(mutable["name"]).toBe("Alice");
        // snake_case -> camelCase via model metadata
        expect(mutable["createdAt"]).toBe("2024-01-01");
      }
    }
  });

  it("returns Ok with empty List when the DB returns no rows (no RETURNING clause)", async () => {
    // Arrange — no RETURNING, DB returns empty rows
    const { conn } = createMockConnection([], 1);
    const db = createMockDb(conn);
    const node = insert(UserModel, { email: "alice@example.com", name: "Alice" });

    // Act
    const result = await execute(db)(node).run();

    // Assert
    expect(result.isOk).toBe(true);
    if (result.isOk) {
      expect(result.value.length).toBe(0);
    }
  });

  it("returns Ok with a single-row insert result", async () => {
    // Arrange
    const rawRows = [
      { id: "u1", email: "alice@example.com", name: "Alice", created_at: "2024-01-01" },
    ];
    const { conn } = createMockConnection(rawRows);
    const db = createMockDb(conn);
    const node = returning(
      "id",
      "email",
    )(insert(UserModel, { email: "alice@example.com", name: "Alice" }));

    // Act
    const result = await execute(db)(node).run();

    // Assert
    expect(result.isOk).toBe(true);
    if (result.isOk) {
      expect(result.value.length).toBe(1);
    }
  });

  it("returns Ok with multiple rows for a multi-row insert with RETURNING", async () => {
    // Arrange
    const rawRows = [
      { id: "u1", email: "a@example.com", name: "Alice", created_at: "2024-01-01" },
      { id: "u2", email: "b@example.com", name: "Bob", created_at: "2024-01-02" },
    ];
    const { conn } = createMockConnection(rawRows);
    const db = createMockDb(conn);
    const node = returning()(
      insertMany(UserModel, [
        { email: "a@example.com", name: "Alice" },
        { email: "b@example.com", name: "Bob" },
      ]),
    );

    // Act
    const result = await execute(db)(node).run();

    // Assert
    expect(result.isOk).toBe(true);
    if (result.isOk) {
      expect(result.value.length).toBe(2);
    }
  });
});

// ---------------------------------------------------------------------------
// execute() — UpdateNode
// ---------------------------------------------------------------------------

describe("execute(): UpdateNode", () => {
  it("returns Ok with affected rows via RETURNING", async () => {
    // Arrange
    const rawRows = [
      { id: "u1", email: "alice@example.com", name: "Updated", created_at: "2024-01-01" },
    ];
    const { conn } = createMockConnection(rawRows);
    const db = createMockDb(conn);
    const node = returning()(where(eq("id", "u1"))(update(UserModel, { name: "Updated" })));

    // Act
    const result = await execute(db)(node).run();

    // Assert
    expect(result.isOk).toBe(true);
    if (result.isOk) {
      expect(result.value.length).toBe(1);
      const first = result.value.first();
      expect(first.isSome).toBe(true);
      if (first.isSome) {
        const mutable = first.value.toMutable() as Record<string, unknown>;
        expect(mutable["name"]).toBe("Updated");
      }
    }
  });

  it("returns Ok with empty List when no RETURNING clause", async () => {
    // Arrange — no RETURNING, DB returns empty rows
    const { conn } = createMockConnection([], 3);
    const db = createMockDb(conn);
    const node = update(UserModel, { name: "Bulk" });

    // Act
    const result = await execute(db)(node).run();

    // Assert
    expect(result.isOk).toBe(true);
    if (result.isOk) {
      expect(result.value.length).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// execute() — DeleteNode
// ---------------------------------------------------------------------------

describe("execute(): DeleteNode", () => {
  it("soft delete: returns affected rows via RETURNING", async () => {
    // Arrange — UserModel has softDelete enabled; remove() emits a soft-delete UPDATE
    const rawRows = [
      { id: "u1", email: "alice@example.com", name: "Alice", created_at: "2024-01-01" },
    ];
    const { conn } = createMockConnection(rawRows);
    const db = createMockDb(conn);
    const node = returning()(where(eq("id", "u1"))(remove(UserModel)));

    // Act
    const result = await execute(db)(node).run();

    // Assert
    expect(result.isOk).toBe(true);
    if (result.isOk) {
      expect(result.value.length).toBe(1);
    }
  });

  it("hard delete: returns affected rows via RETURNING", async () => {
    // Arrange — hardRemove() always issues a physical DELETE
    const rawRows = [{ id: "p1", title: "Post One", author_id: "u1" }];
    const { conn } = createMockConnection(rawRows);
    const db = createMockDb(conn);
    const node = returning()(where(eq("id", "p1"))(hardRemove(PostModel)));

    // Act
    const result = await execute(db)(node).run();

    // Assert
    expect(result.isOk).toBe(true);
    if (result.isOk) {
      expect(result.value.length).toBe(1);
      const first = result.value.first();
      expect(first.isSome).toBe(true);
      if (first.isSome) {
        const mutable = first.value.toMutable() as Record<string, unknown>;
        // snake_case key not in model → snakeToCamel fallback
        expect(mutable["authorId"]).toBe("u1");
      }
    }
  });

  it("returns empty List when no RETURNING and no affected rows", async () => {
    // Arrange
    const { conn } = createMockConnection([], 0);
    const db = createMockDb(conn);
    const node = where(eq("id", "nonexistent"))(remove(UserModel));

    // Act
    const result = await execute(db)(node).run();

    // Assert
    expect(result.isOk).toBe(true);
    if (result.isOk) {
      expect(result.value.length).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// execute() — RawNode
// ---------------------------------------------------------------------------

describe("execute(): RawNode", () => {
  it("executes raw SQL and returns rows", async () => {
    // Arrange
    const rawRows = [{ count: "42" }];
    const { conn } = createMockConnection(rawRows);
    const db = createMockDb(conn);
    const node = Object.freeze({
      tag: "Raw" as const,
      sql: "SELECT COUNT(*) AS count FROM users",
      params: [],
    });

    // Act
    const result = await execute(db)(node).run();

    // Assert
    expect(result.isOk).toBe(true);
    if (result.isOk) {
      expect(result.value.length).toBe(1);
      const first = result.value.first();
      expect(first.isSome).toBe(true);
      if (first.isSome) {
        const mutable = first.value.toMutable() as Record<string, unknown>;
        expect(mutable["count"]).toBe("42");
      }
    }
  });

  it("maps snake_case keys to camelCase via snakeToCamel fallback", async () => {
    // Arrange — no model metadata, snakeToCamel is the only strategy
    const rawRows = [{ user_id: "u1", created_at: "2024-01-01", post_count: 5 }];
    const { conn } = createMockConnection(rawRows);
    const db = createMockDb(conn);
    const node = Object.freeze({
      tag: "Raw" as const,
      sql: "SELECT user_id, created_at, post_count FROM stats",
      params: [],
    });

    // Act
    const result = await execute(db)(node).run();

    // Assert
    expect(result.isOk).toBe(true);
    if (result.isOk) {
      const first = result.value.first();
      expect(first.isSome).toBe(true);
      if (first.isSome) {
        const mutable = first.value.toMutable() as Record<string, unknown>;
        expect(mutable["userId"]).toBe("u1");
        expect(mutable["createdAt"]).toBe("2024-01-01");
        expect(mutable["postCount"]).toBe(5);
      }
    }
  });

  it("returns empty List when raw query returns no rows", async () => {
    // Arrange
    const { conn } = createMockConnection([]);
    const db = createMockDb(conn);
    const node = Object.freeze({ tag: "Raw" as const, sql: "DELETE FROM temp_table", params: [] });

    // Act
    const result = await execute(db)(node).run();

    // Assert
    expect(result.isOk).toBe(true);
    if (result.isOk) {
      expect(result.value.length).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// findOne() — InsertNode with RETURNING
// ---------------------------------------------------------------------------

describe("findOne(): InsertNode with RETURNING", () => {
  it("returns Some(record) for a RETURNING insert", async () => {
    // Arrange
    const rawRows = [
      { id: "u1", email: "alice@example.com", name: "Alice", created_at: "2024-01-01" },
    ];
    const { conn } = createMockConnection(rawRows);
    const db = createMockDb(conn);
    const node = returning()(insert(UserModel, { email: "alice@example.com", name: "Alice" }));

    // Act
    const result = await findOne<{ id: string; email: string; name: string; createdAt: string }>(
      db,
    )(node).run();

    // Assert
    expect(result.isOk).toBe(true);
    if (result.isOk) {
      const opt = result.value;
      expect(opt.isSome).toBe(true);
      if (opt.isSome) {
        const mutable = opt.value.toMutable() as Record<string, unknown>;
        expect(mutable["id"]).toBe("u1");
        expect(mutable["name"]).toBe("Alice");
        expect(mutable["createdAt"]).toBe("2024-01-01");
      }
    }
  });

  it("returns None when insert has no RETURNING and returns empty rows", async () => {
    // Arrange — no RETURNING means the DB returns empty rows
    const { conn } = createMockConnection([], 1);
    const db = createMockDb(conn);
    const node = insert(UserModel, { email: "alice@example.com", name: "Alice" });

    // Act
    const result = await findOne(db)(node).run();

    // Assert
    expect(result.isOk).toBe(true);
    if (result.isOk) {
      expect(result.value.isNone).toBe(true);
    }
  });

  it("returns Some(record) for an UpdateNode with RETURNING", async () => {
    // Arrange
    const rawRows = [
      { id: "u1", email: "alice@example.com", name: "Updated", created_at: "2024-01-01" },
    ];
    const { conn } = createMockConnection(rawRows);
    const db = createMockDb(conn);
    const node = returning()(where(eq("id", "u1"))(update(UserModel, { name: "Updated" })));

    // Act
    const result = await findOne(db)(node).run();

    // Assert
    expect(result.isOk).toBe(true);
    if (result.isOk) {
      const opt = result.value;
      expect(opt.isSome).toBe(true);
      if (opt.isSome) {
        const mutable = opt.value.toMutable() as Record<string, unknown>;
        expect(mutable["name"]).toBe("Updated");
      }
    }
  });

  it("returns None for a DeleteNode with no RETURNING and no rows", async () => {
    // Arrange
    const { conn } = createMockConnection([], 0);
    const db = createMockDb(conn);
    const node = where(eq("id", "nonexistent"))(remove(UserModel));

    // Act
    const result = await findOne(db)(node).run();

    // Assert
    expect(result.isOk).toBe(true);
    if (result.isOk) {
      expect(result.value.isNone).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// compile() — mutation node types
// ---------------------------------------------------------------------------

describe("compile(): InsertNode via compile()", () => {
  it("compiles an InsertNode to SQL with correct structure", () => {
    // Arrange
    const node = insert(UserModel, { email: "alice@example.com", name: "Alice" });

    // Act
    const result = compile(node);

    // Assert
    expect(result.sql.startsWith("INSERT INTO")).toBeTruthy();
    expect(result.sql.includes('"users"')).toBeTruthy();
    expect(result.params.length > 0).toBeTruthy();
  });

  it("compiles an InsertNode with RETURNING *", () => {
    // Arrange
    const node = returning()(insert(UserModel, { email: "alice@example.com", name: "Alice" }));

    // Act
    const result = compile(node);

    // Assert
    expect(result.sql.includes("RETURNING")).toBeTruthy();
  });
});

describe("compile(): UpdateNode via compile()", () => {
  it("compiles an UpdateNode to SQL with correct structure", () => {
    // Arrange
    const node = where(eq("id", "u1"))(update(UserModel, { name: "Bob" }));

    // Act
    const result = compile(node);

    // Assert
    expect(result.sql.startsWith("UPDATE")).toBeTruthy();
    expect(result.sql.includes('"users"')).toBeTruthy();
    expect(result.sql.includes("WHERE")).toBeTruthy();
    expect(result.params.length > 0).toBeTruthy();
  });
});

describe("compile(): DeleteNode via compile()", () => {
  it("compiles a soft-delete node to an UPDATE SQL", () => {
    // Arrange — UserModel has softDelete enabled
    const node = where(eq("id", "u1"))(remove(UserModel));

    // Act
    const result = compile(node);

    // Assert — soft delete emits an UPDATE, not a DELETE
    expect(result.sql.startsWith("UPDATE")).toBeTruthy();
    expect(result.sql.includes('"users"')).toBeTruthy();
  });

  it("compiles a hard-delete node to a DELETE SQL", () => {
    // Arrange — PostModel has no softDelete
    const node = where(eq("id", "p1"))(hardRemove(PostModel));

    // Act
    const result = compile(node);

    // Assert
    expect(result.sql.startsWith("DELETE FROM")).toBeTruthy();
    expect(result.sql.includes('"posts"')).toBeTruthy();
  });
});

describe("compile(): RawNode passes through", () => {
  it("returns the raw SQL and params unchanged", () => {
    // Arrange
    const node = Object.freeze({ tag: "Raw" as const, sql: "SELECT 1 + $1 AS val", params: [41] });

    // Act
    const result = compile(node);

    // Assert
    expect(result.sql).toBe("SELECT 1 + $1 AS val");
    expect(result.params).toEqual([41]);
  });
});

// ---------------------------------------------------------------------------
// Connection lifecycle for mutations
// ---------------------------------------------------------------------------

describe("Connection lifecycle: mutations", () => {
  it("releases the connection after a successful InsertNode", async () => {
    // Arrange
    const { conn, released } = createMockConnection([]);
    const db = createMockDb(conn);
    const node = insert(UserModel, { email: "alice@example.com", name: "Alice" });

    // Act
    await execute(db)(node).run();

    // Assert
    expect(released.value).toBe(true);
  });

  it("releases the connection after an InsertNode query throws", async () => {
    // Arrange
    const { conn, released } = createMockConnection([], 0, /* shouldThrow */ true);
    const db = createMockDb(conn);
    const node = insert(UserModel, { email: "alice@example.com", name: "Alice" });

    // Act
    const result = await execute(db)(node).run();

    // Assert: Err returned AND connection released
    expect(result.isErr).toBe(true);
    expect(released.value).toBe(true);
  });

  it("releases the connection after a successful UpdateNode", async () => {
    // Arrange
    const { conn, released } = createMockConnection([], 1);
    const db = createMockDb(conn);
    const node = update(UserModel, { name: "Changed" });

    // Act
    await execute(db)(node).run();

    // Assert
    expect(released.value).toBe(true);
  });

  it("releases the connection after a successful DeleteNode", async () => {
    // Arrange
    const { conn, released } = createMockConnection([], 1);
    const db = createMockDb(conn);
    const node = remove(UserModel);

    // Act
    await execute(db)(node).run();

    // Assert
    expect(released.value).toBe(true);
  });

  it("releases the connection after a successful RawNode", async () => {
    // Arrange
    const { conn, released } = createMockConnection([{ result: 1 }]);
    const db = createMockDb(conn);
    const node = Object.freeze({ tag: "Raw" as const, sql: "SELECT 1 AS result", params: [] });

    // Act
    await execute(db)(node).run();

    // Assert
    expect(released.value).toBe(true);
  });

  it("releases the connection after a RawNode query throws", async () => {
    // Arrange
    const { conn, released } = createMockConnection([], 0, /* shouldThrow */ true);
    const db = createMockDb(conn);
    const node = Object.freeze({ tag: "Raw" as const, sql: "INVALID SQL", params: [] });

    // Act
    const result = await execute(db)(node).run();

    // Assert
    expect(result.isErr).toBe(true);
    expect(released.value).toBe(true);
  });
});
