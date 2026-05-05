/**
 * Tests for the audit system: AuditModel, auditLog(), and audit types.
 */

import { Schema } from "@igorjs/pure-fx";
import { describe, expect, it } from "@igorjs/pure-test";
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
    expect(AuditModel.$name).toBe("_pure_orm_audit");
  });

  it("has all expected columns", () => {
    const names = AuditModel.$columns.map(c => c.name);

    expect(names.includes("id")).toBeTruthy();
    expect(names.includes("tableName")).toBeTruthy();
    expect(names.includes("operation")).toBeTruthy();
    expect(names.includes("rowId")).toBeTruthy();
    expect(names.includes("oldData")).toBeTruthy();
    expect(names.includes("newData")).toBeTruthy();
    expect(names.includes("changedFields")).toBeTruthy();
    expect(names.includes("actorId")).toBeTruthy();
    expect(names.includes("actorIp")).toBeTruthy();
    expect(names.includes("metadata")).toBeTruthy();
    expect(names.includes("createdAt")).toBeTruthy();
  });

  it("resolves camelCase column names to snake_case", () => {
    const tableNameCol = AuditModel.$columns.find(c => c.name === "tableName");
    expect(tableNameCol?.columnName).toBe("table_name");

    const rowIdCol = AuditModel.$columns.find(c => c.name === "rowId");
    expect(rowIdCol?.columnName).toBe("row_id");

    const oldDataCol = AuditModel.$columns.find(c => c.name === "oldData");
    expect(oldDataCol?.columnName).toBe("old_data");

    const actorIdCol = AuditModel.$columns.find(c => c.name === "actorId");
    expect(actorIdCol?.columnName).toBe("actor_id");

    const changedFieldsCol = AuditModel.$columns.find(c => c.name === "changedFields");
    expect(changedFieldsCol?.columnName).toBe("changed_fields");
  });

  it("is frozen", () => {
    expect(Object.isFrozen(AuditModel)).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// auditLog()
// ---------------------------------------------------------------------------

describe("auditLog()", () => {
  it("creates a SelectNode for the _pure_orm_audit table", () => {
    const node = auditLog(User);

    expect(node.tag).toBe("Select");
    expect(node.model.name).toBe("_pure_orm_audit");
  });

  it("pre-filters by the model's table name", () => {
    const node = auditLog(User);

    expect(node.conditions.length).toBe(1);
    expect(node.conditions[0].tag).toBe("Eq");
    if (node.conditions[0].tag === "Eq") {
      expect(node.conditions[0].column).toBe("tableName");
      expect(node.conditions[0].value).toBe("users");
    }
  });

  it("composes with where() for additional filtering", () => {
    const node = where(eq("rowId", "user-123"))(auditLog(User));

    expect(node.conditions.length).toBe(2);
    expect(node.conditions[0].tag).toBe("Eq"); // tableName = 'users'
    expect(node.conditions[1].tag).toBe("Eq"); // rowId = 'user-123'
  });

  it("composes with orderBy() and limit()", () => {
    const node = limit(50)(orderBy("createdAt", "desc")(auditLog(User)));

    expect(node.limit).toBe(50);
    expect(node.orderBy.length).toBe(1);
    expect(node.orderBy[0].column).toBe("createdAt");
    expect(node.orderBy[0].direction).toBe("desc");
  });

  it("PostgreSQL: compiles to SELECT from _pure_orm_audit", () => {
    const node = where(eq("rowId", "u-1"))(orderBy("createdAt", "desc")(limit(10)(auditLog(User))));
    const result = pgDialect.compileSelect(node);

    expect(result.sql.includes('"_pure_orm_audit"')).toBeTruthy();
    expect(result.sql.includes('"table_name" = $1')).toBeTruthy();
    expect(result.sql.includes('"row_id" = $2')).toBeTruthy();
    expect(result.sql.includes("ORDER BY")).toBeTruthy();
    expect(result.params).toEqual(["users", "u-1", 10]);
  });

  it("SQLite: compiles with ? placeholders", () => {
    const node = auditLog(User);
    const result = sqliteDialect.compileSelect(node);

    expect(result.sql.includes('"_pure_orm_audit"')).toBeTruthy();
    expect(result.sql.includes("?")).toBeTruthy();
    expect(result.params).toEqual(["users"]);
  });
});

// ---------------------------------------------------------------------------
// Audit types (compile-time checks)
// ---------------------------------------------------------------------------

describe("Audit types", () => {
  it("AuditOperation covers all expected operations", () => {
    const ops: AuditOperation[] = ["INSERT", "UPDATE", "DELETE", "SOFT_DELETE", "RESTORE"];

    expect(ops.length).toBe(5);
  });

  it("AuditContext can be constructed with partial fields", () => {
    const ctx1: AuditContext = { actorId: "user-1" };
    const ctx2: AuditContext = { actorId: "user-1", actorIp: "127.0.0.1" };
    const ctx3: AuditContext = { metadata: { requestId: "req-1" } };
    const ctx4: AuditContext = {};

    expect(ctx1.actorId).toBe("user-1");
    expect(ctx2.actorIp).toBe("127.0.0.1");
    expect(ctx3.metadata).toEqual({ requestId: "req-1" });
    expect(ctx4.actorId).toBe(undefined);
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

    expect(entry.tableName).toBe("users");
    expect(entry.operation).toBe("UPDATE");
    expect(entry.changedFields).toEqual(["name"]);
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

    expect(entry.oldData).toBe(null);
    expect(entry.actorId).toBe(null);
  });
});
