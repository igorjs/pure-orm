// Copyright 2026 igorjs. SPDX-License-Identifier: Apache-2.0

import { Task } from "@igorjs/pure-fx/async";
import { describe, expect, it } from "@igorjs/pure-test";
import type { DatabaseClient, RawConnection } from "../src/connection/types.ts";
import { createPostgresDialect } from "../src/dialect/postgresql.ts";
import { createSqliteDialect } from "../src/dialect/sqlite.ts";
import { createNoopLogger } from "../src/logging/logger.ts";
import { acquireLock } from "../src/migration/locking.ts";

const createMockConn = (
  queryHandler: (
    sql: string,
    params: readonly unknown[],
  ) => Promise<{ rows: readonly unknown[]; rowCount: number }>,
): RawConnection => ({
  query: queryHandler,
  release: async () => {
    // no-op in mock
  },
  end: async () => {
    // no-op in mock
  },
});

const createMockDb = (conn: RawConnection, dialectName: string): DatabaseClient => ({
  dialect: dialectName === "sqlite" ? createSqliteDialect() : createPostgresDialect(),
  pool: {
    acquire: () => Task.of(conn),
    release: () => Task.of<void>(undefined),
    end: () => Task.of<void>(undefined),
    mode: "pool",
  },
  logger: createNoopLogger(),
  hooks: {},
});

describe("acquireLock (PostgreSQL)", () => {
  it("acquires lock when pg_try_advisory_lock returns true", async () => {
    const conn = createMockConn(async () => ({ rows: [{ acquired: true }], rowCount: 1 }));
    const db = createMockDb(conn, "postgresql");
    const result = await acquireLock(db).run();
    expect(result.isOk).toBe(true);
  });

  it("returns a LockHandle with release()", async () => {
    const conn = createMockConn(async () => ({ rows: [{ acquired: true }], rowCount: 1 }));
    const db = createMockDb(conn, "postgresql");
    const result = await acquireLock(db).run();
    if (!result.isOk) return;
    expect(typeof result.value.release).toBe("function");
  });

  it("release() calls pg_advisory_unlock", async () => {
    const queries: string[] = [];
    const conn = createMockConn(async sql => {
      queries.push(sql);
      return { rows: [{ acquired: true }], rowCount: 1 };
    });
    const db = createMockDb(conn, "postgresql");
    const result = await acquireLock(db).run();
    if (!result.isOk) return;
    await result.value.release().run();
    expect(queries.some(q => q.includes("pg_advisory_unlock"))).toBeTruthy();
  });

  it("fails when pg_try_advisory_lock returns false", async () => {
    const conn = createMockConn(async () => ({ rows: [{ acquired: false }], rowCount: 1 }));
    const db = createMockDb(conn, "postgresql");
    const result = await acquireLock(db).run();
    expect(result.isErr).toBe(true);
    if (result.isErr) {
      expect(result.error.tag).toBe("MigrationError");
      expect(result.error.message.includes("lock")).toBeTruthy();
    }
  });
});

describe("acquireLock (SQLite)", () => {
  it("acquires lock successfully", async () => {
    const conn = createMockConn(async () => ({ rows: [], rowCount: 1 }));
    const db = createMockDb(conn, "sqlite");
    const result = await acquireLock(db).run();
    expect(result.isOk).toBe(true);
  });

  it("returns a LockHandle with release()", async () => {
    const conn = createMockConn(async () => ({ rows: [], rowCount: 1 }));
    const db = createMockDb(conn, "sqlite");
    const result = await acquireLock(db).run();
    if (!result.isOk) return;
    expect(typeof result.value.release).toBe("function");
  });

  it("fails when lock row insert throws (lock held)", async () => {
    const conn = createMockConn(async sql => {
      if (sql.includes("INSERT")) throw new Error("UNIQUE constraint failed");
      return { rows: [], rowCount: 0 };
    });
    const db = createMockDb(conn, "sqlite");
    const result = await acquireLock(db).run();
    expect(result.isErr).toBe(true);
    if (result.isErr) {
      expect(result.error.tag).toBe("MigrationError");
    }
  });

  it("release() completes without error", async () => {
    const conn = createMockConn(async () => ({ rows: [], rowCount: 1 }));
    const db = createMockDb(conn, "sqlite");
    const result = await acquireLock(db).run();
    if (!result.isOk) return;
    const releaseResult = await result.value.release().run();
    expect(releaseResult.isOk).toBe(true);
  });
});
