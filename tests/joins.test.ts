/**
 * Tests for join builders and dialect compilation of JOIN clauses.
 *
 * Covers: on(), join(), leftJoin(), rightJoin(), fullJoin() builders and
 * their SQL output through both PostgreSQL and SQLite dialects.
 */

import { Schema } from "@igorjs/pure-ts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
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

    assert.equal(cond.leftColumn, "authorId");
    assert.equal(cond.rightColumn, "id");
    assert.ok(Object.isFrozen(cond));
  });

  it("preserves table-qualified column names", () => {
    const cond = on("Post.authorId", "User.id");

    assert.equal(cond.leftColumn, "Post.authorId");
    assert.equal(cond.rightColumn, "User.id");
  });
});

// ---------------------------------------------------------------------------
// join() builder
// ---------------------------------------------------------------------------

describe("join()", () => {
  it("appends an INNER JOIN clause to the SelectNode", () => {
    const node = join(User, on("authorId", "id"))(from(Post));

    assert.equal(node.joins.length, 1);
    assert.equal(node.joins[0].joinType, "inner");
    assert.equal(node.joins[0].model.name, "users");
  });

  it("preserves all other SelectNode fields", () => {
    const base = from(Post);
    const node = join(User, on("authorId", "id"))(base);

    assert.equal(node.tag, "Select");
    assert.equal(node.model.name, "posts");
    assert.equal(node.columns, "*");
    assert.deepEqual(node.conditions, []);
    assert.deepEqual(node.orderBy, []);
    assert.equal(node.limit, null);
    assert.equal(node.offset, null);
  });

  it("returns a frozen SelectNode", () => {
    const node = join(User, on("authorId", "id"))(from(Post));

    assert.ok(Object.isFrozen(node));
    assert.ok(Object.isFrozen(node.joins));
  });

  it("does NOT mutate the input node", () => {
    const base = from(Post);
    join(User, on("authorId", "id"))(base);

    assert.equal(base.joins.length, 0);
  });

  it("accumulates multiple joins", () => {
    const node = fullJoin(Role, on("users.roleId", "id"))(
      leftJoin(Category, on("categoryId", "id"))(
        join(User, on("authorId", "id"))(from(Post)),
      ),
    );

    assert.equal(node.joins.length, 3);
    assert.equal(node.joins[0].joinType, "inner");
    assert.equal(node.joins[0].model.name, "users");
    assert.equal(node.joins[1].joinType, "left");
    assert.equal(node.joins[1].model.name, "categories");
    assert.equal(node.joins[2].joinType, "full");
    assert.equal(node.joins[2].model.name, "roles");
  });
});

// ---------------------------------------------------------------------------
// leftJoin(), rightJoin(), fullJoin()
// ---------------------------------------------------------------------------

describe("leftJoin()", () => {
  it("creates a LEFT join clause", () => {
    const node = leftJoin(User, on("authorId", "id"))(from(Post));

    assert.equal(node.joins[0].joinType, "left");
  });
});

describe("rightJoin()", () => {
  it("creates a RIGHT join clause", () => {
    const node = rightJoin(User, on("authorId", "id"))(from(Post));

    assert.equal(node.joins[0].joinType, "right");
  });
});

describe("fullJoin()", () => {
  it("creates a FULL join clause", () => {
    const node = fullJoin(User, on("authorId", "id"))(from(Post));

    assert.equal(node.joins[0].joinType, "full");
  });
});

// ---------------------------------------------------------------------------
// PostgreSQL dialect: JOIN compilation
// ---------------------------------------------------------------------------

describe("PostgreSQL JOIN compilation", () => {
  it("compiles INNER JOIN with correct SQL", () => {
    const node = join(User, on("authorId", "id"))(from(Post));
    const result = pgDialect.compileSelect(node);

    assert.equal(
      result.sql,
      "SELECT \"posts\".*, \"users\".* FROM \"posts\" INNER JOIN \"users\" ON \"posts\".\"author_id\" = \"users\".\"id\"",
    );
    assert.deepEqual(result.params, []);
  });

  it("compiles LEFT JOIN", () => {
    const node = leftJoin(User, on("authorId", "id"))(from(Post));
    const result = pgDialect.compileSelect(node);

    assert.ok(result.sql.includes("LEFT JOIN"));
  });

  it("compiles RIGHT JOIN", () => {
    const node = rightJoin(User, on("authorId", "id"))(from(Post));
    const result = pgDialect.compileSelect(node);

    assert.ok(result.sql.includes("RIGHT JOIN"));
  });

  it("compiles FULL JOIN", () => {
    const node = fullJoin(User, on("authorId", "id"))(from(Post));
    const result = pgDialect.compileSelect(node);

    assert.ok(result.sql.includes("FULL JOIN"));
  });

  it("places JOIN between FROM and WHERE", () => {
    const node = where(eq("published", true))(
      join(User, on("authorId", "id"))(from(Post)),
    );
    const result = pgDialect.compileSelect(node);

    const fromPos = result.sql.indexOf("FROM");
    const joinPos = result.sql.indexOf("INNER JOIN");
    const wherePos = result.sql.indexOf("WHERE");

    assert.ok(fromPos < joinPos, "JOIN should come after FROM");
    assert.ok(joinPos < wherePos, "JOIN should come before WHERE");
  });

  it("compiles multiple joins in order", () => {
    const node = leftJoin(Category, on("categoryId", "id"))(
      join(User, on("authorId", "id"))(from(Post)),
    );
    const result = pgDialect.compileSelect(node);

    assert.equal(
      result.sql,
      "SELECT \"posts\".*, \"users\".*, \"categories\".* FROM \"posts\" "
        + "INNER JOIN \"users\" ON \"posts\".\"author_id\" = \"users\".\"id\" "
        + "LEFT JOIN \"categories\" ON \"posts\".\"category_id\" = \"categories\".\"id\"",
    );
  });

  it("resolves camelCase field names to snake_case columns in ON clause", () => {
    const node = join(User, on("authorId", "id"))(from(Post));
    const result = pgDialect.compileSelect(node);

    assert.ok(result.sql.includes("\"author_id\""), "Should resolve authorId to author_id");
  });

  it("joins compose with where, orderBy, limit, offset", () => {
    const node = offset(5)(
      limit(10)(
        orderBy("title", "asc")(
          where(eq("published", true))(
            join(User, on("authorId", "id"))(from(Post)),
          ),
        ),
      ),
    );
    const result = pgDialect.compileSelect(node);

    assert.ok(result.sql.includes("INNER JOIN"));
    assert.ok(result.sql.includes("WHERE"));
    assert.ok(result.sql.includes("ORDER BY"));
    assert.ok(result.sql.includes("LIMIT"));
    assert.ok(result.sql.includes("OFFSET"));
    assert.deepEqual(result.params, [true, 10, 5]);
  });

  it("join with select() projects specific columns from main table only", () => {
    const node = select("title", "body")(
      join(User, on("authorId", "id"))(from(Post)),
    );
    const result = pgDialect.compileSelect(node);

    // select() currently resolves columns from the main table only.
    assert.equal(
      result.sql,
      "SELECT \"posts\".\"title\", \"posts\".\"body\" FROM \"posts\" "
        + "INNER JOIN \"users\" ON \"posts\".\"author_id\" = \"users\".\"id\"",
    );
  });

  it("handles table-qualified left column referencing a previously joined table", () => {
    // Post -> join User -> leftJoin Role (on User.roleId = Role.id)
    const node = leftJoin(Role, on("users.roleId", "id"))(
      join(User, on("authorId", "id"))(from(Post)),
    );
    const result = pgDialect.compileSelect(node);

    assert.ok(
      result.sql.includes("\"users\".\"role_id\" = \"roles\".\"id\""),
      "Should resolve users.roleId from the previously joined User model",
    );
  });

  it("SELECT * with joins includes all joined tables", () => {
    const node = join(User, on("authorId", "id"))(from(Post));
    const result = pgDialect.compileSelect(node);

    assert.ok(result.sql.startsWith("SELECT \"posts\".*, \"users\".*"));
  });

  it("handles join with no additional clauses", () => {
    const node = join(Category, on("categoryId", "id"))(from(Post));
    const result = pgDialect.compileSelect(node);

    assert.equal(
      result.sql,
      "SELECT \"posts\".*, \"categories\".* FROM \"posts\" "
        + "INNER JOIN \"categories\" ON \"posts\".\"category_id\" = \"categories\".\"id\"",
    );
    assert.deepEqual(result.params, []);
  });
});

// ---------------------------------------------------------------------------
// SQLite dialect: JOIN compilation
// ---------------------------------------------------------------------------

describe("SQLite JOIN compilation", () => {
  it("compiles INNER JOIN with ? placeholders", () => {
    const node = where(eq("published", true))(
      join(User, on("authorId", "id"))(from(Post)),
    );
    const result = sqliteDialect.compileSelect(node);

    assert.ok(result.sql.includes("INNER JOIN"));
    assert.ok(result.sql.includes("?"), "SQLite should use ? placeholders");
    assert.ok(!result.sql.includes("$"), "SQLite should not use $ placeholders");
  });

  it("compiles LEFT JOIN", () => {
    const node = leftJoin(User, on("authorId", "id"))(from(Post));
    const result = sqliteDialect.compileSelect(node);

    assert.ok(result.sql.includes("LEFT JOIN"));
  });

  it("compiles same SQL structure as PostgreSQL (except placeholders)", () => {
    const node = join(User, on("authorId", "id"))(from(Post));

    const pgResult = pgDialect.compileSelect(node);
    const sqliteResult = sqliteDialect.compileSelect(node);

    // Both should have the same SQL minus placeholder differences.
    assert.equal(pgResult.sql, sqliteResult.sql);
  });

  it("compiles multiple joins in order", () => {
    const node = leftJoin(Category, on("categoryId", "id"))(
      join(User, on("authorId", "id"))(from(Post)),
    );
    const result = sqliteDialect.compileSelect(node);

    assert.ok(result.sql.includes("INNER JOIN"));
    assert.ok(result.sql.includes("LEFT JOIN"));

    const innerPos = result.sql.indexOf("INNER JOIN");
    const leftPos = result.sql.indexOf("LEFT JOIN");
    assert.ok(innerPos < leftPos, "INNER JOIN should come before LEFT JOIN");
  });

  it("resolves camelCase to snake_case in ON clause", () => {
    const node = join(User, on("authorId", "id"))(from(Post));
    const result = sqliteDialect.compileSelect(node);

    assert.ok(result.sql.includes("\"author_id\""));
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("JOIN edge cases", () => {
  it("no joins produces the same SQL as before (no regression)", () => {
    const node = where(eq("name", "Alice"))(from(User));

    const pgResult = pgDialect.compileSelect(node);
    assert.equal(
      pgResult.sql,
      "SELECT \"users\".* FROM \"users\" WHERE \"users\".\"name\" = $1",
    );
    assert.deepEqual(pgResult.params, ["Alice"]);

    const sqliteResult = sqliteDialect.compileSelect(node);
    assert.equal(
      sqliteResult.sql,
      "SELECT \"users\".* FROM \"users\" WHERE \"users\".\"name\" = ?",
    );
    assert.deepEqual(sqliteResult.params, ["Alice"]);
  });

  it("from() initialises joins as an empty frozen array", () => {
    const node = from(Post);

    assert.deepEqual(node.joins, []);
    assert.ok(Object.isFrozen(node.joins));
  });

  it("unqualified left column falls back to raw field name when not in metadata", () => {
    // Using a column name that doesn't exist in the model metadata.
    const node = join(User, on("unknownField", "id"))(from(Post));
    const result = pgDialect.compileSelect(node);

    // Falls back to using the raw field name.
    assert.ok(result.sql.includes("\"unknownField\""));
  });

  it("table-qualified left column with unknown table falls back to raw names", () => {
    const node = join(User, on("unknown.someField", "id"))(from(Post));
    const result = pgDialect.compileSelect(node);

    assert.ok(result.sql.includes("\"unknown\".\"someField\""));
  });
});
