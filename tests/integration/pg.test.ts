/**
 * PostgreSQL integration tests for @igorjs/pure-orm.
 *
 * Exercises every ORM feature against a real PostgreSQL database. The suite
 * skips entirely when the database is not reachable (e.g. local development
 * without a PG instance). CI sets the PG_* environment variables.
 *
 * Uses node:test (describe, it, before, after) and node:assert/strict.
 */

import { strict as assert } from "node:assert";
import { after, before, describe, it } from "node:test";

import { pipe, Schema, Task } from "@igorjs/pure-ts";

import { transaction } from "../../src/connection/transaction.ts";
import type {
  ConnectionConfig,
  ConnectionPool,
  DatabaseClient,
  RawConnection,
} from "../../src/connection/types.ts";
import { createPostgresDialect } from "../../src/dialect/postgresql.ts";
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
import {
  from,
  groupBy,
  having,
  limit,
  offset,
  orderBy,
  select,
  where,
} from "../../src/query/builders.ts";
import {
  and,
  between,
  eq,
  gt,
  gte,
  ilike,
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
import { raw } from "../../src/query/raw.ts";
import { onlyDeleted, withDeleted } from "../../src/query/soft-delete.ts";
import { exists, notExists } from "../../src/query/subquery.ts";
import { denseRank, rank, rowNumber } from "../../src/query/window.ts";

import { createPgDriver } from "../drivers/pg-driver.ts";
import { Category, DROP_TABLES, PG_CREATE_TABLES, Post, Profile, Tag, User } from "./models.ts";

// ---------------------------------------------------------------------------
// PG Configuration from environment variables
// ---------------------------------------------------------------------------

const PG_CONFIG: ConnectionConfig = {
  host: process.env["PG_HOST"] ?? "localhost",
  port: Number(process.env["PG_PORT"] ?? 5432),
  database: process.env["PG_DATABASE"] ?? "pure_orm_test",
  user: process.env["PG_USER"] ?? "postgres",
  password: process.env["PG_PASSWORD"] ?? "postgres",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let db: DatabaseClient;
let rawConn: RawConnection;
let pgAvailable = false;

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

const toRaw = (record: { readonly $raw: unknown }): Record<string, unknown> =>
  record.$raw as Record<string, unknown>;

const execRaw = async (sqlStr: string): Promise<readonly unknown[]> => {
  const result = await rawConn.query(sqlStr, []);
  return result.rows;
};

/**
 * Creates a DatabaseClient backed by a single shared connection.
 *
 * The execute() function acquires from the pool and calls conn.release()
 * (not pool.release()), so the pool must always hand back the same
 * connection without tracking active counts.
 */
const createTestClient = (conn: RawConnection): DatabaseClient => {
  const pool: ConnectionPool = {
    acquire: () => Task.of(conn),
    release: () => Task.of<void>(undefined),
    end: () => Task.of<void>(undefined),
    mode: "pool",
  };
  return Object.freeze({
    dialect: createPostgresDialect(),
    pool,
    logger: createNoopLogger(),
    hooks: {},
  });
};

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("PostgreSQL Integration Tests", () => {
  before(async () => {
    const driver = createPgDriver();

    // Attempt to connect. Skip the entire suite if PG is not available.
    try {
      rawConn = await driver.connect(PG_CONFIG);
      pgAvailable = true;
    } catch {
      console.log("PostgreSQL not available, skipping PG integration tests");
      return;
    }

    // Build a DatabaseClient using the test helper pool.
    db = createTestClient(rawConn);

    // Drop and recreate tables for a clean slate.
    for (const stmt of DROP_TABLES.split(";").filter(s => s.trim().length > 0)) {
      try {
        await rawConn.query(`${stmt.trim()};`, []);
      } catch {
        // Ignore errors from dropping non-existent tables.
      }
    }

    for (const stmt of PG_CREATE_TABLES.split(";").filter(s => s.trim().length > 0)) {
      await rawConn.query(`${stmt.trim()};`, []);
    }
  });

  after(async () => {
    if (!pgAvailable) return;

    for (const stmt of DROP_TABLES.split(";").filter(s => s.trim().length > 0)) {
      try {
        await rawConn.query(`${stmt.trim()};`, []);
      } catch {
        // Ignore.
      }
    }
    await rawConn.end();
  });

  // =========================================================================
  // 1. Connection & Setup
  // =========================================================================

  describe("1. Connection & Setup", () => {
    it("DatabaseClient has a working postgresql dialect", t => {
      if (!pgAvailable) {
        t.skip("PG not available");
        return;
      }
      assert.ok(db !== undefined);
      assert.equal(db.dialect.name, "postgresql");
    });

    it("ensureMigrationTable creates the state table", async t => {
      if (!pgAvailable) {
        t.skip("PG not available");
        return;
      }
      const result = await ensureMigrationTable(db).run();
      assert.equal(result.isOk, true);

      const rows = await execRaw(
        "SELECT table_name FROM information_schema.tables WHERE table_name = '_pure_orm_migrations'",
      );
      assert.equal(rows.length, 1);
    });
  });

  // =========================================================================
  // 2. Basic CRUD
  // =========================================================================

  describe("2. Basic CRUD", () => {
    it("insert() single row with returning", async t => {
      if (!pgAvailable) {
        t.skip("PG not available");
        return;
      }
      const node = pipe(insert(Category, { name: "Tech" }), returning("id", "name"));
      const result = await execute(db)(node).run();
      const list = unwrap(result);
      assert.equal(list.length, 1);
      assert.equal(toRaw(list.first().value)["name"], "Tech");
    });

    it("insertMany() multiple rows", async t => {
      if (!pgAvailable) {
        t.skip("PG not available");
        return;
      }
      const node = pipe(
        insertMany(Category, [{ name: "Science" }, { name: "Art" }]),
        returning("id", "name"),
      );
      const result = await execute(db)(node).run();
      assert.equal(unwrap(result).length, 2);
    });

    it("from() + execute() reads inserted rows", async t => {
      if (!pgAvailable) {
        t.skip("PG not available");
        return;
      }
      const result = await execute(db)(from(Category)).run();
      assert.ok(unwrap(result).length >= 3);
    });

    it("findOne() returns Some for matching row", async t => {
      if (!pgAvailable) {
        t.skip("PG not available");
        return;
      }
      const result = await findOne(db)(pipe(from(Category), where(eq("name", "Tech")))).run();
      const opt = unwrap(result);
      assert.equal(opt.isSome, true);
      if (opt.isSome) assert.equal(toRaw(opt.value)["name"], "Tech");
    });

    it("findOne() returns None for non-matching row", async t => {
      if (!pgAvailable) {
        t.skip("PG not available");
        return;
      }
      const result = await findOne(db)(pipe(from(Category), where(eq("name", "NoSuch")))).run();
      assert.equal(unwrap(result).isNone, true);
    });

    it("update() modifies rows", async t => {
      if (!pgAvailable) {
        t.skip("PG not available");
        return;
      }
      const node = pipe(
        update(Category, { name: "Technology" }),
        where(eq("name", "Tech")),
        returning("id", "name"),
      );
      const result = await execute(db)(node).run();
      assert.equal(unwrap(result).length, 1);
      assert.equal(toRaw(unwrap(result).first().value)["name"], "Technology");
    });

    it("hardRemove() physically deletes rows", async t => {
      if (!pgAvailable) {
        t.skip("PG not available");
        return;
      }
      await execute(db)(insert(Category, { name: "Temp" })).run();

      const node = pipe(hardRemove(Category), where(eq("name", "Temp")));
      await execute(db)(node).run();

      const findResult = await findOne(db)(pipe(from(Category), where(eq("name", "Temp")))).run();
      assert.equal(unwrap(findResult).isNone, true);
    });
  });

  // =========================================================================
  // 3. Query Builders
  // =========================================================================

  describe("3. Query Builders", () => {
    before(async () => {
      if (!pgAvailable) return;
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

    it("where() with eq", async t => {
      if (!pgAvailable) {
        t.skip("PG not available");
        return;
      }
      const result = await execute(db)(pipe(from(User), where(eq("name", "Alice")))).run();
      assert.equal(unwrap(result).length, 1);
    });

    it("where() with ne", async t => {
      if (!pgAvailable) {
        t.skip("PG not available");
        return;
      }
      const result = await execute(db)(pipe(from(User), where(ne("role", "admin")))).run();
      assert.equal(unwrap(result).length, 2);
    });

    it("where() with gt", async t => {
      if (!pgAvailable) {
        t.skip("PG not available");
        return;
      }
      const result = await execute(db)(pipe(from(User), where(gt("age", 30)))).run();
      assert.equal(unwrap(result).length, 1);
    });

    it("where() with gte", async t => {
      if (!pgAvailable) {
        t.skip("PG not available");
        return;
      }
      const result = await execute(db)(pipe(from(User), where(gte("age", 30)))).run();
      assert.equal(unwrap(result).length, 2);
    });

    it("where() with lt", async t => {
      if (!pgAvailable) {
        t.skip("PG not available");
        return;
      }
      const result = await execute(db)(pipe(from(User), where(lt("age", 28)))).run();
      assert.equal(unwrap(result).length, 1);
    });

    it("where() with lte", async t => {
      if (!pgAvailable) {
        t.skip("PG not available");
        return;
      }
      const result = await execute(db)(pipe(from(User), where(lte("age", 28)))).run();
      assert.equal(unwrap(result).length, 2);
    });

    it("where() with like", async t => {
      if (!pgAvailable) {
        t.skip("PG not available");
        return;
      }
      const result = await execute(db)(pipe(from(User), where(like("name", "A%")))).run();
      assert.equal(unwrap(result).length, 1);
    });

    it("where() with ilike (PG only)", async t => {
      if (!pgAvailable) {
        t.skip("PG not available");
        return;
      }
      const result = await execute(db)(pipe(from(User), where(ilike("name", "alice%")))).run();
      assert.equal(unwrap(result).length, 1);
    });

    it("where() with isNull", async t => {
      if (!pgAvailable) {
        t.skip("PG not available");
        return;
      }
      const result = await execute(db)(
        pipe(from(User), withDeleted(), where(isNull("deletedAt"))),
      ).run();
      assert.ok(unwrap(result).length >= 4);
    });

    it("where() with isNotNull", async t => {
      if (!pgAvailable) {
        t.skip("PG not available");
        return;
      }
      const result = await execute(db)(
        pipe(from(User), withDeleted(), where(isNotNull("name"))),
      ).run();
      assert.ok(unwrap(result).length >= 4);
    });

    it("where() with inArray", async t => {
      if (!pgAvailable) {
        t.skip("PG not available");
        return;
      }
      const result = await execute(db)(
        pipe(from(User), where(inArray("name", ["Alice", "Bob"]))),
      ).run();
      assert.equal(unwrap(result).length, 2);
    });

    it("where() with between", async t => {
      if (!pgAvailable) {
        t.skip("PG not available");
        return;
      }
      const result = await execute(db)(pipe(from(User), where(between("age", 25, 30)))).run();
      assert.equal(unwrap(result).length, 3);
    });

    it("where() with and()", async t => {
      if (!pgAvailable) {
        t.skip("PG not available");
        return;
      }
      const result = await execute(db)(
        pipe(from(User), where(and(eq("role", "admin"), gt("age", 29)))),
      ).run();
      assert.equal(unwrap(result).length, 1);
    });

    it("where() with or()", async t => {
      if (!pgAvailable) {
        t.skip("PG not available");
        return;
      }
      const result = await execute(db)(
        pipe(from(User), where(or(eq("name", "Alice"), eq("name", "Bob")))),
      ).run();
      assert.equal(unwrap(result).length, 2);
    });

    it("where() with not()", async t => {
      if (!pgAvailable) {
        t.skip("PG not available");
        return;
      }
      const result = await execute(db)(pipe(from(User), where(not(eq("role", "admin"))))).run();
      assert.equal(unwrap(result).length, 2);
    });

    it("orderBy() ascending", async t => {
      if (!pgAvailable) {
        t.skip("PG not available");
        return;
      }
      const result = await execute(db)(pipe(from(User), orderBy("name", "asc"))).run();
      const list = unwrap(result);
      const names = Array.from({ length: list.length }, (_, i) => {
        const item = list.at(i);
        return item.isSome ? toRaw(item.value)["name"] : null;
      });
      assert.deepEqual(names, ["Alice", "Bob", "Charlie", "Diana"]);
    });

    it("orderBy() descending", async t => {
      if (!pgAvailable) {
        t.skip("PG not available");
        return;
      }
      const result = await execute(db)(pipe(from(User), orderBy("name", "desc"))).run();
      assert.equal(toRaw(unwrap(result).first().value)["name"], "Diana");
    });

    it("limit()", async t => {
      if (!pgAvailable) {
        t.skip("PG not available");
        return;
      }
      const result = await execute(db)(pipe(from(User), orderBy("name", "asc"), limit(2))).run();
      assert.equal(unwrap(result).length, 2);
    });

    it("offset()", async t => {
      if (!pgAvailable) {
        t.skip("PG not available");
        return;
      }
      const result = await execute(db)(
        pipe(from(User), orderBy("name", "asc"), limit(2), offset(2)),
      ).run();
      const list = unwrap(result);
      assert.equal(list.length, 2);
      assert.equal(toRaw(list.first().value)["name"], "Charlie");
    });

    it("select() specific columns", async t => {
      if (!pgAvailable) {
        t.skip("PG not available");
        return;
      }
      const result = await execute(db)(
        pipe(from(User), select("name", "email"), where(eq("name", "Alice"))),
      ).run();
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
      if (!pgAvailable) return;

      const aliceResult = await findOne(db)(pipe(from(User), where(eq("name", "Alice")))).run();
      const aliceId = toRaw(unwrap(aliceResult).value)["id"];

      const bobResult = await findOne(db)(pipe(from(User), where(eq("name", "Bob")))).run();
      const bobId = toRaw(unwrap(bobResult).value)["id"];

      const techResult = await findOne(db)(
        pipe(from(Category), where(eq("name", "Technology"))),
      ).run();
      const techId = toRaw(unwrap(techResult).value)["id"];

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

      await execute(db)(insert(Profile, { bio: "TypeScript enthusiast", userId: aliceId })).run();
    });

    it("join() INNER JOIN", async t => {
      if (!pgAvailable) {
        t.skip("PG not available");
        return;
      }
      const result = await execute(db)(
        pipe(from(Post), join(User, on("authorId", "id")), where(eq("published", 1))),
      ).run();
      assert.equal(unwrap(result).length, 2);
    });

    it("leftJoin() LEFT JOIN", async t => {
      if (!pgAvailable) {
        t.skip("PG not available");
        return;
      }
      const result = await execute(db)(
        pipe(from(User), leftJoin(Profile, on("id", "userId"))),
      ).run();
      assert.ok(unwrap(result).length >= 4);
    });

    it("multiple joins in one query", async t => {
      if (!pgAvailable) {
        t.skip("PG not available");
        return;
      }
      const result = await execute(db)(
        pipe(from(Post), join(User, on("authorId", "id")), join(Category, on("categoryId", "id"))),
      ).run();
      assert.ok(unwrap(result).length >= 3);
    });
  });

  // =========================================================================
  // 5. Aggregates
  // =========================================================================

  describe("5. Aggregates", () => {
    it("count()", async t => {
      if (!pgAvailable) {
        t.skip("PG not available");
        return;
      }
      const result = await execute(db)(pipe(from(Post), select(count("id").as("total")))).run();
      assert.ok(Number(toRaw(unwrap(result).first().value)["total"]) >= 3);
    });

    it("sum()", async t => {
      if (!pgAvailable) {
        t.skip("PG not available");
        return;
      }
      const result = await execute(db)(
        pipe(from(Post), select(sum("views").as("totalViews"))),
      ).run();
      assert.ok(Number(toRaw(unwrap(result).first().value)["totalViews"]) >= 350);
    });

    it("avg()", async t => {
      if (!pgAvailable) {
        t.skip("PG not available");
        return;
      }
      const result = await execute(db)(pipe(from(Post), select(avg("views").as("avgViews")))).run();
      assert.ok(Number(toRaw(unwrap(result).first().value)["avgViews"]) > 0);
    });

    it("min()", async t => {
      if (!pgAvailable) {
        t.skip("PG not available");
        return;
      }
      const result = await execute(db)(pipe(from(Post), select(min("views").as("minViews")))).run();
      assert.equal(Number(toRaw(unwrap(result).first().value)["minViews"]), 0);
    });

    it("max()", async t => {
      if (!pgAvailable) {
        t.skip("PG not available");
        return;
      }
      const result = await execute(db)(pipe(from(Post), select(max("views").as("maxViews")))).run();
      assert.equal(Number(toRaw(unwrap(result).first().value)["maxViews"]), 250);
    });

    it("groupBy() + having()", async t => {
      if (!pgAvailable) {
        t.skip("PG not available");
        return;
      }
      // PostgreSQL supports column aliases in HAVING.
      const result = await execute(db)(
        pipe(
          from(Post),
          select("authorId", count("id").as("postCount")),
          groupBy("authorId"),
          having(gt("postCount", 1)),
        ),
      ).run();
      assert.equal(unwrap(result).length, 1);
    });

    it("aggregates with aliases", async t => {
      if (!pgAvailable) {
        t.skip("PG not available");
        return;
      }
      const result = await execute(db)(
        pipe(
          from(Post),
          select(
            count().as("cnt"),
            sum("views").as("sumV"),
            avg("views").as("avgV"),
            min("views").as("minV"),
            max("views").as("maxV"),
          ),
        ),
      ).run();
      const row = toRaw(unwrap(result).first().value);
      assert.ok(row["cnt"] !== undefined);
      assert.ok(row["sumV"] !== undefined);
    });
  });

  // =========================================================================
  // 6. Soft Deletes
  // =========================================================================

  describe("6. Soft Deletes", () => {
    let softDeleteUserId: unknown;

    before(async () => {
      if (!pgAvailable) return;
      const res = await execute(db)(
        pipe(
          insert(User, { email: "softdel@test.com", name: "SoftDel", age: 40, role: "user" }),
          returning("id"),
        ),
      ).run();
      softDeleteUserId = toRaw(unwrap(res).first().value)["id"];
    });

    it("remove() sets deleted_at", async t => {
      if (!pgAvailable) {
        t.skip("PG not available");
        return;
      }
      await execute(db)(pipe(remove(User), where(eq("id", softDeleteUserId)))).run();

      const rows = await execRaw(`SELECT * FROM "users" WHERE "id" = ${softDeleteUserId}`);
      assert.equal(rows.length, 1);
      assert.ok((rows[0] as Record<string, unknown>)["deleted_at"] !== null);
    });

    it("default query filters deleted rows", async t => {
      if (!pgAvailable) {
        t.skip("PG not available");
        return;
      }
      const result = await findOne(db)(pipe(from(User), where(eq("id", softDeleteUserId)))).run();
      assert.equal(unwrap(result).isNone, true);
    });

    it("withDeleted() includes deleted rows", async t => {
      if (!pgAvailable) {
        t.skip("PG not available");
        return;
      }
      const result = await findOne(db)(
        pipe(from(User), withDeleted(), where(eq("id", softDeleteUserId))),
      ).run();
      assert.equal(unwrap(result).isSome, true);
    });

    it("onlyDeleted() shows only deleted rows", async t => {
      if (!pgAvailable) {
        t.skip("PG not available");
        return;
      }
      const result = await findOne(db)(
        pipe(from(User), onlyDeleted(), where(eq("id", softDeleteUserId))),
      ).run();
      assert.equal(unwrap(result).isSome, true);
    });

    it("restore() clears deleted_at", async t => {
      if (!pgAvailable) {
        t.skip("PG not available");
        return;
      }
      await execute(db)(pipe(restore(User), where(eq("id", softDeleteUserId)))).run();
      const result = await findOne(db)(pipe(from(User), where(eq("id", softDeleteUserId)))).run();
      assert.equal(unwrap(result).isSome, true);
    });

    it("hardRemove() physically deletes", async t => {
      if (!pgAvailable) {
        t.skip("PG not available");
        return;
      }
      await execute(db)(pipe(hardRemove(User), where(eq("id", softDeleteUserId)))).run();
      const rows = await execRaw(`SELECT * FROM "users" WHERE "id" = ${softDeleteUserId}`);
      assert.equal(rows.length, 0);
    });
  });

  // =========================================================================
  // 7. Transactions
  // =========================================================================

  describe("7. Transactions", () => {
    it("successful transaction commits", async t => {
      if (!pgAvailable) {
        t.skip("PG not available");
        return;
      }
      const result = await transaction(db, async tx => {
        await execute(tx)(insert(Tag, { label: "pg-committed" })).run();
        return "ok";
      }).run();
      assert.equal(result.isOk, true);
      const findResult = await findOne(db)(
        pipe(from(Tag), where(eq("label", "pg-committed"))),
      ).run();
      assert.equal(unwrap(findResult).isSome, true);
    });

    it("failed transaction rolls back", async t => {
      if (!pgAvailable) {
        t.skip("PG not available");
        return;
      }
      const result = await transaction(db, async tx => {
        await execute(tx)(insert(Tag, { label: "pg-rollback" })).run();
        throw new Error("intentional");
      }).run();
      assert.equal(result.isErr, true);
      const findResult = await findOne(db)(
        pipe(from(Tag), where(eq("label", "pg-rollback"))),
      ).run();
      assert.equal(unwrap(findResult).isNone, true);
    });

    it("nested transaction (savepoint)", async t => {
      if (!pgAvailable) {
        t.skip("PG not available");
        return;
      }
      const result = await transaction(db, async tx => {
        await execute(tx)(insert(Tag, { label: "pg-outer" })).run();
        const nested = await transaction(tx, async inner => {
          await execute(inner)(insert(Tag, { label: "pg-inner" })).run();
          throw new Error("nested fail");
        }).run();
        assert.equal(nested.isErr, true);
        return "outer-done";
      }).run();
      assert.equal(result.isOk, true);
      assert.equal(
        unwrap(await findOne(db)(pipe(from(Tag), where(eq("label", "pg-outer")))).run()).isSome,
        true,
      );
      assert.equal(
        unwrap(await findOne(db)(pipe(from(Tag), where(eq("label", "pg-inner")))).run()).isNone,
        true,
      );
    });
  });

  // =========================================================================
  // 8. Upsert
  // =========================================================================

  describe("8. Upsert", () => {
    it("onConflict DO NOTHING", async t => {
      if (!pgAvailable) {
        t.skip("PG not available");
        return;
      }
      await execute(db)(insert(Tag, { label: "pg-unique" })).run();

      const node = pipe(insert(Tag, { label: "pg-unique" }), onConflict("label", "nothing"));
      const result = await execute(db)(node).run();
      assert.equal(result.isOk, true);

      const all = await execute(db)(pipe(from(Tag), where(eq("label", "pg-unique")))).run();
      assert.equal(unwrap(all).length, 1);
    });

    it("onConflict DO UPDATE SET", async t => {
      if (!pgAvailable) {
        t.skip("PG not available");
        return;
      }
      await execute(db)(insert(Category, { name: "PG-Upsert" })).run();

      const node = pipe(
        insert(Category, { name: "PG-Upsert" }),
        onConflict("name", { update: ["name"] }),
        returning("id", "name"),
      );
      const result = await execute(db)(node).run();
      assert.equal(unwrap(result).length, 1);
    });
  });

  // =========================================================================
  // 9. Raw SQL
  // =========================================================================

  describe("9. Raw SQL", () => {
    it("raw() with $1 placeholders", async t => {
      if (!pgAvailable) {
        t.skip("PG not available");
        return;
      }
      const node = raw('SELECT "name" FROM "categories" WHERE "name" = $1', ["Technology"]);
      const result = await execute(db)(node).run();
      assert.equal(unwrap(result).length, 1);
    });

    it("raw() with multiple params", async t => {
      if (!pgAvailable) {
        t.skip("PG not available");
        return;
      }
      const node = raw('SELECT "name" FROM "categories" WHERE "name" = $1 OR "name" = $2', [
        "Technology",
        "Science",
      ]);
      const result = await execute(db)(node).run();
      assert.equal(unwrap(result).length, 2);
    });
  });

  // =========================================================================
  // 10. CTEs
  // =========================================================================

  describe("10. CTEs", () => {
    it("withCte() compiles and executes correctly", async t => {
      if (!pgAvailable) {
        t.skip("PG not available");
        return;
      }
      const cteQuery = pipe(from(Post), where(eq("published", 1)));
      const node = pipe(
        from(Post),
        withCte("published_posts", cteQuery),
        select(count("id").as("total")),
      );
      const result = await execute(db)(node).run();
      const row = toRaw(unwrap(result).first().value);
      assert.ok(Number(row["total"]) >= 0);
    });
  });

  // =========================================================================
  // 11. Subqueries
  // =========================================================================

  describe("11. Subqueries", () => {
    it("exists() in WHERE filters with a subquery", async t => {
      if (!pgAvailable) {
        t.skip("PG not available");
        return;
      }
      const subquery = pipe(from(Post), where(eq("published", 1)));
      const node = pipe(from(Category), where(exists(subquery)));
      const result = await execute(db)(node).run();
      assert.ok(unwrap(result).length > 0);
    });

    it("exists() correlated subquery via raw SQL", async t => {
      if (!pgAvailable) {
        t.skip("PG not available");
        return;
      }
      const node = raw(
        'SELECT * FROM "users" WHERE EXISTS (SELECT 1 FROM "posts" WHERE "posts"."author_id" = "users"."id") AND "users"."deleted_at" IS NULL',
      );
      const result = await execute(db)(node).run();
      assert.ok(unwrap(result).length >= 2);
    });

    it("notExists() in WHERE filters with a subquery", async t => {
      if (!pgAvailable) {
        t.skip("PG not available");
        return;
      }
      const subquery = pipe(from(Post), where(eq("published", 999)));
      const node = pipe(from(Category), where(notExists(subquery)));
      const result = await execute(db)(node).run();
      assert.ok(unwrap(result).length > 0);
    });

    it("notExists() correlated subquery via raw SQL", async t => {
      if (!pgAvailable) {
        t.skip("PG not available");
        return;
      }
      const node = raw(
        'SELECT * FROM "users" WHERE NOT EXISTS (SELECT 1 FROM "posts" WHERE "posts"."author_id" = "users"."id") AND "users"."deleted_at" IS NULL',
      );
      const result = await execute(db)(node).run();
      assert.ok(unwrap(result).length > 0);
    });
  });

  // =========================================================================
  // 12. Window Functions
  // =========================================================================

  describe("12. Window Functions", () => {
    it("rowNumber() with partitionBy and orderBy", async t => {
      if (!pgAvailable) {
        t.skip("PG not available");
        return;
      }
      const result = await execute(db)(
        pipe(
          from(Post),
          select(
            "title",
            "authorId",
            rowNumber().partitionBy("authorId").orderBy("views", "desc").as("rn"),
          ),
        ),
      ).run();
      const list = unwrap(result);
      assert.ok(list.length >= 3);
      assert.ok(toRaw(list.first().value)["rn"] !== undefined);
    });

    it("rank() window function", async t => {
      if (!pgAvailable) {
        t.skip("PG not available");
        return;
      }
      const result = await execute(db)(
        pipe(from(Post), select("title", rank().orderBy("views", "desc").as("viewRank"))),
      ).run();
      assert.ok(unwrap(result).length >= 3);
    });

    it("denseRank() window function", async t => {
      if (!pgAvailable) {
        t.skip("PG not available");
        return;
      }
      const result = await execute(db)(
        pipe(from(Post), select("title", denseRank().orderBy("views", "desc").as("denseViewRank"))),
      ).run();
      assert.ok(unwrap(result).length >= 3);
    });
  });

  // =========================================================================
  // 13. Migrations
  // =========================================================================

  describe("13. Migrations", () => {
    it("createSnapshot + diffSnapshots + generateMigration produces valid SQL", t => {
      if (!pgAvailable) {
        t.skip("PG not available");
        return;
      }
      const dialect = createPostgresDialect();
      const emptySnapshot = {
        version: 1 as const,
        generatedAt: new Date().toISOString(),
        tables: {},
      };
      const currentSnapshot = createSnapshot([Category, Tag]);
      const ops = diffSnapshots(emptySnapshot, currentSnapshot);
      const migration = generateMigration(ops, dialect);
      assert.ok(migration.up.includes("CREATE TABLE"));
      assert.ok(migration.down.includes("DROP TABLE"));
    });

    it("generated migration SQL executes against the real DB", async t => {
      if (!pgAvailable) {
        t.skip("PG not available");
        return;
      }
      const dialect = createPostgresDialect();
      const TestMigration = Model("pg_test_migration", {
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

      // Execute each statement separately.
      for (const stmt of migration.up.split(";").filter(s => s.trim().length > 0)) {
        await rawConn.query(`${stmt.trim()};`, []);
      }

      const check = await execRaw(
        "SELECT table_name FROM information_schema.tables WHERE table_name = 'pg_test_migration'",
      );
      assert.equal(check.length, 1);

      for (const stmt of migration.down.split(";").filter(s => s.trim().length > 0)) {
        await rawConn.query(`${stmt.trim()};`, []);
      }

      const gone = await execRaw(
        "SELECT table_name FROM information_schema.tables WHERE table_name = 'pg_test_migration'",
      );
      assert.equal(gone.length, 0);
    });

    it("applyMigration records migration state", async t => {
      if (!pgAvailable) {
        t.skip("PG not available");
        return;
      }
      await ensureMigrationTable(db).run();

      const result = await applyMigration(db, {
        name: "001_pg_test",
        upSql: 'CREATE TABLE IF NOT EXISTS "pg_migration_test_tbl" ("id" SERIAL PRIMARY KEY);',
        checksum: "pg123",
      }).run();
      assert.equal(result.isOk, true);

      const statusResult = await getMigrationStatus(db).run();
      const status = unwrap(statusResult);
      const found = status.find((r: Record<string, unknown>) => r["name"] === "001_pg_test");
      assert.ok(found !== undefined);

      await rawConn.query('DROP TABLE IF EXISTS "pg_migration_test_tbl";', []);
    });
  });
});
