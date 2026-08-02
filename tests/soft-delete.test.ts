// Copyright 2026 igorjs. SPDX-License-Identifier: Apache-2.0

/**
 * Tests for soft delete features: withDeleted(), onlyDeleted(), restore(),
 * and deletedAt column injection.
 *
 * Verifies that models with softDelete: true get the deletedAt column
 * in metadata, and that the query modifiers produce correct SQL through
 * both PostgreSQL and SQLite dialects.
 */

import { Schema } from "@igorjs/pure-fx";
import { describe, expect, it } from "@igorjs/pure-test";
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

    expect(col !== undefined).toBeTruthy();
    expect(col.columnName).toBe("deleted_at");
  });

  it("does NOT add deletedAt when softDelete is not set", () => {
    const col = HardUser.$columns.find(c => c.name === "deletedAt");

    expect(col).toBe(undefined);
  });

  it("deletedAt comes after timestamp columns when both are enabled", () => {
    const names = TimestampedUser.$columns.map(c => c.name);

    expect(names.includes("createdAt")).toBeTruthy();
    expect(names.includes("updatedAt")).toBeTruthy();
    expect(names.includes("deletedAt")).toBeTruthy();

    const createdIdx = names.indexOf("createdAt");
    const updatedIdx = names.indexOf("updatedAt");
    const deletedIdx = names.indexOf("deletedAt");

    expect(createdIdx < deletedIdx).toBeTruthy();
    expect(updatedIdx < deletedIdx).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// withDeleted()
// ---------------------------------------------------------------------------

describe("withDeleted()", () => {
  it("disables the soft-delete filter on SelectNode", () => {
    const base = from(User);
    expect(base.softDeleteFilter).toBe(true);

    const node = withDeleted()(base);
    expect(node.softDeleteFilter).toBe(false);
  });

  it("does not mutate the input node", () => {
    const base = from(User);
    withDeleted()(base);

    expect(base.softDeleteFilter).toBe(true);
  });

  it("returns a frozen SelectNode", () => {
    const node = withDeleted()(from(User));

    expect(Object.isFrozen(node)).toBeTruthy();
  });

  it("preserves all other fields", () => {
    const base = from(User);
    const node = withDeleted()(base);

    expect(node.tag).toBe(base.tag);
    expect(node.model.name).toBe(base.model.name);
    expect(node.columns).toBe(base.columns);
    expect(node.conditions).toEqual(base.conditions);
    expect(node.orderBy).toEqual(base.orderBy);
  });

  it("PostgreSQL: removes the IS NULL filter from compiled SQL", () => {
    const withFilter = pgDialect.compileSelect(from(User));
    const withoutFilter = pgDialect.compileSelect(withDeleted()(from(User)));

    expect(withFilter.sql.includes("IS NULL")).toBeTruthy();
    expect(!withoutFilter.sql.includes("IS NULL")).toBeTruthy();
  });

  it("SQLite: removes the IS NULL filter from compiled SQL", () => {
    const withFilter = sqliteDialect.compileSelect(from(User));
    const withoutFilter = sqliteDialect.compileSelect(withDeleted()(from(User)));

    expect(withFilter.sql.includes("IS NULL")).toBeTruthy();
    expect(!withoutFilter.sql.includes("IS NULL")).toBeTruthy();
  });

  it("is idempotent (calling twice has same effect)", () => {
    const once = withDeleted()(from(User));
    const twice = withDeleted()(once);

    expect(once.softDeleteFilter).toBe(false);
    expect(twice.softDeleteFilter).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// onlyDeleted()
// ---------------------------------------------------------------------------

describe("onlyDeleted()", () => {
  it("disables soft-delete filter and adds IS NOT NULL condition", () => {
    const node = onlyDeleted()(from(User));

    expect(node.softDeleteFilter).toBe(false);
    expect(node.conditions.length).toBe(1);
    expect(node.conditions[0].tag).toBe("IsNotNull");
  });

  it("condition targets the deletedAt column", () => {
    const node = onlyDeleted()(from(User));
    const condition = node.conditions[0];

    expect(condition.tag).toBe("IsNotNull");
    if (condition.tag === "IsNotNull") {
      expect(condition.column).toBe("deletedAt");
    }
  });

  it("does not mutate the input node", () => {
    const base = from(User);
    onlyDeleted()(base);

    expect(base.softDeleteFilter).toBe(true);
    expect(base.conditions.length).toBe(0);
  });

  it("returns a frozen SelectNode", () => {
    const node = onlyDeleted()(from(User));

    expect(Object.isFrozen(node)).toBeTruthy();
    expect(Object.isFrozen(node.conditions)).toBeTruthy();
  });

  it("PostgreSQL: compiles to WHERE deleted_at IS NOT NULL", () => {
    const result = pgDialect.compileSelect(onlyDeleted()(from(User)));

    expect(result.sql.includes('"deleted_at" IS NOT NULL')).toBeTruthy();
    expect(!result.sql.includes("IS NULL ")).toBeTruthy();
  });

  it("SQLite: compiles to WHERE deleted_at IS NOT NULL", () => {
    const result = sqliteDialect.compileSelect(onlyDeleted()(from(User)));

    expect(result.sql.includes('"deleted_at" IS NOT NULL')).toBeTruthy();
  });

  it("composes with where() for additional filtering", () => {
    const node = where(eq("name", "Alice"))(onlyDeleted()(from(User)));
    const result = pgDialect.compileSelect(node);

    expect(result.sql.includes("IS NOT NULL")).toBeTruthy();
    expect(result.sql.includes('"name" = $1')).toBeTruthy();
    expect(result.params).toEqual(["Alice"]);
  });
});

// ---------------------------------------------------------------------------
// restore()
// ---------------------------------------------------------------------------

describe("restore()", () => {
  it("creates an UpdateNode with tag 'Update'", () => {
    const node = restore(User);

    expect(node.tag).toBe("Update");
  });

  it("sets deletedAt to null in the values", () => {
    const node = restore(User);

    expect(node.values.deletedAt).toBe(null);
  });

  it("includes IS NOT NULL condition to target only deleted rows", () => {
    const node = restore(User);

    expect(node.conditions.length).toBe(1);
    expect(node.conditions[0].tag).toBe("IsNotNull");
    if (node.conditions[0].tag === "IsNotNull") {
      expect(node.conditions[0].column).toBe("deletedAt");
    }
  });

  it("softDeleteFilter is false (targets deleted rows, not non-deleted)", () => {
    const node = restore(User);

    expect(node.softDeleteFilter).toBe(false);
  });

  it("returning is null by default", () => {
    const node = restore(User);

    expect(node.returning).toBe(null);
  });

  it("is frozen", () => {
    const node = restore(User);

    expect(Object.isFrozen(node)).toBeTruthy();
    expect(Object.isFrozen(node.values)).toBeTruthy();
    expect(Object.isFrozen(node.conditions)).toBeTruthy();
  });

  it("composes with where() for specific row targeting", () => {
    const node = where(eq("id", "abc"))(restore(User));

    expect(node.conditions.length).toBe(2);
    expect(node.conditions[0].tag).toBe("IsNotNull");
    expect(node.conditions[1].tag).toBe("Eq");
  });

  it("PostgreSQL: compiles to UPDATE SET deleted_at = NULL with IS NOT NULL", () => {
    const node = where(eq("id", "user-1"))(restore(User));
    const result = pgDialect.compileUpdate(node);

    expect(result.sql.includes('SET "deleted_at" = $1')).toBeTruthy();
    expect(result.sql.includes('"deleted_at" IS NOT NULL')).toBeTruthy();
    expect(result.sql.includes('"id" = $2')).toBeTruthy();
    expect(result.params).toEqual([null, "user-1"]);
  });

  it("SQLite: compiles to UPDATE SET deleted_at = ? with IS NOT NULL", () => {
    const node = where(eq("id", "user-1"))(restore(User));
    const result = sqliteDialect.compileUpdate(node);

    expect(result.sql.includes('SET "deleted_at" = ?')).toBeTruthy();
    expect(result.sql.includes('"deleted_at" IS NOT NULL')).toBeTruthy();
    expect(result.params).toEqual([null, "user-1"]);
  });
});

// ---------------------------------------------------------------------------
// Default soft-delete behaviour (regression tests)
// ---------------------------------------------------------------------------

describe("default soft-delete behaviour", () => {
  it("from() on soft-delete model sets softDeleteFilter: true", () => {
    const node = from(User);

    expect(node.softDeleteFilter).toBe(true);
  });

  it("from() on non-soft-delete model sets softDeleteFilter: false", () => {
    const node = from(HardUser);

    expect(node.softDeleteFilter).toBe(false);
  });

  it("PostgreSQL: auto-adds WHERE deleted_at IS NULL for soft-delete models", () => {
    const result = pgDialect.compileSelect(from(User));

    expect(result.sql.includes('"deleted_at" IS NULL')).toBeTruthy();
  });

  it("PostgreSQL: no filter for non-soft-delete models", () => {
    const result = pgDialect.compileSelect(from(HardUser));

    expect(!result.sql.includes("deleted_at")).toBeTruthy();
  });
});
