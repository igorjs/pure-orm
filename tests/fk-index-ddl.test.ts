// Copyright 2026 igorjs. SPDX-License-Identifier: Apache-2.0

/**
 * Tests for foreign-key emission in CREATE TABLE and reversible DROP INDEX
 * (ADR-0005 partial). Foreign keys are already captured in the snapshot but
 * never reached generated SQL; DROP INDEX previously emitted a MANUAL REVIEW
 * comment on the down path because the op did not carry the index definition.
 */

import { Schema } from "@igorjs/pure-fx";
import { describe, expect, it } from "@igorjs/pure-test";
import { createPostgresDialect } from "../src/dialect/postgresql.ts";
import { createSqliteDialect } from "../src/dialect/sqlite.ts";
import { diffTable } from "../src/migration/differ.ts";
import { generateDown, generateUp } from "../src/migration/generator.ts";
import { createSnapshot } from "../src/migration/snapshot.ts";
import type {
  ColumnSnapshot,
  ForeignKeySnapshot,
  IndexSnapshot,
  TableSnapshot,
} from "../src/migration/types.ts";
import { Model } from "../src/model/define.ts";
import { Field } from "../src/model/field.ts";

const pg = createPostgresDialect();
const sqlite = createSqliteDialect();

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

const fk = (overrides: Partial<ForeignKeySnapshot> = {}): ForeignKeySnapshot =>
  Object.freeze({
    column: "author_id",
    referencedTable: "users",
    referencedColumn: "id",
    onDelete: "cascade",
    onUpdate: "no action",
    ...overrides,
  });

const makeTable = (overrides: Partial<TableSnapshot> = {}): TableSnapshot =>
  Object.freeze({
    columns: Object.freeze({ id: makeCol({ primaryKey: true }), author_id: makeCol() }),
    indexes: Object.freeze([]),
    foreignKeys: Object.freeze([]),
    ...overrides,
  });

// ---------------------------------------------------------------------------
// Foreign keys in CREATE TABLE
// ---------------------------------------------------------------------------

describe("CREATE TABLE foreign keys (PostgreSQL)", () => {
  it("emits a FOREIGN KEY constraint clause", () => {
    const snapshot = makeTable({ foreignKeys: Object.freeze([fk()]) });
    const sql = generateUp({ tag: "CreateTable", table: "posts", snapshot }, pg);

    expect(sql.includes('FOREIGN KEY ("author_id")')).toBeTruthy();
    expect(sql.includes('REFERENCES "users" ("id")')).toBeTruthy();
  });

  it("emits ON DELETE for a non-default action, but omits the default ON UPDATE", () => {
    const snapshot = makeTable({
      foreignKeys: Object.freeze([fk({ onDelete: "cascade", onUpdate: "no action" })]),
    });
    const sql = generateUp({ tag: "CreateTable", table: "posts", snapshot }, pg);

    expect(sql.includes("ON DELETE CASCADE")).toBeTruthy();
    expect(sql.includes("ON UPDATE")).toBe(false);
  });

  it("emits ON DELETE SET NULL with correct spacing", () => {
    const snapshot = makeTable({ foreignKeys: Object.freeze([fk({ onDelete: "set null" })]) });
    const sql = generateUp({ tag: "CreateTable", table: "posts", snapshot }, pg);

    expect(sql.includes("ON DELETE SET NULL")).toBeTruthy();
  });

  it("omits the FK clause entirely when there are no foreign keys", () => {
    const sql = generateUp({ tag: "CreateTable", table: "posts", snapshot: makeTable() }, pg);

    expect(sql.includes("FOREIGN KEY")).toBe(false);
  });
});

describe("CREATE TABLE foreign keys (SQLite)", () => {
  it("emits a FOREIGN KEY clause for SQLite too", () => {
    const snapshot = makeTable({ foreignKeys: Object.freeze([fk()]) });
    const sql = generateUp({ tag: "CreateTable", table: "posts", snapshot }, sqlite);

    expect(sql.includes('FOREIGN KEY ("author_id")')).toBeTruthy();
    expect(sql.includes('REFERENCES "users" ("id")')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Reversible DROP INDEX (no more MANUAL REVIEW)
// ---------------------------------------------------------------------------

const idx: IndexSnapshot = Object.freeze({
  name: "idx_users_email",
  columns: Object.freeze(["email"]),
  unique: true,
});

describe("DROP INDEX is reversible", () => {
  it("up drops the index", () => {
    const sql = generateUp({ tag: "DropIndex", table: "users", index: idx }, pg);
    expect(sql).toBe('DROP INDEX "idx_users_email";');
  });

  it("down recreates the index instead of a MANUAL REVIEW comment", () => {
    const sql = generateDown({ tag: "DropIndex", table: "users", index: idx }, pg);
    expect(sql).toBe('CREATE UNIQUE INDEX "idx_users_email" ON "users" ("email");');
    expect(sql.includes("MANUAL REVIEW")).toBe(false);
  });

  it("down recreates a non-unique multi-column index", () => {
    const multi: IndexSnapshot = Object.freeze({
      name: "idx_posts_author_published",
      columns: Object.freeze(["author_id", "published"]),
      unique: false,
    });
    const sql = generateDown({ tag: "DropIndex", table: "posts", index: multi }, pg);
    expect(sql).toBe(
      'CREATE INDEX "idx_posts_author_published" ON "posts" ("author_id", "published");',
    );
  });
});

describe("snapshot resolves referencedColumn to the SQL column name", () => {
  it("maps a referenced field name to its snake_case column name", () => {
    const Org = Model("orgs", {
      fields: { orgId: Field(Schema.string, { primaryKey: true }) },
    });
    const User = Model("users", {
      fields: {
        id: Field(Schema.string, { primaryKey: true }),
        org: Field(Schema.string, { references: () => [Org, "orgId"], columnName: "org_id" }),
      },
    });

    const snap = createSnapshot([Org, User]);
    const userFk = snap.tables.users?.foreignKeys[0];

    expect(userFk !== undefined).toBeTruthy();
    if (userFk !== undefined) {
      expect(userFk.column).toBe("org_id");
      expect(userFk.referencedColumn).toBe("org_id"); // not the field name "orgId"
    }
  });
});

describe("diffTable() carries the index definition on DropIndex", () => {
  it("emits DropIndex with the full index snapshot", () => {
    const from = makeTable({ indexes: Object.freeze([idx]) });
    const to = makeTable();

    const ops = diffTable("users", from, to);
    const drop = ops.find(o => o.tag === "DropIndex");

    expect(drop !== undefined).toBeTruthy();
    if (drop?.tag === "DropIndex") {
      expect(drop.index.name).toBe("idx_users_email");
      expect(drop.index.unique).toBe(true);
    }
  });
});
