/**
 * Comprehensive tests for dialect mutation compilation (INSERT, UPDATE, DELETE)
 * across both PostgreSQL and SQLite dialects.
 *
 * Tests verify:
 *  - Correct SQL generation for each operation
 *  - Proper parameterisation ($N for PG, ? for SQLite)
 *  - Column name resolution (camelCase -> snake_case)
 *  - ON CONFLICT handling
 *  - RETURNING clause handling
 *  - Soft delete vs hard delete behaviour
 *  - softDeleteFilter injection into WHERE
 *  - Cross-dialect differences (param style, NOW() vs datetime('now'))
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { Schema } from "@igorjs/pure-fx";

import { createPostgresDialect } from "../src/dialect/postgresql.ts";
import { createSqliteDialect } from "../src/dialect/sqlite.ts";
import { Model } from "../src/model/define.ts";
import { Field } from "../src/model/field.ts";
import { eq } from "../src/query/conditions.ts";
import type { DeleteNode, InsertNode, UpdateNode } from "../src/query/types.ts";

// ---------------------------------------------------------------------------
// Test models
// ---------------------------------------------------------------------------

const UserModel = Model("users", {
  fields: {
    id: Field(Schema.string, { primaryKey: true, default: "uuid" }),
    email: Field(Schema.string, { unique: true }),
    name: Field(Schema.string),
    // camelCase -> snake_case: authorId -> author_id
    createdAt: Field(Schema.string, { default: "now" }),
  },
  options: { softDelete: true },
});

const PostModel = Model("posts", {
  fields: {
    id: Field(Schema.string, { primaryKey: true, default: "uuid" }),
    title: Field(Schema.string),
    // camelCase -> snake_case: authorId -> author_id
    authorId: Field(Schema.string),
  },
  // No softDelete — tests the false-default path.
});

const toModelRef = (model: typeof UserModel | typeof PostModel) => ({
  name: model.$name,
  columns: model.$columns,
  options: model.$options,
});

// ---------------------------------------------------------------------------
// Helpers for building minimal AST nodes
// ---------------------------------------------------------------------------

const makeInsert = (
  overrides: Partial<InsertNode> = {},
  baseModel: typeof UserModel | typeof PostModel = UserModel,
): InsertNode =>
  Object.freeze({
    tag: "Insert" as const,
    model: toModelRef(baseModel),
    rows: Object.freeze([Object.freeze({ email: "alice@example.com", name: "Alice" })]),
    returning: null,
    onConflict: null,
    ...overrides,
  });

const makeUpdate = (
  overrides: Partial<UpdateNode> = {},
  baseModel: typeof UserModel | typeof PostModel = UserModel,
): UpdateNode =>
  Object.freeze({
    tag: "Update" as const,
    model: toModelRef(baseModel),
    values: Object.freeze({ name: "Alice" }),
    conditions: Object.freeze([]),
    returning: null,
    softDeleteFilter: false,
    ...overrides,
  });

const makeDelete = (
  overrides: Partial<DeleteNode> = {},
  baseModel: typeof UserModel | typeof PostModel = UserModel,
): DeleteNode =>
  Object.freeze({
    tag: "Delete" as const,
    model: toModelRef(baseModel),
    conditions: Object.freeze([]),
    returning: null,
    isSoftDelete: false,
    softDeleteFilter: false,
    ...overrides,
  });

// ---------------------------------------------------------------------------
// Dialects under test
// ---------------------------------------------------------------------------

const pg = createPostgresDialect();
const sqlite = createSqliteDialect();

// ===========================================================================
// INSERT — PostgreSQL
// ===========================================================================

describe("PG compileInsert: single row", () => {
  it("produces INSERT INTO with quoted table and column list and $N params", () => {
    const node = makeInsert();
    const result = pg.compileInsert(node);

    assert.equal(result.sql, `INSERT INTO "users" ("email", "name") VALUES ($1, $2)`);
    assert.deepEqual(result.params, ["alice@example.com", "Alice"]);
  });
});

describe("PG compileInsert: multiple rows", () => {
  it("produces a VALUES list with sequential params for each row", () => {
    const node = makeInsert({
      rows: Object.freeze([
        Object.freeze({ email: "a@example.com", name: "Alice" }),
        Object.freeze({ email: "b@example.com", name: "Bob" }),
      ]),
    });
    const result = pg.compileInsert(node);

    assert.equal(result.sql, `INSERT INTO "users" ("email", "name") VALUES ($1, $2), ($3, $4)`);
    assert.deepEqual(result.params, ["a@example.com", "Alice", "b@example.com", "Bob"]);
  });
});

describe("PG compileInsert: RETURNING *", () => {
  it("appends RETURNING * when returning is '*'", () => {
    const node = makeInsert({ returning: "*" });
    const result = pg.compileInsert(node);

    assert.ok(result.sql.endsWith("RETURNING *"), `unexpected SQL: ${result.sql}`);
    assert.equal(result.sql, `INSERT INTO "users" ("email", "name") VALUES ($1, $2) RETURNING *`);
  });
});

describe("PG compileInsert: RETURNING specific columns", () => {
  it("resolves camelCase column names to snake_case in RETURNING", () => {
    const node = makeInsert({ returning: ["id", "createdAt"] });
    const result = pg.compileInsert(node);

    assert.equal(
      result.sql,
      `INSERT INTO "users" ("email", "name") VALUES ($1, $2) RETURNING "id", "created_at"`,
    );
  });
});

describe("PG compileInsert: ON CONFLICT DO NOTHING", () => {
  it("appends ON CONFLICT (col) DO NOTHING", () => {
    const node = makeInsert({
      onConflict: Object.freeze({
        columns: Object.freeze(["email"]),
        action: "nothing",
      }),
    });
    const result = pg.compileInsert(node);

    assert.equal(
      result.sql,
      `INSERT INTO "users" ("email", "name") VALUES ($1, $2) ON CONFLICT ("email") DO NOTHING`,
    );
  });
});

describe("PG compileInsert: ON CONFLICT DO UPDATE SET", () => {
  it("appends ON CONFLICT (col) DO UPDATE SET col = EXCLUDED.col", () => {
    const node = makeInsert({
      onConflict: Object.freeze({
        columns: Object.freeze(["email"]),
        action: Object.freeze({ update: Object.freeze(["name"]) }),
      }),
    });
    const result = pg.compileInsert(node);

    assert.equal(
      result.sql,
      `INSERT INTO "users" ("email", "name") VALUES ($1, $2) ON CONFLICT ("email") DO UPDATE SET "name" = EXCLUDED."name"`,
    );
  });
});

describe("PG compileInsert: camelCase column resolution", () => {
  it("resolves camelCase keys in row values to snake_case column names", () => {
    const node = makeInsert({
      rows: Object.freeze([Object.freeze({ authorId: "u1", title: "Hello" })]),
      model: toModelRef(PostModel),
    });
    const result = pg.compileInsert(node);

    assert.equal(result.sql, `INSERT INTO "posts" ("author_id", "title") VALUES ($1, $2)`);
    assert.deepEqual(result.params, ["u1", "Hello"]);
  });
});

describe("PG compileInsert: ON CONFLICT + RETURNING together", () => {
  it("emits ON CONFLICT before RETURNING", () => {
    const node = makeInsert({
      onConflict: Object.freeze({
        columns: Object.freeze(["email"]),
        action: "nothing",
      }),
      returning: "*",
    });
    const result = pg.compileInsert(node);

    assert.equal(
      result.sql,
      `INSERT INTO "users" ("email", "name") VALUES ($1, $2) ON CONFLICT ("email") DO NOTHING RETURNING *`,
    );
  });
});

// ===========================================================================
// INSERT — SQLite
// ===========================================================================

describe("SQLite compileInsert: single row", () => {
  it("produces INSERT INTO with ? placeholders", () => {
    const node = makeInsert();
    const result = sqlite.compileInsert(node);

    assert.equal(result.sql, `INSERT INTO "users" ("email", "name") VALUES (?, ?)`);
    assert.deepEqual(result.params, ["alice@example.com", "Alice"]);
  });
});

describe("SQLite compileInsert: multiple rows", () => {
  it("produces a VALUES list with ? for each cell", () => {
    const node = makeInsert({
      rows: Object.freeze([
        Object.freeze({ email: "a@example.com", name: "Alice" }),
        Object.freeze({ email: "b@example.com", name: "Bob" }),
      ]),
    });
    const result = sqlite.compileInsert(node);

    assert.equal(result.sql, `INSERT INTO "users" ("email", "name") VALUES (?, ?), (?, ?)`);
    assert.deepEqual(result.params, ["a@example.com", "Alice", "b@example.com", "Bob"]);
  });
});

describe("SQLite compileInsert: RETURNING *", () => {
  it("appends RETURNING * (SQLite 3.35+)", () => {
    const node = makeInsert({ returning: "*" });
    const result = sqlite.compileInsert(node);

    assert.equal(result.sql, `INSERT INTO "users" ("email", "name") VALUES (?, ?) RETURNING *`);
  });
});

describe("SQLite compileInsert: ON CONFLICT DO NOTHING", () => {
  it("appends ON CONFLICT (col) DO NOTHING", () => {
    const node = makeInsert({
      onConflict: Object.freeze({
        columns: Object.freeze(["email"]),
        action: "nothing",
      }),
    });
    const result = sqlite.compileInsert(node);

    assert.equal(
      result.sql,
      `INSERT INTO "users" ("email", "name") VALUES (?, ?) ON CONFLICT ("email") DO NOTHING`,
    );
  });
});

// ===========================================================================
// UPDATE — PostgreSQL
// ===========================================================================

describe("PG compileUpdate: basic SET", () => {
  it("produces UPDATE ... SET col = $1 with no WHERE when no conditions", () => {
    const node = makeUpdate({ values: Object.freeze({ name: "Alice" }) });
    const result = pg.compileUpdate(node);

    assert.equal(result.sql, `UPDATE "users" SET "name" = $1`);
    assert.deepEqual(result.params, ["Alice"]);
  });
});

describe("PG compileUpdate: multiple SET columns", () => {
  it("produces SET with multiple col = $N assignments", () => {
    const node = makeUpdate({
      values: Object.freeze({ name: "Alice", email: "alice@example.com" }),
    });
    const result = pg.compileUpdate(node);

    assert.equal(result.sql, `UPDATE "users" SET "name" = $1, "email" = $2`);
    assert.deepEqual(result.params, ["Alice", "alice@example.com"]);
  });
});

describe("PG compileUpdate: with WHERE condition", () => {
  it("appends WHERE clause with SET params before WHERE params", () => {
    const node = makeUpdate({
      values: Object.freeze({ name: "Alice" }),
      conditions: Object.freeze([eq("id", "u1")]),
    });
    const result = pg.compileUpdate(node);

    assert.equal(result.sql, `UPDATE "users" SET "name" = $1 WHERE "users"."id" = $2`);
    assert.deepEqual(result.params, ["Alice", "u1"]);
  });
});

describe("PG compileUpdate: with softDeleteFilter", () => {
  it("appends deleted_at IS NULL to WHERE when softDeleteFilter is true", () => {
    const node = makeUpdate({
      values: Object.freeze({ name: "Alice" }),
      conditions: Object.freeze([eq("id", "u1")]),
      softDeleteFilter: true,
    });
    const result = pg.compileUpdate(node);

    assert.equal(
      result.sql,
      `UPDATE "users" SET "name" = $1 WHERE "users"."id" = $2 AND "users"."deleted_at" IS NULL`,
    );
    assert.deepEqual(result.params, ["Alice", "u1"]);
  });
});

describe("PG compileUpdate: softDeleteFilter only (no explicit conditions)", () => {
  it("produces WHERE deleted_at IS NULL when there are no other conditions", () => {
    const node = makeUpdate({
      values: Object.freeze({ name: "Alice" }),
      softDeleteFilter: true,
    });
    const result = pg.compileUpdate(node);

    assert.equal(result.sql, `UPDATE "users" SET "name" = $1 WHERE "users"."deleted_at" IS NULL`);
  });
});

describe("PG compileUpdate: with RETURNING", () => {
  it("appends RETURNING clause after WHERE", () => {
    const node = makeUpdate({
      values: Object.freeze({ name: "Alice" }),
      conditions: Object.freeze([eq("id", "u1")]),
      returning: ["id", "name"],
    });
    const result = pg.compileUpdate(node);

    assert.equal(
      result.sql,
      `UPDATE "users" SET "name" = $1 WHERE "users"."id" = $2 RETURNING "id", "name"`,
    );
  });
});

describe("PG compileUpdate: camelCase column resolution in SET", () => {
  it("resolves camelCase keys in values to snake_case column names", () => {
    const node = makeUpdate(
      {
        values: Object.freeze({ authorId: "u2" }),
        conditions: Object.freeze([eq("id", "p1")]),
      },
      PostModel,
    );
    const result = pg.compileUpdate(node);

    assert.equal(result.sql, `UPDATE "posts" SET "author_id" = $1 WHERE "posts"."id" = $2`);
    assert.deepEqual(result.params, ["u2", "p1"]);
  });
});

// ===========================================================================
// UPDATE — SQLite
// ===========================================================================

describe("SQLite compileUpdate: basic SET", () => {
  it("produces UPDATE ... SET col = ? with no WHERE", () => {
    const node = makeUpdate({ values: Object.freeze({ name: "Alice" }) });
    const result = sqlite.compileUpdate(node);

    assert.equal(result.sql, `UPDATE "users" SET "name" = ?`);
    assert.deepEqual(result.params, ["Alice"]);
  });
});

describe("SQLite compileUpdate: with WHERE condition", () => {
  it("appends WHERE with ? placeholder", () => {
    const node = makeUpdate({
      values: Object.freeze({ name: "Alice" }),
      conditions: Object.freeze([eq("id", "u1")]),
    });
    const result = sqlite.compileUpdate(node);

    assert.equal(result.sql, `UPDATE "users" SET "name" = ? WHERE "users"."id" = ?`);
    assert.deepEqual(result.params, ["Alice", "u1"]);
  });
});

describe("SQLite compileUpdate: with RETURNING", () => {
  it("appends RETURNING clause (SQLite 3.35+)", () => {
    const node = makeUpdate({
      values: Object.freeze({ name: "Alice" }),
      returning: "*",
    });
    const result = sqlite.compileUpdate(node);

    assert.equal(result.sql, `UPDATE "users" SET "name" = ? RETURNING *`);
  });
});

// ===========================================================================
// DELETE (hard) — PostgreSQL
// ===========================================================================

describe("PG compileDelete (hard): basic", () => {
  it("produces DELETE FROM table with WHERE", () => {
    const node = makeDelete({
      conditions: Object.freeze([eq("id", "u1")]),
      isSoftDelete: false,
    });
    const result = pg.compileDelete(node);

    assert.equal(result.sql, `DELETE FROM "users" WHERE "users"."id" = $1`);
    assert.deepEqual(result.params, ["u1"]);
  });
});

describe("PG compileDelete (hard): no WHERE", () => {
  it("produces DELETE FROM table with no WHERE when no conditions", () => {
    const node = makeDelete({ isSoftDelete: false });
    const result = pg.compileDelete(node);

    assert.equal(result.sql, `DELETE FROM "users"`);
    assert.deepEqual(result.params, []);
  });
});

describe("PG compileDelete (hard): with RETURNING", () => {
  it("appends RETURNING clause", () => {
    const node = makeDelete({
      conditions: Object.freeze([eq("id", "u1")]),
      isSoftDelete: false,
      returning: ["id"],
    });
    const result = pg.compileDelete(node);

    assert.equal(result.sql, `DELETE FROM "users" WHERE "users"."id" = $1 RETURNING "id"`);
  });
});

// ===========================================================================
// DELETE (soft) — PostgreSQL
// ===========================================================================

describe("PG compileDelete (soft): basic", () => {
  it("generates UPDATE SET deleted_at = NOW() instead of DELETE", () => {
    const node = makeDelete({
      conditions: Object.freeze([eq("id", "u1")]),
      isSoftDelete: true,
      softDeleteFilter: false,
    });
    const result = pg.compileDelete(node);

    assert.equal(result.sql, `UPDATE "users" SET "deleted_at" = NOW() WHERE "users"."id" = $1`);
    assert.deepEqual(result.params, ["u1"]);
  });
});

describe("PG compileDelete (soft): no WHERE", () => {
  it("produces soft delete with no WHERE when no conditions", () => {
    const node = makeDelete({ isSoftDelete: true, softDeleteFilter: false });
    const result = pg.compileDelete(node);

    assert.equal(result.sql, `UPDATE "users" SET "deleted_at" = NOW()`);
    assert.deepEqual(result.params, []);
  });
});

describe("PG compileDelete (soft): with softDeleteFilter", () => {
  it("appends deleted_at IS NULL to WHERE for the soft-delete guard", () => {
    const node = makeDelete({
      conditions: Object.freeze([eq("id", "u1")]),
      isSoftDelete: true,
      softDeleteFilter: true,
    });
    const result = pg.compileDelete(node);

    assert.equal(
      result.sql,
      `UPDATE "users" SET "deleted_at" = NOW() WHERE "users"."id" = $1 AND "users"."deleted_at" IS NULL`,
    );
  });
});

describe("PG compileDelete (soft): with RETURNING", () => {
  it("appends RETURNING after WHERE", () => {
    const node = makeDelete({
      conditions: Object.freeze([eq("id", "u1")]),
      isSoftDelete: true,
      softDeleteFilter: false,
      returning: "*",
    });
    const result = pg.compileDelete(node);

    assert.equal(
      result.sql,
      `UPDATE "users" SET "deleted_at" = NOW() WHERE "users"."id" = $1 RETURNING *`,
    );
  });
});

// ===========================================================================
// DELETE (hard) — SQLite
// ===========================================================================

describe("SQLite compileDelete (hard): basic", () => {
  it("produces DELETE FROM table WHERE col = ?", () => {
    const node = makeDelete({
      conditions: Object.freeze([eq("id", "u1")]),
      isSoftDelete: false,
    });
    const result = sqlite.compileDelete(node);

    assert.equal(result.sql, `DELETE FROM "users" WHERE "users"."id" = ?`);
    assert.deepEqual(result.params, ["u1"]);
  });
});

describe("SQLite compileDelete (hard): with RETURNING", () => {
  it("appends RETURNING clause (SQLite 3.35+)", () => {
    const node = makeDelete({
      conditions: Object.freeze([eq("id", "u1")]),
      isSoftDelete: false,
      returning: ["id"],
    });
    const result = sqlite.compileDelete(node);

    assert.equal(result.sql, `DELETE FROM "users" WHERE "users"."id" = ? RETURNING "id"`);
  });
});

// ===========================================================================
// DELETE (soft) — SQLite
// ===========================================================================

describe("SQLite compileDelete (soft): uses datetime('now') not NOW()", () => {
  it("generates UPDATE SET deleted_at = datetime('now')", () => {
    const node = makeDelete({
      conditions: Object.freeze([eq("id", "u1")]),
      isSoftDelete: true,
      softDeleteFilter: false,
    });
    const result = sqlite.compileDelete(node);

    assert.equal(
      result.sql,
      `UPDATE "users" SET "deleted_at" = datetime('now') WHERE "users"."id" = ?`,
    );
    assert.deepEqual(result.params, ["u1"]);
  });
});

describe("SQLite compileDelete (soft): with softDeleteFilter", () => {
  it("appends deleted_at IS NULL guard", () => {
    const node = makeDelete({
      conditions: Object.freeze([eq("id", "u1")]),
      isSoftDelete: true,
      softDeleteFilter: true,
    });
    const result = sqlite.compileDelete(node);

    assert.equal(
      result.sql,
      `UPDATE "users" SET "deleted_at" = datetime('now') WHERE "users"."id" = ? AND "users"."deleted_at" IS NULL`,
    );
  });
});

describe("SQLite compileDelete (soft): with RETURNING", () => {
  it("appends RETURNING clause", () => {
    const node = makeDelete({
      conditions: Object.freeze([eq("id", "u1")]),
      isSoftDelete: true,
      softDeleteFilter: false,
      returning: "*",
    });
    const result = sqlite.compileDelete(node);

    assert.equal(
      result.sql,
      `UPDATE "users" SET "deleted_at" = datetime('now') WHERE "users"."id" = ? RETURNING *`,
    );
  });
});

// ===========================================================================
// Cross-dialect comparison
// ===========================================================================

describe("cross-dialect: INSERT param style", () => {
  it("same InsertNode produces $N for PG and ? for SQLite", () => {
    const node = makeInsert();
    const pgResult = pg.compileInsert(node);
    const sqliteResult = sqlite.compileInsert(node);

    // Same params
    assert.deepEqual(pgResult.params, sqliteResult.params);

    // Different placeholders
    assert.ok(pgResult.sql.includes("$1"), `PG SQL should use $1: ${pgResult.sql}`);
    assert.ok(pgResult.sql.includes("$2"), `PG SQL should use $2: ${pgResult.sql}`);
    assert.ok(!sqliteResult.sql.includes("$"), `SQLite SQL must not use $N: ${sqliteResult.sql}`);
    assert.ok(sqliteResult.sql.includes("?"), `SQLite SQL should use ?: ${sqliteResult.sql}`);
  });
});

describe("cross-dialect: soft delete timestamp expression", () => {
  it("PG uses NOW() and SQLite uses datetime('now')", () => {
    const node = makeDelete({
      conditions: Object.freeze([eq("id", "u1")]),
      isSoftDelete: true,
      softDeleteFilter: false,
    });
    const pgResult = pg.compileDelete(node);
    const sqliteResult = sqlite.compileDelete(node);

    assert.ok(pgResult.sql.includes("NOW()"), `PG should use NOW(): ${pgResult.sql}`);
    assert.ok(
      sqliteResult.sql.includes("datetime('now')"),
      `SQLite should use datetime('now'): ${sqliteResult.sql}`,
    );
  });
});

describe("cross-dialect: UPDATE param style", () => {
  it("same UpdateNode produces $N for PG and ? for SQLite", () => {
    const node = makeUpdate({
      values: Object.freeze({ name: "Alice" }),
      conditions: Object.freeze([eq("id", "u1")]),
    });
    const pgResult = pg.compileUpdate(node);
    const sqliteResult = sqlite.compileUpdate(node);

    assert.deepEqual(pgResult.params, sqliteResult.params);
    assert.ok(pgResult.sql.includes("$1"));
    assert.ok(!sqliteResult.sql.includes("$"));
    assert.equal(
      sqliteResult.sql.split("?").length - 1,
      2,
      "SQLite SQL should have exactly 2 ? placeholders",
    );
  });
});

// ===========================================================================
// Immutability
// ===========================================================================

describe("compileInsert returns frozen CompiledQuery", () => {
  it("result is frozen for PG", () => {
    const result = pg.compileInsert(makeInsert());
    assert.ok(Object.isFrozen(result));
    assert.ok(Object.isFrozen(result.params));
  });

  it("result is frozen for SQLite", () => {
    const result = sqlite.compileInsert(makeInsert());
    assert.ok(Object.isFrozen(result));
    assert.ok(Object.isFrozen(result.params));
  });
});

describe("compileUpdate returns frozen CompiledQuery", () => {
  it("result is frozen for PG", () => {
    const result = pg.compileUpdate(makeUpdate());
    assert.ok(Object.isFrozen(result));
  });

  it("result is frozen for SQLite", () => {
    const result = sqlite.compileUpdate(makeUpdate());
    assert.ok(Object.isFrozen(result));
  });
});

describe("compileDelete returns frozen CompiledQuery", () => {
  it("result is frozen for PG", () => {
    const result = pg.compileDelete(makeDelete());
    assert.ok(Object.isFrozen(result));
  });

  it("result is frozen for SQLite", () => {
    const result = sqlite.compileDelete(makeDelete());
    assert.ok(Object.isFrozen(result));
  });
});
