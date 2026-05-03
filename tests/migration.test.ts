/**
 * Tests for the migration system: snapshot, differ, and SQL generator.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Schema } from "@igorjs/pure-fx";
import { createPostgresDialect } from "../src/dialect/postgresql.ts";
import { createSqliteDialect } from "../src/dialect/sqlite.ts";
import { columnsEqual, diffSnapshots, diffTable } from "../src/migration/differ.ts";
import { generateMigration, generateUp } from "../src/migration/generator.ts";
import { createSnapshot, snapshotColumn, snapshotTable } from "../src/migration/snapshot.ts";
import { MigrationModel } from "../src/migration/state.ts";
import type { ColumnSnapshot, SchemaSnapshot, TableSnapshot } from "../src/migration/types.ts";
import { Model } from "../src/model/define.ts";
import { Field } from "../src/model/field.ts";

// ---- Test models ----

const User = Model("users", {
  fields: {
    id: Field(Schema.string, { primaryKey: true, default: "uuid" }),
    email: Field(Schema.string, { unique: true }),
    name: Field(Schema.string),
    age: Field(Schema.number.optional()),
  },
  options: { timestamps: true },
});

const Post = Model("posts", {
  fields: {
    id: Field(Schema.string, { primaryKey: true, default: "uuid" }),
    title: Field(Schema.string),
    body: Field(Schema.string),
    published: Field(Schema.boolean, { default: "false" }),
  },
});

const pgDialect = createPostgresDialect();
const sqliteDialect = createSqliteDialect();

// ---- Helpers ----

const makeCol = (overrides: Partial<ColumnSnapshot> = {}): ColumnSnapshot =>
  Object.freeze({
    type: "string",
    primaryKey: false,
    nullable: false,
    unique: false,
    default: null,
    index: false,
    ...overrides,
  });

const makeTable = (columns: Record<string, ColumnSnapshot>): TableSnapshot =>
  Object.freeze({
    columns: Object.freeze(columns),
    indexes: Object.freeze([]),
    foreignKeys: Object.freeze([]),
  });

const emptySnapshot: SchemaSnapshot = Object.freeze({
  version: 1 as const,
  generatedAt: "2026-01-01T00:00:00Z",
  tables: Object.freeze({}),
});

// ---------------------------------------------------------------------------
// snapshotColumn()
// ---------------------------------------------------------------------------

describe("snapshotColumn()", () => {
  it("extracts primaryKey from field config", () => {
    const idCol = User.$columns.find(c => c.name === "id");
    assert.ok(idCol !== undefined);
    const snap = snapshotColumn(idCol);

    assert.equal(snap.primaryKey, true);
  });

  it("extracts unique from field config", () => {
    const emailCol = User.$columns.find(c => c.name === "email");
    assert.ok(emailCol !== undefined);
    const snap = snapshotColumn(emailCol);

    assert.equal(snap.unique, true);
  });

  it("extracts default from field config", () => {
    const idCol = User.$columns.find(c => c.name === "id");
    assert.ok(idCol !== undefined);
    const snap = snapshotColumn(idCol);

    assert.equal(snap.default, "uuid");
  });

  it("returns null default when none set", () => {
    const nameCol = User.$columns.find(c => c.name === "name");
    assert.ok(nameCol !== undefined);
    const snap = snapshotColumn(nameCol);

    assert.equal(snap.default, null);
  });
});

// ---------------------------------------------------------------------------
// snapshotTable()
// ---------------------------------------------------------------------------

describe("snapshotTable()", () => {
  it("creates a table snapshot with all columns", () => {
    const snap = snapshotTable(User);

    assert.ok("id" in snap.columns);
    assert.ok("email" in snap.columns);
    assert.ok("name" in snap.columns);
    assert.ok("age" in snap.columns);
    // Timestamp columns
    assert.ok("created_at" in snap.columns);
    assert.ok("updated_at" in snap.columns);
  });

  it("uses snake_case column names as keys", () => {
    const snap = snapshotTable(User);
    const keys = Object.keys(snap.columns);

    assert.ok(keys.includes("created_at"));
    assert.ok(keys.includes("updated_at"));
    assert.ok(!keys.includes("createdAt"));
  });

  it("generates unique index entries for unique columns", () => {
    const snap = snapshotTable(User);

    const emailIndex = snap.indexes.find(i => i.columns.includes("email"));
    assert.ok(emailIndex !== undefined, "Should have an index for unique email column");
    assert.equal(emailIndex.unique, true);
  });

  it("is frozen", () => {
    const snap = snapshotTable(User);

    assert.ok(Object.isFrozen(snap));
    assert.ok(Object.isFrozen(snap.columns));
  });
});

// ---------------------------------------------------------------------------
// createSnapshot()
// ---------------------------------------------------------------------------

describe("createSnapshot()", () => {
  it("creates a snapshot with version 1", () => {
    const snap = createSnapshot([User]);

    assert.equal(snap.version, 1);
  });

  it("includes all provided models", () => {
    const snap = createSnapshot([User, Post]);

    assert.ok("users" in snap.tables);
    assert.ok("posts" in snap.tables);
    assert.equal(Object.keys(snap.tables).length, 2);
  });

  it("sets generatedAt to a valid ISO date", () => {
    const snap = createSnapshot([User]);

    assert.ok(snap.generatedAt.includes("T"));
    assert.ok(!Number.isNaN(Date.parse(snap.generatedAt)));
  });

  it("is frozen", () => {
    const snap = createSnapshot([User]);

    assert.ok(Object.isFrozen(snap));
    assert.ok(Object.isFrozen(snap.tables));
  });
});

// ---------------------------------------------------------------------------
// columnsEqual()
// ---------------------------------------------------------------------------

describe("columnsEqual()", () => {
  it("returns true for identical columns", () => {
    const a = makeCol({ type: "string", unique: true });
    const b = makeCol({ type: "string", unique: true });

    assert.equal(columnsEqual(a, b), true);
  });

  it("returns false when type differs", () => {
    assert.equal(columnsEqual(makeCol({ type: "string" }), makeCol({ type: "number" })), false);
  });

  it("returns false when nullable differs", () => {
    assert.equal(columnsEqual(makeCol({ nullable: false }), makeCol({ nullable: true })), false);
  });

  it("returns false when unique differs", () => {
    assert.equal(columnsEqual(makeCol({ unique: false }), makeCol({ unique: true })), false);
  });

  it("returns false when default differs", () => {
    assert.equal(columnsEqual(makeCol({ default: null }), makeCol({ default: "uuid" })), false);
  });
});

// ---------------------------------------------------------------------------
// diffTable()
// ---------------------------------------------------------------------------

describe("diffTable()", () => {
  it("detects added columns", () => {
    const from = makeTable({ id: makeCol({ primaryKey: true }) });
    const to = makeTable({ id: makeCol({ primaryKey: true }), name: makeCol() });

    const ops = diffTable("users", from, to);

    assert.equal(ops.length, 1);
    assert.equal(ops[0].tag, "AddColumn");
    if (ops[0].tag === "AddColumn") {
      assert.equal(ops[0].column, "name");
    }
  });

  it("detects dropped columns", () => {
    const from = makeTable({ id: makeCol({ primaryKey: true }), name: makeCol() });
    const to = makeTable({ id: makeCol({ primaryKey: true }) });

    const ops = diffTable("users", from, to);

    assert.equal(ops.length, 1);
    assert.equal(ops[0].tag, "DropColumn");
    if (ops[0].tag === "DropColumn") {
      assert.equal(ops[0].column, "name");
    }
  });

  it("detects altered columns", () => {
    const from = makeTable({ id: makeCol({ primaryKey: true }), age: makeCol({ type: "string" }) });
    const to = makeTable({ id: makeCol({ primaryKey: true }), age: makeCol({ type: "number" }) });

    const ops = diffTable("users", from, to);

    assert.equal(ops.length, 1);
    assert.equal(ops[0].tag, "AlterColumn");
    if (ops[0].tag === "AlterColumn") {
      assert.equal(ops[0].from.type, "string");
      assert.equal(ops[0].to.type, "number");
    }
  });

  it("returns empty array when tables are identical", () => {
    const table = makeTable({ id: makeCol({ primaryKey: true }), name: makeCol() });
    const ops = diffTable("users", table, table);

    assert.equal(ops.length, 0);
  });
});

// ---------------------------------------------------------------------------
// diffSnapshots()
// ---------------------------------------------------------------------------

describe("diffSnapshots()", () => {
  it("detects new tables", () => {
    const from = emptySnapshot;
    const to: SchemaSnapshot = Object.freeze({
      ...emptySnapshot,
      tables: Object.freeze({
        users: makeTable({ id: makeCol({ primaryKey: true }) }),
      }),
    });

    const ops = diffSnapshots(from, to);

    assert.equal(ops.length, 1);
    assert.equal(ops[0].tag, "CreateTable");
    if (ops[0].tag === "CreateTable") {
      assert.equal(ops[0].table, "users");
    }
  });

  it("detects dropped tables", () => {
    const from: SchemaSnapshot = Object.freeze({
      ...emptySnapshot,
      tables: Object.freeze({
        users: makeTable({ id: makeCol({ primaryKey: true }) }),
      }),
    });
    const to = emptySnapshot;

    const ops = diffSnapshots(from, to);

    assert.equal(ops.length, 1);
    assert.equal(ops[0].tag, "DropTable");
  });

  it("detects column changes within existing tables", () => {
    const from: SchemaSnapshot = Object.freeze({
      ...emptySnapshot,
      tables: Object.freeze({
        users: makeTable({ id: makeCol({ primaryKey: true }) }),
      }),
    });
    const to: SchemaSnapshot = Object.freeze({
      ...emptySnapshot,
      tables: Object.freeze({
        users: makeTable({ id: makeCol({ primaryKey: true }), email: makeCol({ unique: true }) }),
      }),
    });

    const ops = diffSnapshots(from, to);

    assert.equal(ops.length, 1);
    assert.equal(ops[0].tag, "AddColumn");
  });

  it("returns empty array for identical snapshots", () => {
    const snap: SchemaSnapshot = Object.freeze({
      ...emptySnapshot,
      tables: Object.freeze({
        users: makeTable({ id: makeCol({ primaryKey: true }) }),
      }),
    });

    const ops = diffSnapshots(snap, snap);

    assert.equal(ops.length, 0);
  });

  it("orders drops before creates", () => {
    const from: SchemaSnapshot = Object.freeze({
      ...emptySnapshot,
      tables: Object.freeze({
        old_table: makeTable({ id: makeCol({ primaryKey: true }) }),
      }),
    });
    const to: SchemaSnapshot = Object.freeze({
      ...emptySnapshot,
      tables: Object.freeze({
        new_table: makeTable({ id: makeCol({ primaryKey: true }) }),
      }),
    });

    const ops = diffSnapshots(from, to);

    assert.equal(ops.length, 2);
    assert.equal(ops[0].tag, "DropTable");
    assert.equal(ops[1].tag, "CreateTable");
  });
});

// ---------------------------------------------------------------------------
// generateUp / generateMigration
// ---------------------------------------------------------------------------

describe("generateUp()", () => {
  it("generates CREATE TABLE SQL for PostgreSQL", () => {
    const table = makeTable({
      id: makeCol({ type: "string", primaryKey: true }),
      name: makeCol({ type: "string" }),
      age: makeCol({ type: "number", nullable: true }),
    });
    const sql = generateUp({ tag: "CreateTable", table: "users", snapshot: table }, pgDialect);

    assert.ok(sql.includes("CREATE TABLE"));
    assert.ok(sql.includes('"users"'));
    assert.ok(sql.includes('"id"'));
    assert.ok(sql.includes("PRIMARY KEY"));
    assert.ok(sql.includes("NOT NULL"));
  });

  it("generates CREATE TABLE SQL for SQLite", () => {
    const table = makeTable({
      id: makeCol({ type: "string", primaryKey: true }),
      active: makeCol({ type: "boolean", default: "false" }),
    });
    const sql = generateUp({ tag: "CreateTable", table: "items", snapshot: table }, sqliteDialect);

    assert.ok(sql.includes("CREATE TABLE"));
    assert.ok(sql.includes("INTEGER")); // SQLite maps boolean to INTEGER
  });

  it("generates ALTER TABLE ADD COLUMN", () => {
    const sql = generateUp(
      { tag: "AddColumn", table: "users", column: "email", snapshot: makeCol({ unique: true }) },
      pgDialect,
    );

    assert.ok(sql.includes("ALTER TABLE"));
    assert.ok(sql.includes("ADD COLUMN"));
    assert.ok(sql.includes('"email"'));
    assert.ok(sql.includes("UNIQUE"));
  });

  it("generates ALTER TABLE DROP COLUMN", () => {
    const sql = generateUp(
      { tag: "DropColumn", table: "users", column: "age", snapshot: makeCol() },
      pgDialect,
    );

    assert.ok(sql.includes("DROP COLUMN"));
    assert.ok(sql.includes('"age"'));
  });

  it("generates DROP TABLE", () => {
    const sql = generateUp(
      {
        tag: "DropTable",
        table: "old",
        snapshot: makeTable({ id: makeCol({ primaryKey: true }) }),
      },
      pgDialect,
    );

    assert.equal(sql, 'DROP TABLE "old";');
  });

  it("generates CREATE INDEX", () => {
    const sql = generateUp(
      {
        tag: "AddIndex",
        table: "users",
        index: { name: "idx_users_email", columns: ["email"], unique: true },
      },
      pgDialect,
    );

    assert.ok(sql.includes("CREATE UNIQUE INDEX"));
    assert.ok(sql.includes('"idx_users_email"'));
  });

  it("generates DROP INDEX", () => {
    const sql = generateUp({ tag: "DropIndex", table: "users", indexName: "idx_old" }, pgDialect);

    assert.equal(sql, 'DROP INDEX "idx_old";');
  });
});

describe("generateMigration()", () => {
  it("produces up and down SQL", () => {
    const ops = diffSnapshots(emptySnapshot, {
      ...emptySnapshot,
      tables: {
        users: makeTable({ id: makeCol({ type: "string", primaryKey: true }), name: makeCol() }),
      },
    });

    const migration = generateMigration(ops, pgDialect);

    assert.ok(migration.up.includes("CREATE TABLE"));
    assert.ok(migration.down.includes("DROP TABLE"));
  });

  it("down reverses the up operations", () => {
    const from: SchemaSnapshot = {
      ...emptySnapshot,
      tables: { users: makeTable({ id: makeCol({ primaryKey: true }) }) },
    };
    const to: SchemaSnapshot = {
      ...emptySnapshot,
      tables: {
        users: makeTable({ id: makeCol({ primaryKey: true }), email: makeCol({ unique: true }) }),
      },
    };

    const ops = diffSnapshots(from, to);
    const migration = generateMigration(ops, pgDialect);

    assert.ok(migration.up.includes("ADD COLUMN"));
    assert.ok(migration.down.includes("DROP COLUMN"));
  });

  it("is frozen", () => {
    const migration = generateMigration([], pgDialect);

    assert.ok(Object.isFrozen(migration));
  });
});

// ---------------------------------------------------------------------------
// MigrationModel
// ---------------------------------------------------------------------------

describe("MigrationModel", () => {
  it("has table name _pure_orm_migrations", () => {
    assert.equal(MigrationModel.$name, "_pure_orm_migrations");
  });

  it("has expected columns", () => {
    const names = MigrationModel.$columns.map(c => c.name);

    assert.ok(names.includes("id"));
    assert.ok(names.includes("name"));
    assert.ok(names.includes("appliedAt"));
    assert.ok(names.includes("checksum"));
    assert.ok(names.includes("executionMs"));
  });

  it("resolves column names to snake_case", () => {
    const appliedCol = MigrationModel.$columns.find(c => c.name === "appliedAt");
    assert.equal(appliedCol?.columnName, "applied_at");

    const execCol = MigrationModel.$columns.find(c => c.name === "executionMs");
    assert.equal(execCol?.columnName, "execution_ms");
  });
});

// ---------------------------------------------------------------------------
// End-to-end: snapshot -> diff -> generate
// ---------------------------------------------------------------------------

describe("end-to-end migration pipeline", () => {
  it("snapshot -> diff -> generate for new models", () => {
    const snap = createSnapshot([User, Post]);
    const ops = diffSnapshots(emptySnapshot, snap);
    const migration = generateMigration(ops, pgDialect);

    // Should create both tables
    assert.ok(migration.up.includes('"users"'));
    assert.ok(migration.up.includes('"posts"'));
    assert.ok(migration.up.includes("CREATE TABLE"));

    // Down should drop both
    assert.ok(migration.down.includes("DROP TABLE"));
  });

  it("detects column additions between snapshots", () => {
    const v1 = createSnapshot([
      Model("items", { fields: { id: Field(Schema.string, { primaryKey: true }) } }),
    ]);
    const v2 = createSnapshot([
      Model("items", {
        fields: {
          id: Field(Schema.string, { primaryKey: true }),
          name: Field(Schema.string),
        },
      }),
    ]);

    const ops = diffSnapshots(v1, v2);

    assert.equal(ops.length, 1);
    assert.equal(ops[0].tag, "AddColumn");
    if (ops[0].tag === "AddColumn") {
      assert.equal(ops[0].column, "name");
    }

    const migration = generateMigration(ops, pgDialect);
    assert.ok(migration.up.includes("ADD COLUMN"));
  });
});
