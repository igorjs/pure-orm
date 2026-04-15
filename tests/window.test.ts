/**
 * Tests for window function expressions and lazy relation loading.
 */

import { Schema } from "@igorjs/pure-ts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
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

    assert.equal(expr.tag, "Window");
    assert.equal(expr.fn, "ROW_NUMBER");
    assert.deepEqual(expr.partitions, []);
    assert.deepEqual(expr.orders, []);
    assert.equal(expr.alias, null);
  });

  it(".partitionBy() adds partition columns", () => {
    const expr = rowNumber().partitionBy("authorId");

    assert.deepEqual(expr.partitions, ["authorId"]);
  });

  it(".orderBy() adds order clause", () => {
    const expr = rowNumber().orderBy("createdAt", "desc");

    assert.equal(expr.orders.length, 1);
    assert.equal(expr.orders[0].column, "createdAt");
    assert.equal(expr.orders[0].direction, "desc");
  });

  it(".as() sets alias", () => {
    const expr = rowNumber().as("rn");

    assert.equal(expr.alias, "rn");
  });

  it("methods chain immutably", () => {
    const base = rowNumber();
    const withPartition = base.partitionBy("authorId");
    const withOrder = withPartition.orderBy("createdAt", "desc");
    const withAlias = withOrder.as("rank");

    assert.deepEqual(base.partitions, []);
    assert.deepEqual(withPartition.orders, []);
    assert.equal(withOrder.alias, null);
    assert.equal(withAlias.alias, "rank");
  });

  it("is frozen at every step", () => {
    assert.ok(Object.isFrozen(rowNumber()));
    assert.ok(Object.isFrozen(rowNumber().partitionBy("x")));
    assert.ok(Object.isFrozen(rowNumber().orderBy("x", "asc")));
    assert.ok(Object.isFrozen(rowNumber().as("y")));
  });
});

describe("rank()", () => {
  it("creates RANK window function", () => {
    assert.equal(rank().fn, "RANK");
  });
});

describe("denseRank()", () => {
  it("creates DENSE_RANK window function", () => {
    assert.equal(denseRank().fn, "DENSE_RANK");
  });
});

// ---------------------------------------------------------------------------
// PostgreSQL: window function compilation
// ---------------------------------------------------------------------------

describe("PostgreSQL window function compilation", () => {
  it("compiles ROW_NUMBER() OVER ()", () => {
    const node = select(rowNumber().as("rn"))(from(Post));
    const result = pgDialect.compileSelect(node);

    assert.ok(result.sql.includes("ROW_NUMBER() OVER ()"));
    assert.ok(result.sql.includes("AS \"rn\""));
  });

  it("compiles PARTITION BY", () => {
    const node = select(
      rowNumber().partitionBy("authorId").orderBy("createdAt", "desc").as("rank"),
    )(from(Post));
    const result = pgDialect.compileSelect(node);

    assert.ok(result.sql.includes("PARTITION BY \"posts\".\"author_id\""));
    assert.ok(result.sql.includes("ORDER BY \"posts\".\"created_at\" DESC"));
    assert.ok(result.sql.includes("AS \"rank\""));
  });

  it("compiles multiple partition columns", () => {
    const node = select(
      rowNumber().partitionBy("authorId", "title").as("rn"),
    )(from(Post));
    const result = pgDialect.compileSelect(node);

    assert.ok(result.sql.includes("\"author_id\""));
    assert.ok(result.sql.includes("\"title\""));
  });

  it("compiles RANK()", () => {
    const node = select(rank().orderBy("views", "desc").as("r"))(from(Post));
    const result = pgDialect.compileSelect(node);

    assert.ok(result.sql.includes("RANK() OVER"));
  });

  it("compiles DENSE_RANK()", () => {
    const node = select(denseRank().orderBy("views", "desc").as("dr"))(from(Post));
    const result = pgDialect.compileSelect(node);

    assert.ok(result.sql.includes("DENSE_RANK() OVER"));
  });

  it("mixes window functions with regular columns", () => {
    const node = select(
      "authorId",
      "title",
      rowNumber().partitionBy("authorId").orderBy("createdAt", "desc").as("rn"),
    )(from(Post));
    const result = pgDialect.compileSelect(node);

    assert.ok(result.sql.includes("\"posts\".\"author_id\""));
    assert.ok(result.sql.includes("\"posts\".\"title\""));
    assert.ok(result.sql.includes("ROW_NUMBER()"));
  });
});

// ---------------------------------------------------------------------------
// SQLite: window function compilation
// ---------------------------------------------------------------------------

describe("SQLite window function compilation", () => {
  it("compiles window functions same as PostgreSQL", () => {
    const node = select(
      rowNumber().partitionBy("authorId").orderBy("views", "desc").as("rn"),
    )(from(Post));

    const pg = pgDialect.compileSelect(node);
    const sqlite = sqliteDialect.compileSelect(node);

    assert.equal(pg.sql, sqlite.sql);
  });
});

// ---------------------------------------------------------------------------
// lazy()
// ---------------------------------------------------------------------------

describe("lazy()", () => {
  it("builds a SelectNode for hasMany relations", () => {
    const record = { id: "u-1", name: "Alice" };
    const node = lazy(User, record, "posts");

    assert.equal(node.tag, "Select");
    assert.equal(node.model.name, "posts");
    assert.equal(node.conditions.length, 1);
    assert.equal(node.conditions[0].tag, "Eq");
    if (node.conditions[0].tag === "Eq") {
      assert.equal(node.conditions[0].column, "authorId");
      assert.equal(node.conditions[0].value, "u-1");
    }
  });

  it("builds a SelectNode for hasOne relations", () => {
    const record = { id: "u-1", name: "Alice" };
    const node = lazy(User, record, "profile");

    assert.equal(node.model.name, "profiles");
    assert.equal(node.conditions.length, 1);
    if (node.conditions[0].tag === "Eq") {
      assert.equal(node.conditions[0].column, "userId");
      assert.equal(node.conditions[0].value, "u-1");
    }
  });

  it("builds a SelectNode for belongsTo relations", () => {
    const record = { id: "p-1", title: "Hello", authorId: "u-1" };
    const node = lazy(Post, record, "author");

    assert.equal(node.model.name, "users");
    if (node.conditions[0].tag === "Eq") {
      assert.equal(node.conditions[0].column, "id");
      assert.equal(node.conditions[0].value, "u-1");
    }
  });

  it("throws for unknown relation", () => {
    assert.throws(
      () => lazy(User, { id: "u-1" }, "nonexistent"),
      { message: /not found/ },
    );
  });

  it("compiles to correct SQL", () => {
    const node = lazy(User, { id: "u-1", name: "Alice" }, "posts");
    const result = pgDialect.compileSelect(node);

    assert.ok(result.sql.includes("\"posts\""));
    assert.ok(result.sql.includes("\"author_id\" = $1"));
    assert.deepEqual(result.params, ["u-1"]);
  });
});
