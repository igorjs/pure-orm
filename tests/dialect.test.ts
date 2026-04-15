import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { Schema } from "@igorjs/pure-ts";

import { createPostgresDialect } from "../src/dialect/postgresql.ts";
import { registerDialect, resolveDialect } from "../src/dialect/registry.ts";
import { Model } from "../src/model/define.ts";
import { Field } from "../src/model/field.ts";
import { and, between, eq, gt, ilike, inArray, isNull, ne, not, or } from "../src/query/conditions.ts";
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

const dialect = createPostgresDialect();

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

describe("quote()", () => {
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

describe("param()", () => {
  it("returns $1 for index 1", () => {
    assert.equal(dialect.param(1), "$1");
  });

  it("returns $2 for index 2", () => {
    assert.equal(dialect.param(2), "$2");
  });

  it("returns $10 for index 10", () => {
    assert.equal(dialect.param(10), "$10");
  });
});

// ---------------------------------------------------------------------------
// compileSelect: SELECT * (star columns)
// ---------------------------------------------------------------------------

describe("compileSelect: SELECT *", () => {
  it("produces SELECT tablename.* FROM tablename", () => {
    // Arrange
    const node = makeSelect({ columns: "*" });

    // Act
    const result = dialect.compileSelect(node);

    // Assert
    assert.equal(result.sql, "SELECT \"users\".* FROM \"users\"");
    assert.deepEqual(result.params, []);
  });
});

// ---------------------------------------------------------------------------
// compileSelect: specific columns
// ---------------------------------------------------------------------------

describe("compileSelect: specific columns", () => {
  it("produces SELECT with each quoted column", () => {
    // Arrange — columns listed as camelCase field names
    const node = makeSelect({ columns: ["id", "name", "email"] });

    // Act
    const result = dialect.compileSelect(node);

    // Assert
    assert.equal(result.sql, "SELECT \"users\".\"id\", \"users\".\"name\", \"users\".\"email\" FROM \"users\"");
    assert.deepEqual(result.params, []);
  });

  it("resolves camelCase field names to snake_case column names", () => {
    // Arrange
    const node = makeSelect({ columns: ["createdAt"] });

    // Act
    const result = dialect.compileSelect(node);

    // Assert
    assert.equal(result.sql, "SELECT \"users\".\"created_at\" FROM \"users\"");
  });
});

// ---------------------------------------------------------------------------
// compileSelect: WHERE conditions
// ---------------------------------------------------------------------------

describe("compileSelect: WHERE eq", () => {
  it("adds parameterised WHERE clause for eq", () => {
    // Arrange
    const node = makeSelect({ conditions: [eq("id", "u1")] });

    // Act
    const result = dialect.compileSelect(node);

    // Assert
    assert.equal(result.sql, "SELECT \"users\".* FROM \"users\" WHERE \"users\".\"id\" = $1");
    assert.deepEqual(result.params, ["u1"]);
  });
});

describe("compileSelect: WHERE ne", () => {
  it("adds != operator for ne", () => {
    // Arrange
    const node = makeSelect({ conditions: [ne("role", "banned")] });

    // Act
    const result = dialect.compileSelect(node);

    // Assert
    assert.equal(result.sql, "SELECT \"users\".* FROM \"users\" WHERE \"users\".\"role\" != $1");
    assert.deepEqual(result.params, ["banned"]);
  });
});

describe("compileSelect: WHERE gt", () => {
  it("adds > operator for gt", () => {
    // Arrange
    const node = makeSelect({ conditions: [gt("age", 18)] });

    // Act
    const result = dialect.compileSelect(node);

    // Assert
    assert.equal(result.sql, "SELECT \"users\".* FROM \"users\" WHERE \"users\".\"age\" > $1");
    assert.deepEqual(result.params, [18]);
  });
});

describe("compileSelect: WHERE isNull", () => {
  it("adds IS NULL with no parameter", () => {
    // Arrange
    const node = makeSelect({ conditions: [isNull("deletedAt")] });

    // Act
    const result = dialect.compileSelect(node);

    // Assert
    assert.equal(result.sql, "SELECT \"users\".* FROM \"users\" WHERE \"users\".\"deleted_at\" IS NULL");
    assert.deepEqual(result.params, []);
  });
});

describe("compileSelect: WHERE inArray empty", () => {
  it("produces FALSE for an empty inArray", () => {
    // Arrange
    const node = makeSelect({ conditions: [inArray("role", [])] });

    // Act
    const result = dialect.compileSelect(node);

    // Assert
    assert.equal(result.sql, "SELECT \"users\".* FROM \"users\" WHERE FALSE");
    assert.deepEqual(result.params, []);
  });
});

describe("compileSelect: WHERE inArray non-empty", () => {
  it("produces IN ($1, $2) for two values", () => {
    // Arrange
    const node = makeSelect({ conditions: [inArray("role", ["admin", "editor"])] });

    // Act
    const result = dialect.compileSelect(node);

    // Assert
    assert.equal(result.sql, "SELECT \"users\".* FROM \"users\" WHERE \"users\".\"role\" IN ($1, $2)");
    assert.deepEqual(result.params, ["admin", "editor"]);
  });
});

describe("compileSelect: WHERE between", () => {
  it("produces BETWEEN $1 AND $2", () => {
    // Arrange
    const node = makeSelect({ conditions: [between("age", 18, 65)] });

    // Act
    const result = dialect.compileSelect(node);

    // Assert
    assert.equal(result.sql, "SELECT \"users\".* FROM \"users\" WHERE \"users\".\"age\" BETWEEN $1 AND $2");
    assert.deepEqual(result.params, [18, 65]);
  });
});

describe("compileSelect: WHERE not", () => {
  it("wraps compiled inner condition in NOT (...)", () => {
    // Arrange
    const node = makeSelect({ conditions: [not(eq("active", false))] });

    // Act
    const result = dialect.compileSelect(node);

    // Assert
    assert.equal(result.sql, "SELECT \"users\".* FROM \"users\" WHERE NOT (\"users\".\"active\" = $1)");
    assert.deepEqual(result.params, [false]);
  });
});

describe("compileSelect: WHERE and", () => {
  it("joins conditions with AND inside parentheses", () => {
    // Arrange
    const node = makeSelect({
      conditions: [and(eq("role", "admin"), gt("age", 18))],
    });

    // Act
    const result = dialect.compileSelect(node);

    // Assert
    assert.equal(
      result.sql,
      "SELECT \"users\".* FROM \"users\" WHERE (\"users\".\"role\" = $1 AND \"users\".\"age\" > $2)",
    );
    assert.deepEqual(result.params, ["admin", 18]);
  });
});

describe("compileSelect: WHERE or", () => {
  it("joins conditions with OR inside parentheses", () => {
    // Arrange
    const node = makeSelect({
      conditions: [or(eq("role", "admin"), eq("role", "editor"))],
    });

    // Act
    const result = dialect.compileSelect(node);

    // Assert
    assert.equal(
      result.sql,
      "SELECT \"users\".* FROM \"users\" WHERE (\"users\".\"role\" = $1 OR \"users\".\"role\" = $2)",
    );
    assert.deepEqual(result.params, ["admin", "editor"]);
  });
});

// ---------------------------------------------------------------------------
// compileSelect: compound WHERE (and + or nesting)
// ---------------------------------------------------------------------------

describe("compileSelect: compound WHERE", () => {
  it("supports nested and/or with correct param ordering", () => {
    // Arrange: (role = 'admin' OR role = 'editor') AND age > 18
    const node = makeSelect({
      conditions: [
        and(
          or(eq("role", "admin"), eq("role", "editor")),
          gt("age", 18),
        ),
      ],
    });

    // Act
    const result = dialect.compileSelect(node);

    // Assert
    assert.equal(
      result.sql,
      "SELECT \"users\".* FROM \"users\" WHERE ((\"users\".\"role\" = $1 OR \"users\".\"role\" = $2) AND \"users\".\"age\" > $3)",
    );
    assert.deepEqual(result.params, ["admin", "editor", 18]);
  });

  it("multiple top-level conditions are joined with AND", () => {
    // Arrange
    const node = makeSelect({
      conditions: [eq("role", "admin"), gt("age", 18)],
    });

    // Act
    const result = dialect.compileSelect(node);

    // Assert
    assert.equal(
      result.sql,
      "SELECT \"users\".* FROM \"users\" WHERE \"users\".\"role\" = $1 AND \"users\".\"age\" > $2",
    );
    assert.deepEqual(result.params, ["admin", 18]);
  });
});

// ---------------------------------------------------------------------------
// compileSelect: ORDER BY
// ---------------------------------------------------------------------------

describe("compileSelect: ORDER BY", () => {
  it("adds ASC order clause", () => {
    // Arrange
    const node = makeSelect({ orderBy: [{ column: "name", direction: "asc" }] });

    // Act
    const result = dialect.compileSelect(node);

    // Assert
    assert.equal(result.sql, "SELECT \"users\".* FROM \"users\" ORDER BY \"users\".\"name\" ASC");
  });

  it("adds DESC order clause", () => {
    // Arrange
    const node = makeSelect({ orderBy: [{ column: "createdAt", direction: "desc" }] });

    // Act
    const result = dialect.compileSelect(node);

    // Assert
    assert.equal(result.sql, "SELECT \"users\".* FROM \"users\" ORDER BY \"users\".\"created_at\" DESC");
  });

  it("supports multiple ORDER BY columns", () => {
    // Arrange
    const node = makeSelect({
      orderBy: [
        { column: "role", direction: "asc" },
        { column: "createdAt", direction: "desc" },
      ],
    });

    // Act
    const result = dialect.compileSelect(node);

    // Assert
    assert.equal(
      result.sql,
      "SELECT \"users\".* FROM \"users\" ORDER BY \"users\".\"role\" ASC, \"users\".\"created_at\" DESC",
    );
  });
});

// ---------------------------------------------------------------------------
// compileSelect: LIMIT and OFFSET (parameterised)
// ---------------------------------------------------------------------------

describe("compileSelect: LIMIT", () => {
  it("adds LIMIT as a parameter (not interpolated)", () => {
    // Arrange
    const node = makeSelect({ limit: 10 });

    // Act
    const result = dialect.compileSelect(node);

    // Assert
    assert.equal(result.sql, "SELECT \"users\".* FROM \"users\" LIMIT $1");
    assert.deepEqual(result.params, [10]);
  });
});

describe("compileSelect: OFFSET", () => {
  it("adds OFFSET as a parameter (not interpolated)", () => {
    // Arrange
    const node = makeSelect({ offset: 20 });

    // Act
    const result = dialect.compileSelect(node);

    // Assert
    assert.equal(result.sql, "SELECT \"users\".* FROM \"users\" OFFSET $1");
    assert.deepEqual(result.params, [20]);
  });
});

describe("compileSelect: LIMIT + OFFSET together", () => {
  it("assigns sequential params to LIMIT then OFFSET", () => {
    // Arrange
    const node = makeSelect({ limit: 10, offset: 30 });

    // Act
    const result = dialect.compileSelect(node);

    // Assert
    assert.equal(result.sql, "SELECT \"users\".* FROM \"users\" LIMIT $1 OFFSET $2");
    assert.deepEqual(result.params, [10, 30]);
  });

  it("WHERE params come before LIMIT/OFFSET params", () => {
    // Arrange
    const node = makeSelect({
      conditions: [eq("role", "admin")],
      limit: 5,
      offset: 0,
    });

    // Act
    const result = dialect.compileSelect(node);

    // Assert
    assert.equal(
      result.sql,
      "SELECT \"users\".* FROM \"users\" WHERE \"users\".\"role\" = $1 LIMIT $2 OFFSET $3",
    );
    assert.deepEqual(result.params, ["admin", 5, 0]);
  });
});

// ---------------------------------------------------------------------------
// compileSelect: soft delete filter
// ---------------------------------------------------------------------------

describe("compileSelect: soft delete filter", () => {
  it("appends deleted_at IS NULL when softDeleteFilter is true", () => {
    // Arrange
    const node = makeSelect({ softDeleteFilter: true });

    // Act
    const result = dialect.compileSelect(node);

    // Assert
    assert.equal(result.sql, "SELECT \"users\".* FROM \"users\" WHERE \"users\".\"deleted_at\" IS NULL");
    assert.deepEqual(result.params, []);
  });

  it("adds soft delete filter after existing conditions joined with AND", () => {
    // Arrange
    const node = makeSelect({
      conditions: [eq("role", "admin")],
      softDeleteFilter: true,
    });

    // Act
    const result = dialect.compileSelect(node);

    // Assert
    assert.equal(
      result.sql,
      "SELECT \"users\".* FROM \"users\" WHERE \"users\".\"role\" = $1 AND \"users\".\"deleted_at\" IS NULL",
    );
    assert.deepEqual(result.params, ["admin"]);
  });
});

// ---------------------------------------------------------------------------
// compileSelect: column name resolution (camelCase -> snake_case)
// ---------------------------------------------------------------------------

describe("compileSelect: column name resolution", () => {
  it("resolves camelCase field name to snake_case column in WHERE", () => {
    // Arrange: "createdAt" -> "created_at"
    const node = makeSelect({ conditions: [eq("createdAt", "2024-01-01")] });

    // Act
    const result = dialect.compileSelect(node);

    // Assert
    assert.equal(
      result.sql,
      "SELECT \"users\".* FROM \"users\" WHERE \"users\".\"created_at\" = $1",
    );
  });

  it("resolves 'role' field to 'role' column (already matches)", () => {
    // Arrange
    const node = makeSelect({ conditions: [eq("role", "admin")] });

    // Act
    const result = dialect.compileSelect(node);

    // Assert
    assert.ok(result.sql.includes("\"users\".\"role\""));
  });

  it("strips leading qualifier (Model.field) before resolving", () => {
    // Arrange: "User.createdAt" -> strip qualifier -> "createdAt" -> "created_at"
    const node = makeSelect({ conditions: [eq("User.createdAt", "2024-01-01")] });

    // Act
    const result = dialect.compileSelect(node);

    // Assert
    assert.equal(
      result.sql,
      "SELECT \"users\".* FROM \"users\" WHERE \"users\".\"created_at\" = $1",
    );
  });

  it("falls back to raw field name when no metadata match exists", () => {
    // Arrange: "raw_col" is not in UserModel fields
    const node = makeSelect({ conditions: [eq("raw_col", "val")] });

    // Act
    const result = dialect.compileSelect(node);

    // Assert
    assert.ok(result.sql.includes("\"users\".\"raw_col\""));
  });

  it("resolves ilike column to snake_case", () => {
    // Arrange
    const node = makeSelect({ conditions: [ilike("email", "%@example.com")] });

    // Act
    const result = dialect.compileSelect(node);

    // Assert
    assert.equal(
      result.sql,
      "SELECT \"users\".* FROM \"users\" WHERE \"users\".\"email\" ILIKE $1",
    );
    assert.deepEqual(result.params, ["%@example.com"]);
  });
});

// ---------------------------------------------------------------------------
// compileSelect: softDeleteFilter false
// ---------------------------------------------------------------------------

describe("compileSelect: softDeleteFilter false", () => {
  it("does NOT inject deleted_at IS NULL when softDeleteFilter is false", () => {
    // Arrange
    const node = makeSelect({ softDeleteFilter: false });

    // Act
    const result = dialect.compileSelect(node);

    // Assert
    assert.ok(!result.sql.includes("deleted_at"), "should not contain deleted_at");
    assert.equal(result.sql, "SELECT \"users\".* FROM \"users\"");
  });
});

// ---------------------------------------------------------------------------
// compileSelect: qualified column names
// ---------------------------------------------------------------------------

describe("compileSelect: qualified column names", () => {
  it("strips table qualifier from 'table.column' and resolves to snake_case", () => {
    // Arrange: "users.role" — qualifier matches table, field name is "role"
    const node = makeSelect({ conditions: [eq("users.role", "admin")] });

    // Act
    const result = dialect.compileSelect(node);

    // Assert — qualifier is stripped, column is resolved correctly
    assert.ok(result.sql.includes("\"users\".\"role\""), `unexpected SQL: ${result.sql}`);
    assert.deepEqual(result.params, ["admin"]);
  });

  it("strips non-matching qualifier and resolves camelCase field to snake_case", () => {
    // Arrange: "u.createdAt" — arbitrary qualifier, field is "createdAt" -> "created_at"
    const node = makeSelect({ conditions: [eq("u.createdAt", "2024-01-01")] });

    // Act
    const result = dialect.compileSelect(node);

    // Assert
    assert.ok(result.sql.includes("\"created_at\""), `unexpected SQL: ${result.sql}`);
  });
});

// ---------------------------------------------------------------------------
// compileSelect: limit(0)
// ---------------------------------------------------------------------------

describe("compileSelect: limit(0)", () => {
  it("compiles limit 0 as a parameterised LIMIT clause", () => {
    // Arrange
    const node = makeSelect({ limit: 0 });

    // Act
    const result = dialect.compileSelect(node);

    // Assert
    assert.equal(result.sql, "SELECT \"users\".* FROM \"users\" LIMIT $1");
    assert.deepEqual(result.params, [0]);
  });
});

// ---------------------------------------------------------------------------
// compileSelect: multiple ORDER BY preserves insertion order
// ---------------------------------------------------------------------------

describe("compileSelect: multiple ORDER BY order", () => {
  it("emits ORDER BY clauses in the order they were added", () => {
    // Arrange
    const node = makeSelect({
      orderBy: [
        { column: "name", direction: "asc" },
        { column: "createdAt", direction: "desc" },
        { column: "id", direction: "asc" },
      ],
    });

    // Act
    const result = dialect.compileSelect(node);

    // Assert — three clauses in declaration order
    assert.equal(
      result.sql,
      "SELECT \"users\".* FROM \"users\" ORDER BY \"users\".\"name\" ASC, \"users\".\"created_at\" DESC, \"users\".\"id\" ASC",
    );
  });
});

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

describe("resolveDialect()", () => {
  it("returns Ok for the pre-registered 'postgresql' dialect", () => {
    // Act
    const result = resolveDialect("postgresql");

    // Assert
    assert.equal(result.tag, "Ok");
    assert.equal(result.tag === "Ok" && result.value.name, "postgresql");
  });

  it("returns Err for an unknown dialect name", () => {
    // Act
    const result = resolveDialect("mysql");

    // Assert
    assert.equal(result.tag, "Err");
    assert.equal(result.tag === "Err" && result.error.tag, "ValidationError");
  });

  it("registerDialect makes a custom dialect resolvable", () => {
    // Arrange: create a minimal stub dialect
    const stubDialect = Object.freeze({
      name: "stub",
      compileSelect: () => Object.freeze({ sql: "SELECT 1", params: Object.freeze([]) }),
      param: (i: number) => `?${i}`,
      quote: (id: string) => `\`${id}\``,
      mapFieldType: () => "TEXT",
    });

    // Act
    registerDialect("stub", stubDialect);
    const result = resolveDialect("stub");

    // Assert
    assert.equal(result.tag, "Ok");
    assert.equal(result.tag === "Ok" && result.value.name, "stub");
  });
});
