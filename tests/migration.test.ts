/**
 * Tests for the migration system: snapshot, differ, and SQL generator.
 */

import { Schema } from "@igorjs/pure-fx";
import { describe, expect, it } from "@igorjs/pure-test";
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
    expect(idCol !== undefined).toBeTruthy();
    const snap = snapshotColumn(idCol);

    expect(snap.primaryKey).toBe(true);
  });

  it("extracts unique from field config", () => {
    const emailCol = User.$columns.find(c => c.name === "email");
    expect(emailCol !== undefined).toBeTruthy();
    const snap = snapshotColumn(emailCol);

    expect(snap.unique).toBe(true);
  });

  it("extracts default from field config", () => {
    const idCol = User.$columns.find(c => c.name === "id");
    expect(idCol !== undefined).toBeTruthy();
    const snap = snapshotColumn(idCol);

    expect(snap.default).toBe("uuid");
  });

  it("returns null default when none set", () => {
    const nameCol = User.$columns.find(c => c.name === "name");
    expect(nameCol !== undefined).toBeTruthy();
    const snap = snapshotColumn(nameCol);

    expect(snap.default).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// snapshotTable()
// ---------------------------------------------------------------------------

describe("snapshotTable()", () => {
  it("creates a table snapshot with all columns", () => {
    const snap = snapshotTable(User);

    expect("id" in snap.columns).toBeTruthy();
    expect("email" in snap.columns).toBeTruthy();
    expect("name" in snap.columns).toBeTruthy();
    expect("age" in snap.columns).toBeTruthy();
    // Timestamp columns
    expect("created_at" in snap.columns).toBeTruthy();
    expect("updated_at" in snap.columns).toBeTruthy();
  });

  it("uses snake_case column names as keys", () => {
    const snap = snapshotTable(User);
    const keys = Object.keys(snap.columns);

    expect(keys.includes("created_at")).toBeTruthy();
    expect(keys.includes("updated_at")).toBeTruthy();
    expect(!keys.includes("createdAt")).toBeTruthy();
  });

  it("generates unique index entries for unique columns", () => {
    const snap = snapshotTable(User);

    const emailIndex = snap.indexes.find(i => i.columns.includes("email"));
    expect(emailIndex !== undefined).toBeTruthy();
    expect(emailIndex.unique).toBe(true);
  });

  it("is frozen", () => {
    const snap = snapshotTable(User);

    expect(Object.isFrozen(snap)).toBeTruthy();
    expect(Object.isFrozen(snap.columns)).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// createSnapshot()
// ---------------------------------------------------------------------------

describe("createSnapshot()", () => {
  it("creates a snapshot with version 1", () => {
    const snap = createSnapshot([User]);

    expect(snap.version).toBe(1);
  });

  it("includes all provided models", () => {
    const snap = createSnapshot([User, Post]);

    expect("users" in snap.tables).toBeTruthy();
    expect("posts" in snap.tables).toBeTruthy();
    expect(Object.keys(snap.tables).length).toBe(2);
  });

  it("sets generatedAt to a valid ISO date", () => {
    const snap = createSnapshot([User]);

    expect(snap.generatedAt.includes("T")).toBeTruthy();
    expect(!Number.isNaN(Date.parse(snap.generatedAt))).toBeTruthy();
  });

  it("is frozen", () => {
    const snap = createSnapshot([User]);

    expect(Object.isFrozen(snap)).toBeTruthy();
    expect(Object.isFrozen(snap.tables)).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// columnsEqual()
// ---------------------------------------------------------------------------

describe("columnsEqual()", () => {
  it("returns true for identical columns", () => {
    const a = makeCol({ type: "string", unique: true });
    const b = makeCol({ type: "string", unique: true });

    expect(columnsEqual(a, b)).toBe(true);
  });

  it("returns false when type differs", () => {
    expect(columnsEqual(makeCol({ type: "string" }), makeCol({ type: "number" }))).toBe(false);
  });

  it("returns false when nullable differs", () => {
    expect(columnsEqual(makeCol({ nullable: false }), makeCol({ nullable: true }))).toBe(false);
  });

  it("returns false when unique differs", () => {
    expect(columnsEqual(makeCol({ unique: false }), makeCol({ unique: true }))).toBe(false);
  });

  it("returns false when default differs", () => {
    expect(columnsEqual(makeCol({ default: null }), makeCol({ default: "uuid" }))).toBe(false);
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

    expect(ops.length).toBe(1);
    expect(ops[0].tag).toBe("AddColumn");
    if (ops[0].tag === "AddColumn") {
      expect(ops[0].column).toBe("name");
    }
  });

  it("detects dropped columns", () => {
    const from = makeTable({ id: makeCol({ primaryKey: true }), name: makeCol() });
    const to = makeTable({ id: makeCol({ primaryKey: true }) });

    const ops = diffTable("users", from, to);

    expect(ops.length).toBe(1);
    expect(ops[0].tag).toBe("DropColumn");
    if (ops[0].tag === "DropColumn") {
      expect(ops[0].column).toBe("name");
    }
  });

  it("detects altered columns", () => {
    const from = makeTable({ id: makeCol({ primaryKey: true }), age: makeCol({ type: "string" }) });
    const to = makeTable({ id: makeCol({ primaryKey: true }), age: makeCol({ type: "number" }) });

    const ops = diffTable("users", from, to);

    expect(ops.length).toBe(1);
    expect(ops[0].tag).toBe("AlterColumn");
    if (ops[0].tag === "AlterColumn") {
      expect(ops[0].from.type).toBe("string");
      expect(ops[0].to.type).toBe("number");
    }
  });

  it("returns empty array when tables are identical", () => {
    const table = makeTable({ id: makeCol({ primaryKey: true }), name: makeCol() });
    const ops = diffTable("users", table, table);

    expect(ops.length).toBe(0);
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

    expect(ops.length).toBe(1);
    expect(ops[0].tag).toBe("CreateTable");
    if (ops[0].tag === "CreateTable") {
      expect(ops[0].table).toBe("users");
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

    expect(ops.length).toBe(1);
    expect(ops[0].tag).toBe("DropTable");
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

    expect(ops.length).toBe(1);
    expect(ops[0].tag).toBe("AddColumn");
  });

  it("returns empty array for identical snapshots", () => {
    const snap: SchemaSnapshot = Object.freeze({
      ...emptySnapshot,
      tables: Object.freeze({
        users: makeTable({ id: makeCol({ primaryKey: true }) }),
      }),
    });

    const ops = diffSnapshots(snap, snap);

    expect(ops.length).toBe(0);
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

    expect(ops.length).toBe(2);
    expect(ops[0].tag).toBe("DropTable");
    expect(ops[1].tag).toBe("CreateTable");
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

    expect(sql.includes("CREATE TABLE")).toBeTruthy();
    expect(sql.includes('"users"')).toBeTruthy();
    expect(sql.includes('"id"')).toBeTruthy();
    expect(sql.includes("PRIMARY KEY")).toBeTruthy();
    expect(sql.includes("NOT NULL")).toBeTruthy();
  });

  it("generates CREATE TABLE SQL for SQLite", () => {
    const table = makeTable({
      id: makeCol({ type: "string", primaryKey: true }),
      active: makeCol({ type: "boolean", default: "false" }),
    });
    const sql = generateUp({ tag: "CreateTable", table: "items", snapshot: table }, sqliteDialect);

    expect(sql.includes("CREATE TABLE")).toBeTruthy();
    expect(sql.includes("INTEGER")).toBeTruthy(); // SQLite maps boolean to INTEGER
  });

  it("generates ALTER TABLE ADD COLUMN", () => {
    const sql = generateUp(
      { tag: "AddColumn", table: "users", column: "email", snapshot: makeCol({ unique: true }) },
      pgDialect,
    );

    expect(sql.includes("ALTER TABLE")).toBeTruthy();
    expect(sql.includes("ADD COLUMN")).toBeTruthy();
    expect(sql.includes('"email"')).toBeTruthy();
    expect(sql.includes("UNIQUE")).toBeTruthy();
  });

  it("generates ALTER TABLE DROP COLUMN", () => {
    const sql = generateUp(
      { tag: "DropColumn", table: "users", column: "age", snapshot: makeCol() },
      pgDialect,
    );

    expect(sql.includes("DROP COLUMN")).toBeTruthy();
    expect(sql.includes('"age"')).toBeTruthy();
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

    expect(sql).toBe('DROP TABLE "old";');
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

    expect(sql.includes("CREATE UNIQUE INDEX")).toBeTruthy();
    expect(sql.includes('"idx_users_email"')).toBeTruthy();
  });

  it("generates DROP INDEX", () => {
    const sql = generateUp({ tag: "DropIndex", table: "users", indexName: "idx_old" }, pgDialect);

    expect(sql).toBe('DROP INDEX "idx_old";');
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

    expect(migration.up.includes("CREATE TABLE")).toBeTruthy();
    expect(migration.down.includes("DROP TABLE")).toBeTruthy();
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

    expect(migration.up.includes("ADD COLUMN")).toBeTruthy();
    expect(migration.down.includes("DROP COLUMN")).toBeTruthy();
  });

  it("is frozen", () => {
    const migration = generateMigration([], pgDialect);

    expect(Object.isFrozen(migration)).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// MigrationModel
// ---------------------------------------------------------------------------

describe("MigrationModel", () => {
  it("has table name _pure_orm_migrations", () => {
    expect(MigrationModel.$name).toBe("_pure_orm_migrations");
  });

  it("has expected columns", () => {
    const names = MigrationModel.$columns.map(c => c.name);

    expect(names.includes("id")).toBeTruthy();
    expect(names.includes("name")).toBeTruthy();
    expect(names.includes("appliedAt")).toBeTruthy();
    expect(names.includes("checksum")).toBeTruthy();
    expect(names.includes("executionMs")).toBeTruthy();
  });

  it("resolves column names to snake_case", () => {
    const appliedCol = MigrationModel.$columns.find(c => c.name === "appliedAt");
    expect(appliedCol?.columnName).toBe("applied_at");

    const execCol = MigrationModel.$columns.find(c => c.name === "executionMs");
    expect(execCol?.columnName).toBe("execution_ms");
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
    expect(migration.up.includes('"users"')).toBeTruthy();
    expect(migration.up.includes('"posts"')).toBeTruthy();
    expect(migration.up.includes("CREATE TABLE")).toBeTruthy();

    // Down should drop both
    expect(migration.down.includes("DROP TABLE")).toBeTruthy();
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

    expect(ops.length).toBe(1);
    expect(ops[0].tag).toBe("AddColumn");
    if (ops[0].tag === "AddColumn") {
      expect(ops[0].column).toBe("name");
    }

    const migration = generateMigration(ops, pgDialect);
    expect(migration.up.includes("ADD COLUMN")).toBeTruthy();
  });
});
