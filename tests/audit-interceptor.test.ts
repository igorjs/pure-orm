/**
 * Tests for audit interceptor: createAuditHooks and withAuditContext.
 * Also tests migration runner types (runner logic needs a real DB).
 */

import { describe, expect, it } from "@igorjs/pure-test";
import type { AuditEntryInput } from "../src/audit/interceptor.ts";
import { createAuditHooks, withAuditContext } from "../src/audit/interceptor.ts";
import type { DatabaseClient } from "../src/connection/types.ts";
import { createPostgresDialect } from "../src/dialect/postgresql.ts";
import { createNoopLogger } from "../src/logging/logger.ts";
import type { MigrationInput, RollbackInput } from "../src/migration/runner.ts";

// ---- Mock DatabaseClient ----

const mockDb: DatabaseClient = Object.freeze({
  dialect: createPostgresDialect(),
  pool: {
    acquire: () => {
      throw new Error("not implemented");
    },
    release: () => {
      throw new Error("not implemented");
    },
    end: () => {
      throw new Error("not implemented");
    },
    mode: "pool" as const,
  },
  logger: createNoopLogger(),
  hooks: {},
});

// ---- Helper to call hooks safely ----

const callBeforeExecute = (
  hooks: Partial<Record<string, unknown>>,
  compiled: { sql: string; params: readonly unknown[] },
): void => {
  const fn = hooks.beforeExecute;
  if (typeof fn === "function") fn(compiled);
};

const callAfterExecute = (
  hooks: Partial<Record<string, unknown>>,
  result: { sql: string; params: readonly unknown[]; rows: readonly unknown[]; durationMs: number },
): void => {
  const fn = hooks.afterExecute;
  if (typeof fn === "function") fn(result);
};

// ---------------------------------------------------------------------------
// createAuditHooks()
// ---------------------------------------------------------------------------

describe("createAuditHooks()", () => {
  it("returns hooks with beforeExecute and afterExecute", () => {
    const hooks = createAuditHooks({ callback: () => undefined });

    expect(typeof hooks.beforeExecute).toBe("function");
    expect(typeof hooks.afterExecute).toBe("function");
  });

  it("calls callback for INSERT operations", () => {
    const entries: AuditEntryInput[] = [];
    const hooks = createAuditHooks({ callback: e => entries.push(e) });

    callBeforeExecute(hooks, {
      sql: 'INSERT INTO "users" ("name") VALUES ($1)',
      params: ["Alice"],
    });
    callAfterExecute(hooks, {
      sql: 'INSERT INTO "users" ("name") VALUES ($1)',
      params: ["Alice"],
      rows: [{ id: "1" }],
      durationMs: 5,
    });

    expect(entries.length).toBe(1);
    expect(entries[0].operation).toBe("INSERT");
    expect(entries[0].tableName).toBe("users");
  });

  it("calls callback for UPDATE operations", () => {
    const entries: AuditEntryInput[] = [];
    const hooks = createAuditHooks({ callback: e => entries.push(e) });

    callBeforeExecute(hooks, { sql: 'UPDATE "posts" SET "title" = $1', params: ["New"] });
    callAfterExecute(hooks, {
      sql: 'UPDATE "posts" SET "title" = $1',
      params: ["New"],
      rows: [],
      durationMs: 3,
    });

    expect(entries.length).toBe(1);
    expect(entries[0].operation).toBe("UPDATE");
    expect(entries[0].tableName).toBe("posts");
  });

  it("calls callback for DELETE operations", () => {
    const entries: AuditEntryInput[] = [];
    const hooks = createAuditHooks({ callback: e => entries.push(e) });

    callBeforeExecute(hooks, { sql: 'DELETE FROM "users" WHERE "id" = $1', params: ["u-1"] });
    callAfterExecute(hooks, {
      sql: 'DELETE FROM "users" WHERE "id" = $1',
      params: ["u-1"],
      rows: [],
      durationMs: 2,
    });

    expect(entries.length).toBe(1);
    expect(entries[0].operation).toBe("DELETE");
  });

  it("detects SOFT_DELETE when SQL contains deleted_at", () => {
    const entries: AuditEntryInput[] = [];
    const hooks = createAuditHooks({ callback: e => entries.push(e) });

    callBeforeExecute(hooks, { sql: 'UPDATE "users" SET "deleted_at" = NOW()', params: [] });
    callAfterExecute(hooks, {
      sql: 'UPDATE "users" SET "deleted_at" = NOW()',
      params: [],
      rows: [],
      durationMs: 1,
    });

    expect(entries.length).toBe(1);
    expect(entries[0].operation).toBe("SOFT_DELETE");
  });

  it("does NOT call callback for SELECT operations", () => {
    const entries: AuditEntryInput[] = [];
    const hooks = createAuditHooks({ callback: e => entries.push(e) });

    callBeforeExecute(hooks, { sql: 'SELECT * FROM "users"', params: [] });
    callAfterExecute(hooks, {
      sql: 'SELECT * FROM "users"',
      params: [],
      rows: [{ id: "1" }],
      durationMs: 1,
    });

    expect(entries.length).toBe(0);
  });

  it("includes context when provided", () => {
    const entries: AuditEntryInput[] = [];
    const hooks = createAuditHooks({
      callback: e => entries.push(e),
      context: { actorId: "admin-1", actorIp: "127.0.0.1", metadata: { reason: "test" } },
    });

    callBeforeExecute(hooks, { sql: 'INSERT INTO "users" ("name") VALUES ($1)', params: ["Bob"] });
    callAfterExecute(hooks, {
      sql: 'INSERT INTO "users" ("name") VALUES ($1)',
      params: ["Bob"],
      rows: [],
      durationMs: 1,
    });

    expect(entries[0].actorId).toBe("admin-1");
    expect(entries[0].actorIp).toBe("127.0.0.1");
    expect(entries[0].metadata).toEqual({ reason: "test" });
  });

  it("defaults context fields to null", () => {
    const entries: AuditEntryInput[] = [];
    const hooks = createAuditHooks({ callback: e => entries.push(e) });

    callBeforeExecute(hooks, { sql: 'INSERT INTO "x" ("a") VALUES ($1)', params: [1] });
    callAfterExecute(hooks, {
      sql: 'INSERT INTO "x" ("a") VALUES ($1)',
      params: [1],
      rows: [],
      durationMs: 0,
    });

    expect(entries[0].actorId).toBe(null);
    expect(entries[0].actorIp).toBe(null);
    expect(entries[0].metadata).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// withAuditContext()
// ---------------------------------------------------------------------------

describe("withAuditContext()", () => {
  it("returns a new DatabaseClient", () => {
    const db = withAuditContext(mockDb, { actorId: "u-1" });

    expect(db).not.toBe(mockDb);
    expect(db.dialect.name).toBe("postgresql");
  });

  it("preserves existing client properties", () => {
    const db = withAuditContext(mockDb, { actorId: "u-1" });

    expect(db.pool.mode).toBe("pool");
    expect(typeof db.logger.debug).toBe("function");
  });

  it("attaches hooks", () => {
    const db = withAuditContext(mockDb, { actorId: "u-1" });

    expect(typeof db.hooks.beforeExecute).toBe("function");
    expect(typeof db.hooks.afterExecute).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// Migration runner types (compile-time checks)
// ---------------------------------------------------------------------------

describe("Migration runner types", () => {
  it("MigrationInput has expected shape", () => {
    const input: MigrationInput = {
      name: "0001_create_users",
      upSql: 'CREATE TABLE "users" ("id" TEXT PRIMARY KEY)',
      checksum: "abc123",
    };

    expect(input.name).toBe("0001_create_users");
    expect(input.checksum).toBe("abc123");
  });

  it("RollbackInput has expected shape", () => {
    const input: RollbackInput = {
      name: "0001_create_users",
      downSql: 'DROP TABLE "users"',
    };

    expect(input.name).toBe("0001_create_users");
  });
});
