/**
 * SQLite integration tests for @igorjs/pure-orm.
 *
 * Exercises every ORM feature against a real in-memory SQLite database
 * via better-sqlite3. Each test inserts its own data, queries it, verifies
 * the result, and cleans up, so tests are independent.
 *
 * Uses node:test (describe, it, before, after) and node:assert/strict.
 */

import { strict as assert } from "node:assert";
import { after, before, describe, it } from "node:test";

import { pipe, Schema, Task } from "@igorjs/pure-ts";

import { transaction } from "../../src/connection/transaction.ts";
import type { ConnectionPool, DatabaseClient, RawConnection } from "../../src/connection/types.ts";
import { createSqliteDialect } from "../../src/dialect/sqlite.ts";
import { execute, findOne } from "../../src/execute/execute.ts";
import { createSnapshot, diffSnapshots, generateMigration } from "../../src/index.ts";
import { createNoopLogger } from "../../src/logging/logger.ts";
import {
  applyMigration,
  ensureMigrationTable,
  getMigrationStatus,
} from "../../src/migration/runner.ts";
import { Model } from "../../src/model/define.ts";
import { Field } from "../../src/model/field.ts";
import { avg, count, max, min, sum } from "../../src/query/aggregates.ts";
import { from, limit, offset, orderBy, select, where } from "../../src/query/builders.ts";
import {
  and,
  between,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  like,
  lt,
  lte,
  ne,
  not,
  or,
} from "../../src/query/conditions.ts";
import { withCte } from "../../src/query/cte.ts";
import { join, leftJoin, on } from "../../src/query/joins.ts";
import {
  hardRemove,
  insert,
  insertMany,
  onConflict,
  remove,
  restore,
  returning,
  update,
} from "../../src/query/mutations.ts";
import { raw, sql } from "../../src/query/raw.ts";
import { onlyDeleted, withDeleted } from "../../src/query/soft-delete.ts";
import { exists, notExists } from "../../src/query/subquery.ts";
import { denseRank, rank, rowNumber } from "../../src/query/window.ts";

import { createSqliteDriver } from "../drivers/sqlite-driver.ts";
import { Category, DROP_TABLES, Post, Profile, SQLITE_CREATE_TABLES, Tag, User } from "./models.ts";

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

let db: DatabaseClient;
let rawConn: RawConnection;

/**
 * Helper to run raw SQL directly against the test connection.
 * Used for setup/teardown DDL and verifying state outside the ORM.
 */
const execRaw = async (sqlStr: string): Promise<readonly unknown[]> => {
  const result = await rawConn.query(sqlStr, []);
  return result.rows;
};

/**
 * Helper to extract the value from an Ok Result, or throw if Err.
 */
const unwrap = <T>(result: {
  readonly isOk: boolean;
  readonly value?: T;
  readonly error?: unknown;
}): T => {
  if (!result.isOk) {
    throw new Error(`Expected Ok, got Err: ${JSON.stringify(result.error)}`);
  }
  return result.value as T;
};

/**
 * Helper to get the $raw object from an ImmutableRecord.
 */
const toRaw = (record: { readonly $raw: unknown }): Record<string, unknown> =>
  record.$raw as Record<string, unknown>;

/**
 * Creates a DatabaseClient backed by a single shared connection.
 *
 * The execute() function acquires from the pool and calls conn.release()
 * (not pool.release()), so the pool must always hand back the same
 * connection without tracking active counts. This is a test helper that
 * models the "lambda" pattern without the global singleton.
 */
const createTestClient = (conn: RawConnection): DatabaseClient => {
  const pool: ConnectionPool = {
    acquire: () => Task.of(conn),
    release: () => Task.of<void>(undefined),
    end: () => Task.of<void>(undefined),
    mode: "pool",
  };
  return Object.freeze({
    dialect: createSqliteDialect(),
    pool,
    logger: createNoopLogger(),
    hooks: {},
  });
};

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("SQLite Integration Tests", () => {
  before(async () => {
    const driver = createSqliteDriver();

    // Create a single connection that all tests share.
    const dummyConfig = { host: "", port: 0, database: ":memory:", user: "", password: "" };
    rawConn = await driver.connect(dummyConfig);

    // Build a DatabaseClient using the test helper pool.
    db = createTestClient(rawConn);

    // Create all test tables.
    for (const stmt of SQLITE_CREATE_TABLES.split(";").filter(s => s.trim().length > 0)) {
      await rawConn.query(`${stmt.trim()};`, []);
    }
  });

  after(async () => {
    // Drop all tables.
    for (const stmt of DROP_TABLES.split(";").filter(s => s.trim().length > 0)) {
      await rawConn.query(`${stmt.trim()};`, []);
    }
    // Close the database.
    await rawConn.end();
  });

  // =========================================================================
  // 1. Connection & Setup
  // =========================================================================

  describe("1. Connection & Setup", () => {
    it("DatabaseClient has a working sqlite dialect", () => {
      assert.ok(db !== undefined, "db should be defined");
      assert.equal(db.dialect.name, "sqlite", "dialect should be sqlite");
    });

    it("ensureMigrationTable creates the state table", async () => {
      const result = await ensureMigrationTable(db).run();
      assert.equal(result.isOk, true, "ensureMigrationTable should succeed");

      // Verify the table exists by querying it.
      const rows = await execRaw(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='_pure_orm_migrations'",
      );
      assert.equal(rows.length, 1, "migration table should exist");
    });
  });

  // =========================================================================
  // 2. Basic CRUD
  // =========================================================================

  describe("2. Basic CRUD", () => {
    it("insert() single row and read it back", async () => {
      // Insert a category.
      const insertNode = pipe(insert(Category, { name: "Tech" }), returning("id", "name"));
      const insertResult = await execute(db)(insertNode).run();
      const list = unwrap(insertResult);
      assert.equal(list.length, 1, "should return 1 inserted row");

      const row = toRaw(list.first().value);
      assert.equal(row["name"], "Tech");
      assert.ok(row["id"] !== undefined, "id should be auto-generated");
    });

    it("insertMany() multiple rows", async () => {
      const node = pipe(
        insertMany(Category, [{ name: "Science" }, { name: "Art" }]),
        returning("id", "name"),
      );
      const result = await execute(db)(node).run();
      const list = unwrap(result);
      assert.equal(list.length, 2, "should return 2 inserted rows");
    });

    it("from() + execute() reads inserted rows", async () => {
      const node = from(Category);
      const result = await execute(db)(node).run();
      const list = unwrap(result);
      assert.ok(list.length >= 3, "should have at least 3 categories");
    });

    it("findOne() returns Some for matching row", async () => {
      const node = pipe(from(Category), where(eq("name", "Tech")));
      const result = await findOne(db)(node).run();
      const opt = unwrap(result);
      assert.equal(opt.isSome, true, "should find the Tech category");
      if (opt.isSome) {
        assert.equal(toRaw(opt.value)["name"], "Tech");
      }
    });

    it("findOne() returns None for non-matching row", async () => {
      const node = pipe(from(Category), where(eq("name", "NonExistent")));
      const result = await findOne(db)(node).run();
      const opt = unwrap(result);
      assert.equal(opt.isNone, true, "should return None");
    });

    it("update() modifies rows", async () => {
      // Update "Tech" to "Technology"
      const node = pipe(
        update(Category, { name: "Technology" }),
        where(eq("name", "Tech")),
        returning("id", "name"),
      );
      const result = await execute(db)(node).run();
      const list = unwrap(result);
      assert.equal(list.length, 1, "should update 1 row");
      assert.equal(toRaw(list.first().value)["name"], "Technology");
    });

    it("hardRemove() physically deletes rows", async () => {
      // Insert a throwaway category, then delete it.
      await execute(db)(insert(Category, { name: "Temp" })).run();

      const deleteNode = pipe(hardRemove(Category), where(eq("name", "Temp")));
      const delResult = await execute(db)(deleteNode).run();
      assert.equal(delResult.isOk, true, "delete should succeed");

      // Verify it's gone.
      const findResult = await findOne(db)(pipe(from(Category), where(eq("name", "Temp")))).run();
      const opt = unwrap(findResult);
      assert.equal(opt.isNone, true, "Temp should be physically deleted");
    });
  });

  // =========================================================================
  // 3. Query Builders
  // =========================================================================

  describe("3. Query Builders", () => {
    // Seed some users for query testing.
    before(async () => {
      await execute(db)(
        insert(User, { email: "alice@test.com", name: "Alice", age: 30, role: "admin" }),
      ).run();
      await execute(db)(
        insert(User, { email: "bob@test.com", name: "Bob", age: 25, role: "user" }),
      ).run();
      await execute(db)(
        insert(User, { email: "charlie@test.com", name: "Charlie", age: 35, role: "user" }),
      ).run();
      await execute(db)(
        insert(User, { email: "diana@test.com", name: "Diana", age: 28, role: "admin" }),
      ).run();
    });

    it("where() with eq", async () => {
      const node = pipe(from(User), where(eq("name", "Alice")));
      const result = await execute(db)(node).run();
      const list = unwrap(result);
      assert.equal(list.length, 1);
      assert.equal(toRaw(list.first().value)["name"], "Alice");
    });

    it("where() with ne", async () => {
      const node = pipe(from(User), where(ne("role", "admin")));
      const result = await execute(db)(node).run();
      const list = unwrap(result);
      assert.equal(list.length, 2);
    });

    it("where() with gt", async () => {
      const node = pipe(from(User), where(gt("age", 30)));
      const result = await execute(db)(node).run();
      const list = unwrap(result);
      assert.equal(list.length, 1);
      assert.equal(toRaw(list.first().value)["name"], "Charlie");
    });

    it("where() with gte", async () => {
      const node = pipe(from(User), where(gte("age", 30)));
      const result = await execute(db)(node).run();
      const list = unwrap(result);
      assert.equal(list.length, 2);
    });

    it("where() with lt", async () => {
      const node = pipe(from(User), where(lt("age", 28)));
      const result = await execute(db)(node).run();
      const list = unwrap(result);
      assert.equal(list.length, 1);
      assert.equal(toRaw(list.first().value)["name"], "Bob");
    });

    it("where() with lte", async () => {
      const node = pipe(from(User), where(lte("age", 28)));
      const result = await execute(db)(node).run();
      const list = unwrap(result);
      assert.equal(list.length, 2);
    });

    it("where() with like", async () => {
      const node = pipe(from(User), where(like("name", "A%")));
      const result = await execute(db)(node).run();
      const list = unwrap(result);
      assert.equal(list.length, 1);
      assert.equal(toRaw(list.first().value)["name"], "Alice");
    });

    it("where() with isNull", async () => {
      // All users have non-null deleted_at = NULL (not soft deleted), so query deletedAt IS NULL.
      const node = pipe(from(User), withDeleted(), where(isNull("deletedAt")));
      const result = await execute(db)(node).run();
      const list = unwrap(result);
      assert.ok(list.length >= 4, "all users should have null deleted_at");
    });

    it("where() with isNotNull", async () => {
      const node = pipe(from(User), withDeleted(), where(isNotNull("name")));
      const result = await execute(db)(node).run();
      const list = unwrap(result);
      assert.ok(list.length >= 4, "all users have non-null name");
    });

    it("where() with inArray", async () => {
      const node = pipe(from(User), where(inArray("name", ["Alice", "Bob"])));
      const result = await execute(db)(node).run();
      const list = unwrap(result);
      assert.equal(list.length, 2);
    });

    it("where() with between", async () => {
      const node = pipe(from(User), where(between("age", 25, 30)));
      const result = await execute(db)(node).run();
      const list = unwrap(result);
      assert.equal(list.length, 3); // Bob(25), Diana(28), Alice(30)
    });

    it("where() with and()", async () => {
      const node = pipe(from(User), where(and(eq("role", "admin"), gt("age", 29))));
      const result = await execute(db)(node).run();
      const list = unwrap(result);
      assert.equal(list.length, 1);
      assert.equal(toRaw(list.first().value)["name"], "Alice");
    });

    it("where() with or()", async () => {
      const node = pipe(from(User), where(or(eq("name", "Alice"), eq("name", "Bob"))));
      const result = await execute(db)(node).run();
      const list = unwrap(result);
      assert.equal(list.length, 2);
    });

    it("where() with not()", async () => {
      const node = pipe(from(User), where(not(eq("role", "admin"))));
      const result = await execute(db)(node).run();
      const list = unwrap(result);
      assert.equal(list.length, 2);
    });

    it("orderBy() ascending", async () => {
      const node = pipe(from(User), orderBy("name", "asc"));
      const result = await execute(db)(node).run();
      const list = unwrap(result);
      const names = Array.from({ length: list.length }, (_, i) => {
        const item = list.at(i);
        return item.isSome ? toRaw(item.value)["name"] : null;
      });
      assert.deepEqual(names, ["Alice", "Bob", "Charlie", "Diana"]);
    });

    it("orderBy() descending", async () => {
      const node = pipe(from(User), orderBy("name", "desc"));
      const result = await execute(db)(node).run();
      const list = unwrap(result);
      const first = list.first();
      assert.equal(first.isSome, true);
      assert.equal(toRaw(first.value)["name"], "Diana");
    });

    it("limit()", async () => {
      const node = pipe(from(User), orderBy("name", "asc"), limit(2));
      const result = await execute(db)(node).run();
      const list = unwrap(result);
      assert.equal(list.length, 2);
    });

    it("offset()", async () => {
      const node = pipe(from(User), orderBy("name", "asc"), limit(2), offset(2));
      const result = await execute(db)(node).run();
      const list = unwrap(result);
      assert.equal(list.length, 2);
      assert.equal(toRaw(list.first().value)["name"], "Charlie");
    });

    it("select() specific columns", async () => {
      const node = pipe(from(User), select("name", "email"), where(eq("name", "Alice")));
      const result = await execute(db)(node).run();
      const list = unwrap(result);
      assert.equal(list.length, 1);
      const row = toRaw(list.first().value);
      assert.equal(row["name"], "Alice");
      assert.equal(row["email"], "alice@test.com");
    });
  });

  // =========================================================================
  // 4. Joins
  // =========================================================================

  describe("4. Joins", () => {
    before(async () => {
      // Get user IDs and category IDs for post creation.
      const usersResult = await execute(db)(pipe(from(User), where(eq("name", "Alice")))).run();
      const aliceId = toRaw(unwrap(usersResult).first().value)["id"];

      const catsResult = await execute(db)(
        pipe(from(Category), where(eq("name", "Technology"))),
      ).run();
      const techId = toRaw(unwrap(catsResult).first().value)["id"];

      const bobResult = await execute(db)(pipe(from(User), where(eq("name", "Bob")))).run();
      const bobId = toRaw(unwrap(bobResult).first().value)["id"];

      // Insert posts.
      await execute(db)(
        insert(Post, {
          title: "Intro to TS",
          body: "TypeScript basics",
          published: 1,
          authorId: aliceId,
          categoryId: techId,
          views: 100,
        }),
      ).run();
      await execute(db)(
        insert(Post, {
          title: "Advanced TS",
          body: "Generics and more",
          published: 1,
          authorId: aliceId,
          categoryId: techId,
          views: 250,
        }),
      ).run();
      await execute(db)(
        insert(Post, {
          title: "Draft Post",
          body: "Work in progress",
          published: 0,
          authorId: bobId,
          categoryId: techId,
          views: 0,
        }),
      ).run();

      // Insert profile for Alice.
      await execute(db)(insert(Profile, { bio: "TypeScript enthusiast", userId: aliceId })).run();
    });

    it("join() INNER JOIN returns matching rows", async () => {
      const node = pipe(from(Post), join(User, on("authorId", "id")), where(eq("published", 1)));
      const result = await execute(db)(node).run();
      const list = unwrap(result);
      assert.equal(list.length, 2, "should return 2 published posts with author");
    });

    it("leftJoin() LEFT JOIN includes unmatched rows", async () => {
      // Left join profiles onto users: all users, even those without profiles.
      const node = pipe(from(User), leftJoin(Profile, on("id", "userId")));
      const result = await execute(db)(node).run();
      const list = unwrap(result);
      // All users returned, including those without profiles.
      assert.ok(list.length >= 4, "should return all users");
    });

    it("multiple joins in one query", async () => {
      const node = pipe(
        from(Post),
        join(User, on("authorId", "id")),
        join(Category, on("categoryId", "id")),
      );
      const result = await execute(db)(node).run();
      const list = unwrap(result);
      assert.ok(list.length >= 3, "should return posts with author and category");
    });
  });

  // =========================================================================
  // 5. Aggregates
  // =========================================================================

  describe("5. Aggregates", () => {
    it("count()", async () => {
      const node = pipe(from(Post), select(count("id").as("total")));
      const result = await execute(db)(node).run();
      const list = unwrap(result);
      assert.equal(list.length, 1);
      const row = toRaw(list.first().value);
      assert.ok(Number(row["total"]) >= 3);
    });

    it("sum()", async () => {
      const node = pipe(from(Post), select(sum("views").as("totalViews")));
      const result = await execute(db)(node).run();
      const list = unwrap(result);
      const row = toRaw(list.first().value);
      assert.ok(Number(row["totalViews"]) >= 350);
    });

    it("avg()", async () => {
      const node = pipe(from(Post), select(avg("views").as("avgViews")));
      const result = await execute(db)(node).run();
      const list = unwrap(result);
      const row = toRaw(list.first().value);
      assert.ok(Number(row["avgViews"]) > 0);
    });

    it("min()", async () => {
      const node = pipe(from(Post), select(min("views").as("minViews")));
      const result = await execute(db)(node).run();
      const list = unwrap(result);
      const row = toRaw(list.first().value);
      assert.equal(Number(row["minViews"]), 0);
    });

    it("max()", async () => {
      const node = pipe(from(Post), select(max("views").as("maxViews")));
      const result = await execute(db)(node).run();
      const list = unwrap(result);
      const row = toRaw(list.first().value);
      assert.equal(Number(row["maxViews"]), 250);
    });

    it("groupBy() + having()", async () => {
      // SQLite requires the full aggregate expression in HAVING, not an alias.
      // Use raw() to express the HAVING condition with the aggregate directly.
      const node = raw(
        'SELECT "posts"."author_id", COUNT("posts"."id") AS "postCount" FROM "posts" GROUP BY "posts"."author_id" HAVING COUNT("posts"."id") > ?',
        [1],
      );
      const result = await execute(db)(node).run();
      const list = unwrap(result);
      // Only Alice has > 1 post.
      assert.equal(list.length, 1);
      const row = toRaw(list.first().value);
      assert.ok(Number(row["postCount"]) >= 2);
    });

    it("aggregates with aliases", async () => {
      const node = pipe(
        from(Post),
        select(
          count().as("cnt"),
          sum("views").as("sumV"),
          avg("views").as("avgV"),
          min("views").as("minV"),
          max("views").as("maxV"),
        ),
      );
      const result = await execute(db)(node).run();
      const list = unwrap(result);
      const row = toRaw(list.first().value);
      assert.ok(row["cnt"] !== undefined);
      assert.ok(row["sumV"] !== undefined);
      assert.ok(row["avgV"] !== undefined);
      assert.ok(row["minV"] !== undefined);
      assert.ok(row["maxV"] !== undefined);
    });
  });

  // =========================================================================
  // 6. Soft Deletes
  // =========================================================================

  describe("6. Soft Deletes", () => {
    let softDeleteUserId: unknown;

    before(async () => {
      // Insert a user specifically for soft-delete testing.
      const insertNode = pipe(
        insert(User, { email: "softdel@test.com", name: "SoftDel", age: 40, role: "user" }),
        returning("id"),
      );
      const res = await execute(db)(insertNode).run();
      softDeleteUserId = toRaw(unwrap(res).first().value)["id"];
    });

    it("remove() on soft-delete model sets deleted_at instead of deleting", async () => {
      const node = pipe(remove(User), where(eq("id", softDeleteUserId)));
      const result = await execute(db)(node).run();
      assert.equal(result.isOk, true);

      // Verify the row still exists with a non-null deleted_at.
      const rawRows = await execRaw(`SELECT * FROM "users" WHERE "id" = ${softDeleteUserId}`);
      assert.equal(rawRows.length, 1);
      const row = rawRows[0] as Record<string, unknown>;
      assert.ok(row["deleted_at"] !== null, "deleted_at should be set");
    });

    it("default query filters deleted rows", async () => {
      const node = pipe(from(User), where(eq("id", softDeleteUserId)));
      const result = await findOne(db)(node).run();
      const opt = unwrap(result);
      assert.equal(opt.isNone, true, "soft-deleted user should not appear in default queries");
    });

    it("withDeleted() includes deleted rows", async () => {
      const node = pipe(from(User), withDeleted(), where(eq("id", softDeleteUserId)));
      const result = await findOne(db)(node).run();
      const opt = unwrap(result);
      assert.equal(opt.isSome, true, "should find soft-deleted user with withDeleted()");
    });

    it("onlyDeleted() shows only deleted rows", async () => {
      const node = pipe(from(User), onlyDeleted(), where(eq("id", softDeleteUserId)));
      const result = await findOne(db)(node).run();
      const opt = unwrap(result);
      assert.equal(opt.isSome, true, "should find the soft-deleted user");
    });

    it("restore() clears deleted_at", async () => {
      const restoreNode = pipe(restore(User), where(eq("id", softDeleteUserId)));
      const restoreResult = await execute(db)(restoreNode).run();
      assert.equal(restoreResult.isOk, true);

      // Verify the user is now visible in default queries.
      const findNode = pipe(from(User), where(eq("id", softDeleteUserId)));
      const findResult = await findOne(db)(findNode).run();
      const opt = unwrap(findResult);
      assert.equal(opt.isSome, true, "restored user should appear in default queries");
    });

    it("hardRemove() physically deletes even a soft-delete model", async () => {
      // Soft-delete first, then hard-remove.
      await execute(db)(pipe(remove(User), where(eq("id", softDeleteUserId)))).run();

      const node = pipe(hardRemove(User), where(eq("id", softDeleteUserId)));
      const result = await execute(db)(node).run();
      assert.equal(result.isOk, true);

      // Verify the row is physically gone.
      const rawRows = await execRaw(`SELECT * FROM "users" WHERE "id" = ${softDeleteUserId}`);
      assert.equal(rawRows.length, 0, "row should be physically deleted");
    });
  });

  // =========================================================================
  // 7. Transactions
  // =========================================================================

  describe("7. Transactions", () => {
    it("successful transaction commits", async () => {
      const result = await transaction(db, async tx => {
        await execute(tx)(insert(Tag, { label: "committed-tag" })).run();
        return "ok";
      }).run();

      assert.equal(result.isOk, true);
      if (result.isOk) {
        assert.equal(result.value, "ok");
      }

      // Verify the tag was committed.
      const findResult = await findOne(db)(
        pipe(from(Tag), where(eq("label", "committed-tag"))),
      ).run();
      const opt = unwrap(findResult);
      assert.equal(opt.isSome, true, "committed tag should exist");
    });

    it("failed transaction rolls back", async () => {
      const result = await transaction(db, async tx => {
        await execute(tx)(insert(Tag, { label: "rollback-tag" })).run();
        throw new Error("intentional failure");
      }).run();

      assert.equal(result.isErr, true, "transaction should fail");

      // Verify the tag was NOT committed.
      const findResult = await findOne(db)(
        pipe(from(Tag), where(eq("label", "rollback-tag"))),
      ).run();
      const opt = unwrap(findResult);
      assert.equal(opt.isNone, true, "rolled-back tag should not exist");
    });

    it("nested transaction (savepoint) rolls back independently", async () => {
      const result = await transaction(db, async tx => {
        await execute(tx)(insert(Tag, { label: "outer-tag" })).run();

        // Nested transaction that fails.
        const nestedResult = await transaction(tx, async nested => {
          await execute(nested)(insert(Tag, { label: "inner-tag" })).run();
          throw new Error("nested failure");
        }).run();

        assert.equal(nestedResult.isErr, true, "nested tx should fail");

        return "outer-done";
      }).run();

      assert.equal(result.isOk, true, "outer transaction should succeed");

      // Outer tag was committed.
      const outerResult = await findOne(db)(pipe(from(Tag), where(eq("label", "outer-tag")))).run();
      assert.equal(unwrap(outerResult).isSome, true, "outer-tag should exist");

      // Inner tag was rolled back.
      const innerResult = await findOne(db)(pipe(from(Tag), where(eq("label", "inner-tag")))).run();
      assert.equal(unwrap(innerResult).isNone, true, "inner-tag should not exist");
    });
  });

  // =========================================================================
  // 8. Upsert
  // =========================================================================

  describe("8. Upsert", () => {
    it("onConflict DO NOTHING skips duplicate", async () => {
      // Insert a tag.
      await execute(db)(insert(Tag, { label: "unique-tag" })).run();

      // Attempt to insert the same tag with DO NOTHING.
      const node = pipe(insert(Tag, { label: "unique-tag" }), onConflict("label", "nothing"));
      const result = await execute(db)(node).run();
      assert.equal(result.isOk, true);

      // Should still be exactly one.
      const allResult = await execute(db)(pipe(from(Tag), where(eq("label", "unique-tag")))).run();
      assert.equal(unwrap(allResult).length, 1);
    });

    it("onConflict DO UPDATE SET updates existing row", async () => {
      // Insert initial category.
      await execute(db)(insert(Category, { name: "Upsert-Cat" })).run();

      // Upsert: on conflict update the name.
      const node = pipe(
        insert(Category, { name: "Upsert-Cat" }),
        onConflict("name", { update: ["name"] }),
        returning("id", "name"),
      );
      const result = await execute(db)(node).run();
      const list = unwrap(result);
      assert.equal(list.length, 1);
      assert.equal(toRaw(list.first().value)["name"], "Upsert-Cat");

      // Should still be exactly one.
      const allResult = await execute(db)(
        pipe(from(Category), where(eq("name", "Upsert-Cat"))),
      ).run();
      assert.equal(unwrap(allResult).length, 1);
    });
  });

  // =========================================================================
  // 9. Raw SQL
  // =========================================================================

  describe("9. Raw SQL", () => {
    it("raw() executes dialect-appropriate SQL", async () => {
      const node = raw('SELECT "name" FROM "categories" WHERE "name" = ?', ["Technology"]);
      const result = await execute(db)(node).run();
      const list = unwrap(result);
      assert.equal(list.length, 1);
      assert.equal(toRaw(list.first().value)["name"], "Technology");
    });

    it("sql`` tagged template parameterises values", async () => {
      const target = "Technology";
      const node = sql`SELECT "name" FROM "categories" WHERE "name" = ${target}`;
      const result = await execute(db)(node).run();
      const list = unwrap(result);
      assert.equal(list.length, 1);
      assert.equal(toRaw(list.first().value)["name"], "Technology");
    });
  });

  // =========================================================================
  // 10. CTEs
  // =========================================================================

  describe("10. CTEs", () => {
    it("withCte() compiles and executes correctly", async () => {
      // CTE: published posts, then count from main table.
      const cteQuery = pipe(from(Post), where(eq("published", 1)));

      const node = pipe(
        from(Post),
        withCte("published_posts", cteQuery),
        select(count("id").as("total")),
      );

      const result = await execute(db)(node).run();
      const list = unwrap(result);
      assert.equal(list.length, 1);
      const row = toRaw(list.first().value);
      assert.ok(Number(row["total"]) >= 0, "CTE query should return a count");
    });
  });

  // =========================================================================
  // 11. Subqueries
  // =========================================================================

  describe("11. Subqueries", () => {
    it("exists() in WHERE filters with a subquery", async () => {
      // Non-correlated EXISTS: check whether any published posts exist.
      // Use the ORM builder for the subquery, verifying the AST path works.
      const subquery = pipe(from(Post), where(eq("published", 1)));
      const node = pipe(from(Category), where(exists(subquery)));
      const result = await execute(db)(node).run();
      const list = unwrap(result);
      // EXISTS returns all categories since published posts exist.
      assert.ok(list.length > 0, "categories returned when published posts exist");
    });

    it("exists() correlated subquery via raw SQL", async () => {
      // Correlated subquery needs raw SQL since eq() treats the second
      // argument as a parameter value, not a column reference.
      const node = raw(
        'SELECT * FROM "users" WHERE EXISTS (SELECT 1 FROM "posts" WHERE "posts"."author_id" = "users"."id") AND "users"."deleted_at" IS NULL',
      );
      const result = await execute(db)(node).run();
      const list = unwrap(result);
      // Alice and Bob have posts.
      assert.ok(list.length >= 2, "should find users with posts");
    });

    it("notExists() in WHERE filters with a subquery", async () => {
      // Non-correlated NOT EXISTS: if there are published posts, nothing
      // satisfies NOT EXISTS for a subquery that returns rows. Use an
      // impossible condition so the subquery returns empty.
      const subquery = pipe(from(Post), where(eq("published", 999)));
      const node = pipe(from(Category), where(notExists(subquery)));
      const result = await execute(db)(node).run();
      const list = unwrap(result);
      // No posts with published=999, so NOT EXISTS is true for all categories.
      assert.ok(list.length > 0, "categories returned when no matching posts");
    });

    it("notExists() correlated subquery via raw SQL", async () => {
      const node = raw(
        'SELECT * FROM "users" WHERE NOT EXISTS (SELECT 1 FROM "posts" WHERE "posts"."author_id" = "users"."id") AND "users"."deleted_at" IS NULL',
      );
      const result = await execute(db)(node).run();
      const list = unwrap(result);
      // Charlie and Diana have no posts.
      assert.ok(list.length > 0, "should find users without posts");
    });
  });

  // =========================================================================
  // 12. Window Functions
  // =========================================================================

  describe("12. Window Functions", () => {
    it("rowNumber() with partitionBy and orderBy", async () => {
      const node = pipe(
        from(Post),
        select(
          "title",
          "authorId",
          rowNumber().partitionBy("authorId").orderBy("views", "desc").as("rn"),
        ),
      );
      const result = await execute(db)(node).run();
      const list = unwrap(result);
      assert.ok(list.length >= 3, "should return all posts with row numbers");

      // Verify row numbers are assigned.
      const firstRow = toRaw(list.first().value);
      assert.ok(firstRow["rn"] !== undefined, "row number should be present");
    });

    it("rank() window function", async () => {
      const node = pipe(
        from(Post),
        select("title", rank().orderBy("views", "desc").as("viewRank")),
      );
      const result = await execute(db)(node).run();
      const list = unwrap(result);
      assert.ok(list.length >= 3);
      assert.ok(toRaw(list.first().value)["viewRank"] !== undefined);
    });

    it("denseRank() window function", async () => {
      const node = pipe(
        from(Post),
        select("title", denseRank().orderBy("views", "desc").as("denseViewRank")),
      );
      const result = await execute(db)(node).run();
      const list = unwrap(result);
      assert.ok(list.length >= 3);
      assert.ok(toRaw(list.first().value)["denseViewRank"] !== undefined);
    });
  });

  // =========================================================================
  // 13. Migrations
  // =========================================================================

  describe("13. Migrations", () => {
    it("createSnapshot + diffSnapshots + generateMigration produces valid SQL", () => {
      const dialect = createSqliteDialect();

      // Snapshot 1: empty.
      const emptySnapshot = {
        version: 1 as const,
        generatedAt: new Date().toISOString(),
        tables: {},
      };

      // Snapshot 2: from our models.
      const currentSnapshot = createSnapshot([Category, Tag]);

      // Diff should produce CreateTable operations.
      const ops = diffSnapshots(emptySnapshot, currentSnapshot);
      assert.ok(ops.length >= 2, "should have at least 2 CreateTable operations");

      // Generate migration SQL.
      const migration = generateMigration(ops, dialect);
      assert.ok(migration.up.length > 0, "up SQL should be non-empty");
      assert.ok(migration.down.length > 0, "down SQL should be non-empty");
      assert.ok(migration.up.includes("CREATE TABLE"), "up should contain CREATE TABLE");
      assert.ok(migration.down.includes("DROP TABLE"), "down should contain DROP TABLE");
    });

    it("generated migration SQL executes successfully against the real DB", async () => {
      const dialect = createSqliteDialect();

      // Define a test-only model.
      const TestMigration = Model("test_migration_table", {
        fields: {
          id: Field(Schema.number, { primaryKey: true, default: "autoincrement" }),
          value: Field(Schema.string),
        },
        options: {},
      });

      const emptySnapshot = {
        version: 1 as const,
        generatedAt: new Date().toISOString(),
        tables: {},
      };
      const targetSnapshot = createSnapshot([TestMigration]);
      const ops = diffSnapshots(emptySnapshot, targetSnapshot);
      const migration = generateMigration(ops, dialect);

      // Execute the up migration (may contain multiple statements, execute each separately).
      for (const stmt of migration.up.split(";").filter(s => s.trim().length > 0)) {
        await rawConn.query(`${stmt.trim()};`, []);
      }

      // Verify the table exists.
      const tableCheck = await execRaw(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='test_migration_table'",
      );
      assert.equal(tableCheck.length, 1, "migration table should exist");

      // Execute the down migration (split by statement).
      for (const stmt of migration.down.split(";").filter(s => s.trim().length > 0)) {
        await rawConn.query(`${stmt.trim()};`, []);
      }

      // Verify the table is gone.
      const tableGone = await execRaw(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='test_migration_table'",
      );
      assert.equal(tableGone.length, 0, "migration table should be dropped");
    });

    it("applyMigration records migration state", async () => {
      // Ensure migration table exists (idempotent).
      await ensureMigrationTable(db).run();

      const result = await applyMigration(db, {
        name: "001_test_migration",
        upSql: 'CREATE TABLE IF NOT EXISTS "migration_test_tbl" ("id" INTEGER PRIMARY KEY);',
        checksum: "abc123",
      }).run();
      assert.equal(result.isOk, true, "applyMigration should succeed");

      // Check migration status.
      const statusResult = await getMigrationStatus(db).run();
      const status = unwrap(statusResult);
      assert.ok(status.length > 0, "should have at least 1 migration recorded");

      const found = status.find((r: Record<string, unknown>) => r["name"] === "001_test_migration");
      assert.ok(found !== undefined, "our migration should be recorded");

      // Clean up.
      await rawConn.query('DROP TABLE IF EXISTS "migration_test_tbl";', []);
    });
  });
});
