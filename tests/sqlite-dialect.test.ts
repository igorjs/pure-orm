import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { Schema } from "@igorjs/pure-ts";

import { resolveDialect } from "../src/dialect/registry.ts";
import { createSqliteDialect } from "../src/dialect/sqlite.ts";
import { Model } from "../src/model/define.ts";
import { Field } from "../src/model/field.ts";
import { and, eq, gt, ilike, inArray, isNull, ne, or } from "../src/query/conditions.ts";
import type { SelectNode } from "../src/query/types.ts";

// ---------------------------------------------------------------------------
// Test models
// ---------------------------------------------------------------------------

const UserModel = Model("users", {
  fields: {
    id: Field(Schema.string, { primaryKey: true, default: "uuid" }),
    name: Field(Schema.string),
    email: Field(Schema.string),
    role: Field(Schema.string),
    age: Field(Schema.number),
    active: Field(Schema.boolean),
    createdAt: Field(Schema.string),
    deletedAt: Field(Schema.string),
  },
  options: { softDelete: true },
});

const toModelRef = (model: typeof UserModel) => ({
  name: model.$name,
  columns: model.$columns,
  options: model.$options,
});

const dialect = createSqliteDialect();

// Helper to build a minimal SelectNode
const makeSelect = (
  overrides: Partial<SelectNode> = {},
): SelectNode =>
  Object.freeze({
    tag: "Select" as const,
    model: toModelRef(UserModel),
    columns: "*",
    conditions: [],
    orderBy: [],
    limit: null,
    offset: null,
    softDeleteFilter: false,
    ...overrides,
  });

// ---------------------------------------------------------------------------
// quote()
// ---------------------------------------------------------------------------

describe("SQLite quote()", () => {
  it("wraps an identifier in double-quotes", () => {
    assert.equal(dialect.quote("users"), "\"users\"");
  });

  it("escapes embedded double-quotes by doubling them", () => {
    assert.equal(dialect.quote("weird\"name"), "\"weird\"\"name\"");
  });

  it("handles identifiers with no special characters", () => {
    assert.equal(dialect.quote("created_at"), "\"created_at\"");
  });

  it("handles an identifier that is already quoted-looking", () => {
    // The double-quote chars inside should be escaped.
    assert.equal(dialect.quote("\"foo\""), "\"\"\"foo\"\"\"");
  });
});

// ---------------------------------------------------------------------------
// param()
// ---------------------------------------------------------------------------

describe("SQLite param()", () => {
  it("always returns '?' regardless of index 1", () => {
    assert.equal(dialect.param(1), "?");
  });

  it("always returns '?' regardless of index 2", () => {
    assert.equal(dialect.param(2), "?");
  });

  it("always returns '?' regardless of index 10", () => {
    assert.equal(dialect.param(10), "?");
  });

  it("always returns '?' regardless of index 0", () => {
    assert.equal(dialect.param(0), "?");
  });
});

// ---------------------------------------------------------------------------
// mapFieldType()
// ---------------------------------------------------------------------------

describe("SQLite mapFieldType()", () => {
  const dummyConfig = Object.freeze({
    primaryKey: false,
    unique: false,
    nullable: false,
  });

  it("maps string schema type to TEXT", () => {
    assert.equal(dialect.mapFieldType("string", dummyConfig), "TEXT");
  });

  it("maps number schema type to REAL (not INTEGER like PostgreSQL)", () => {
    assert.equal(dialect.mapFieldType("number", dummyConfig), "REAL");
  });

  it("maps boolean schema type to INTEGER (SQLite has no BOOLEAN type)", () => {
    assert.equal(dialect.mapFieldType("boolean", dummyConfig), "INTEGER");
  });

  it("maps unknown schema types to TEXT as a fallback", () => {
    assert.equal(dialect.mapFieldType("date", dummyConfig), "TEXT");
  });
});

// ---------------------------------------------------------------------------
// compileSelect: SELECT * (star columns)
// ---------------------------------------------------------------------------

describe("SQLite compileSelect: SELECT *", () => {
  it("produces SELECT tablename.* FROM tablename", () => {
    const node = makeSelect({ columns: "*" });
    const result = dialect.compileSelect(node);

    assert.equal(result.sql, "SELECT \"users\".* FROM \"users\"");
    assert.deepEqual(result.params, []);
  });
});

// ---------------------------------------------------------------------------
// compileSelect: specific columns
// ---------------------------------------------------------------------------

describe("SQLite compileSelect: specific columns", () => {
  it("produces SELECT with each quoted column", () => {
    const node = makeSelect({ columns: ["id", "name", "email"] });
    const result = dialect.compileSelect(node);

    assert.equal(result.sql, "SELECT \"users\".\"id\", \"users\".\"name\", \"users\".\"email\" FROM \"users\"");
    assert.deepEqual(result.params, []);
  });

  it("resolves camelCase field names to snake_case column names", () => {
    const node = makeSelect({ columns: ["createdAt"] });
    const result = dialect.compileSelect(node);

    assert.equal(result.sql, "SELECT \"users\".\"created_at\" FROM \"users\"");
  });
});

// ---------------------------------------------------------------------------
// compileSelect: WHERE eq (uses ? not $1)
// ---------------------------------------------------------------------------

describe("SQLite compileSelect: WHERE eq", () => {
  it("adds parameterised WHERE clause using ? placeholder", () => {
    const node = makeSelect({ conditions: [eq("role", "admin")] });
    const result = dialect.compileSelect(node);

    assert.equal(result.sql, "SELECT \"users\".* FROM \"users\" WHERE \"users\".\"role\" = ?");
    assert.deepEqual(result.params, ["admin"]);
  });

  it("uses ? for every parameter with no index suffix", () => {
    const node = makeSelect({ conditions: [eq("id", "u1")] });
    const result = dialect.compileSelect(node);

    assert.ok(!result.sql.includes("$"), "SQL must not contain $ placeholders");
    assert.ok(result.sql.includes("?"), "SQL must contain ? placeholder");
  });
});

// ---------------------------------------------------------------------------
// compileSelect: WHERE ne
// ---------------------------------------------------------------------------

describe("SQLite compileSelect: WHERE ne", () => {
  it("adds != operator for ne with ? placeholder", () => {
    const node = makeSelect({ conditions: [ne("role", "banned")] });
    const result = dialect.compileSelect(node);

    assert.equal(result.sql, "SELECT \"users\".* FROM \"users\" WHERE \"users\".\"role\" != ?");
    assert.deepEqual(result.params, ["banned"]);
  });
});

// ---------------------------------------------------------------------------
// compileSelect: WHERE and/or nesting
// ---------------------------------------------------------------------------

describe("SQLite compileSelect: WHERE and/or", () => {
  it("joins conditions with AND inside parentheses using ? placeholders", () => {
    const node = makeSelect({
      conditions: [and(eq("role", "admin"), gt("age", 18))],
    });
    const result = dialect.compileSelect(node);

    assert.equal(
      result.sql,
      "SELECT \"users\".* FROM \"users\" WHERE (\"users\".\"role\" = ? AND \"users\".\"age\" > ?)",
    );
    assert.deepEqual(result.params, ["admin", 18]);
  });

  it("joins conditions with OR inside parentheses", () => {
    const node = makeSelect({
      conditions: [or(eq("role", "admin"), eq("role", "editor"))],
    });
    const result = dialect.compileSelect(node);

    assert.equal(
      result.sql,
      "SELECT \"users\".* FROM \"users\" WHERE (\"users\".\"role\" = ? OR \"users\".\"role\" = ?)",
    );
    assert.deepEqual(result.params, ["admin", "editor"]);
  });

  it("supports nested and/or with correct param ordering", () => {
    // (role = 'admin' OR role = 'editor') AND age > 18
    const node = makeSelect({
      conditions: [
        and(
          or(eq("role", "admin"), eq("role", "editor")),
          gt("age", 18),
        ),
      ],
    });
    const result = dialect.compileSelect(node);

    assert.equal(
      result.sql,
      "SELECT \"users\".* FROM \"users\" WHERE ((\"users\".\"role\" = ? OR \"users\".\"role\" = ?) AND \"users\".\"age\" > ?)",
    );
    assert.deepEqual(result.params, ["admin", "editor", 18]);
  });

  it("multiple top-level conditions are joined with AND", () => {
    const node = makeSelect({
      conditions: [eq("role", "admin"), gt("age", 18)],
    });
    const result = dialect.compileSelect(node);

    assert.equal(
      result.sql,
      "SELECT \"users\".* FROM \"users\" WHERE \"users\".\"role\" = ? AND \"users\".\"age\" > ?",
    );
    assert.deepEqual(result.params, ["admin", 18]);
  });
});

// ---------------------------------------------------------------------------
// compileSelect: ILIKE compiles to LIKE
// ---------------------------------------------------------------------------

describe("SQLite compileSelect: ILIKE -> LIKE", () => {
  it("compiles ilike condition as LIKE (not ILIKE)", () => {
    const node = makeSelect({ conditions: [ilike("name", "%alice%")] });
    const result = dialect.compileSelect(node);

    assert.ok(!result.sql.includes("ILIKE"), `SQL must not contain ILIKE: ${result.sql}`);
    assert.equal(result.sql, "SELECT \"users\".* FROM \"users\" WHERE \"users\".\"name\" LIKE ?");
    assert.deepEqual(result.params, ["%alice%"]);
  });

  it("compiles ilike on email column to LIKE with ? placeholder", () => {
    const node = makeSelect({ conditions: [ilike("email", "%@example.com")] });
    const result = dialect.compileSelect(node);

    assert.equal(result.sql, "SELECT \"users\".* FROM \"users\" WHERE \"users\".\"email\" LIKE ?");
    assert.deepEqual(result.params, ["%@example.com"]);
  });
});

// ---------------------------------------------------------------------------
// compileSelect: inArray empty
// ---------------------------------------------------------------------------

describe("SQLite compileSelect: inArray empty", () => {
  it("produces FALSE for an empty inArray", () => {
    const node = makeSelect({ conditions: [inArray("role", [])] });
    const result = dialect.compileSelect(node);

    assert.equal(result.sql, "SELECT \"users\".* FROM \"users\" WHERE FALSE");
    assert.deepEqual(result.params, []);
  });
});

// ---------------------------------------------------------------------------
// compileSelect: inArray non-empty
// ---------------------------------------------------------------------------

describe("SQLite compileSelect: inArray non-empty", () => {
  it("produces IN (?, ?) for two values", () => {
    const node = makeSelect({ conditions: [inArray("role", ["admin", "editor"])] });
    const result = dialect.compileSelect(node);

    assert.equal(result.sql, "SELECT \"users\".* FROM \"users\" WHERE \"users\".\"role\" IN (?, ?)");
    assert.deepEqual(result.params, ["admin", "editor"]);
  });

  it("produces IN (?, ?, ?) for three values", () => {
    const node = makeSelect({ conditions: [inArray("role", ["admin", "editor", "viewer"])] });
    const result = dialect.compileSelect(node);

    assert.equal(result.sql, "SELECT \"users\".* FROM \"users\" WHERE \"users\".\"role\" IN (?, ?, ?)");
    assert.deepEqual(result.params, ["admin", "editor", "viewer"]);
  });
});

// ---------------------------------------------------------------------------
// compileSelect: ORDER BY + LIMIT + OFFSET
// ---------------------------------------------------------------------------

describe("SQLite compileSelect: ORDER BY + LIMIT + OFFSET", () => {
  it("adds ASC order clause", () => {
    const node = makeSelect({ orderBy: [{ column: "name", direction: "asc" }] });
    const result = dialect.compileSelect(node);

    assert.equal(result.sql, "SELECT \"users\".* FROM \"users\" ORDER BY \"users\".\"name\" ASC");
  });

  it("adds LIMIT as a ? parameter (not interpolated)", () => {
    const node = makeSelect({ limit: 10 });
    const result = dialect.compileSelect(node);

    assert.equal(result.sql, "SELECT \"users\".* FROM \"users\" LIMIT ?");
    assert.deepEqual(result.params, [10]);
  });

  it("adds OFFSET as a ? parameter (not interpolated)", () => {
    const node = makeSelect({ offset: 20 });
    const result = dialect.compileSelect(node);

    assert.equal(result.sql, "SELECT \"users\".* FROM \"users\" OFFSET ?");
    assert.deepEqual(result.params, [20]);
  });

  it("produces ORDER BY ASC, LIMIT ?, OFFSET ? together", () => {
    const node = makeSelect({
      orderBy: [{ column: "name", direction: "asc" }],
      limit: 10,
      offset: 20,
    });
    const result = dialect.compileSelect(node);

    assert.equal(
      result.sql,
      "SELECT \"users\".* FROM \"users\" ORDER BY \"users\".\"name\" ASC LIMIT ? OFFSET ?",
    );
    assert.deepEqual(result.params, [10, 20]);
  });
});

// ---------------------------------------------------------------------------
// compileSelect: soft delete filter
// ---------------------------------------------------------------------------

describe("SQLite compileSelect: soft delete filter", () => {
  it("appends deleted_at IS NULL when softDeleteFilter is true", () => {
    const node = makeSelect({ softDeleteFilter: true });
    const result = dialect.compileSelect(node);

    assert.equal(result.sql, "SELECT \"users\".* FROM \"users\" WHERE \"users\".\"deleted_at\" IS NULL");
    assert.deepEqual(result.params, []);
  });

  it("adds soft delete filter after existing conditions joined with AND", () => {
    const node = makeSelect({
      conditions: [eq("role", "admin")],
      softDeleteFilter: true,
    });
    const result = dialect.compileSelect(node);

    assert.equal(
      result.sql,
      "SELECT \"users\".* FROM \"users\" WHERE \"users\".\"role\" = ? AND \"users\".\"deleted_at\" IS NULL",
    );
    assert.deepEqual(result.params, ["admin"]);
  });
});

// ---------------------------------------------------------------------------
// compileSelect: isNull condition
// ---------------------------------------------------------------------------

describe("SQLite compileSelect: isNull", () => {
  it("produces IS NULL with no parameter", () => {
    const node = makeSelect({ conditions: [isNull("deletedAt")] });
    const result = dialect.compileSelect(node);

    assert.equal(result.sql, "SELECT \"users\".* FROM \"users\" WHERE \"users\".\"deleted_at\" IS NULL");
    assert.deepEqual(result.params, []);
  });
});

// ---------------------------------------------------------------------------
// Parameter ordering verification
// ---------------------------------------------------------------------------

describe("SQLite compileSelect: parameter ordering", () => {
  it("params array matches the positional order of ? placeholders", () => {
    // WHERE role = ? AND age > ? LIMIT ? OFFSET ?
    const node = makeSelect({
      conditions: [eq("role", "admin"), gt("age", 18)],
      limit: 5,
      offset: 0,
    });
    const result = dialect.compileSelect(node);

    assert.equal(
      result.sql,
      "SELECT \"users\".* FROM \"users\" WHERE \"users\".\"role\" = ? AND \"users\".\"age\" > ? LIMIT ? OFFSET ?",
    );
    // Params must be in the same order as the ? placeholders appear in the SQL.
    assert.deepEqual(result.params, ["admin", 18, 5, 0]);
  });

  it("inArray values appear in order in params", () => {
    const node = makeSelect({ conditions: [inArray("role", ["a", "b", "c"])] });
    const result = dialect.compileSelect(node);

    assert.deepEqual(result.params, ["a", "b", "c"]);
  });

  it("nested and/or params are in left-to-right traversal order", () => {
    const node = makeSelect({
      conditions: [and(eq("role", "admin"), or(eq("name", "Alice"), eq("name", "Bob")))],
    });
    const result = dialect.compileSelect(node);

    // Params should be: "admin", "Alice", "Bob" — left to right depth-first.
    assert.deepEqual(result.params, ["admin", "Alice", "Bob"]);
  });
});

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

describe("SQLite resolveDialect('sqlite')", () => {
  it("returns Ok for the pre-registered 'sqlite' dialect", () => {
    const result = resolveDialect("sqlite");

    assert.equal(result.tag, "Ok");
    assert.equal(result.tag === "Ok" && result.value.name, "sqlite");
  });

  it("resolved dialect compiles ? placeholders not $N", () => {
    const result = resolveDialect("sqlite");
    assert.equal(result.tag, "Ok");

    if (result.tag === "Ok") {
      const node = makeSelect({ conditions: [eq("role", "admin")] });
      const compiled = result.value.compileSelect(node);

      assert.ok(compiled.sql.includes("?"), "Should use ? placeholder");
      assert.ok(!compiled.sql.includes("$"), "Should not use $ placeholder");
    }
  });
});
