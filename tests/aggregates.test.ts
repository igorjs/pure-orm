/**
 * Tests for aggregate expressions and include() eager loading.
 */

import { Schema } from "@igorjs/pure-fx";
import { describe, expect, it } from "@igorjs/pure-test";
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

    expect(expr.tag).toBe("Aggregate");
    expect(expr.fn).toBe("COUNT");
    expect(expr.column).toBe("id");
    expect(expr.alias).toBe(null);
  });

  it("defaults to COUNT(*) when no column given", () => {
    const expr = count();

    expect(expr.column).toBe("*");
  });

  it(".as() returns a new expr with alias", () => {
    const expr = count("id").as("postCount");

    expect(expr.alias).toBe("postCount");
    expect(expr.fn).toBe("COUNT");
    expect(expr.column).toBe("id");
  });

  it(".as() does not mutate the original", () => {
    const original = count("id");
    original.as("postCount");

    expect(original.alias).toBe(null);
  });

  it("is frozen", () => {
    expect(Object.isFrozen(count("id"))).toBeTruthy();
    expect(Object.isFrozen(count("id").as("x"))).toBeTruthy();
  });
});

describe("sum()", () => {
  it("creates SUM aggregate", () => {
    const expr = sum("views");
    expect(expr.fn).toBe("SUM");
    expect(expr.column).toBe("views");
  });
});

describe("avg()", () => {
  it("creates AVG aggregate", () => {
    const expr = avg("views");
    expect(expr.fn).toBe("AVG");
  });
});

describe("min()", () => {
  it("creates MIN aggregate", () => {
    const expr = min("views");
    expect(expr.fn).toBe("MIN");
  });
});

describe("max()", () => {
  it("creates MAX aggregate", () => {
    const expr = max("views");
    expect(expr.fn).toBe("MAX");
  });
});

// ---------------------------------------------------------------------------
// Aggregates in select()
// ---------------------------------------------------------------------------

describe("select() with aggregates", () => {
  it("accepts a mix of strings and aggregate expressions", () => {
    const node = select("authorId", count("id").as("cnt"))(from(Post));

    expect(node.columns.length).toBe(2);
    expect(node.columns[0]).toBe("authorId");
    expect(typeof node.columns[1]).toBe("object");
  });

  it("accepts only aggregate expressions", () => {
    const node = select(count(), sum("views"))(from(Post));

    expect(node.columns.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// PostgreSQL aggregate compilation
// ---------------------------------------------------------------------------

describe("PostgreSQL aggregate compilation", () => {
  it("compiles COUNT(column)", () => {
    const node = select("authorId", count("id").as("cnt"))(from(Post));
    const result = pgDialect.compileSelect(node);

    expect(result.sql.includes('"posts"."author_id"')).toBeTruthy();
    expect(result.sql.includes('COUNT("posts"."id") AS "cnt"')).toBeTruthy();
  });

  it("compiles COUNT(*)", () => {
    const node = select(count())(from(Post));
    const result = pgDialect.compileSelect(node);

    expect(result.sql.includes("COUNT(*)")).toBeTruthy();
  });

  it("compiles SUM, AVG, MIN, MAX", () => {
    const node = select(
      sum("views").as("total"),
      avg("views").as("average"),
      min("views").as("lowest"),
      max("views").as("highest"),
    )(from(Post));
    const result = pgDialect.compileSelect(node);

    expect(result.sql.includes("SUM(")).toBeTruthy();
    expect(result.sql.includes("AVG(")).toBeTruthy();
    expect(result.sql.includes("MIN(")).toBeTruthy();
    expect(result.sql.includes("MAX(")).toBeTruthy();
    expect(result.sql.includes('AS "total"')).toBeTruthy();
    expect(result.sql.includes('AS "average"')).toBeTruthy();
  });

  it("compiles aggregate without alias", () => {
    const node = select(count("id"))(from(Post));
    const result = pgDialect.compileSelect(node);

    expect(result.sql.includes('COUNT("posts"."id")')).toBeTruthy();
    expect(!result.sql.includes(" AS ")).toBeTruthy();
  });

  it("compiles full aggregate pipeline: select + groupBy + having", () => {
    const node = having(gt("views", 100))(
      groupBy("authorId")(
        select("authorId", count("id").as("postCount"), avg("views").as("avgViews"))(from(Post)),
      ),
    );
    const result = pgDialect.compileSelect(node);

    expect(result.sql.includes('SELECT "posts"."author_id"')).toBeTruthy();
    expect(result.sql.includes('COUNT("posts"."id") AS "postCount"')).toBeTruthy();
    expect(result.sql.includes('AVG("posts"."views") AS "avgViews"')).toBeTruthy();
    expect(result.sql.includes('GROUP BY "posts"."author_id"')).toBeTruthy();
    expect(result.sql.includes("HAVING")).toBeTruthy();
  });

  it("resolves camelCase column names inside aggregates", () => {
    const node = select(count("authorId"))(from(Post));
    const result = pgDialect.compileSelect(node);

    expect(result.sql.includes('"author_id"')).toBeTruthy();
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

    expect(result.sql.includes("COUNT(")).toBeTruthy();
    expect(result.sql.includes("?")).toBeTruthy();
    expect(result.params).toEqual([50]);
  });
});

// ---------------------------------------------------------------------------
// include() - eager loading
// ---------------------------------------------------------------------------

describe("include()", () => {
  it("adds a LEFT JOIN for a belongsTo relation", () => {
    const node = include(Post, "author")(from(Post));

    expect(node.joins.length).toBe(1);
    expect(node.joins[0].joinType).toBe("left");
    expect(node.joins[0].model.name).toBe("users");
  });

  it("sets correct ON condition for belongsTo (FK on source)", () => {
    const node = include(Post, "author")(from(Post));

    // belongsTo: leftColumn = foreignKey (authorId), rightColumn = localKey (id)
    expect(node.joins[0].condition.leftColumn).toBe("authorId");
    expect(node.joins[0].condition.rightColumn).toBe("id");
  });

  it("adds a LEFT JOIN for a hasOne relation", () => {
    const node = include(User, "profile")(from(User));

    expect(node.joins.length).toBe(1);
    expect(node.joins[0].joinType).toBe("left");
    expect(node.joins[0].model.name).toBe("profiles");
  });

  it("sets correct ON condition for hasOne (FK on target)", () => {
    const node = include(User, "profile")(from(User));

    // hasOne: leftColumn = localKey (id), rightColumn = foreignKey (userId)
    expect(node.joins[0].condition.leftColumn).toBe("id");
    expect(node.joins[0].condition.rightColumn).toBe("userId");
  });

  it("throws for unknown relation name", () => {
    expect(() => include(Post, "nonexistent")(from(Post))).toThrow();
  });

  it("throws for hasMany relations", () => {
    expect(() => include(User, "posts")(from(User))).toThrow();
  });

  it("does not mutate the input node", () => {
    const base = from(Post);
    include(Post, "author")(base);

    expect(base.joins.length).toBe(0);
  });

  it("returns a frozen SelectNode", () => {
    const node = include(Post, "author")(from(Post));

    expect(Object.isFrozen(node)).toBeTruthy();
    expect(Object.isFrozen(node.joins)).toBeTruthy();
  });

  it("PostgreSQL: compiles include as LEFT JOIN", () => {
    const node = include(Post, "author")(from(Post));
    const result = pgDialect.compileSelect(node);

    expect(result.sql.includes("LEFT JOIN")).toBeTruthy();
    expect(result.sql.includes('"users"')).toBeTruthy();
    expect(result.sql.includes('"author_id"')).toBeTruthy();
  });

  it("composes with other query builders", () => {
    const node = groupBy("authorId")(
      select("authorId", count("id").as("cnt"))(include(Post, "author")(from(Post))),
    );
    const result = pgDialect.compileSelect(node);

    expect(result.sql.includes("LEFT JOIN")).toBeTruthy();
    expect(result.sql.includes("COUNT(")).toBeTruthy();
    expect(result.sql.includes("GROUP BY")).toBeTruthy();
  });
});
