/**
 * Tests for Phase 6 advanced query features: groupBy, having, raw, sql.
 */

import { Schema } from "@igorjs/pure-fx";
import { describe, expect, it } from "@igorjs/pure-test";
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

    expect(node.groupBy).toEqual(["authorId"]);
  });

  it("accumulates across multiple calls", () => {
    const node = groupBy("published")(groupBy("authorId")(from(Post)));

    expect(node.groupBy).toEqual(["authorId", "published"]);
  });

  it("accepts multiple columns in a single call", () => {
    const node = groupBy("authorId", "published")(from(Post));

    expect(node.groupBy).toEqual(["authorId", "published"]);
  });

  it("does not mutate the input node", () => {
    const base = from(Post);
    groupBy("authorId")(base);

    expect(base.groupBy).toEqual([]);
  });

  it("returns a frozen SelectNode", () => {
    const node = groupBy("authorId")(from(Post));

    expect(Object.isFrozen(node)).toBeTruthy();
    expect(Object.isFrozen(node.groupBy)).toBeTruthy();
  });

  it("from() initialises groupBy as empty frozen array", () => {
    const node = from(Post);

    expect(node.groupBy).toEqual([]);
    expect(Object.isFrozen(node.groupBy)).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// having()
// ---------------------------------------------------------------------------

describe("having()", () => {
  it("adds a condition to the having array", () => {
    const node = having(gt("views", 100))(from(Post));

    expect(node.having.length).toBe(1);
    expect(node.having[0].tag).toBe("Gt");
  });

  it("accumulates across multiple calls", () => {
    const node = having(eq("published", true))(having(gt("views", 100))(from(Post)));

    expect(node.having.length).toBe(2);
  });

  it("does not mutate the input node", () => {
    const base = from(Post);
    having(gt("views", 100))(base);

    expect(base.having).toEqual([]);
  });

  it("returns a frozen SelectNode", () => {
    const node = having(gt("views", 100))(from(Post));

    expect(Object.isFrozen(node)).toBeTruthy();
    expect(Object.isFrozen(node.having)).toBeTruthy();
  });

  it("from() initialises having as empty frozen array", () => {
    const node = from(Post);

    expect(node.having).toEqual([]);
    expect(Object.isFrozen(node.having)).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// PostgreSQL: GROUP BY / HAVING compilation
// ---------------------------------------------------------------------------

describe("PostgreSQL GROUP BY / HAVING compilation", () => {
  it("compiles GROUP BY with column name resolution", () => {
    const node = groupBy("authorId")(from(Post));
    const result = pgDialect.compileSelect(node);

    expect(result.sql.includes('GROUP BY "posts"."author_id"')).toBeTruthy();
  });

  it("compiles multiple GROUP BY columns", () => {
    const node = groupBy("authorId", "published")(from(Post));
    const result = pgDialect.compileSelect(node);

    expect(result.sql.includes('GROUP BY "posts"."author_id", "posts"."published"')).toBeTruthy();
  });

  it("places GROUP BY after WHERE", () => {
    const node = groupBy("authorId")(where(eq("published", true))(from(Post)));
    const result = pgDialect.compileSelect(node);

    const wherePos = result.sql.indexOf("WHERE");
    const groupPos = result.sql.indexOf("GROUP BY");
    expect(wherePos < groupPos).toBeTruthy();
  });

  it("compiles HAVING clause", () => {
    const node = having(gt("views", 100))(groupBy("authorId")(from(Post)));
    const result = pgDialect.compileSelect(node);

    expect(result.sql.includes("HAVING")).toBeTruthy();
    expect(result.sql.includes('"views" > $1')).toBeTruthy();
    expect(result.params).toEqual([100]);
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

    expect(groupPos < havingPos).toBeTruthy();
    expect(havingPos < orderPos).toBeTruthy();
  });

  it("no GROUP BY produces same SQL as before (regression)", () => {
    const node = where(eq("role", "admin"))(from(User));
    const result = pgDialect.compileSelect(node);

    expect(!result.sql.includes("GROUP BY")).toBeTruthy();
    expect(!result.sql.includes("HAVING")).toBeTruthy();
    expect(result.sql).toBe('SELECT "users".* FROM "users" WHERE "users"."role" = $1');
  });

  it("composes all clauses correctly", () => {
    const node = limit(10)(
      orderBy(
        "authorId",
        "asc",
      )(having(gt("views", 50))(groupBy("authorId")(where(eq("published", true))(from(Post))))),
    );
    const result = pgDialect.compileSelect(node);

    expect(result.sql.includes("WHERE")).toBeTruthy();
    expect(result.sql.includes("GROUP BY")).toBeTruthy();
    expect(result.sql.includes("HAVING")).toBeTruthy();
    expect(result.sql.includes("ORDER BY")).toBeTruthy();
    expect(result.sql.includes("LIMIT")).toBeTruthy();
    expect(result.params).toEqual([true, 50, 10]);
  });
});

// ---------------------------------------------------------------------------
// SQLite: GROUP BY / HAVING compilation
// ---------------------------------------------------------------------------

describe("SQLite GROUP BY / HAVING compilation", () => {
  it("compiles GROUP BY", () => {
    const node = groupBy("authorId")(from(Post));
    const result = sqliteDialect.compileSelect(node);

    expect(result.sql.includes('GROUP BY "posts"."author_id"')).toBeTruthy();
  });

  it("compiles HAVING with ? placeholders", () => {
    const node = having(gt("views", 100))(groupBy("authorId")(from(Post)));
    const result = sqliteDialect.compileSelect(node);

    expect(result.sql.includes("HAVING")).toBeTruthy();
    expect(result.sql.includes("?")).toBeTruthy();
    expect(result.params).toEqual([100]);
  });
});

// ---------------------------------------------------------------------------
// raw()
// ---------------------------------------------------------------------------

describe("raw()", () => {
  it("creates a RawNode with SQL and params", () => {
    const node = raw("SELECT * FROM users WHERE id = $1", ["user-1"]);

    expect(node.tag).toBe("Raw");
    expect(node.sql).toBe("SELECT * FROM users WHERE id = $1");
    expect(node.params).toEqual(["user-1"]);
  });

  it("defaults params to empty array", () => {
    const node = raw("SELECT 1");

    expect(node.params).toEqual([]);
  });

  it("is frozen", () => {
    const node = raw("SELECT 1", [42]);

    expect(Object.isFrozen(node)).toBeTruthy();
    expect(Object.isFrozen(node.params)).toBeTruthy();
  });

  it("passes through to compile() without modification", () => {
    const node = raw('SELECT * FROM "users" WHERE id = $1', ["user-1"]);

    // RawNode bypasses dialect compilation; compile() returns it as-is.
    expect(node.sql).toBe('SELECT * FROM "users" WHERE id = $1');
    expect(node.params).toEqual(["user-1"]);
  });
});

// ---------------------------------------------------------------------------
// sql`` tagged template
// ---------------------------------------------------------------------------

describe("sql`` tagged template", () => {
  it("creates a RawNode from a template literal", () => {
    const email = "alice@example.com";
    const node = sql`SELECT * FROM users WHERE email = ${email}`;

    expect(node.tag).toBe("Raw");
    expect(node.params).toEqual(["alice@example.com"]);
  });

  it("replaces interpolated values with ? placeholders", () => {
    const email = "alice@example.com";
    const age = 25;
    const node = sql`SELECT * FROM users WHERE email = ${email} AND age > ${age}`;

    expect(node.sql.includes("?")).toBeTruthy();
    expect(!node.sql.includes("alice@example.com")).toBeTruthy();
    expect(node.params).toEqual(["alice@example.com", 25]);
  });

  it("handles multiple interpolations", () => {
    const a = 1;
    const b = 2;
    const c = 3;
    const node = sql`SELECT ${a}, ${b}, ${c}`;

    expect(node.params).toEqual([1, 2, 3]);
    expect(node.sql.split("?").length - 1).toBe(3); // 3 placeholders
  });

  it("handles no interpolations", () => {
    const node = sql`SELECT 1`;

    expect(node.sql).toBe("SELECT 1");
    expect(node.params).toEqual([]);
  });

  it("is frozen", () => {
    const node = sql`SELECT ${42}`;

    expect(Object.isFrozen(node)).toBeTruthy();
    expect(Object.isFrozen(node.params)).toBeTruthy();
  });
});
