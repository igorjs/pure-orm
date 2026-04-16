/**
 * Tests for soft delete features: withDeleted(), onlyDeleted(), restore(),
 * and deletedAt column injection.
 *
 * Verifies that models with softDelete: true get the deletedAt column
 * in metadata, and that the query modifiers produce correct SQL through
 * both PostgreSQL and SQLite dialects.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Schema } from "@igorjs/pure-ts";
import { createPostgresDialect } from "../src/dialect/postgresql.ts";
import { createSqliteDialect } from "../src/dialect/sqlite.ts";
import { Model } from "../src/model/define.ts";
import { Field } from "../src/model/field.ts";
import { from, where } from "../src/query/builders.ts";
import { eq } from "../src/query/conditions.ts";
import { restore } from "../src/query/mutations.ts";
import { onlyDeleted, withDeleted } from "../src/query/soft-delete.ts";

// ---- Test models ----

const User = Model("users", {
  fields: {
    id: Field(Schema.string, { primaryKey: true, default: "uuid" }),
    email: Field(Schema.string, { unique: true }),
    name: Field(Schema.string),
  },
  options: { softDelete: true },
});

const HardUser = Model("hard_users", {
  fields: {
    id: Field(Schema.string, { primaryKey: true }),
    name: Field(Schema.string),
  },
  // No softDelete
});

const TimestampedUser = Model("ts_users", {
  fields: {
    id: Field(Schema.string, { primaryKey: true }),
    name: Field(Schema.string),
  },
  options: { timestamps: true, softDelete: true },
});

const pgDialect = createPostgresDialect();
const sqliteDialect = createSqliteDialect();

// ---------------------------------------------------------------------------
// deletedAt column injection
// ---------------------------------------------------------------------------

describe("deletedAt column injection", () => {
  it("adds deletedAt column when softDelete is true", () => {
    const col = User.$columns.find(c => c.name === "deletedAt");

    assert.ok(col !== undefined, "Should have a deletedAt column");
    assert.equal(col.columnName, "deleted_at");
  });

  it("does NOT add deletedAt when softDelete is not set", () => {
    const col = HardUser.$columns.find(c => c.name === "deletedAt");

    assert.equal(col, undefined);
  });

  it("deletedAt comes after timestamp columns when both are enabled", () => {
    const names = TimestampedUser.$columns.map(c => c.name);

    assert.ok(names.includes("createdAt"), "Should have createdAt");
    assert.ok(names.includes("updatedAt"), "Should have updatedAt");
    assert.ok(names.includes("deletedAt"), "Should have deletedAt");

    const createdIdx = names.indexOf("createdAt");
    const updatedIdx = names.indexOf("updatedAt");
    const deletedIdx = names.indexOf("deletedAt");

    assert.ok(createdIdx < deletedIdx, "deletedAt should come after createdAt");
    assert.ok(updatedIdx < deletedIdx, "deletedAt should come after updatedAt");
  });
});

// ---------------------------------------------------------------------------
// withDeleted()
// ---------------------------------------------------------------------------

describe("withDeleted()", () => {
  it("disables the soft-delete filter on SelectNode", () => {
    const base = from(User);
    assert.equal(base.softDeleteFilter, true);

    const node = withDeleted()(base);
    assert.equal(node.softDeleteFilter, false);
  });

  it("does not mutate the input node", () => {
    const base = from(User);
    withDeleted()(base);

    assert.equal(base.softDeleteFilter, true);
  });

  it("returns a frozen SelectNode", () => {
    const node = withDeleted()(from(User));

    assert.ok(Object.isFrozen(node));
  });

  it("preserves all other fields", () => {
    const base = from(User);
    const node = withDeleted()(base);

    assert.equal(node.tag, base.tag);
    assert.equal(node.model.name, base.model.name);
    assert.equal(node.columns, base.columns);
    assert.deepEqual(node.conditions, base.conditions);
    assert.deepEqual(node.orderBy, base.orderBy);
  });

  it("PostgreSQL: removes the IS NULL filter from compiled SQL", () => {
    const withFilter = pgDialect.compileSelect(from(User));
    const withoutFilter = pgDialect.compileSelect(withDeleted()(from(User)));

    assert.ok(withFilter.sql.includes("IS NULL"), "Default should have IS NULL");
    assert.ok(!withoutFilter.sql.includes("IS NULL"), "withDeleted should remove IS NULL");
  });

  it("SQLite: removes the IS NULL filter from compiled SQL", () => {
    const withFilter = sqliteDialect.compileSelect(from(User));
    const withoutFilter = sqliteDialect.compileSelect(withDeleted()(from(User)));

    assert.ok(withFilter.sql.includes("IS NULL"));
    assert.ok(!withoutFilter.sql.includes("IS NULL"));
  });

  it("is idempotent (calling twice has same effect)", () => {
    const once = withDeleted()(from(User));
    const twice = withDeleted()(once);

    assert.equal(once.softDeleteFilter, false);
    assert.equal(twice.softDeleteFilter, false);
  });
});

// ---------------------------------------------------------------------------
// onlyDeleted()
// ---------------------------------------------------------------------------

describe("onlyDeleted()", () => {
  it("disables soft-delete filter and adds IS NOT NULL condition", () => {
    const node = onlyDeleted()(from(User));

    assert.equal(node.softDeleteFilter, false);
    assert.equal(node.conditions.length, 1);
    assert.equal(node.conditions[0].tag, "IsNotNull");
  });

  it("condition targets the deletedAt column", () => {
    const node = onlyDeleted()(from(User));
    const condition = node.conditions[0];

    assert.equal(condition.tag, "IsNotNull");
    if (condition.tag === "IsNotNull") {
      assert.equal(condition.column, "deletedAt");
    }
  });

  it("does not mutate the input node", () => {
    const base = from(User);
    onlyDeleted()(base);

    assert.equal(base.softDeleteFilter, true);
    assert.equal(base.conditions.length, 0);
  });

  it("returns a frozen SelectNode", () => {
    const node = onlyDeleted()(from(User));

    assert.ok(Object.isFrozen(node));
    assert.ok(Object.isFrozen(node.conditions));
  });

  it("PostgreSQL: compiles to WHERE deleted_at IS NOT NULL", () => {
    const result = pgDialect.compileSelect(onlyDeleted()(from(User)));

    assert.ok(result.sql.includes('"deleted_at" IS NOT NULL'));
    assert.ok(!result.sql.includes("IS NULL "), "Should not have IS NULL (only IS NOT NULL)");
  });

  it("SQLite: compiles to WHERE deleted_at IS NOT NULL", () => {
    const result = sqliteDialect.compileSelect(onlyDeleted()(from(User)));

    assert.ok(result.sql.includes('"deleted_at" IS NOT NULL'));
  });

  it("composes with where() for additional filtering", () => {
    const node = where(eq("name", "Alice"))(onlyDeleted()(from(User)));
    const result = pgDialect.compileSelect(node);

    assert.ok(result.sql.includes("IS NOT NULL"));
    assert.ok(result.sql.includes('"name" = $1'));
    assert.deepEqual(result.params, ["Alice"]);
  });
});

// ---------------------------------------------------------------------------
// restore()
// ---------------------------------------------------------------------------

describe("restore()", () => {
  it("creates an UpdateNode with tag 'Update'", () => {
    const node = restore(User);

    assert.equal(node.tag, "Update");
  });

  it("sets deletedAt to null in the values", () => {
    const node = restore(User);

    assert.equal(node.values.deletedAt, null);
  });

  it("includes IS NOT NULL condition to target only deleted rows", () => {
    const node = restore(User);

    assert.equal(node.conditions.length, 1);
    assert.equal(node.conditions[0].tag, "IsNotNull");
    if (node.conditions[0].tag === "IsNotNull") {
      assert.equal(node.conditions[0].column, "deletedAt");
    }
  });

  it("softDeleteFilter is false (targets deleted rows, not non-deleted)", () => {
    const node = restore(User);

    assert.equal(node.softDeleteFilter, false);
  });

  it("returning is null by default", () => {
    const node = restore(User);

    assert.equal(node.returning, null);
  });

  it("is frozen", () => {
    const node = restore(User);

    assert.ok(Object.isFrozen(node));
    assert.ok(Object.isFrozen(node.values));
    assert.ok(Object.isFrozen(node.conditions));
  });

  it("composes with where() for specific row targeting", () => {
    const node = where(eq("id", "abc"))(restore(User));

    assert.equal(node.conditions.length, 2);
    assert.equal(node.conditions[0].tag, "IsNotNull");
    assert.equal(node.conditions[1].tag, "Eq");
  });

  it("PostgreSQL: compiles to UPDATE SET deleted_at = NULL with IS NOT NULL", () => {
    const node = where(eq("id", "user-1"))(restore(User));
    const result = pgDialect.compileUpdate(node);

    assert.ok(result.sql.includes('SET "deleted_at" = $1'));
    assert.ok(result.sql.includes('"deleted_at" IS NOT NULL'));
    assert.ok(result.sql.includes('"id" = $2'));
    assert.deepEqual(result.params, [null, "user-1"]);
  });

  it("SQLite: compiles to UPDATE SET deleted_at = ? with IS NOT NULL", () => {
    const node = where(eq("id", "user-1"))(restore(User));
    const result = sqliteDialect.compileUpdate(node);

    assert.ok(result.sql.includes('SET "deleted_at" = ?'));
    assert.ok(result.sql.includes('"deleted_at" IS NOT NULL'));
    assert.deepEqual(result.params, [null, "user-1"]);
  });
});

// ---------------------------------------------------------------------------
// Default soft-delete behaviour (regression tests)
// ---------------------------------------------------------------------------

describe("default soft-delete behaviour", () => {
  it("from() on soft-delete model sets softDeleteFilter: true", () => {
    const node = from(User);

    assert.equal(node.softDeleteFilter, true);
  });

  it("from() on non-soft-delete model sets softDeleteFilter: false", () => {
    const node = from(HardUser);

    assert.equal(node.softDeleteFilter, false);
  });

  it("PostgreSQL: auto-adds WHERE deleted_at IS NULL for soft-delete models", () => {
    const result = pgDialect.compileSelect(from(User));

    assert.ok(result.sql.includes('"deleted_at" IS NULL'));
  });

  it("PostgreSQL: no filter for non-soft-delete models", () => {
    const result = pgDialect.compileSelect(from(HardUser));

    assert.ok(!result.sql.includes("deleted_at"));
  });
});
