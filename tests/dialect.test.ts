import { Schema } from "@igorjs/pure-fx";
import { describe, expect, it } from "@igorjs/pure-test";

import { createPostgresDialect } from "../src/dialect/postgresql.ts";
import { registerDialect, resolveDialect } from "../src/dialect/registry.ts";
import { Model } from "../src/model/define.ts";
import { Field } from "../src/model/field.ts";
import {
  and,
  between,
  eq,
  gt,
  ilike,
  inArray,
  isNull,
  ne,
  not,
  or,
} from "../src/query/conditions.ts";
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
const makeSelect = (overrides: Partial<SelectNode> = {}): SelectNode =>
  Object.freeze({
    tag: "Select" as const,
    model: toModelRef(UserModel),
    columns: "*",
    conditions: [],
    joins: [],
    ctes: [],
    groupBy: [],
    having: [],
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
    expect(dialect.quote("users")).toBe('"users"');
  });

  it("escapes embedded double-quotes by doubling them", () => {
    expect(dialect.quote('weird"name')).toBe('"weird""name"');
  });

  it("handles identifiers with no special characters", () => {
    expect(dialect.quote("created_at")).toBe('"created_at"');
  });

  it("handles an identifier that is already quoted-looking", () => {
    // The double-quote chars inside should be escaped.
    expect(dialect.quote('"foo"')).toBe('"""foo"""');
  });
});

// ---------------------------------------------------------------------------
// param()
// ---------------------------------------------------------------------------

describe("param()", () => {
  it("returns $1 for index 1", () => {
    expect(dialect.param(1)).toBe("$1");
  });

  it("returns $2 for index 2", () => {
    expect(dialect.param(2)).toBe("$2");
  });

  it("returns $10 for index 10", () => {
    expect(dialect.param(10)).toBe("$10");
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
    expect(result.sql).toBe('SELECT "users".* FROM "users"');
    expect(result.params).toEqual([]);
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
    expect(result.sql).toBe('SELECT "users"."id", "users"."name", "users"."email" FROM "users"');
    expect(result.params).toEqual([]);
  });

  it("resolves camelCase field names to snake_case column names", () => {
    // Arrange
    const node = makeSelect({ columns: ["createdAt"] });

    // Act
    const result = dialect.compileSelect(node);

    // Assert
    expect(result.sql).toBe('SELECT "users"."created_at" FROM "users"');
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
    expect(result.sql).toBe('SELECT "users".* FROM "users" WHERE "users"."id" = $1');
    expect(result.params).toEqual(["u1"]);
  });
});

describe("compileSelect: WHERE ne", () => {
  it("adds != operator for ne", () => {
    // Arrange
    const node = makeSelect({ conditions: [ne("role", "banned")] });

    // Act
    const result = dialect.compileSelect(node);

    // Assert
    expect(result.sql).toBe('SELECT "users".* FROM "users" WHERE "users"."role" != $1');
    expect(result.params).toEqual(["banned"]);
  });
});

describe("compileSelect: WHERE gt", () => {
  it("adds > operator for gt", () => {
    // Arrange
    const node = makeSelect({ conditions: [gt("age", 18)] });

    // Act
    const result = dialect.compileSelect(node);

    // Assert
    expect(result.sql).toBe('SELECT "users".* FROM "users" WHERE "users"."age" > $1');
    expect(result.params).toEqual([18]);
  });
});

describe("compileSelect: WHERE isNull", () => {
  it("adds IS NULL with no parameter", () => {
    // Arrange
    const node = makeSelect({ conditions: [isNull("deletedAt")] });

    // Act
    const result = dialect.compileSelect(node);

    // Assert
    expect(result.sql).toBe('SELECT "users".* FROM "users" WHERE "users"."deleted_at" IS NULL');
    expect(result.params).toEqual([]);
  });
});

describe("compileSelect: WHERE inArray empty", () => {
  it("produces FALSE for an empty inArray", () => {
    // Arrange
    const node = makeSelect({ conditions: [inArray("role", [])] });

    // Act
    const result = dialect.compileSelect(node);

    // Assert
    expect(result.sql).toBe('SELECT "users".* FROM "users" WHERE FALSE');
    expect(result.params).toEqual([]);
  });
});

describe("compileSelect: WHERE inArray non-empty", () => {
  it("produces IN ($1, $2) for two values", () => {
    // Arrange
    const node = makeSelect({ conditions: [inArray("role", ["admin", "editor"])] });

    // Act
    const result = dialect.compileSelect(node);

    // Assert
    expect(result.sql).toBe('SELECT "users".* FROM "users" WHERE "users"."role" IN ($1, $2)');
    expect(result.params).toEqual(["admin", "editor"]);
  });
});

describe("compileSelect: WHERE between", () => {
  it("produces BETWEEN $1 AND $2", () => {
    // Arrange
    const node = makeSelect({ conditions: [between("age", 18, 65)] });

    // Act
    const result = dialect.compileSelect(node);

    // Assert
    expect(result.sql).toBe('SELECT "users".* FROM "users" WHERE "users"."age" BETWEEN $1 AND $2');
    expect(result.params).toEqual([18, 65]);
  });
});

describe("compileSelect: WHERE not", () => {
  it("wraps compiled inner condition in NOT (...)", () => {
    // Arrange
    const node = makeSelect({ conditions: [not(eq("active", false))] });

    // Act
    const result = dialect.compileSelect(node);

    // Assert
    expect(result.sql).toBe('SELECT "users".* FROM "users" WHERE NOT ("users"."active" = $1)');
    expect(result.params).toEqual([false]);
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
    expect(result.sql).toBe(
      'SELECT "users".* FROM "users" WHERE ("users"."role" = $1 AND "users"."age" > $2)',
    );
    expect(result.params).toEqual(["admin", 18]);
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
    expect(result.sql).toBe(
      'SELECT "users".* FROM "users" WHERE ("users"."role" = $1 OR "users"."role" = $2)',
    );
    expect(result.params).toEqual(["admin", "editor"]);
  });
});

// ---------------------------------------------------------------------------
// compileSelect: compound WHERE (and + or nesting)
// ---------------------------------------------------------------------------

describe("compileSelect: compound WHERE", () => {
  it("supports nested and/or with correct param ordering", () => {
    // Arrange: (role = 'admin' OR role = 'editor') AND age > 18
    const node = makeSelect({
      conditions: [and(or(eq("role", "admin"), eq("role", "editor")), gt("age", 18))],
    });

    // Act
    const result = dialect.compileSelect(node);

    // Assert
    expect(result.sql).toBe(
      'SELECT "users".* FROM "users" WHERE (("users"."role" = $1 OR "users"."role" = $2) AND "users"."age" > $3)',
    );
    expect(result.params).toEqual(["admin", "editor", 18]);
  });

  it("multiple top-level conditions are joined with AND", () => {
    // Arrange
    const node = makeSelect({
      conditions: [eq("role", "admin"), gt("age", 18)],
    });

    // Act
    const result = dialect.compileSelect(node);

    // Assert
    expect(result.sql).toBe(
      'SELECT "users".* FROM "users" WHERE "users"."role" = $1 AND "users"."age" > $2',
    );
    expect(result.params).toEqual(["admin", 18]);
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
    expect(result.sql).toBe('SELECT "users".* FROM "users" ORDER BY "users"."name" ASC');
  });

  it("adds DESC order clause", () => {
    // Arrange
    const node = makeSelect({ orderBy: [{ column: "createdAt", direction: "desc" }] });

    // Act
    const result = dialect.compileSelect(node);

    // Assert
    expect(result.sql).toBe('SELECT "users".* FROM "users" ORDER BY "users"."created_at" DESC');
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
    expect(result.sql).toBe(
      'SELECT "users".* FROM "users" ORDER BY "users"."role" ASC, "users"."created_at" DESC',
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
    expect(result.sql).toBe('SELECT "users".* FROM "users" LIMIT $1');
    expect(result.params).toEqual([10]);
  });
});

describe("compileSelect: OFFSET", () => {
  it("adds OFFSET as a parameter (not interpolated)", () => {
    // Arrange
    const node = makeSelect({ offset: 20 });

    // Act
    const result = dialect.compileSelect(node);

    // Assert
    expect(result.sql).toBe('SELECT "users".* FROM "users" OFFSET $1');
    expect(result.params).toEqual([20]);
  });
});

describe("compileSelect: LIMIT + OFFSET together", () => {
  it("assigns sequential params to LIMIT then OFFSET", () => {
    // Arrange
    const node = makeSelect({ limit: 10, offset: 30 });

    // Act
    const result = dialect.compileSelect(node);

    // Assert
    expect(result.sql).toBe('SELECT "users".* FROM "users" LIMIT $1 OFFSET $2');
    expect(result.params).toEqual([10, 30]);
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
    expect(result.sql).toBe(
      'SELECT "users".* FROM "users" WHERE "users"."role" = $1 LIMIT $2 OFFSET $3',
    );
    expect(result.params).toEqual(["admin", 5, 0]);
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
    expect(result.sql).toBe('SELECT "users".* FROM "users" WHERE "users"."deleted_at" IS NULL');
    expect(result.params).toEqual([]);
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
    expect(result.sql).toBe(
      'SELECT "users".* FROM "users" WHERE "users"."role" = $1 AND "users"."deleted_at" IS NULL',
    );
    expect(result.params).toEqual(["admin"]);
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
    expect(result.sql).toBe('SELECT "users".* FROM "users" WHERE "users"."created_at" = $1');
  });

  it("resolves 'role' field to 'role' column (already matches)", () => {
    // Arrange
    const node = makeSelect({ conditions: [eq("role", "admin")] });

    // Act
    const result = dialect.compileSelect(node);

    // Assert
    expect(result.sql.includes('"users"."role"')).toBeTruthy();
  });

  it("strips leading qualifier (Model.field) before resolving", () => {
    // Arrange: "User.createdAt" -> strip qualifier -> "createdAt" -> "created_at"
    const node = makeSelect({ conditions: [eq("User.createdAt", "2024-01-01")] });

    // Act
    const result = dialect.compileSelect(node);

    // Assert
    expect(result.sql).toBe('SELECT "users".* FROM "users" WHERE "users"."created_at" = $1');
  });

  it("falls back to raw field name when no metadata match exists", () => {
    // Arrange: "raw_col" is not in UserModel fields
    const node = makeSelect({ conditions: [eq("raw_col", "val")] });

    // Act
    const result = dialect.compileSelect(node);

    // Assert
    expect(result.sql.includes('"users"."raw_col"')).toBeTruthy();
  });

  it("resolves ilike column to snake_case", () => {
    // Arrange
    const node = makeSelect({ conditions: [ilike("email", "%@example.com")] });

    // Act
    const result = dialect.compileSelect(node);

    // Assert
    expect(result.sql).toBe('SELECT "users".* FROM "users" WHERE "users"."email" ILIKE $1');
    expect(result.params).toEqual(["%@example.com"]);
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
    expect(!result.sql.includes("deleted_at")).toBeTruthy();
    expect(result.sql).toBe('SELECT "users".* FROM "users"');
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
    expect(result.sql.includes('"users"."role"')).toBeTruthy();
    expect(result.params).toEqual(["admin"]);
  });

  it("strips non-matching qualifier and resolves camelCase field to snake_case", () => {
    // Arrange: "u.createdAt" — arbitrary qualifier, field is "createdAt" -> "created_at"
    const node = makeSelect({ conditions: [eq("u.createdAt", "2024-01-01")] });

    // Act
    const result = dialect.compileSelect(node);

    // Assert
    expect(result.sql.includes('"created_at"')).toBeTruthy();
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
    expect(result.sql).toBe('SELECT "users".* FROM "users" LIMIT $1');
    expect(result.params).toEqual([0]);
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
    expect(result.sql).toBe(
      'SELECT "users".* FROM "users" ORDER BY "users"."name" ASC, "users"."created_at" DESC, "users"."id" ASC',
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
    expect(result.tag).toBe("Ok");
    expect(result.tag === "Ok" && result.value.name).toBe("postgresql");
  });

  it("returns Err for an unknown dialect name", () => {
    // Act
    const result = resolveDialect("mysql");

    // Assert
    expect(result.tag).toBe("Err");
    expect(result.tag === "Err" && result.error.tag).toBe("ValidationError");
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
    expect(result.tag).toBe("Ok");
    expect(result.tag === "Ok" && result.value.name).toBe("stub");
  });
});
