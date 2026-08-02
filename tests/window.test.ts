// Copyright 2026 igorjs. SPDX-License-Identifier: Apache-2.0

/**
 * Tests for window function expressions and lazy relation loading.
 */

import { Schema } from "@igorjs/pure-fx";
import { describe, expect, it } from "@igorjs/pure-test";
import { createPostgresDialect } from "../src/dialect/postgresql.ts";
import { createSqliteDialect } from "../src/dialect/sqlite.ts";
import { Model } from "../src/model/define.ts";
import { Field } from "../src/model/field.ts";
import { belongsTo, hasMany, hasOne } from "../src/model/relations.ts";
import { from, select } from "../src/query/builders.ts";
import { lazy } from "../src/query/lazy.ts";
import { denseRank, rank, rowNumber } from "../src/query/window.ts";

// ---- Test models ----

const User = Model("users", {
  fields: {
    id: Field(Schema.string, { primaryKey: true }),
    name: Field(Schema.string),
  },
  relations: () => ({
    posts: hasMany(() => Post, { foreignKey: "authorId", localKey: "id" }),
    profile: hasOne(() => Profile, { foreignKey: "userId", localKey: "id" }),
  }),
});

const Post = Model("posts", {
  fields: {
    id: Field(Schema.string, { primaryKey: true }),
    title: Field(Schema.string),
    authorId: Field(Schema.string),
    views: Field(Schema.number),
    createdAt: Field(Schema.isoDate),
  },
  relations: () => ({
    author: belongsTo(() => User, { foreignKey: "authorId", localKey: "id" }),
  }),
});

const Profile = Model("profiles", {
  fields: {
    id: Field(Schema.string, { primaryKey: true }),
    userId: Field(Schema.string),
    bio: Field(Schema.string),
  },
});

const pgDialect = createPostgresDialect();
const sqliteDialect = createSqliteDialect();

// ---------------------------------------------------------------------------
// rowNumber()
// ---------------------------------------------------------------------------

describe("rowNumber()", () => {
  it("creates a Window expression with fn ROW_NUMBER", () => {
    const expr = rowNumber();

    expect(expr.tag).toBe("Window");
    expect(expr.fn).toBe("ROW_NUMBER");
    expect(expr.partitions).toEqual([]);
    expect(expr.orders).toEqual([]);
    expect(expr.alias).toBe(null);
  });

  it(".partitionBy() adds partition columns", () => {
    const expr = rowNumber().partitionBy("authorId");

    expect(expr.partitions).toEqual(["authorId"]);
  });

  it(".orderBy() adds order clause", () => {
    const expr = rowNumber().orderBy("createdAt", "desc");

    expect(expr.orders.length).toBe(1);
    expect(expr.orders[0].column).toBe("createdAt");
    expect(expr.orders[0].direction).toBe("desc");
  });

  it(".as() sets alias", () => {
    const expr = rowNumber().as("rn");

    expect(expr.alias).toBe("rn");
  });

  it("methods chain immutably", () => {
    const base = rowNumber();
    const withPartition = base.partitionBy("authorId");
    const withOrder = withPartition.orderBy("createdAt", "desc");
    const withAlias = withOrder.as("rank");

    expect(base.partitions).toEqual([]);
    expect(withPartition.orders).toEqual([]);
    expect(withOrder.alias).toBe(null);
    expect(withAlias.alias).toBe("rank");
  });

  it("is frozen at every step", () => {
    expect(Object.isFrozen(rowNumber())).toBeTruthy();
    expect(Object.isFrozen(rowNumber().partitionBy("x"))).toBeTruthy();
    expect(Object.isFrozen(rowNumber().orderBy("x", "asc"))).toBeTruthy();
    expect(Object.isFrozen(rowNumber().as("y"))).toBeTruthy();
  });
});

describe("rank()", () => {
  it("creates RANK window function", () => {
    expect(rank().fn).toBe("RANK");
  });
});

describe("denseRank()", () => {
  it("creates DENSE_RANK window function", () => {
    expect(denseRank().fn).toBe("DENSE_RANK");
  });
});

// ---------------------------------------------------------------------------
// PostgreSQL: window function compilation
// ---------------------------------------------------------------------------

describe("PostgreSQL window function compilation", () => {
  it("compiles ROW_NUMBER() OVER ()", () => {
    const node = select(rowNumber().as("rn"))(from(Post));
    const result = pgDialect.compileSelect(node);

    expect(result.sql.includes("ROW_NUMBER() OVER ()")).toBeTruthy();
    expect(result.sql.includes('AS "rn"')).toBeTruthy();
  });

  it("compiles PARTITION BY", () => {
    const node = select(
      rowNumber().partitionBy("authorId").orderBy("createdAt", "desc").as("rank"),
    )(from(Post));
    const result = pgDialect.compileSelect(node);

    expect(result.sql.includes('PARTITION BY "posts"."author_id"')).toBeTruthy();
    expect(result.sql.includes('ORDER BY "posts"."created_at" DESC')).toBeTruthy();
    expect(result.sql.includes('AS "rank"')).toBeTruthy();
  });

  it("compiles multiple partition columns", () => {
    const node = select(rowNumber().partitionBy("authorId", "title").as("rn"))(from(Post));
    const result = pgDialect.compileSelect(node);

    expect(result.sql.includes('"author_id"')).toBeTruthy();
    expect(result.sql.includes('"title"')).toBeTruthy();
  });

  it("compiles RANK()", () => {
    const node = select(rank().orderBy("views", "desc").as("r"))(from(Post));
    const result = pgDialect.compileSelect(node);

    expect(result.sql.includes("RANK() OVER")).toBeTruthy();
  });

  it("compiles DENSE_RANK()", () => {
    const node = select(denseRank().orderBy("views", "desc").as("dr"))(from(Post));
    const result = pgDialect.compileSelect(node);

    expect(result.sql.includes("DENSE_RANK() OVER")).toBeTruthy();
  });

  it("mixes window functions with regular columns", () => {
    const node = select(
      "authorId",
      "title",
      rowNumber().partitionBy("authorId").orderBy("createdAt", "desc").as("rn"),
    )(from(Post));
    const result = pgDialect.compileSelect(node);

    expect(result.sql.includes('"posts"."author_id"')).toBeTruthy();
    expect(result.sql.includes('"posts"."title"')).toBeTruthy();
    expect(result.sql.includes("ROW_NUMBER()")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// SQLite: window function compilation
// ---------------------------------------------------------------------------

describe("SQLite window function compilation", () => {
  it("compiles window functions same as PostgreSQL", () => {
    const node = select(rowNumber().partitionBy("authorId").orderBy("views", "desc").as("rn"))(
      from(Post),
    );

    const pg = pgDialect.compileSelect(node);
    const sqlite = sqliteDialect.compileSelect(node);

    expect(pg.sql).toBe(sqlite.sql);
  });
});

// ---------------------------------------------------------------------------
// lazy()
// ---------------------------------------------------------------------------

describe("lazy()", () => {
  it("builds a SelectNode for hasMany relations", () => {
    const record = { id: "u-1", name: "Alice" };
    const node = lazy(User, record, "posts");

    expect(node.tag).toBe("Select");
    expect(node.model.name).toBe("posts");
    expect(node.conditions.length).toBe(1);
    expect(node.conditions[0].tag).toBe("Eq");
    if (node.conditions[0].tag === "Eq") {
      expect(node.conditions[0].column).toBe("authorId");
      expect(node.conditions[0].value).toBe("u-1");
    }
  });

  it("builds a SelectNode for hasOne relations", () => {
    const record = { id: "u-1", name: "Alice" };
    const node = lazy(User, record, "profile");

    expect(node.model.name).toBe("profiles");
    expect(node.conditions.length).toBe(1);
    if (node.conditions[0].tag === "Eq") {
      expect(node.conditions[0].column).toBe("userId");
      expect(node.conditions[0].value).toBe("u-1");
    }
  });

  it("builds a SelectNode for belongsTo relations", () => {
    const record = { id: "p-1", title: "Hello", authorId: "u-1" };
    const node = lazy(Post, record, "author");

    expect(node.model.name).toBe("users");
    if (node.conditions[0].tag === "Eq") {
      expect(node.conditions[0].column).toBe("id");
      expect(node.conditions[0].value).toBe("u-1");
    }
  });

  it("throws for unknown relation", () => {
    expect(() => lazy(User, { id: "u-1" }, "nonexistent")).toThrow();
  });

  it("compiles to correct SQL", () => {
    const node = lazy(User, { id: "u-1", name: "Alice" }, "posts");
    const result = pgDialect.compileSelect(node);

    expect(result.sql.includes('"posts"')).toBeTruthy();
    expect(result.sql.includes('"author_id" = $1')).toBeTruthy();
    expect(result.params).toEqual(["u-1"]);
  });
});
