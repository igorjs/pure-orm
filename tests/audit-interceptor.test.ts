/**
 * Tests for audit interceptor: createAuditHooks and withAuditContext.
 * Also tests migration runner types (runner logic needs a real DB).
 */

import { Schema } from "@igorjs/pure-ts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createAuditHooks, withAuditContext } from "../src/audit/interceptor.ts";
import type { AuditEntryInput } from "../src/audit/interceptor.ts";
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

// ---------------------------------------------------------------------------
// createAuditHooks()
// ---------------------------------------------------------------------------

describe("createAuditHooks()", () => {
  it("returns hooks with beforeExecute and afterExecute", () => {
    const hooks = createAuditHooks({ callback: () => {} });

    assert.equal(typeof hooks.beforeExecute, "function");
    assert.equal(typeof hooks.afterExecute, "function");
  });

  it("calls callback for INSERT operations", () => {
    const entries: AuditEntryInput[] = [];
    const hooks = createAuditHooks({ callback: (e) => entries.push(e) });

    hooks.beforeExecute!({ sql: "INSERT INTO \"users\" (\"name\") VALUES ($1)", params: ["Alice"] });
    hooks.afterExecute!({
      sql: "INSERT INTO \"users\" (\"name\") VALUES ($1)",
      params: ["Alice"],
      rows: [{ id: "1" }],
      durationMs: 5,
    });

    assert.equal(entries.length, 1);
    assert.equal(entries[0].operation, "INSERT");
    assert.equal(entries[0].tableName, "users");
  });

  it("calls callback for UPDATE operations", () => {
    const entries: AuditEntryInput[] = [];
    const hooks = createAuditHooks({ callback: (e) => entries.push(e) });

    hooks.beforeExecute!({ sql: "UPDATE \"posts\" SET \"title\" = $1", params: ["New"] });
    hooks.afterExecute!({ sql: "UPDATE \"posts\" SET \"title\" = $1", params: ["New"], rows: [], durationMs: 3 });

    assert.equal(entries.length, 1);
    assert.equal(entries[0].operation, "UPDATE");
    assert.equal(entries[0].tableName, "posts");
  });

  it("calls callback for DELETE operations", () => {
    const entries: AuditEntryInput[] = [];
    const hooks = createAuditHooks({ callback: (e) => entries.push(e) });

    hooks.beforeExecute!({ sql: "DELETE FROM \"users\" WHERE \"id\" = $1", params: ["u-1"] });
    hooks.afterExecute!({ sql: "DELETE FROM \"users\" WHERE \"id\" = $1", params: ["u-1"], rows: [], durationMs: 2 });

    assert.equal(entries.length, 1);
    assert.equal(entries[0].operation, "DELETE");
  });

  it("detects SOFT_DELETE when SQL contains deleted_at", () => {
    const entries: AuditEntryInput[] = [];
    const hooks = createAuditHooks({ callback: (e) => entries.push(e) });

    hooks.beforeExecute!({ sql: "UPDATE \"users\" SET \"deleted_at\" = NOW()", params: [] });
    hooks.afterExecute!({ sql: "UPDATE \"users\" SET \"deleted_at\" = NOW()", params: [], rows: [], durationMs: 1 });

    assert.equal(entries.length, 1);
    assert.equal(entries[0].operation, "SOFT_DELETE");
  });

  it("does NOT call callback for SELECT operations", () => {
    const entries: AuditEntryInput[] = [];
    const hooks = createAuditHooks({ callback: (e) => entries.push(e) });

    hooks.beforeExecute!({ sql: "SELECT * FROM \"users\"", params: [] });
    hooks.afterExecute!({ sql: "SELECT * FROM \"users\"", params: [], rows: [{ id: "1" }], durationMs: 1 });

    assert.equal(entries.length, 0);
  });

  it("includes context when provided", () => {
    const entries: AuditEntryInput[] = [];
    const hooks = createAuditHooks({
      callback: (e) => entries.push(e),
      context: { actorId: "admin-1", actorIp: "127.0.0.1", metadata: { reason: "test" } },
    });

    hooks.beforeExecute!({ sql: "INSERT INTO \"users\" (\"name\") VALUES ($1)", params: ["Bob"] });
    hooks.afterExecute!({
      sql: "INSERT INTO \"users\" (\"name\") VALUES ($1)",
      params: ["Bob"],
      rows: [],
      durationMs: 1,
    });

    assert.equal(entries[0].actorId, "admin-1");
    assert.equal(entries[0].actorIp, "127.0.0.1");
    assert.deepEqual(entries[0].metadata, { reason: "test" });
  });

  it("defaults context fields to null", () => {
    const entries: AuditEntryInput[] = [];
    const hooks = createAuditHooks({ callback: (e) => entries.push(e) });

    hooks.beforeExecute!({ sql: "INSERT INTO \"x\" (\"a\") VALUES ($1)", params: [1] });
    hooks.afterExecute!({ sql: "INSERT INTO \"x\" (\"a\") VALUES ($1)", params: [1], rows: [], durationMs: 0 });

    assert.equal(entries[0].actorId, null);
    assert.equal(entries[0].actorIp, null);
    assert.equal(entries[0].metadata, null);
  });
});

// ---------------------------------------------------------------------------
// withAuditContext()
// ---------------------------------------------------------------------------

describe("withAuditContext()", () => {
  it("returns a new DatabaseClient", () => {
    const db = withAuditContext(mockDb, { actorId: "u-1" });

    assert.notEqual(db, mockDb);
    assert.equal(db.dialect.name, "postgresql");
  });

  it("preserves existing client properties", () => {
    const db = withAuditContext(mockDb, { actorId: "u-1" });

    assert.equal(db.pool.mode, "pool");
    assert.equal(typeof db.logger.debug, "function");
  });

  it("attaches hooks", () => {
    const db = withAuditContext(mockDb, { actorId: "u-1" });

    assert.equal(typeof db.hooks.beforeExecute, "function");
    assert.equal(typeof db.hooks.afterExecute, "function");
  });
});

// ---------------------------------------------------------------------------
// Migration runner types (compile-time checks)
// ---------------------------------------------------------------------------

describe("Migration runner types", () => {
  it("MigrationInput has expected shape", () => {
    const input: MigrationInput = {
      name: "0001_create_users",
      upSql: "CREATE TABLE \"users\" (\"id\" TEXT PRIMARY KEY)",
      checksum: "abc123",
    };

    assert.equal(input.name, "0001_create_users");
    assert.equal(input.checksum, "abc123");
  });

  it("RollbackInput has expected shape", () => {
    const input: RollbackInput = {
      name: "0001_create_users",
      downSql: "DROP TABLE \"users\"",
    };

    assert.equal(input.name, "0001_create_users");
  });
});
