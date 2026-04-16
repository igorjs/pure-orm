/**
 * Tests for the audit system: AuditModel, auditLog(), and audit types.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Schema } from "@igorjs/pure-ts";
import { auditLog } from "../src/audit/logger.ts";
import { AuditModel } from "../src/audit/table.ts";
import type { AuditContext, AuditEntry, AuditOperation } from "../src/audit/types.ts";
import { createPostgresDialect } from "../src/dialect/postgresql.ts";
import { createSqliteDialect } from "../src/dialect/sqlite.ts";
import { Model } from "../src/model/define.ts";
import { Field } from "../src/model/field.ts";
import { limit, orderBy, where } from "../src/query/builders.ts";
import { eq } from "../src/query/conditions.ts";

// ---- Test model ----

const User = Model("users", {
  fields: {
    id: Field(Schema.string, { primaryKey: true }),
    name: Field(Schema.string),
  },
  options: { audit: true },
});

const pgDialect = createPostgresDialect();
const sqliteDialect = createSqliteDialect();

// ---------------------------------------------------------------------------
// AuditModel
// ---------------------------------------------------------------------------

describe("AuditModel", () => {
  it("has table name _pure_orm_audit", () => {
    assert.equal(AuditModel.$name, "_pure_orm_audit");
  });

  it("has all expected columns", () => {
    const names = AuditModel.$columns.map(c => c.name);

    assert.ok(names.includes("id"));
    assert.ok(names.includes("tableName"));
    assert.ok(names.includes("operation"));
    assert.ok(names.includes("rowId"));
    assert.ok(names.includes("oldData"));
    assert.ok(names.includes("newData"));
    assert.ok(names.includes("changedFields"));
    assert.ok(names.includes("actorId"));
    assert.ok(names.includes("actorIp"));
    assert.ok(names.includes("metadata"));
    assert.ok(names.includes("createdAt"));
  });

  it("resolves camelCase column names to snake_case", () => {
    const tableNameCol = AuditModel.$columns.find(c => c.name === "tableName");
    assert.equal(tableNameCol?.columnName, "table_name");

    const rowIdCol = AuditModel.$columns.find(c => c.name === "rowId");
    assert.equal(rowIdCol?.columnName, "row_id");

    const oldDataCol = AuditModel.$columns.find(c => c.name === "oldData");
    assert.equal(oldDataCol?.columnName, "old_data");

    const actorIdCol = AuditModel.$columns.find(c => c.name === "actorId");
    assert.equal(actorIdCol?.columnName, "actor_id");

    const changedFieldsCol = AuditModel.$columns.find(c => c.name === "changedFields");
    assert.equal(changedFieldsCol?.columnName, "changed_fields");
  });

  it("is frozen", () => {
    assert.ok(Object.isFrozen(AuditModel));
  });
});

// ---------------------------------------------------------------------------
// auditLog()
// ---------------------------------------------------------------------------

describe("auditLog()", () => {
  it("creates a SelectNode for the _pure_orm_audit table", () => {
    const node = auditLog(User);

    assert.equal(node.tag, "Select");
    assert.equal(node.model.name, "_pure_orm_audit");
  });

  it("pre-filters by the model's table name", () => {
    const node = auditLog(User);

    assert.equal(node.conditions.length, 1);
    assert.equal(node.conditions[0].tag, "Eq");
    if (node.conditions[0].tag === "Eq") {
      assert.equal(node.conditions[0].column, "tableName");
      assert.equal(node.conditions[0].value, "users");
    }
  });

  it("composes with where() for additional filtering", () => {
    const node = where(eq("rowId", "user-123"))(auditLog(User));

    assert.equal(node.conditions.length, 2);
    assert.equal(node.conditions[0].tag, "Eq"); // tableName = 'users'
    assert.equal(node.conditions[1].tag, "Eq"); // rowId = 'user-123'
  });

  it("composes with orderBy() and limit()", () => {
    const node = limit(50)(orderBy("createdAt", "desc")(auditLog(User)));

    assert.equal(node.limit, 50);
    assert.equal(node.orderBy.length, 1);
    assert.equal(node.orderBy[0].column, "createdAt");
    assert.equal(node.orderBy[0].direction, "desc");
  });

  it("PostgreSQL: compiles to SELECT from _pure_orm_audit", () => {
    const node = where(eq("rowId", "u-1"))(orderBy("createdAt", "desc")(limit(10)(auditLog(User))));
    const result = pgDialect.compileSelect(node);

    assert.ok(result.sql.includes('"_pure_orm_audit"'));
    assert.ok(result.sql.includes('"table_name" = $1'));
    assert.ok(result.sql.includes('"row_id" = $2'));
    assert.ok(result.sql.includes("ORDER BY"));
    assert.deepEqual(result.params, ["users", "u-1", 10]);
  });

  it("SQLite: compiles with ? placeholders", () => {
    const node = auditLog(User);
    const result = sqliteDialect.compileSelect(node);

    assert.ok(result.sql.includes('"_pure_orm_audit"'));
    assert.ok(result.sql.includes("?"));
    assert.deepEqual(result.params, ["users"]);
  });
});

// ---------------------------------------------------------------------------
// Audit types (compile-time checks)
// ---------------------------------------------------------------------------

describe("Audit types", () => {
  it("AuditOperation covers all expected operations", () => {
    const ops: AuditOperation[] = ["INSERT", "UPDATE", "DELETE", "SOFT_DELETE", "RESTORE"];

    assert.equal(ops.length, 5);
  });

  it("AuditContext can be constructed with partial fields", () => {
    const ctx1: AuditContext = { actorId: "user-1" };
    const ctx2: AuditContext = { actorId: "user-1", actorIp: "127.0.0.1" };
    const ctx3: AuditContext = { metadata: { requestId: "req-1" } };
    const ctx4: AuditContext = {};

    assert.equal(ctx1.actorId, "user-1");
    assert.equal(ctx2.actorIp, "127.0.0.1");
    assert.deepEqual(ctx3.metadata, { requestId: "req-1" });
    assert.equal(ctx4.actorId, undefined);
  });

  it("AuditEntry can be constructed with all fields", () => {
    const entry: AuditEntry = {
      id: "audit-1",
      tableName: "users",
      operation: "UPDATE",
      rowId: "user-1",
      oldData: { name: "Alice" },
      newData: { name: "Bob" },
      changedFields: ["name"],
      actorId: "admin-1",
      actorIp: "192.168.1.1",
      metadata: { reason: "name change" },
      createdAt: "2026-04-07T12:00:00Z",
    };

    assert.equal(entry.tableName, "users");
    assert.equal(entry.operation, "UPDATE");
    assert.deepEqual(entry.changedFields, ["name"]);
  });

  it("AuditEntry allows null for optional JSONB fields", () => {
    const entry: AuditEntry = {
      id: "audit-2",
      tableName: "users",
      operation: "INSERT",
      rowId: "user-2",
      oldData: null,
      newData: { name: "Charlie" },
      changedFields: null,
      actorId: null,
      actorIp: null,
      metadata: null,
      createdAt: "2026-04-07T12:00:00Z",
    };

    assert.equal(entry.oldData, null);
    assert.equal(entry.actorId, null);
  });
});
