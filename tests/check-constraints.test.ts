// Copyright 2026 igorjs. SPDX-License-Identifier: Apache-2.0

/**
 * Tests for CHECK constraint snapshotting, diffing, and DDL emission
 * (ADR-0005 part 2). Mirrors the structure of fk-index-ddl.test.ts.
 */

import { Schema } from "@igorjs/pure-fx";
import { describe, expect, it } from "@igorjs/pure-test";
import { createMysqlDialect } from "../src/dialect/mysql.ts";
import { createPostgresDialect } from "../src/dialect/postgresql.ts";
import { createSqliteDialect } from "../src/dialect/sqlite.ts";
import { diffSnapshots } from "../src/migration/differ.ts";
import { generateDown, generateUp } from "../src/migration/generator.ts";
import { createSnapshot } from "../src/migration/snapshot.ts";
import type {
  CheckConstraintSnapshot,
  ColumnSnapshot,
  SchemaSnapshot,
  TableSnapshot,
} from "../src/migration/types.ts";
import { Model } from "../src/model/define.ts";
import { Field } from "../src/model/field.ts";

const pg = createPostgresDialect();
const sqlite = createSqliteDialect();
const mysql = createMysqlDialect();

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

const chk = (overrides: Partial<CheckConstraintSnapshot> = {}): CheckConstraintSnapshot =>
  Object.freeze({
    name: "users_age_positive",
    expression: "age >= 0",
    ...overrides,
  });

const makeTable = (overrides: Partial<TableSnapshot> = {}): TableSnapshot =>
  Object.freeze({
    columns: Object.freeze({ id: makeCol({ primaryKey: true }), age: makeCol({ type: "number" }) }),
    indexes: Object.freeze([]),
    foreignKeys: Object.freeze([]),
    checkConstraints: Object.freeze([]),
    ...overrides,
  });

const makeSnap = (tables: Readonly<Record<string, TableSnapshot>>): SchemaSnapshot =>
  Object.freeze({
    version: 1 as const,
    generatedAt: "2026-06-07T00:00:00.000Z",
    tables: Object.freeze(tables),
  });

// ---------------------------------------------------------------------------
// CREATE TABLE inline CHECK constraints
// ---------------------------------------------------------------------------

describe("CREATE TABLE inline CHECK constraint", () => {
  it("PostgreSQL emits a CONSTRAINT … CHECK clause", () => {
    const snapshot = makeTable({ checkConstraints: [chk()] });
    const sql = generateUp({ tag: "CreateTable", table: "users", snapshot }, pg);
    expect(sql.includes('CONSTRAINT "users_age_positive" CHECK (age >= 0)')).toBeTruthy();
  });

  it("SQLite emits the same inline form (the only path SQLite supports)", () => {
    const snapshot = makeTable({ checkConstraints: [chk()] });
    const sql = generateUp({ tag: "CreateTable", table: "users", snapshot }, sqlite);
    expect(sql.includes('CONSTRAINT "users_age_positive" CHECK (age >= 0)')).toBeTruthy();
  });

  it("MySQL emits the same inline form", () => {
    const snapshot = makeTable({ checkConstraints: [chk()] });
    const sql = generateUp({ tag: "CreateTable", table: "users", snapshot }, mysql);
    expect(sql.includes('CONSTRAINT "users_age_positive" CHECK (age >= 0)')).toBeTruthy();
  });

  it("omits any CHECK clause when there are no constraints", () => {
    const sql = generateUp({ tag: "CreateTable", table: "users", snapshot: makeTable() }, pg);
    expect(sql.includes("CHECK")).toBe(false);
  });

  it("emits multiple CHECKs in declaration order", () => {
    const snapshot = makeTable({
      checkConstraints: [
        chk({ name: "a", expression: "x > 0" }),
        chk({ name: "b", expression: "y < 100" }),
      ],
    });
    const sql = generateUp({ tag: "CreateTable", table: "users", snapshot }, pg);
    const aIdx = sql.indexOf('CONSTRAINT "a"');
    const bIdx = sql.indexOf('CONSTRAINT "b"');
    expect(aIdx > -1).toBeTruthy();
    expect(bIdx > -1).toBeTruthy();
    expect(aIdx < bIdx).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// AddCheckConstraint generator
// ---------------------------------------------------------------------------

describe("AddCheckConstraint generator", () => {
  it("PostgreSQL emits ALTER TABLE ADD CONSTRAINT … CHECK", () => {
    const sql = generateUp({ tag: "AddCheckConstraint", table: "users", check: chk() }, pg);
    expect(sql).toBe('ALTER TABLE "users" ADD CONSTRAINT "users_age_positive" CHECK (age >= 0);');
  });

  it("MySQL emits the same form (the divergence is on DROP)", () => {
    const sql = generateUp({ tag: "AddCheckConstraint", table: "users", check: chk() }, mysql);
    expect(sql).toBe('ALTER TABLE "users" ADD CONSTRAINT "users_age_positive" CHECK (age >= 0);');
  });

  it("SQLite throws — CHECKs are inline-only", () => {
    let caught: unknown;
    try {
      generateUp({ tag: "AddCheckConstraint", table: "users", check: chk() }, sqlite);
    } catch (err) {
      caught = err;
    }
    expect(caught instanceof Error).toBeTruthy();
    expect((caught as Error).message.includes("sqlite")).toBeTruthy();
    expect((caught as Error).message.includes("table-rebuild")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// DropCheckConstraint generator (dialect divergence here)
// ---------------------------------------------------------------------------

describe("DropCheckConstraint generator", () => {
  it("PostgreSQL says DROP CONSTRAINT", () => {
    const sql = generateUp({ tag: "DropCheckConstraint", table: "users", check: chk() }, pg);
    expect(sql).toBe('ALTER TABLE "users" DROP CONSTRAINT "users_age_positive";');
  });

  it("MySQL says DROP CHECK (not DROP CONSTRAINT)", () => {
    const sql = generateUp({ tag: "DropCheckConstraint", table: "users", check: chk() }, mysql);
    expect(sql).toBe('ALTER TABLE "users" DROP CHECK "users_age_positive";');
    expect(sql.includes("DROP CONSTRAINT")).toBe(false);
  });

  it("SQLite throws on DROP too", () => {
    let caught: unknown;
    try {
      generateUp({ tag: "DropCheckConstraint", table: "users", check: chk() }, sqlite);
    } catch (err) {
      caught = err;
    }
    expect(caught instanceof Error).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Up/down inverses
// ---------------------------------------------------------------------------

describe("AddCheckConstraint / DropCheckConstraint down paths are inverses", () => {
  it("AddCheckConstraint down emits DROP CONSTRAINT", () => {
    const sql = generateDown({ tag: "AddCheckConstraint", table: "users", check: chk() }, pg);
    expect(sql).toBe('ALTER TABLE "users" DROP CONSTRAINT "users_age_positive";');
  });

  it("DropCheckConstraint down emits ADD CONSTRAINT", () => {
    const sql = generateDown({ tag: "DropCheckConstraint", table: "users", check: chk() }, pg);
    expect(sql).toBe('ALTER TABLE "users" ADD CONSTRAINT "users_age_positive" CHECK (age >= 0);');
  });

  it("MySQL down path also swaps keywords correctly (CHECK vs CONSTRAINT)", () => {
    const addDown = generateDown(
      { tag: "AddCheckConstraint", table: "users", check: chk() },
      mysql,
    );
    expect(addDown).toBe('ALTER TABLE "users" DROP CHECK "users_age_positive";');
  });
});

// ---------------------------------------------------------------------------
// diffSnapshots()
// ---------------------------------------------------------------------------

describe("diffSnapshots() detects CHECK constraint changes on existing tables", () => {
  it("emits AddCheckConstraint when a CHECK appears", () => {
    const before = makeSnap({ users: makeTable() });
    const after = makeSnap({ users: makeTable({ checkConstraints: [chk()] }) });
    const ops = diffSnapshots(before, after);
    const add = ops.find(o => o.tag === "AddCheckConstraint");
    expect(add !== undefined).toBeTruthy();
    if (add?.tag === "AddCheckConstraint") {
      expect(add.table).toBe("users");
      expect(add.check.name).toBe("users_age_positive");
    }
  });

  it("emits DropCheckConstraint when a CHECK disappears", () => {
    const before = makeSnap({ users: makeTable({ checkConstraints: [chk()] }) });
    const after = makeSnap({ users: makeTable() });
    const ops = diffSnapshots(before, after);
    const drop = ops.find(o => o.tag === "DropCheckConstraint");
    expect(drop !== undefined).toBeTruthy();
    if (drop?.tag === "DropCheckConstraint") {
      expect(drop.table).toBe("users");
    }
  });

  it("models an expression change as drop + add", () => {
    const before = makeSnap({
      users: makeTable({ checkConstraints: [chk({ expression: "age >= 0" })] }),
    });
    const after = makeSnap({
      users: makeTable({ checkConstraints: [chk({ expression: "age >= 18" })] }),
    });
    const ops = diffSnapshots(before, after);
    expect(ops.some(o => o.tag === "DropCheckConstraint")).toBeTruthy();
    expect(ops.some(o => o.tag === "AddCheckConstraint")).toBeTruthy();
  });

  it("ordering: CHECK drops are early, CHECK adds are late", () => {
    const before = makeSnap({
      users: makeTable({ checkConstraints: [chk({ expression: "age >= 0" })] }),
    });
    const after = makeSnap({
      users: makeTable({ checkConstraints: [chk({ expression: "age >= 18" })] }),
    });
    const ops = diffSnapshots(before, after);
    const firstDrop = ops.findIndex(o => o.tag === "DropCheckConstraint");
    const firstAdd = ops.findIndex(o => o.tag === "AddCheckConstraint");
    expect(firstDrop > -1).toBeTruthy();
    expect(firstAdd > -1).toBeTruthy();
    expect(firstDrop < firstAdd).toBeTruthy();
  });

  it("does not emit CHECK ops when checkConstraints arrays are unchanged", () => {
    const same = makeSnap({ users: makeTable({ checkConstraints: [chk()] }) });
    const ops = diffSnapshots(same, same);
    expect(ops.some(o => o.tag === "AddCheckConstraint" || o.tag === "DropCheckConstraint")).toBe(
      false,
    );
  });

  it("renamed identity = different constraint (deliberately strict)", () => {
    const before = makeSnap({ users: makeTable({ checkConstraints: [chk({ name: "old" })] }) });
    const after = makeSnap({ users: makeTable({ checkConstraints: [chk({ name: "new" })] }) });
    const ops = diffSnapshots(before, after);
    expect(ops.some(o => o.tag === "DropCheckConstraint")).toBeTruthy();
    expect(ops.some(o => o.tag === "AddCheckConstraint")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Snapshot reader: model.options.checks -> snapshot.checkConstraints
// ---------------------------------------------------------------------------

describe("createSnapshot reads model.options.checks", () => {
  it("populates checkConstraints when the model declares checks", () => {
    const User = Model("users", {
      fields: {
        id: Field(Schema.string, { primaryKey: true }),
        age: Field(Schema.number),
      },
      options: {
        checks: [{ name: "users_age_nonneg", expression: "age >= 0" }],
      },
    });

    const snap = createSnapshot([User]);
    expect(snap.tables.users?.checkConstraints.length).toBe(1);
    expect(snap.tables.users?.checkConstraints[0]?.name).toBe("users_age_nonneg");
    expect(snap.tables.users?.checkConstraints[0]?.expression).toBe("age >= 0");
  });

  it("defaults to an empty array when the model omits options.checks", () => {
    const User = Model("users", {
      fields: { id: Field(Schema.string, { primaryKey: true }) },
    });
    const snap = createSnapshot([User]);
    expect(snap.tables.users?.checkConstraints.length).toBe(0);
  });
});
