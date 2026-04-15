/**
 * Tests for src/execute/compile.ts
 *
 * Verifies that compile() correctly translates SelectNode ASTs into SQL
 * using the registered PostgreSQL dialect, defaults the dialect name when
 * omitted, and throws for unknown dialects.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { Schema } from "@igorjs/pure-ts";

import { compile } from "../src/execute/compile.ts";
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
// compile() — basic SelectNode
// ---------------------------------------------------------------------------

describe("compile(): SelectNode produces SQL", () => {
  it("produces a SELECT * SQL string from a bare from()", () => {
    // Arrange
    const node = from(UserModel);

    // Act
    const result = compile(node);

    // Assert
    assert.equal(result.sql, "SELECT \"users\".* FROM \"users\"");
    assert.deepEqual(result.params, []);
  });

  it("produces SQL with a WHERE clause from where(eq(...))", () => {
    // Arrange
    const node = where(eq("email", "alice@example.com"))(from(UserModel));

    // Act
    const result = compile(node);

    // Assert
    assert.equal(result.sql, "SELECT \"users\".* FROM \"users\" WHERE \"users\".\"email\" = $1");
    assert.deepEqual(result.params, ["alice@example.com"]);
  });

  it("resolves camelCase field names to snake_case in SQL", () => {
    // Arrange
    const node = where(eq("createdAt", "2024-01-01"))(from(UserModel));

    // Act
    const result = compile(node);

    // Assert
    assert.ok(result.sql.includes("\"created_at\""));
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
    assert.ok(result.sql.startsWith("SELECT"));
  });

  it("accepts 'postgresql' explicitly and returns the same result", () => {
    // Arrange
    const node = from(UserModel);

    // Act
    const withDefault = compile(node);
    const withExplicit = compile(node, "postgresql");

    // Assert — both paths use the same dialect
    assert.equal(withDefault.sql, withExplicit.sql);
    assert.deepEqual(withDefault.params, withExplicit.params);
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
    assert.throws(
      () => compile(node, "mysql"),
      // compile() throws the DbError object directly, not an Error subclass
      (err: unknown) => {
        assert.ok(err !== null && typeof err === "object");
        const e = err as Record<string, unknown>;
        assert.equal(e["tag"], "ValidationError");
        assert.ok(String(e["message"]).includes("mysql"));
        return true;
      },
    );
  });
});

// ---------------------------------------------------------------------------
// compile() — unsupported node types throw
// ---------------------------------------------------------------------------

describe("compile(): throws for unsupported Phase 1 node types", () => {
  it("throws for an InsertNode", () => {
    // Arrange
    const insertNode = Object.freeze({ tag: "Insert" as const });

    // Act + Assert
    assert.throws(
      () => compile(insertNode),
      /not implemented in Phase 1/,
    );
  });

  it("throws for an UpdateNode", () => {
    // Arrange
    const updateNode = Object.freeze({ tag: "Update" as const });

    // Act + Assert
    assert.throws(
      () => compile(updateNode),
      /not implemented in Phase 1/,
    );
  });

  it("throws for a RawNode", () => {
    // Arrange
    const rawNode = Object.freeze({ tag: "Raw" as const, sql: "SELECT 1", params: [] });

    // Act + Assert
    assert.throws(
      () => compile(rawNode),
      /not implemented in Phase 1/,
    );
  });
});
