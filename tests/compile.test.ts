/**
 * Tests for src/execute/compile.ts
 *
 * Verifies that compile() correctly translates all QueryNode ASTs into SQL
 * using the registered PostgreSQL dialect, defaults the dialect name when
 * omitted, and throws for unknown dialects.
 */

import { Schema } from "@igorjs/pure-fx";
import { describe, expect, it } from "@igorjs/pure-test";

import { compile } from "../src/execute/compile.ts";
import { Model } from "../src/model/define.ts";
import { Field } from "../src/model/field.ts";
import { from, where } from "../src/query/builders.ts";
import { eq } from "../src/query/conditions.ts";
import { insert, remove, update } from "../src/query/mutations.ts";

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
// compile() — basic SelectNode
// ---------------------------------------------------------------------------

describe("compile(): SelectNode produces SQL", () => {
  it("produces a SELECT * SQL string from a bare from()", () => {
    // Arrange
    const node = from(UserModel);

    // Act
    const result = compile(node);

    // Assert
    expect(result.sql).toBe('SELECT "users".* FROM "users"');
    expect(result.params).toEqual([]);
  });

  it("produces SQL with a WHERE clause from where(eq(...))", () => {
    // Arrange
    const node = where(eq("email", "alice@example.com"))(from(UserModel));

    // Act
    const result = compile(node);

    // Assert
    expect(result.sql).toBe('SELECT "users".* FROM "users" WHERE "users"."email" = $1');
    expect(result.params).toEqual(["alice@example.com"]);
  });

  it("resolves camelCase field names to snake_case in SQL", () => {
    // Arrange
    const node = where(eq("createdAt", "2024-01-01"))(from(UserModel));

    // Act
    const result = compile(node);

    // Assert
    expect(result.sql.includes('"created_at"')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// compile() — dialect defaulting
// ---------------------------------------------------------------------------

describe("compile(): defaults to 'postgresql' dialect", () => {
  it("succeeds without a dialectName argument", () => {
    // Arrange
    const node = from(UserModel);

    // Act — no second argument
    const result = compile(node);

    // Assert — valid SQL returned, so postgresql dialect was used
    expect(result.sql.startsWith("SELECT")).toBeTruthy();
  });

  it("accepts 'postgresql' explicitly and returns the same result", () => {
    // Arrange
    const node = from(UserModel);

    // Act
    const withDefault = compile(node);
    const withExplicit = compile(node, "postgresql");

    // Assert — both paths use the same dialect
    expect(withDefault.sql).toBe(withExplicit.sql);
    expect(withDefault.params).toEqual(withExplicit.params);
  });
});

// ---------------------------------------------------------------------------
// compile() — unknown dialect throws
// ---------------------------------------------------------------------------

describe("compile(): throws for an unknown dialect", () => {
  it("throws when the dialect name is not registered", () => {
    // Arrange
    const node = from(UserModel);

    // Act + Assert
    expect(() => compile(node, "oracle")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// compile() — mutation nodes
// ---------------------------------------------------------------------------

describe("compile(): InsertNode produces SQL", () => {
  it("produces an INSERT SQL string from insert()", () => {
    // Arrange
    const node = insert(UserModel, { name: "Alice", email: "alice@example.com" });

    // Act
    const result = compile(node);

    // Assert
    expect(result.sql.startsWith("INSERT INTO")).toBeTruthy();
    expect(result.sql.includes('"users"')).toBeTruthy();
    expect(result.params.length > 0).toBeTruthy();
  });
});

describe("compile(): UpdateNode produces SQL", () => {
  it("produces an UPDATE SQL string from update()", () => {
    // Arrange
    const node = update(UserModel, { name: "Bob" });

    // Act
    const result = compile(node);

    // Assert
    expect(result.sql.startsWith("UPDATE")).toBeTruthy();
    expect(result.sql.includes('"users"')).toBeTruthy();
    expect(result.params.length > 0).toBeTruthy();
  });
});

describe("compile(): DeleteNode produces SQL", () => {
  it("produces a DELETE (or soft-delete UPDATE) SQL string from remove()", () => {
    // Arrange
    const node = remove(UserModel);

    // Act
    const result = compile(node);

    // Assert — UserModel has softDelete, so this emits an UPDATE
    expect(result.sql.length > 0).toBeTruthy();
    expect(result.sql.includes('"users"')).toBeTruthy();
  });
});

describe("compile(): RawNode passes through", () => {
  it("returns the raw SQL and params unchanged", () => {
    // Arrange
    const rawNode = Object.freeze({ tag: "Raw" as const, sql: "SELECT 1 + $1", params: [1] });

    // Act
    const result = compile(rawNode);

    // Assert
    expect(result.sql).toBe("SELECT 1 + $1");
    expect(result.params).toEqual([1]);
  });

  it("works with empty params", () => {
    // Arrange
    const rawNode = Object.freeze({ tag: "Raw" as const, sql: "SELECT NOW()", params: [] });

    // Act
    const result = compile(rawNode);

    // Assert
    expect(result.sql).toBe("SELECT NOW()");
    expect(result.params).toEqual([]);
  });
});
