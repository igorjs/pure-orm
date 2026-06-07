// Copyright 2026 igorjs. SPDX-License-Identifier: Apache-2.0

/**
 * Tests for rename detection in the schema differ (ADR-0004).
 *
 * A rename declared in code via `renamedFrom` must produce a first-class
 * RenameTable/RenameColumn operation — never a drop-plus-add, which destroys
 * data. The heuristic detector surfaces *candidate* renames for unannotated
 * drop+add pairs as a hint, without auto-applying them.
 */

import { Schema } from "@igorjs/pure-fx";
import { describe, expect, it } from "@igorjs/pure-test";
import { createPostgresDialect } from "../src/dialect/postgresql.ts";
import { detectRenameCandidates, diffSnapshots, diffTable } from "../src/migration/differ.ts";
import { generateDown, generateUp } from "../src/migration/generator.ts";
import { createSnapshot, snapshotColumn, snapshotTable } from "../src/migration/snapshot.ts";
import type { ColumnSnapshot, SchemaSnapshot, TableSnapshot } from "../src/migration/types.ts";
import { Model } from "../src/model/define.ts";
import { Field } from "../src/model/field.ts";

const pg = createPostgresDialect();

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

const makeTable = (
  columns: Record<string, ColumnSnapshot>,
  overrides: Partial<TableSnapshot> = {},
): TableSnapshot =>
  Object.freeze({
    columns: Object.freeze(columns),
    indexes: Object.freeze([]),
    foreignKeys: Object.freeze([]),
    checkConstraints: Object.freeze([]),
    ...overrides,
  });

const snapshotOf = (tables: Record<string, TableSnapshot>): SchemaSnapshot =>
  Object.freeze({
    version: 1 as const,
    generatedAt: "2026-01-01T00:00:00Z",
    tables: Object.freeze(tables),
  });

// ---------------------------------------------------------------------------
// Annotated column rename
// ---------------------------------------------------------------------------

describe("diffTable() column rename via renamedFrom", () => {
  it("emits a single RenameColumn instead of drop+add", () => {
    const from = makeTable({ id: makeCol({ primaryKey: true }), name: makeCol() });
    const to = makeTable({
      id: makeCol({ primaryKey: true }),
      full_name: makeCol({ renamedFrom: "name" }),
    });

    const ops = diffTable("users", from, to);

    expect(ops.length).toBe(1);
    expect(ops[0].tag).toBe("RenameColumn");
    if (ops[0].tag === "RenameColumn") {
      expect(ops[0].from).toBe("name");
      expect(ops[0].to).toBe("full_name");
      expect(ops[0].table).toBe("users");
    }
  });

  it("does not emit DropColumn for the renamed-away source column", () => {
    const from = makeTable({ id: makeCol({ primaryKey: true }), name: makeCol() });
    const to = makeTable({
      id: makeCol({ primaryKey: true }),
      full_name: makeCol({ renamedFrom: "name" }),
    });

    const ops = diffTable("users", from, to);

    expect(ops.some(o => o.tag === "DropColumn")).toBe(false);
    expect(ops.some(o => o.tag === "AddColumn")).toBe(false);
  });

  it("ignores renamedFrom that does not match any existing column (treats as add)", () => {
    const from = makeTable({ id: makeCol({ primaryKey: true }) });
    const to = makeTable({
      id: makeCol({ primaryKey: true }),
      full_name: makeCol({ renamedFrom: "ghost" }),
    });

    const ops = diffTable("users", from, to);

    expect(ops.length).toBe(1);
    expect(ops[0].tag).toBe("AddColumn");
  });
});

// ---------------------------------------------------------------------------
// Annotated table rename
// ---------------------------------------------------------------------------

describe("diffSnapshots() table rename via renamedFrom", () => {
  it("emits RenameTable instead of drop+create", () => {
    const from = snapshotOf({ users: makeTable({ id: makeCol({ primaryKey: true }) }) });
    const to = snapshotOf({
      app_users: makeTable({ id: makeCol({ primaryKey: true }) }, { renamedFrom: "users" }),
    });

    const ops = diffSnapshots(from, to);

    expect(ops.some(o => o.tag === "RenameTable")).toBe(true);
    expect(ops.some(o => o.tag === "DropTable")).toBe(false);
    expect(ops.some(o => o.tag === "CreateTable")).toBe(false);
    const rename = ops.find(o => o.tag === "RenameTable");
    if (rename?.tag === "RenameTable") {
      expect(rename.from).toBe("users");
      expect(rename.to).toBe("app_users");
    }
  });
});

// ---------------------------------------------------------------------------
// Heuristic candidate detection (hint only, never auto-applied)
// ---------------------------------------------------------------------------

describe("detectRenameCandidates()", () => {
  it("pairs a dropped column with an added column of identical shape", () => {
    const from = { name: makeCol({ type: "string" }) };
    const to = { full_name: makeCol({ type: "string" }) };

    const candidates = detectRenameCandidates(from, to);

    expect(candidates.length).toBe(1);
    expect(candidates[0].from).toBe("name");
    expect(candidates[0].to).toBe("full_name");
  });

  it("does not pair columns with incompatible shapes", () => {
    const from = { count: makeCol({ type: "number" }) };
    const to = { label: makeCol({ type: "string" }) };

    expect(detectRenameCandidates(from, to).length).toBe(0);
  });

  it("excludes pairs already resolved by a renamedFrom annotation", () => {
    const from = { name: makeCol({ type: "string" }) };
    const to = { full_name: makeCol({ type: "string", renamedFrom: "name" }) };

    expect(detectRenameCandidates(from, to).length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Generator SQL for rename operations
// ---------------------------------------------------------------------------

describe("generateUp/Down for renames", () => {
  it("RenameColumn up emits ALTER TABLE ... RENAME COLUMN", () => {
    const sql = generateUp(
      { tag: "RenameColumn", table: "users", from: "name", to: "full_name" },
      pg,
    );
    expect(sql).toBe('ALTER TABLE "users" RENAME COLUMN "name" TO "full_name";');
  });

  it("RenameColumn down reverses the rename", () => {
    const sql = generateDown(
      { tag: "RenameColumn", table: "users", from: "name", to: "full_name" },
      pg,
    );
    expect(sql).toBe('ALTER TABLE "users" RENAME COLUMN "full_name" TO "name";');
  });

  it("RenameTable up emits ALTER TABLE ... RENAME TO", () => {
    const sql = generateUp({ tag: "RenameTable", from: "users", to: "app_users" }, pg);
    expect(sql).toBe('ALTER TABLE "users" RENAME TO "app_users";');
  });

  it("RenameTable down reverses the rename", () => {
    const sql = generateDown({ tag: "RenameTable", from: "users", to: "app_users" }, pg);
    expect(sql).toBe('ALTER TABLE "app_users" RENAME TO "users";');
  });
});

// ---------------------------------------------------------------------------
// Snapshot captures renamedFrom annotations
// ---------------------------------------------------------------------------

describe("snapshot captures renamedFrom", () => {
  it("snapshotColumn records a column renamedFrom from field config", () => {
    const m = Model("users", {
      fields: {
        id: Field(Schema.string, { primaryKey: true }),
        fullName: Field(Schema.string, { renamedFrom: "name" }),
      },
    });
    const col = m.$columns.find(c => c.name === "fullName");
    expect(col !== undefined).toBeTruthy();
    if (col !== undefined) {
      expect(snapshotColumn(col).renamedFrom).toBe("name");
    }
  });

  it("snapshotTable records a table renamedFrom from model options", () => {
    const m = Model("app_users", {
      fields: { id: Field(Schema.string, { primaryKey: true }) },
      options: { renamedFrom: "users" },
    });
    expect(snapshotTable(m).renamedFrom).toBe("users");
  });

  it("end-to-end: createSnapshot then diff yields a RenameColumn", () => {
    const v1 = snapshotOf({
      users: makeTable({ id: makeCol({ primaryKey: true }), name: makeCol() }),
    });
    const v2 = createSnapshot([
      Model("users", {
        fields: {
          id: Field(Schema.string, { primaryKey: true }),
          fullName: Field(Schema.string, { renamedFrom: "name", columnName: "full_name" }),
        },
      }),
    ]);

    const ops = diffSnapshots(v1, v2);
    expect(ops.some(o => o.tag === "RenameColumn")).toBe(true);
  });
});
