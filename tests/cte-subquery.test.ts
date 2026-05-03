/**
 * Tests for CTEs (cte()) and subquery conditions (exists, notExists).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Schema } from "@igorjs/pure-fx";
import { createPostgresDialect } from "../src/dialect/postgresql.ts";
import { createSqliteDialect } from "../src/dialect/sqlite.ts";
import { Model } from "../src/model/define.ts";
import { Field } from "../src/model/field.ts";
import { from, where } from "../src/query/builders.ts";
import { eq } from "../src/query/conditions.ts";
import { withCte as cte } from "../src/query/cte.ts";
import { exists, notExists } from "../src/query/subquery.ts";

// ---- Test models ----

const User = Model("users", {
  fields: {
    id: Field(Schema.string, { primaryKey: true }),
    name: Field(Schema.string),
    email: Field(Schema.string),
  },
});

const Post = Model("posts", {
  fields: {
    id: Field(Schema.string, { primaryKey: true }),
    title: Field(Schema.string),
    authorId: Field(Schema.string),
    published: Field(Schema.boolean),
  },
});

const pgDialect = createPostgresDialect();
const sqliteDialect = createSqliteDialect();

// ---------------------------------------------------------------------------
// cte() builder
// ---------------------------------------------------------------------------

describe("cte()", () => {
  it("adds a CTE to the SelectNode", () => {
    const subquery = from(Post);
    const node = cte("active_posts", subquery)(from(User));

    assert.equal(node.ctes.length, 1);
    assert.equal(node.ctes[0].name, "active_posts");
    assert.equal(node.ctes[0].query.model.name, "posts");
  });

  it("accumulates multiple CTEs", () => {
    const node = cte("cte2", from(User))(cte("cte1", from(Post))(from(User)));

    assert.equal(node.ctes.length, 2);
    assert.equal(node.ctes[0].name, "cte1");
    assert.equal(node.ctes[1].name, "cte2");
  });

  it("does not mutate the input node", () => {
    const base = from(User);
    cte("x", from(Post))(base);

    assert.equal(base.ctes.length, 0);
  });

  it("returns a frozen SelectNode", () => {
    const node = cte("x", from(Post))(from(User));

    assert.ok(Object.isFrozen(node));
    assert.ok(Object.isFrozen(node.ctes));
  });

  it("from() initialises ctes as empty frozen array", () => {
    const node = from(User);

    assert.deepEqual(node.ctes, []);
    assert.ok(Object.isFrozen(node.ctes));
  });
});

// ---------------------------------------------------------------------------
// PostgreSQL: CTE compilation
// ---------------------------------------------------------------------------

describe("PostgreSQL CTE compilation", () => {
  it("compiles WITH clause before SELECT", () => {
    const subquery = where(eq("published", true))(from(Post));
    const node = cte("active_posts", subquery)(from(User));
    const result = pgDialect.compileSelect(node);

    assert.ok(result.sql.startsWith("WITH"));
    assert.ok(result.sql.includes('"active_posts" AS'));
    assert.ok(result.sql.includes('SELECT "users".*'));
  });

  it("renumbers CTE params for PostgreSQL", () => {
    const subquery = where(eq("published", true))(from(Post));
    const node = where(eq("name", "Alice"))(cte("active_posts", subquery)(from(User)));
    const result = pgDialect.compileSelect(node);

    // CTE param is $1 (published=true), outer WHERE is $2 (name=Alice)
    assert.ok(result.sql.includes("$1"));
    assert.ok(result.sql.includes("$2"));
    assert.deepEqual(result.params, [true, "Alice"]);
  });

  it("compiles multiple CTEs separated by commas", () => {
    const cte1 = from(Post);
    const cte2 = from(User);
    const node = cte("b", cte2)(cte("a", cte1)(from(User)));
    const result = pgDialect.compileSelect(node);

    assert.ok(result.sql.startsWith("WITH"));
    assert.ok(result.sql.includes('"a" AS'));
    assert.ok(result.sql.includes('"b" AS'));
  });

  it("no CTEs produces normal SQL (regression)", () => {
    const result = pgDialect.compileSelect(from(User));

    assert.ok(!result.sql.includes("WITH"));
    assert.ok(result.sql.startsWith('SELECT "users".*'));
  });
});

// ---------------------------------------------------------------------------
// SQLite: CTE compilation
// ---------------------------------------------------------------------------

describe("SQLite CTE compilation", () => {
  it("compiles WITH clause", () => {
    const subquery = where(eq("published", true))(from(Post));
    const node = cte("active_posts", subquery)(from(User));
    const result = sqliteDialect.compileSelect(node);

    assert.ok(result.sql.startsWith("WITH"));
    assert.ok(result.sql.includes("?"));
    assert.deepEqual(result.params, [true]);
  });
});

// ---------------------------------------------------------------------------
// exists() and notExists()
// ---------------------------------------------------------------------------

describe("exists()", () => {
  it("creates an Exists condition node", () => {
    const subquery = from(Post);
    const cond = exists(subquery);

    assert.equal(cond.tag, "Exists");
  });

  it("is frozen", () => {
    assert.ok(Object.isFrozen(exists(from(Post))));
  });
});

describe("notExists()", () => {
  it("creates a NotExists condition node", () => {
    const cond = notExists(from(Post));

    assert.equal(cond.tag, "NotExists");
  });

  it("is frozen", () => {
    assert.ok(Object.isFrozen(notExists(from(Post))));
  });
});

// ---------------------------------------------------------------------------
// PostgreSQL: EXISTS compilation
// ---------------------------------------------------------------------------

describe("PostgreSQL EXISTS compilation", () => {
  it("compiles EXISTS (subquery) in WHERE", () => {
    const subquery = where(eq("authorId", "u-1"))(from(Post));
    const node = where(exists(subquery))(from(User));
    const result = pgDialect.compileSelect(node);

    assert.ok(result.sql.includes("EXISTS (SELECT"));
    assert.ok(result.sql.includes('"posts"'));
  });

  it("renumbers params in EXISTS subquery", () => {
    const subquery = where(eq("published", true))(from(Post));
    const node = where(exists(subquery))(where(eq("name", "Alice"))(from(User)));
    const result = pgDialect.compileSelect(node);

    // Outer: name = $1, EXISTS subquery: published = $2
    assert.deepEqual(result.params, ["Alice", true]);
    assert.ok(result.sql.includes("$1"));
    assert.ok(result.sql.includes("$2"));
  });

  it("compiles NOT EXISTS", () => {
    const subquery = from(Post);
    const node = where(notExists(subquery))(from(User));
    const result = pgDialect.compileSelect(node);

    assert.ok(result.sql.includes("NOT EXISTS (SELECT"));
  });
});

// ---------------------------------------------------------------------------
// SQLite: EXISTS compilation
// ---------------------------------------------------------------------------

describe("SQLite EXISTS compilation", () => {
  it("compiles EXISTS with ? placeholders", () => {
    const subquery = where(eq("published", true))(from(Post));
    const node = where(exists(subquery))(from(User));
    const result = sqliteDialect.compileSelect(node);

    assert.ok(result.sql.includes("EXISTS (SELECT"));
    assert.ok(result.sql.includes("?"));
    assert.deepEqual(result.params, [true]);
  });

  it("compiles NOT EXISTS", () => {
    const subquery = from(Post);
    const node = where(notExists(subquery))(from(User));
    const result = sqliteDialect.compileSelect(node);

    assert.ok(result.sql.includes("NOT EXISTS (SELECT"));
  });
});

// ---------------------------------------------------------------------------
// Composition: CTE + EXISTS
// ---------------------------------------------------------------------------

describe("CTE + EXISTS composition", () => {
  it("composes CTEs and EXISTS in the same query", () => {
    const activePosts = where(eq("published", true))(from(Post));
    const postExists = exists(where(eq("authorId", "u-1"))(from(Post)));

    const node = where(postExists)(cte("active", activePosts)(from(User)));
    const result = pgDialect.compileSelect(node);

    assert.ok(result.sql.startsWith("WITH"));
    assert.ok(result.sql.includes("EXISTS"));
  });
});
