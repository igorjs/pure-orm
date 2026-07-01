// Copyright 2026 igorjs. SPDX-License-Identifier: Apache-2.0

/**
 * Tests for CTEs (cte()) and subquery conditions (exists, notExists).
 */

import { Schema } from "@igorjs/pure-fx";
import { describe, expect, it } from "@igorjs/pure-test";
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

    expect(node.ctes.length).toBe(1);
    expect(node.ctes[0].name).toBe("active_posts");
    expect(node.ctes[0].query.model.name).toBe("posts");
  });

  it("accumulates multiple CTEs", () => {
    const node = cte("cte2", from(User))(cte("cte1", from(Post))(from(User)));

    expect(node.ctes.length).toBe(2);
    expect(node.ctes[0].name).toBe("cte1");
    expect(node.ctes[1].name).toBe("cte2");
  });

  it("does not mutate the input node", () => {
    const base = from(User);
    cte("x", from(Post))(base);

    expect(base.ctes.length).toBe(0);
  });

  it("returns a frozen SelectNode", () => {
    const node = cte("x", from(Post))(from(User));

    expect(Object.isFrozen(node)).toBeTruthy();
    expect(Object.isFrozen(node.ctes)).toBeTruthy();
  });

  it("from() initialises ctes as empty frozen array", () => {
    const node = from(User);

    expect(node.ctes).toEqual([]);
    expect(Object.isFrozen(node.ctes)).toBeTruthy();
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

    expect(result.sql.startsWith("WITH")).toBeTruthy();
    expect(result.sql.includes('"active_posts" AS')).toBeTruthy();
    expect(result.sql.includes('SELECT "users".*')).toBeTruthy();
  });

  it("renumbers CTE params for PostgreSQL", () => {
    const subquery = where(eq("published", true))(from(Post));
    const node = where(eq("name", "Alice"))(cte("active_posts", subquery)(from(User)));
    const result = pgDialect.compileSelect(node);

    // CTE param is $1 (published=true), outer WHERE is $2 (name=Alice)
    expect(result.sql.includes("$1")).toBeTruthy();
    expect(result.sql.includes("$2")).toBeTruthy();
    expect(result.params).toEqual([true, "Alice"]);
  });

  it("compiles multiple CTEs separated by commas", () => {
    const cte1 = from(Post);
    const cte2 = from(User);
    const node = cte("b", cte2)(cte("a", cte1)(from(User)));
    const result = pgDialect.compileSelect(node);

    expect(result.sql.startsWith("WITH")).toBeTruthy();
    expect(result.sql.includes('"a" AS')).toBeTruthy();
    expect(result.sql.includes('"b" AS')).toBeTruthy();
  });

  it("no CTEs produces normal SQL (regression)", () => {
    const result = pgDialect.compileSelect(from(User));

    expect(!result.sql.includes("WITH")).toBeTruthy();
    expect(result.sql.startsWith('SELECT "users".*')).toBeTruthy();
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

    expect(result.sql.startsWith("WITH")).toBeTruthy();
    expect(result.sql.includes("?")).toBeTruthy();
    expect(result.params).toEqual([true]);
  });
});

// ---------------------------------------------------------------------------
// exists() and notExists()
// ---------------------------------------------------------------------------

describe("exists()", () => {
  it("creates an Exists condition node", () => {
    const subquery = from(Post);
    const cond = exists(subquery);

    expect(cond.tag).toBe("Exists");
  });

  it("is frozen", () => {
    expect(Object.isFrozen(exists(from(Post)))).toBeTruthy();
  });
});

describe("notExists()", () => {
  it("creates a NotExists condition node", () => {
    const cond = notExists(from(Post));

    expect(cond.tag).toBe("NotExists");
  });

  it("is frozen", () => {
    expect(Object.isFrozen(notExists(from(Post)))).toBeTruthy();
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

    expect(result.sql.includes("EXISTS (SELECT")).toBeTruthy();
    expect(result.sql.includes('"posts"')).toBeTruthy();
  });

  it("renumbers params in EXISTS subquery", () => {
    const subquery = where(eq("published", true))(from(Post));
    const node = where(exists(subquery))(where(eq("name", "Alice"))(from(User)));
    const result = pgDialect.compileSelect(node);

    // Outer: name = $1, EXISTS subquery: published = $2
    expect(result.params).toEqual(["Alice", true]);
    expect(result.sql.includes("$1")).toBeTruthy();
    expect(result.sql.includes("$2")).toBeTruthy();
  });

  it("compiles NOT EXISTS", () => {
    const subquery = from(Post);
    const node = where(notExists(subquery))(from(User));
    const result = pgDialect.compileSelect(node);

    expect(result.sql.includes("NOT EXISTS (SELECT")).toBeTruthy();
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

    expect(result.sql.includes("EXISTS (SELECT")).toBeTruthy();
    expect(result.sql.includes("?")).toBeTruthy();
    expect(result.params).toEqual([true]);
  });

  it("compiles NOT EXISTS", () => {
    const subquery = from(Post);
    const node = where(notExists(subquery))(from(User));
    const result = sqliteDialect.compileSelect(node);

    expect(result.sql.includes("NOT EXISTS (SELECT")).toBeTruthy();
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

    expect(result.sql.startsWith("WITH")).toBeTruthy();
    expect(result.sql.includes("EXISTS")).toBeTruthy();
  });
});
