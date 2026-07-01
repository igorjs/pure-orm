// Copyright 2026 igorjs. SPDX-License-Identifier: Apache-2.0

/**
 * PostgreSQL integration tests for @igorjs/pure-orm.
 *
 * Exercises every ORM feature against a real PostgreSQL database. The suite
 * skips entirely when the database is not reachable (e.g. local development
 * without a PG instance). CI sets the PG_* environment variables.
 *
 * Uses node:test (describe, it, before, after) and node:assert/strict.
 */

import { pipe, Schema, Task } from "@igorjs/pure-fx";
import { afterAll, beforeAll, describe, expect, it } from "@igorjs/pure-test";

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
import { from, limit, offset, orderBy, select, where } from "../../src/query/builders.ts";
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
  beforeAll(async () => {
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

  afterAll(async () => {
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
    it("DatabaseClient has a working postgresql dialect", () => {
      if (!pgAvailable) {
        return;
      }
      expect(db !== undefined).toBeTruthy();
      expect(db.dialect.name).toBe("postgresql");
    });

    it("ensureMigrationTable creates the state table", async () => {
      if (!pgAvailable) {
        return;
      }
      const result = await ensureMigrationTable(db).run();
      expect(result.isOk).toBe(true);

      const rows = await execRaw(
        "SELECT table_name FROM information_schema.tables WHERE table_name = '_pure_orm_migrations'",
      );
      expect(rows.length).toBe(1);
    });
  });

  // =========================================================================
  // 2. Basic CRUD
  // =========================================================================

  describe("2. Basic CRUD", () => {
    it("insert() single row with returning", async () => {
      if (!pgAvailable) {
        return;
      }
      const node = pipe(insert(Category, { name: "Tech" }), returning("id", "name"));
      const result = await execute(db)(node).run();
      const list = unwrap(result);
      expect(list.length).toBe(1);
      expect(toRaw(list.first().value)["name"]).toBe("Tech");
    });

    it("insertMany() multiple rows", async () => {
      if (!pgAvailable) {
        return;
      }
      const node = pipe(
        insertMany(Category, [{ name: "Science" }, { name: "Art" }]),
        returning("id", "name"),
      );
      const result = await execute(db)(node).run();
      expect(unwrap(result).length).toBe(2);
    });

    it("from() + execute() reads inserted rows", async () => {
      if (!pgAvailable) {
        return;
      }
      const result = await execute(db)(from(Category)).run();
      expect(unwrap(result).length >= 3).toBeTruthy();
    });

    it("findOne() returns Some for matching row", async () => {
      if (!pgAvailable) {
        return;
      }
      const result = await findOne(db)(pipe(from(Category), where(eq("name", "Tech")))).run();
      const opt = unwrap(result);
      expect(opt.isSome).toBe(true);
      if (opt.isSome) expect(toRaw(opt.value)["name"]).toBe("Tech");
    });

    it("findOne() returns None for non-matching row", async () => {
      if (!pgAvailable) {
        return;
      }
      const result = await findOne(db)(pipe(from(Category), where(eq("name", "NoSuch")))).run();
      expect(unwrap(result).isNone).toBe(true);
    });

    it("update() modifies rows", async () => {
      if (!pgAvailable) {
        return;
      }
      const node = pipe(
        update(Category, { name: "Technology" }),
        where(eq("name", "Tech")),
        returning("id", "name"),
      );
      const result = await execute(db)(node).run();
      expect(unwrap(result).length).toBe(1);
      expect(toRaw(unwrap(result).first().value)["name"]).toBe("Technology");
    });

    it("hardRemove() physically deletes rows", async () => {
      if (!pgAvailable) {
        return;
      }
      await execute(db)(insert(Category, { name: "Temp" })).run();

      const node = pipe(hardRemove(Category), where(eq("name", "Temp")));
      await execute(db)(node).run();

      const findResult = await findOne(db)(pipe(from(Category), where(eq("name", "Temp")))).run();
      expect(unwrap(findResult).isNone).toBe(true);
    });
  });

  // =========================================================================
  // 3. Query Builders
  // =========================================================================

  describe("3. Query Builders", () => {
    beforeAll(async () => {
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

    it("where() with eq", async () => {
      if (!pgAvailable) {
        return;
      }
      const result = await execute(db)(pipe(from(User), where(eq("name", "Alice")))).run();
      expect(unwrap(result).length).toBe(1);
    });

    it("where() with ne", async () => {
      if (!pgAvailable) {
        return;
      }
      const result = await execute(db)(pipe(from(User), where(ne("role", "admin")))).run();
      expect(unwrap(result).length).toBe(2);
    });

    it("where() with gt", async () => {
      if (!pgAvailable) {
        return;
      }
      const result = await execute(db)(pipe(from(User), where(gt("age", 30)))).run();
      expect(unwrap(result).length).toBe(1);
    });

    it("where() with gte", async () => {
      if (!pgAvailable) {
        return;
      }
      const result = await execute(db)(pipe(from(User), where(gte("age", 30)))).run();
      expect(unwrap(result).length).toBe(2);
    });

    it("where() with lt", async () => {
      if (!pgAvailable) {
        return;
      }
      const result = await execute(db)(pipe(from(User), where(lt("age", 28)))).run();
      expect(unwrap(result).length).toBe(1);
    });

    it("where() with lte", async () => {
      if (!pgAvailable) {
        return;
      }
      const result = await execute(db)(pipe(from(User), where(lte("age", 28)))).run();
      expect(unwrap(result).length).toBe(2);
    });

    it("where() with like", async () => {
      if (!pgAvailable) {
        return;
      }
      const result = await execute(db)(pipe(from(User), where(like("name", "A%")))).run();
      expect(unwrap(result).length).toBe(1);
    });

    it("where() with ilike (PG only)", async () => {
      if (!pgAvailable) {
        return;
      }
      const result = await execute(db)(pipe(from(User), where(ilike("name", "alice%")))).run();
      expect(unwrap(result).length).toBe(1);
    });

    it("where() with isNull", async () => {
      if (!pgAvailable) {
        return;
      }
      const result = await execute(db)(
        pipe(from(User), withDeleted(), where(isNull("deletedAt"))),
      ).run();
      expect(unwrap(result).length >= 4).toBeTruthy();
    });

    it("where() with isNotNull", async () => {
      if (!pgAvailable) {
        return;
      }
      const result = await execute(db)(
        pipe(from(User), withDeleted(), where(isNotNull("name"))),
      ).run();
      expect(unwrap(result).length >= 4).toBeTruthy();
    });

    it("where() with inArray", async () => {
      if (!pgAvailable) {
        return;
      }
      const result = await execute(db)(
        pipe(from(User), where(inArray("name", ["Alice", "Bob"]))),
      ).run();
      expect(unwrap(result).length).toBe(2);
    });

    it("where() with between", async () => {
      if (!pgAvailable) {
        return;
      }
      const result = await execute(db)(pipe(from(User), where(between("age", 25, 30)))).run();
      expect(unwrap(result).length).toBe(3);
    });

    it("where() with and()", async () => {
      if (!pgAvailable) {
        return;
      }
      const result = await execute(db)(
        pipe(from(User), where(and(eq("role", "admin"), gt("age", 29)))),
      ).run();
      expect(unwrap(result).length).toBe(1);
    });

    it("where() with or()", async () => {
      if (!pgAvailable) {
        return;
      }
      const result = await execute(db)(
        pipe(from(User), where(or(eq("name", "Alice"), eq("name", "Bob")))),
      ).run();
      expect(unwrap(result).length).toBe(2);
    });

    it("where() with not()", async () => {
      if (!pgAvailable) {
        return;
      }
      const result = await execute(db)(pipe(from(User), where(not(eq("role", "admin"))))).run();
      expect(unwrap(result).length).toBe(2);
    });

    it("orderBy() ascending", async () => {
      if (!pgAvailable) {
        return;
      }
      const result = await execute(db)(pipe(from(User), orderBy("name", "asc"))).run();
      const list = unwrap(result);
      const names = Array.from({ length: list.length }, (_, i) => {
        const item = list.at(i);
        return item.isSome ? toRaw(item.value)["name"] : null;
      });
      expect(names).toEqual(["Alice", "Bob", "Charlie", "Diana"]);
    });

    it("orderBy() descending", async () => {
      if (!pgAvailable) {
        return;
      }
      const result = await execute(db)(pipe(from(User), orderBy("name", "desc"))).run();
      expect(toRaw(unwrap(result).first().value)["name"]).toBe("Diana");
    });

    it("limit()", async () => {
      if (!pgAvailable) {
        return;
      }
      const result = await execute(db)(pipe(from(User), orderBy("name", "asc"), limit(2))).run();
      expect(unwrap(result).length).toBe(2);
    });

    it("offset()", async () => {
      if (!pgAvailable) {
        return;
      }
      const result = await execute(db)(
        pipe(from(User), orderBy("name", "asc"), limit(2), offset(2)),
      ).run();
      const list = unwrap(result);
      expect(list.length).toBe(2);
      expect(toRaw(list.first().value)["name"]).toBe("Charlie");
    });

    it("select() specific columns", async () => {
      if (!pgAvailable) {
        return;
      }
      const result = await execute(db)(
        pipe(from(User), select("name", "email"), where(eq("name", "Alice"))),
      ).run();
      const list = unwrap(result);
      expect(list.length).toBe(1);
      const row = toRaw(list.first().value);
      expect(row["name"]).toBe("Alice");
      expect(row["email"]).toBe("alice@test.com");
    });
  });

  // =========================================================================
  // 4. Joins
  // =========================================================================

  describe("4. Joins", () => {
    beforeAll(async () => {
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

    it("join() INNER JOIN", async () => {
      if (!pgAvailable) {
        return;
      }
      const result = await execute(db)(
        pipe(from(Post), join(User, on("authorId", "id")), where(eq("published", 1))),
      ).run();
      expect(unwrap(result).length).toBe(2);
    });

    it("leftJoin() LEFT JOIN", async () => {
      if (!pgAvailable) {
        return;
      }
      const result = await execute(db)(
        pipe(from(User), leftJoin(Profile, on("id", "userId"))),
      ).run();
      expect(unwrap(result).length >= 4).toBeTruthy();
    });

    it("multiple joins in one query", async () => {
      if (!pgAvailable) {
        return;
      }
      const result = await execute(db)(
        pipe(from(Post), join(User, on("authorId", "id")), join(Category, on("categoryId", "id"))),
      ).run();
      expect(unwrap(result).length >= 3).toBeTruthy();
    });
  });

  // =========================================================================
  // 5. Aggregates
  // =========================================================================

  describe("5. Aggregates", () => {
    it("count()", async () => {
      if (!pgAvailable) {
        return;
      }
      const result = await execute(db)(pipe(from(Post), select(count("id").as("total")))).run();
      expect(Number(toRaw(unwrap(result).first().value)["total"]) >= 3).toBeTruthy();
    });

    it("sum()", async () => {
      if (!pgAvailable) {
        return;
      }
      const result = await execute(db)(
        pipe(from(Post), select(sum("views").as("totalViews"))),
      ).run();
      expect(Number(toRaw(unwrap(result).first().value)["totalViews"]) >= 350).toBeTruthy();
    });

    it("avg()", async () => {
      if (!pgAvailable) {
        return;
      }
      const result = await execute(db)(pipe(from(Post), select(avg("views").as("avgViews")))).run();
      expect(Number(toRaw(unwrap(result).first().value)["avgViews"]) > 0).toBeTruthy();
    });

    it("min()", async () => {
      if (!pgAvailable) {
        return;
      }
      const result = await execute(db)(pipe(from(Post), select(min("views").as("minViews")))).run();
      expect(Number(toRaw(unwrap(result).first().value)["minViews"])).toBe(0);
    });

    it("max()", async () => {
      if (!pgAvailable) {
        return;
      }
      const result = await execute(db)(pipe(from(Post), select(max("views").as("maxViews")))).run();
      expect(Number(toRaw(unwrap(result).first().value)["maxViews"])).toBe(250);
    });

    it("groupBy() + having()", async () => {
      if (!pgAvailable) {
        return;
      }
      // PostgreSQL does not support column aliases in HAVING; use raw SQL
      // with the full aggregate expression, same approach as the SQLite test.
      const node = raw(
        'SELECT "posts"."author_id", COUNT("posts"."id") AS "postCount" FROM "posts" GROUP BY "posts"."author_id" HAVING COUNT("posts"."id") > $1',
        [1],
      );
      const result = await execute(db)(node).run();
      const list = unwrap(result);
      expect(list.length).toBe(1);
      const row = toRaw(list.first().value);
      expect(Number(row["postCount"]) >= 2).toBeTruthy();
    });

    it("aggregates with aliases", async () => {
      if (!pgAvailable) {
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
      expect(row["cnt"] !== undefined).toBeTruthy();
      expect(row["sumV"] !== undefined).toBeTruthy();
    });
  });

  // =========================================================================
  // 6. Soft Deletes
  // =========================================================================

  describe("6. Soft Deletes", () => {
    let softDeleteUserId: unknown;

    beforeAll(async () => {
      if (!pgAvailable) return;
      const res = await execute(db)(
        pipe(
          insert(User, { email: "softdel@test.com", name: "SoftDel", age: 40, role: "user" }),
          returning("id"),
        ),
      ).run();
      softDeleteUserId = toRaw(unwrap(res).first().value)["id"];
    });

    it("remove() sets deleted_at", async () => {
      if (!pgAvailable) {
        return;
      }
      await execute(db)(pipe(remove(User), where(eq("id", softDeleteUserId)))).run();

      const rows = await execRaw(`SELECT * FROM "users" WHERE "id" = ${softDeleteUserId}`);
      expect(rows.length).toBe(1);
      expect((rows[0] as Record<string, unknown>)["deleted_at"] !== null).toBeTruthy();
    });

    it("default query filters deleted rows", async () => {
      if (!pgAvailable) {
        return;
      }
      const result = await findOne(db)(pipe(from(User), where(eq("id", softDeleteUserId)))).run();
      expect(unwrap(result).isNone).toBe(true);
    });

    it("withDeleted() includes deleted rows", async () => {
      if (!pgAvailable) {
        return;
      }
      const result = await findOne(db)(
        pipe(from(User), withDeleted(), where(eq("id", softDeleteUserId))),
      ).run();
      expect(unwrap(result).isSome).toBe(true);
    });

    it("onlyDeleted() shows only deleted rows", async () => {
      if (!pgAvailable) {
        return;
      }
      const result = await findOne(db)(
        pipe(from(User), onlyDeleted(), where(eq("id", softDeleteUserId))),
      ).run();
      expect(unwrap(result).isSome).toBe(true);
    });

    it("restore() clears deleted_at", async () => {
      if (!pgAvailable) {
        return;
      }
      await execute(db)(pipe(restore(User), where(eq("id", softDeleteUserId)))).run();
      const result = await findOne(db)(pipe(from(User), where(eq("id", softDeleteUserId)))).run();
      expect(unwrap(result).isSome).toBe(true);
    });

    it("hardRemove() physically deletes", async () => {
      if (!pgAvailable) {
        return;
      }
      await execute(db)(pipe(hardRemove(User), where(eq("id", softDeleteUserId)))).run();
      const rows = await execRaw(`SELECT * FROM "users" WHERE "id" = ${softDeleteUserId}`);
      expect(rows.length).toBe(0);
    });
  });

  // =========================================================================
  // 7. Transactions
  // =========================================================================

  describe("7. Transactions", () => {
    it("successful transaction commits", async () => {
      if (!pgAvailable) {
        return;
      }
      const result = await transaction(db, async tx => {
        await execute(tx)(insert(Tag, { label: "pg-committed" })).run();
        return "ok";
      }).run();
      expect(result.isOk).toBe(true);
      const findResult = await findOne(db)(
        pipe(from(Tag), where(eq("label", "pg-committed"))),
      ).run();
      expect(unwrap(findResult).isSome).toBe(true);
    });

    it("failed transaction rolls back", async () => {
      if (!pgAvailable) {
        return;
      }
      const result = await transaction(db, async tx => {
        await execute(tx)(insert(Tag, { label: "pg-rollback" })).run();
        throw new Error("intentional");
      }).run();
      expect(result.isErr).toBe(true);
      const findResult = await findOne(db)(
        pipe(from(Tag), where(eq("label", "pg-rollback"))),
      ).run();
      expect(unwrap(findResult).isNone).toBe(true);
    });

    it("nested transaction (savepoint)", async () => {
      if (!pgAvailable) {
        return;
      }
      const result = await transaction(db, async tx => {
        await execute(tx)(insert(Tag, { label: "pg-outer" })).run();
        const nested = await transaction(tx, async inner => {
          await execute(inner)(insert(Tag, { label: "pg-inner" })).run();
          throw new Error("nested fail");
        }).run();
        expect(nested.isErr).toBe(true);
        return "outer-done";
      }).run();
      expect(result.isOk).toBe(true);
      expect(
        unwrap(await findOne(db)(pipe(from(Tag), where(eq("label", "pg-outer")))).run()).isSome,
      ).toBe(true);
      expect(
        unwrap(await findOne(db)(pipe(from(Tag), where(eq("label", "pg-inner")))).run()).isNone,
      ).toBe(true);
    });
  });

  // =========================================================================
  // 8. Upsert
  // =========================================================================

  describe("8. Upsert", () => {
    it("onConflict DO NOTHING", async () => {
      if (!pgAvailable) {
        return;
      }
      await execute(db)(insert(Tag, { label: "pg-unique" })).run();

      const node = pipe(insert(Tag, { label: "pg-unique" }), onConflict("label", "nothing"));
      const result = await execute(db)(node).run();
      expect(result.isOk).toBe(true);

      const all = await execute(db)(pipe(from(Tag), where(eq("label", "pg-unique")))).run();
      expect(unwrap(all).length).toBe(1);
    });

    it("onConflict DO UPDATE SET", async () => {
      if (!pgAvailable) {
        return;
      }
      await execute(db)(insert(Category, { name: "PG-Upsert" })).run();

      const node = pipe(
        insert(Category, { name: "PG-Upsert" }),
        onConflict("name", { update: ["name"] }),
        returning("id", "name"),
      );
      const result = await execute(db)(node).run();
      expect(unwrap(result).length).toBe(1);
    });
  });

  // =========================================================================
  // 9. Raw SQL
  // =========================================================================

  describe("9. Raw SQL", () => {
    it("raw() with $1 placeholders", async () => {
      if (!pgAvailable) {
        return;
      }
      const node = raw('SELECT "name" FROM "categories" WHERE "name" = $1', ["Technology"]);
      const result = await execute(db)(node).run();
      expect(unwrap(result).length).toBe(1);
    });

    it("raw() with multiple params", async () => {
      if (!pgAvailable) {
        return;
      }
      const node = raw('SELECT "name" FROM "categories" WHERE "name" = $1 OR "name" = $2', [
        "Technology",
        "Science",
      ]);
      const result = await execute(db)(node).run();
      expect(unwrap(result).length).toBe(2);
    });
  });

  // =========================================================================
  // 10. CTEs
  // =========================================================================

  describe("10. CTEs", () => {
    it("withCte() compiles and executes correctly", async () => {
      if (!pgAvailable) {
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
      expect(Number(row["total"]) >= 0).toBeTruthy();
    });
  });

  // =========================================================================
  // 11. Subqueries
  // =========================================================================

  describe("11. Subqueries", () => {
    it("exists() in WHERE filters with a subquery", async () => {
      if (!pgAvailable) {
        return;
      }
      const subquery = pipe(from(Post), where(eq("published", 1)));
      const node = pipe(from(Category), where(exists(subquery)));
      const result = await execute(db)(node).run();
      expect(unwrap(result).length > 0).toBeTruthy();
    });

    it("exists() correlated subquery via raw SQL", async () => {
      if (!pgAvailable) {
        return;
      }
      const node = raw(
        'SELECT * FROM "users" WHERE EXISTS (SELECT 1 FROM "posts" WHERE "posts"."author_id" = "users"."id") AND "users"."deleted_at" IS NULL',
      );
      const result = await execute(db)(node).run();
      expect(unwrap(result).length >= 2).toBeTruthy();
    });

    it("notExists() in WHERE filters with a subquery", async () => {
      if (!pgAvailable) {
        return;
      }
      // Use "views" (INTEGER) instead of "published" (BOOLEAN) to avoid PG type error.
      const subquery = pipe(from(Post), where(eq("views", 999)));
      const node = pipe(from(Category), where(notExists(subquery)));
      const result = await execute(db)(node).run();
      expect(unwrap(result).length > 0).toBeTruthy();
    });

    it("notExists() correlated subquery via raw SQL", async () => {
      if (!pgAvailable) {
        return;
      }
      const node = raw(
        'SELECT * FROM "users" WHERE NOT EXISTS (SELECT 1 FROM "posts" WHERE "posts"."author_id" = "users"."id") AND "users"."deleted_at" IS NULL',
      );
      const result = await execute(db)(node).run();
      expect(unwrap(result).length > 0).toBeTruthy();
    });
  });

  // =========================================================================
  // 12. Window Functions
  // =========================================================================

  describe("12. Window Functions", () => {
    it("rowNumber() with partitionBy and orderBy", async () => {
      if (!pgAvailable) {
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
      expect(list.length >= 3).toBeTruthy();
      expect(toRaw(list.first().value)["rn"] !== undefined).toBeTruthy();
    });

    it("rank() window function", async () => {
      if (!pgAvailable) {
        return;
      }
      const result = await execute(db)(
        pipe(from(Post), select("title", rank().orderBy("views", "desc").as("viewRank"))),
      ).run();
      expect(unwrap(result).length >= 3).toBeTruthy();
    });

    it("denseRank() window function", async () => {
      if (!pgAvailable) {
        return;
      }
      const result = await execute(db)(
        pipe(from(Post), select("title", denseRank().orderBy("views", "desc").as("denseViewRank"))),
      ).run();
      expect(unwrap(result).length >= 3).toBeTruthy();
    });
  });

  // =========================================================================
  // 13. Migrations
  // =========================================================================

  describe("13. Migrations", () => {
    it("createSnapshot + diffSnapshots + generateMigration produces valid SQL", () => {
      if (!pgAvailable) {
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
      expect(migration.up.includes("CREATE TABLE")).toBeTruthy();
      expect(migration.down.includes("DROP TABLE")).toBeTruthy();
    });

    it("generated migration SQL executes against the real DB", async () => {
      if (!pgAvailable) {
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
      expect(check.length).toBe(1);

      for (const stmt of migration.down.split(";").filter(s => s.trim().length > 0)) {
        await rawConn.query(`${stmt.trim()};`, []);
      }

      const gone = await execRaw(
        "SELECT table_name FROM information_schema.tables WHERE table_name = 'pg_test_migration'",
      );
      expect(gone.length).toBe(0);
    });

    it("applyMigration records migration state", async () => {
      if (!pgAvailable) {
        return;
      }
      await ensureMigrationTable(db).run();

      const result = await applyMigration(db, {
        name: "001_pg_test",
        upSql: 'CREATE TABLE IF NOT EXISTS "pg_migration_test_tbl" ("id" SERIAL PRIMARY KEY);',
        checksum: "pg123",
        batch: 1,
        transaction: true,
      }).run();
      expect(result.isOk).toBe(true);

      const statusResult = await getMigrationStatus(db).run();
      const status = unwrap(statusResult);
      const found = status.find((r: Record<string, unknown>) => r["name"] === "001_pg_test");
      expect(found !== undefined).toBeTruthy();

      await rawConn.query('DROP TABLE IF EXISTS "pg_migration_test_tbl";', []);
    });
  });
});
