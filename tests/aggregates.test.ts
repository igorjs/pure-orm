/**
 * Tests for aggregate expressions and include() eager loading.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Schema } from "@igorjs/pure-fx";
import { createPostgresDialect } from "../src/dialect/postgresql.ts";
import { createSqliteDialect } from "../src/dialect/sqlite.ts";
import { Model } from "../src/model/define.ts";
import { Field } from "../src/model/field.ts";
import { belongsTo, hasMany, hasOne } from "../src/model/relations.ts";
import { avg, count, max, min, sum } from "../src/query/aggregates.ts";
import { from, groupBy, having, select } from "../src/query/builders.ts";
import { gt } from "../src/query/conditions.ts";
import { include } from "../src/query/include.ts";

// ---- Test models ----

const User = Model("users", {
  fields: {
    id: Field(Schema.string, { primaryKey: true }),
    name: Field(Schema.string),
    email: Field(Schema.string, { unique: true }),
  },
  relations: () => ({
    profile: hasOne(() => Profile, { foreignKey: "userId", localKey: "id" }),
    posts: hasMany(() => Post, { foreignKey: "authorId", localKey: "id" }),
  }),
});

const Post = Model("posts", {
  fields: {
    id: Field(Schema.string, { primaryKey: true }),
    title: Field(Schema.string),
    authorId: Field(Schema.string),
    views: Field(Schema.number),
    published: Field(Schema.boolean),
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
  relations: () => ({
    user: belongsTo(() => User, { foreignKey: "userId", localKey: "id" }),
  }),
});

const pgDialect = createPostgresDialect();
const sqliteDialect = createSqliteDialect();

// ---------------------------------------------------------------------------
// Aggregate factories
// ---------------------------------------------------------------------------

describe("count()", () => {
  it("creates an AggregateExpr with fn COUNT", () => {
    const expr = count("id");

    assert.equal(expr.tag, "Aggregate");
    assert.equal(expr.fn, "COUNT");
    assert.equal(expr.column, "id");
    assert.equal(expr.alias, null);
  });

  it("defaults to COUNT(*) when no column given", () => {
    const expr = count();

    assert.equal(expr.column, "*");
  });

  it(".as() returns a new expr with alias", () => {
    const expr = count("id").as("postCount");

    assert.equal(expr.alias, "postCount");
    assert.equal(expr.fn, "COUNT");
    assert.equal(expr.column, "id");
  });

  it(".as() does not mutate the original", () => {
    const original = count("id");
    original.as("postCount");

    assert.equal(original.alias, null);
  });

  it("is frozen", () => {
    assert.ok(Object.isFrozen(count("id")));
    assert.ok(Object.isFrozen(count("id").as("x")));
  });
});

describe("sum()", () => {
  it("creates SUM aggregate", () => {
    const expr = sum("views");
    assert.equal(expr.fn, "SUM");
    assert.equal(expr.column, "views");
  });
});

describe("avg()", () => {
  it("creates AVG aggregate", () => {
    const expr = avg("views");
    assert.equal(expr.fn, "AVG");
  });
});

describe("min()", () => {
  it("creates MIN aggregate", () => {
    const expr = min("views");
    assert.equal(expr.fn, "MIN");
  });
});

describe("max()", () => {
  it("creates MAX aggregate", () => {
    const expr = max("views");
    assert.equal(expr.fn, "MAX");
  });
});

// ---------------------------------------------------------------------------
// Aggregates in select()
// ---------------------------------------------------------------------------

describe("select() with aggregates", () => {
  it("accepts a mix of strings and aggregate expressions", () => {
    const node = select("authorId", count("id").as("cnt"))(from(Post));

    assert.equal(node.columns.length, 2);
    assert.equal(node.columns[0], "authorId");
    assert.equal(typeof node.columns[1], "object");
  });

  it("accepts only aggregate expressions", () => {
    const node = select(count(), sum("views"))(from(Post));

    assert.equal(node.columns.length, 2);
  });
});

// ---------------------------------------------------------------------------
// PostgreSQL aggregate compilation
// ---------------------------------------------------------------------------

describe("PostgreSQL aggregate compilation", () => {
  it("compiles COUNT(column)", () => {
    const node = select("authorId", count("id").as("cnt"))(from(Post));
    const result = pgDialect.compileSelect(node);

    assert.ok(result.sql.includes('"posts"."author_id"'));
    assert.ok(result.sql.includes('COUNT("posts"."id") AS "cnt"'));
  });

  it("compiles COUNT(*)", () => {
    const node = select(count())(from(Post));
    const result = pgDialect.compileSelect(node);

    assert.ok(result.sql.includes("COUNT(*)"));
  });

  it("compiles SUM, AVG, MIN, MAX", () => {
    const node = select(
      sum("views").as("total"),
      avg("views").as("average"),
      min("views").as("lowest"),
      max("views").as("highest"),
    )(from(Post));
    const result = pgDialect.compileSelect(node);

    assert.ok(result.sql.includes("SUM("));
    assert.ok(result.sql.includes("AVG("));
    assert.ok(result.sql.includes("MIN("));
    assert.ok(result.sql.includes("MAX("));
    assert.ok(result.sql.includes('AS "total"'));
    assert.ok(result.sql.includes('AS "average"'));
  });

  it("compiles aggregate without alias", () => {
    const node = select(count("id"))(from(Post));
    const result = pgDialect.compileSelect(node);

    assert.ok(result.sql.includes('COUNT("posts"."id")'));
    assert.ok(!result.sql.includes(" AS "));
  });

  it("compiles full aggregate pipeline: select + groupBy + having", () => {
    const node = having(gt("views", 100))(
      groupBy("authorId")(
        select("authorId", count("id").as("postCount"), avg("views").as("avgViews"))(from(Post)),
      ),
    );
    const result = pgDialect.compileSelect(node);

    assert.ok(result.sql.includes('SELECT "posts"."author_id"'));
    assert.ok(result.sql.includes('COUNT("posts"."id") AS "postCount"'));
    assert.ok(result.sql.includes('AVG("posts"."views") AS "avgViews"'));
    assert.ok(result.sql.includes('GROUP BY "posts"."author_id"'));
    assert.ok(result.sql.includes("HAVING"));
  });

  it("resolves camelCase column names inside aggregates", () => {
    const node = select(count("authorId"))(from(Post));
    const result = pgDialect.compileSelect(node);

    assert.ok(result.sql.includes('"author_id"'));
  });
});

// ---------------------------------------------------------------------------
// SQLite aggregate compilation
// ---------------------------------------------------------------------------

describe("SQLite aggregate compilation", () => {
  it("compiles COUNT with ? placeholders in HAVING", () => {
    const node = having(gt("views", 50))(
      groupBy("authorId")(select("authorId", count("id").as("cnt"))(from(Post))),
    );
    const result = sqliteDialect.compileSelect(node);

    assert.ok(result.sql.includes("COUNT("));
    assert.ok(result.sql.includes("?"));
    assert.deepEqual(result.params, [50]);
  });
});

// ---------------------------------------------------------------------------
// include() - eager loading
// ---------------------------------------------------------------------------

describe("include()", () => {
  it("adds a LEFT JOIN for a belongsTo relation", () => {
    const node = include(Post, "author")(from(Post));

    assert.equal(node.joins.length, 1);
    assert.equal(node.joins[0].joinType, "left");
    assert.equal(node.joins[0].model.name, "users");
  });

  it("sets correct ON condition for belongsTo (FK on source)", () => {
    const node = include(Post, "author")(from(Post));

    // belongsTo: leftColumn = foreignKey (authorId), rightColumn = localKey (id)
    assert.equal(node.joins[0].condition.leftColumn, "authorId");
    assert.equal(node.joins[0].condition.rightColumn, "id");
  });

  it("adds a LEFT JOIN for a hasOne relation", () => {
    const node = include(User, "profile")(from(User));

    assert.equal(node.joins.length, 1);
    assert.equal(node.joins[0].joinType, "left");
    assert.equal(node.joins[0].model.name, "profiles");
  });

  it("sets correct ON condition for hasOne (FK on target)", () => {
    const node = include(User, "profile")(from(User));

    // hasOne: leftColumn = localKey (id), rightColumn = foreignKey (userId)
    assert.equal(node.joins[0].condition.leftColumn, "id");
    assert.equal(node.joins[0].condition.rightColumn, "userId");
  });

  it("throws for unknown relation name", () => {
    assert.throws(() => include(Post, "nonexistent")(from(Post)), { message: /not found/ });
  });

  it("throws for hasMany relations", () => {
    assert.throws(() => include(User, "posts")(from(User)), { message: /HasMany/ });
  });

  it("does not mutate the input node", () => {
    const base = from(Post);
    include(Post, "author")(base);

    assert.equal(base.joins.length, 0);
  });

  it("returns a frozen SelectNode", () => {
    const node = include(Post, "author")(from(Post));

    assert.ok(Object.isFrozen(node));
    assert.ok(Object.isFrozen(node.joins));
  });

  it("PostgreSQL: compiles include as LEFT JOIN", () => {
    const node = include(Post, "author")(from(Post));
    const result = pgDialect.compileSelect(node);

    assert.ok(result.sql.includes("LEFT JOIN"));
    assert.ok(result.sql.includes('"users"'));
    assert.ok(result.sql.includes('"author_id"'));
  });

  it("composes with other query builders", () => {
    const node = groupBy("authorId")(
      select("authorId", count("id").as("cnt"))(include(Post, "author")(from(Post))),
    );
    const result = pgDialect.compileSelect(node);

    assert.ok(result.sql.includes("LEFT JOIN"));
    assert.ok(result.sql.includes("COUNT("));
    assert.ok(result.sql.includes("GROUP BY"));
  });
});
