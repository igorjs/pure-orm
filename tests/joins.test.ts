/**
 * Tests for join builders and dialect compilation of JOIN clauses.
 *
 * Covers: on(), join(), leftJoin(), rightJoin(), fullJoin() builders and
 * their SQL output through both PostgreSQL and SQLite dialects.
 */

import { Schema } from "@igorjs/pure-fx";
import { describe, expect, it } from "@igorjs/pure-test";
import { createPostgresDialect } from "../src/dialect/postgresql.ts";
import { createSqliteDialect } from "../src/dialect/sqlite.ts";
import { Model } from "../src/model/define.ts";
import { Field } from "../src/model/field.ts";
import { from, limit, offset, orderBy, select, where } from "../src/query/builders.ts";
import { eq } from "../src/query/conditions.ts";
import { fullJoin, join, leftJoin, on, rightJoin } from "../src/query/joins.ts";

// ---- Test models ----

const User = Model("users", {
  fields: {
    id: Field(Schema.string, { primaryKey: true }),
    name: Field(Schema.string),
    email: Field(Schema.string, { unique: true }),
    roleId: Field(Schema.string),
  },
});

const Post = Model("posts", {
  fields: {
    id: Field(Schema.string, { primaryKey: true }),
    title: Field(Schema.string),
    body: Field(Schema.string),
    authorId: Field(Schema.string),
    categoryId: Field(Schema.string),
    published: Field(Schema.boolean),
  },
});

const Category = Model("categories", {
  fields: {
    id: Field(Schema.string, { primaryKey: true }),
    name: Field(Schema.string),
    slug: Field(Schema.string),
  },
});

const Role = Model("roles", {
  fields: {
    id: Field(Schema.string, { primaryKey: true }),
    name: Field(Schema.string),
  },
});

const pgDialect = createPostgresDialect();
const sqliteDialect = createSqliteDialect();

// ---------------------------------------------------------------------------
// on()
// ---------------------------------------------------------------------------

describe("on()", () => {
  it("creates a frozen JoinCondition", () => {
    const cond = on("authorId", "id");

    expect(cond.leftColumn).toBe("authorId");
    expect(cond.rightColumn).toBe("id");
    expect(Object.isFrozen(cond)).toBeTruthy();
  });

  it("preserves table-qualified column names", () => {
    const cond = on("Post.authorId", "User.id");

    expect(cond.leftColumn).toBe("Post.authorId");
    expect(cond.rightColumn).toBe("User.id");
  });
});

// ---------------------------------------------------------------------------
// join() builder
// ---------------------------------------------------------------------------

describe("join()", () => {
  it("appends an INNER JOIN clause to the SelectNode", () => {
    const node = join(User, on("authorId", "id"))(from(Post));

    expect(node.joins.length).toBe(1);
    expect(node.joins[0].joinType).toBe("inner");
    expect(node.joins[0].model.name).toBe("users");
  });

  it("preserves all other SelectNode fields", () => {
    const base = from(Post);
    const node = join(User, on("authorId", "id"))(base);

    expect(node.tag).toBe("Select");
    expect(node.model.name).toBe("posts");
    expect(node.columns).toBe("*");
    expect(node.conditions).toEqual([]);
    expect(node.orderBy).toEqual([]);
    expect(node.limit).toBe(null);
    expect(node.offset).toBe(null);
  });

  it("returns a frozen SelectNode", () => {
    const node = join(User, on("authorId", "id"))(from(Post));

    expect(Object.isFrozen(node)).toBeTruthy();
    expect(Object.isFrozen(node.joins)).toBeTruthy();
  });

  it("does NOT mutate the input node", () => {
    const base = from(Post);
    join(User, on("authorId", "id"))(base);

    expect(base.joins.length).toBe(0);
  });

  it("accumulates multiple joins", () => {
    const node = fullJoin(
      Role,
      on("users.roleId", "id"),
    )(leftJoin(Category, on("categoryId", "id"))(join(User, on("authorId", "id"))(from(Post))));

    expect(node.joins.length).toBe(3);
    expect(node.joins[0].joinType).toBe("inner");
    expect(node.joins[0].model.name).toBe("users");
    expect(node.joins[1].joinType).toBe("left");
    expect(node.joins[1].model.name).toBe("categories");
    expect(node.joins[2].joinType).toBe("full");
    expect(node.joins[2].model.name).toBe("roles");
  });
});

// ---------------------------------------------------------------------------
// leftJoin(), rightJoin(), fullJoin()
// ---------------------------------------------------------------------------

describe("leftJoin()", () => {
  it("creates a LEFT join clause", () => {
    const node = leftJoin(User, on("authorId", "id"))(from(Post));

    expect(node.joins[0].joinType).toBe("left");
  });
});

describe("rightJoin()", () => {
  it("creates a RIGHT join clause", () => {
    const node = rightJoin(User, on("authorId", "id"))(from(Post));

    expect(node.joins[0].joinType).toBe("right");
  });
});

describe("fullJoin()", () => {
  it("creates a FULL join clause", () => {
    const node = fullJoin(User, on("authorId", "id"))(from(Post));

    expect(node.joins[0].joinType).toBe("full");
  });
});

// ---------------------------------------------------------------------------
// PostgreSQL dialect: JOIN compilation
// ---------------------------------------------------------------------------

describe("PostgreSQL JOIN compilation", () => {
  it("compiles INNER JOIN with correct SQL", () => {
    const node = join(User, on("authorId", "id"))(from(Post));
    const result = pgDialect.compileSelect(node);

    expect(result.sql).toBe(
      'SELECT "posts".*, "users".* FROM "posts" INNER JOIN "users" ON "posts"."author_id" = "users"."id"',
    );
    expect(result.params).toEqual([]);
  });

  it("compiles LEFT JOIN", () => {
    const node = leftJoin(User, on("authorId", "id"))(from(Post));
    const result = pgDialect.compileSelect(node);

    expect(result.sql.includes("LEFT JOIN")).toBeTruthy();
  });

  it("compiles RIGHT JOIN", () => {
    const node = rightJoin(User, on("authorId", "id"))(from(Post));
    const result = pgDialect.compileSelect(node);

    expect(result.sql.includes("RIGHT JOIN")).toBeTruthy();
  });

  it("compiles FULL JOIN", () => {
    const node = fullJoin(User, on("authorId", "id"))(from(Post));
    const result = pgDialect.compileSelect(node);

    expect(result.sql.includes("FULL JOIN")).toBeTruthy();
  });

  it("places JOIN between FROM and WHERE", () => {
    const node = where(eq("published", true))(join(User, on("authorId", "id"))(from(Post)));
    const result = pgDialect.compileSelect(node);

    const fromPos = result.sql.indexOf("FROM");
    const joinPos = result.sql.indexOf("INNER JOIN");
    const wherePos = result.sql.indexOf("WHERE");

    expect(fromPos < joinPos).toBeTruthy();
    expect(joinPos < wherePos).toBeTruthy();
  });

  it("compiles multiple joins in order", () => {
    const node = leftJoin(
      Category,
      on("categoryId", "id"),
    )(join(User, on("authorId", "id"))(from(Post)));
    const result = pgDialect.compileSelect(node);

    expect(result.sql).toBe(
      'SELECT "posts".*, "users".*, "categories".* FROM "posts" ' +
        'INNER JOIN "users" ON "posts"."author_id" = "users"."id" ' +
        'LEFT JOIN "categories" ON "posts"."category_id" = "categories"."id"',
    );
  });

  it("resolves camelCase field names to snake_case columns in ON clause", () => {
    const node = join(User, on("authorId", "id"))(from(Post));
    const result = pgDialect.compileSelect(node);

    expect(result.sql.includes('"author_id"')).toBeTruthy();
  });

  it("joins compose with where, orderBy, limit, offset", () => {
    const node = offset(5)(
      limit(10)(
        orderBy(
          "title",
          "asc",
        )(where(eq("published", true))(join(User, on("authorId", "id"))(from(Post)))),
      ),
    );
    const result = pgDialect.compileSelect(node);

    expect(result.sql.includes("INNER JOIN")).toBeTruthy();
    expect(result.sql.includes("WHERE")).toBeTruthy();
    expect(result.sql.includes("ORDER BY")).toBeTruthy();
    expect(result.sql.includes("LIMIT")).toBeTruthy();
    expect(result.sql.includes("OFFSET")).toBeTruthy();
    expect(result.params).toEqual([true, 10, 5]);
  });

  it("join with select() projects specific columns from main table only", () => {
    const node = select("title", "body")(join(User, on("authorId", "id"))(from(Post)));
    const result = pgDialect.compileSelect(node);

    // select() currently resolves columns from the main table only.
    expect(result.sql).toBe(
      'SELECT "posts"."title", "posts"."body" FROM "posts" ' +
        'INNER JOIN "users" ON "posts"."author_id" = "users"."id"',
    );
  });

  it("handles table-qualified left column referencing a previously joined table", () => {
    // Post -> join User -> leftJoin Role (on User.roleId = Role.id)
    const node = leftJoin(
      Role,
      on("users.roleId", "id"),
    )(join(User, on("authorId", "id"))(from(Post)));
    const result = pgDialect.compileSelect(node);

    expect(result.sql.includes('"users"."role_id" = "roles"."id"')).toBeTruthy();
  });

  it("SELECT * with joins includes all joined tables", () => {
    const node = join(User, on("authorId", "id"))(from(Post));
    const result = pgDialect.compileSelect(node);

    expect(result.sql.startsWith('SELECT "posts".*, "users".*')).toBeTruthy();
  });

  it("handles join with no additional clauses", () => {
    const node = join(Category, on("categoryId", "id"))(from(Post));
    const result = pgDialect.compileSelect(node);

    expect(result.sql).toBe(
      'SELECT "posts".*, "categories".* FROM "posts" ' +
        'INNER JOIN "categories" ON "posts"."category_id" = "categories"."id"',
    );
    expect(result.params).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// SQLite dialect: JOIN compilation
// ---------------------------------------------------------------------------

describe("SQLite JOIN compilation", () => {
  it("compiles INNER JOIN with ? placeholders", () => {
    const node = where(eq("published", true))(join(User, on("authorId", "id"))(from(Post)));
    const result = sqliteDialect.compileSelect(node);

    expect(result.sql.includes("INNER JOIN")).toBeTruthy();
    expect(result.sql.includes("?")).toBeTruthy();
    expect(!result.sql.includes("$")).toBeTruthy();
  });

  it("compiles LEFT JOIN", () => {
    const node = leftJoin(User, on("authorId", "id"))(from(Post));
    const result = sqliteDialect.compileSelect(node);

    expect(result.sql.includes("LEFT JOIN")).toBeTruthy();
  });

  it("compiles same SQL structure as PostgreSQL (except placeholders)", () => {
    const node = join(User, on("authorId", "id"))(from(Post));

    const pgResult = pgDialect.compileSelect(node);
    const sqliteResult = sqliteDialect.compileSelect(node);

    // Both should have the same SQL minus placeholder differences.
    expect(pgResult.sql).toBe(sqliteResult.sql);
  });

  it("compiles multiple joins in order", () => {
    const node = leftJoin(
      Category,
      on("categoryId", "id"),
    )(join(User, on("authorId", "id"))(from(Post)));
    const result = sqliteDialect.compileSelect(node);

    expect(result.sql.includes("INNER JOIN")).toBeTruthy();
    expect(result.sql.includes("LEFT JOIN")).toBeTruthy();

    const innerPos = result.sql.indexOf("INNER JOIN");
    const leftPos = result.sql.indexOf("LEFT JOIN");
    expect(innerPos < leftPos).toBeTruthy();
  });

  it("resolves camelCase to snake_case in ON clause", () => {
    const node = join(User, on("authorId", "id"))(from(Post));
    const result = sqliteDialect.compileSelect(node);

    expect(result.sql.includes('"author_id"')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("JOIN edge cases", () => {
  it("no joins produces the same SQL as before (no regression)", () => {
    const node = where(eq("name", "Alice"))(from(User));

    const pgResult = pgDialect.compileSelect(node);
    expect(pgResult.sql).toBe('SELECT "users".* FROM "users" WHERE "users"."name" = $1');
    expect(pgResult.params).toEqual(["Alice"]);

    const sqliteResult = sqliteDialect.compileSelect(node);
    expect(sqliteResult.sql).toBe('SELECT "users".* FROM "users" WHERE "users"."name" = ?');
    expect(sqliteResult.params).toEqual(["Alice"]);
  });

  it("from() initialises joins as an empty frozen array", () => {
    const node = from(Post);

    expect(node.joins).toEqual([]);
    expect(Object.isFrozen(node.joins)).toBeTruthy();
  });

  it("unqualified left column falls back to raw field name when not in metadata", () => {
    // Using a column name that doesn't exist in the model metadata.
    const node = join(User, on("unknownField", "id"))(from(Post));
    const result = pgDialect.compileSelect(node);

    // Falls back to using the raw field name.
    expect(result.sql.includes('"unknownField"')).toBeTruthy();
  });

  it("table-qualified left column with unknown table falls back to raw names", () => {
    const node = join(User, on("unknown.someField", "id"))(from(Post));
    const result = pgDialect.compileSelect(node);

    expect(result.sql.includes('"unknown"."someField"')).toBeTruthy();
  });
});
