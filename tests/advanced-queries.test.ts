/**
 * Tests for Phase 6 advanced query features: groupBy, having, raw, sql.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Schema } from "@igorjs/pure-ts";
import { createPostgresDialect } from "../src/dialect/postgresql.ts";
import { createSqliteDialect } from "../src/dialect/sqlite.ts";
import { Model } from "../src/model/define.ts";
import { Field } from "../src/model/field.ts";
import { from, groupBy, having, limit, orderBy, where } from "../src/query/builders.ts";
import { eq, gt } from "../src/query/conditions.ts";
import { raw, sql } from "../src/query/raw.ts";

// ---- Test models ----

const Post = Model("posts", {
  fields: {
    id: Field(Schema.string, { primaryKey: true }),
    authorId: Field(Schema.string),
    title: Field(Schema.string),
    views: Field(Schema.number),
    published: Field(Schema.boolean),
  },
});

const User = Model("users", {
  fields: {
    id: Field(Schema.string, { primaryKey: true }),
    name: Field(Schema.string),
    role: Field(Schema.string),
  },
});

const pgDialect = createPostgresDialect();
const sqliteDialect = createSqliteDialect();

// ---------------------------------------------------------------------------
// groupBy()
// ---------------------------------------------------------------------------

describe("groupBy()", () => {
  it("adds columns to the groupBy array", () => {
    const node = groupBy("authorId")(from(Post));

    assert.deepEqual(node.groupBy, ["authorId"]);
  });

  it("accumulates across multiple calls", () => {
    const node = groupBy("published")(groupBy("authorId")(from(Post)));

    assert.deepEqual(node.groupBy, ["authorId", "published"]);
  });

  it("accepts multiple columns in a single call", () => {
    const node = groupBy("authorId", "published")(from(Post));

    assert.deepEqual(node.groupBy, ["authorId", "published"]);
  });

  it("does not mutate the input node", () => {
    const base = from(Post);
    groupBy("authorId")(base);

    assert.deepEqual(base.groupBy, []);
  });

  it("returns a frozen SelectNode", () => {
    const node = groupBy("authorId")(from(Post));

    assert.ok(Object.isFrozen(node));
    assert.ok(Object.isFrozen(node.groupBy));
  });

  it("from() initialises groupBy as empty frozen array", () => {
    const node = from(Post);

    assert.deepEqual(node.groupBy, []);
    assert.ok(Object.isFrozen(node.groupBy));
  });
});

// ---------------------------------------------------------------------------
// having()
// ---------------------------------------------------------------------------

describe("having()", () => {
  it("adds a condition to the having array", () => {
    const node = having(gt("views", 100))(from(Post));

    assert.equal(node.having.length, 1);
    assert.equal(node.having[0].tag, "Gt");
  });

  it("accumulates across multiple calls", () => {
    const node = having(eq("published", true))(having(gt("views", 100))(from(Post)));

    assert.equal(node.having.length, 2);
  });

  it("does not mutate the input node", () => {
    const base = from(Post);
    having(gt("views", 100))(base);

    assert.deepEqual(base.having, []);
  });

  it("returns a frozen SelectNode", () => {
    const node = having(gt("views", 100))(from(Post));

    assert.ok(Object.isFrozen(node));
    assert.ok(Object.isFrozen(node.having));
  });

  it("from() initialises having as empty frozen array", () => {
    const node = from(Post);

    assert.deepEqual(node.having, []);
    assert.ok(Object.isFrozen(node.having));
  });
});

// ---------------------------------------------------------------------------
// PostgreSQL: GROUP BY / HAVING compilation
// ---------------------------------------------------------------------------

describe("PostgreSQL GROUP BY / HAVING compilation", () => {
  it("compiles GROUP BY with column name resolution", () => {
    const node = groupBy("authorId")(from(Post));
    const result = pgDialect.compileSelect(node);

    assert.ok(result.sql.includes('GROUP BY "posts"."author_id"'));
  });

  it("compiles multiple GROUP BY columns", () => {
    const node = groupBy("authorId", "published")(from(Post));
    const result = pgDialect.compileSelect(node);

    assert.ok(result.sql.includes('GROUP BY "posts"."author_id", "posts"."published"'));
  });

  it("places GROUP BY after WHERE", () => {
    const node = groupBy("authorId")(where(eq("published", true))(from(Post)));
    const result = pgDialect.compileSelect(node);

    const wherePos = result.sql.indexOf("WHERE");
    const groupPos = result.sql.indexOf("GROUP BY");
    assert.ok(wherePos < groupPos, "GROUP BY should come after WHERE");
  });

  it("compiles HAVING clause", () => {
    const node = having(gt("views", 100))(groupBy("authorId")(from(Post)));
    const result = pgDialect.compileSelect(node);

    assert.ok(result.sql.includes("HAVING"));
    assert.ok(result.sql.includes('"views" > $1'));
    assert.deepEqual(result.params, [100]);
  });

  it("places HAVING after GROUP BY and before ORDER BY", () => {
    const node = orderBy(
      "authorId",
      "asc",
    )(having(gt("views", 100))(groupBy("authorId")(from(Post))));
    const result = pgDialect.compileSelect(node);

    const groupPos = result.sql.indexOf("GROUP BY");
    const havingPos = result.sql.indexOf("HAVING");
    const orderPos = result.sql.indexOf("ORDER BY");

    assert.ok(groupPos < havingPos, "HAVING should come after GROUP BY");
    assert.ok(havingPos < orderPos, "HAVING should come before ORDER BY");
  });

  it("no GROUP BY produces same SQL as before (regression)", () => {
    const node = where(eq("role", "admin"))(from(User));
    const result = pgDialect.compileSelect(node);

    assert.ok(!result.sql.includes("GROUP BY"));
    assert.ok(!result.sql.includes("HAVING"));
    assert.equal(result.sql, 'SELECT "users".* FROM "users" WHERE "users"."role" = $1');
  });

  it("composes all clauses correctly", () => {
    const node = limit(10)(
      orderBy(
        "authorId",
        "asc",
      )(having(gt("views", 50))(groupBy("authorId")(where(eq("published", true))(from(Post))))),
    );
    const result = pgDialect.compileSelect(node);

    assert.ok(result.sql.includes("WHERE"));
    assert.ok(result.sql.includes("GROUP BY"));
    assert.ok(result.sql.includes("HAVING"));
    assert.ok(result.sql.includes("ORDER BY"));
    assert.ok(result.sql.includes("LIMIT"));
    assert.deepEqual(result.params, [true, 50, 10]);
  });
});

// ---------------------------------------------------------------------------
// SQLite: GROUP BY / HAVING compilation
// ---------------------------------------------------------------------------

describe("SQLite GROUP BY / HAVING compilation", () => {
  it("compiles GROUP BY", () => {
    const node = groupBy("authorId")(from(Post));
    const result = sqliteDialect.compileSelect(node);

    assert.ok(result.sql.includes('GROUP BY "posts"."author_id"'));
  });

  it("compiles HAVING with ? placeholders", () => {
    const node = having(gt("views", 100))(groupBy("authorId")(from(Post)));
    const result = sqliteDialect.compileSelect(node);

    assert.ok(result.sql.includes("HAVING"));
    assert.ok(result.sql.includes("?"));
    assert.deepEqual(result.params, [100]);
  });
});

// ---------------------------------------------------------------------------
// raw()
// ---------------------------------------------------------------------------

describe("raw()", () => {
  it("creates a RawNode with SQL and params", () => {
    const node = raw("SELECT * FROM users WHERE id = $1", ["user-1"]);

    assert.equal(node.tag, "Raw");
    assert.equal(node.sql, "SELECT * FROM users WHERE id = $1");
    assert.deepEqual(node.params, ["user-1"]);
  });

  it("defaults params to empty array", () => {
    const node = raw("SELECT 1");

    assert.deepEqual(node.params, []);
  });

  it("is frozen", () => {
    const node = raw("SELECT 1", [42]);

    assert.ok(Object.isFrozen(node));
    assert.ok(Object.isFrozen(node.params));
  });

  it("passes through to compile() without modification", () => {
    const node = raw('SELECT * FROM "users" WHERE id = $1', ["user-1"]);

    // RawNode bypasses dialect compilation; compile() returns it as-is.
    assert.equal(node.sql, 'SELECT * FROM "users" WHERE id = $1');
    assert.deepEqual(node.params, ["user-1"]);
  });
});

// ---------------------------------------------------------------------------
// sql`` tagged template
// ---------------------------------------------------------------------------

describe("sql`` tagged template", () => {
  it("creates a RawNode from a template literal", () => {
    const email = "alice@example.com";
    const node = sql`SELECT * FROM users WHERE email = ${email}`;

    assert.equal(node.tag, "Raw");
    assert.deepEqual(node.params, ["alice@example.com"]);
  });

  it("replaces interpolated values with ? placeholders", () => {
    const email = "alice@example.com";
    const age = 25;
    const node = sql`SELECT * FROM users WHERE email = ${email} AND age > ${age}`;

    assert.ok(node.sql.includes("?"));
    assert.ok(!node.sql.includes("alice@example.com"), "Should not interpolate value into SQL");
    assert.deepEqual(node.params, ["alice@example.com", 25]);
  });

  it("handles multiple interpolations", () => {
    const a = 1;
    const b = 2;
    const c = 3;
    const node = sql`SELECT ${a}, ${b}, ${c}`;

    assert.deepEqual(node.params, [1, 2, 3]);
    assert.equal(node.sql.split("?").length - 1, 3); // 3 placeholders
  });

  it("handles no interpolations", () => {
    const node = sql`SELECT 1`;

    assert.equal(node.sql, "SELECT 1");
    assert.deepEqual(node.params, []);
  });

  it("is frozen", () => {
    const node = sql`SELECT ${42}`;

    assert.ok(Object.isFrozen(node));
    assert.ok(Object.isFrozen(node.params));
  });
});
