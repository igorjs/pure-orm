// Copyright 2026 igorjs. SPDX-License-Identifier: Apache-2.0

/**
 * Tests for foreign-key emission in CREATE TABLE and reversible DROP INDEX
 * (ADR-0005 partial). Foreign keys are already captured in the snapshot but
 * never reached generated SQL; DROP INDEX previously emitted a MANUAL REVIEW
 * comment on the down path because the op did not carry the index definition.
 */

import { Schema } from "@igorjs/pure-fx";
import { describe, expect, it } from "@igorjs/pure-test";
import { createMysqlDialect } from "../src/dialect/mysql.ts";
import { createPostgresDialect } from "../src/dialect/postgresql.ts";
import { createSqliteDialect } from "../src/dialect/sqlite.ts";
import { diffSnapshots, diffTable } from "../src/migration/differ.ts";
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
    checkConstraints: Object.freeze([]),
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

// ---------------------------------------------------------------------------
// ALTER TABLE foreign keys (ADR-0005)
// ---------------------------------------------------------------------------

const makeSnap = (
  tables: Readonly<Record<string, TableSnapshot>>,
): {
  readonly version: 1;
  readonly generatedAt: string;
  readonly tables: Readonly<Record<string, TableSnapshot>>;
} =>
  Object.freeze({
    version: 1 as const,
    generatedAt: "2026-06-07T00:00:00.000Z",
    tables: Object.freeze(tables),
  });

describe("AddForeignKey generator", () => {
  it("PostgreSQL emits ALTER TABLE ADD CONSTRAINT", () => {
    const sql = generateUp({ tag: "AddForeignKey", table: "posts", fk: fk() }, pg);
    expect(sql).toBe(
      'ALTER TABLE "posts" ADD CONSTRAINT "fk_posts_author_id" FOREIGN KEY ("author_id") ' +
        'REFERENCES "users" ("id") ON DELETE CASCADE;',
    );
  });

  it("MySQL emits ALTER TABLE ADD CONSTRAINT (same form as PG)", () => {
    const sql = generateUp({ tag: "AddForeignKey", table: "posts", fk: fk() }, mysql);
    expect(sql.startsWith('ALTER TABLE "posts" ADD CONSTRAINT "fk_posts_author_id"')).toBeTruthy();
    expect(sql.includes('FOREIGN KEY ("author_id")')).toBeTruthy();
  });

  it("SQLite throws because it cannot ALTER TABLE for FKs", () => {
    let caught: unknown;
    try {
      generateUp({ tag: "AddForeignKey", table: "posts", fk: fk() }, sqlite);
    } catch (err) {
      caught = err;
    }
    expect(caught instanceof Error).toBeTruthy();
    expect((caught as Error).message.includes("sqlite")).toBeTruthy();
    expect((caught as Error).message.includes("table-rebuild")).toBeTruthy();
  });

  it("constraint name matches the CREATE TABLE inline form", () => {
    const inline = generateUp(
      { tag: "CreateTable", table: "posts", snapshot: makeTable({ foreignKeys: [fk()] }) },
      pg,
    );
    const alter = generateUp({ tag: "AddForeignKey", table: "posts", fk: fk() }, pg);
    expect(inline.includes('CONSTRAINT "fk_posts_author_id"')).toBeTruthy();
    expect(alter.includes('CONSTRAINT "fk_posts_author_id"')).toBeTruthy();
  });
});

describe("DropForeignKey generator", () => {
  it("PostgreSQL emits DROP CONSTRAINT", () => {
    const sql = generateUp({ tag: "DropForeignKey", table: "posts", fk: fk() }, pg);
    expect(sql).toBe('ALTER TABLE "posts" DROP CONSTRAINT "fk_posts_author_id";');
  });

  it("MySQL emits DROP FOREIGN KEY (not DROP CONSTRAINT)", () => {
    const sql = generateUp({ tag: "DropForeignKey", table: "posts", fk: fk() }, mysql);
    expect(sql).toBe('ALTER TABLE "posts" DROP FOREIGN KEY "fk_posts_author_id";');
    expect(sql.includes("DROP CONSTRAINT")).toBe(false);
  });

  it("SQLite throws on DROP FK too", () => {
    let caught: unknown;
    try {
      generateUp({ tag: "DropForeignKey", table: "posts", fk: fk() }, sqlite);
    } catch (err) {
      caught = err;
    }
    expect(caught instanceof Error).toBeTruthy();
  });
});

describe("AddForeignKey / DropForeignKey down paths are inverses", () => {
  it("AddForeignKey down emits DROP CONSTRAINT", () => {
    const sql = generateDown({ tag: "AddForeignKey", table: "posts", fk: fk() }, pg);
    expect(sql).toBe('ALTER TABLE "posts" DROP CONSTRAINT "fk_posts_author_id";');
  });

  it("DropForeignKey down emits ADD CONSTRAINT", () => {
    const sql = generateDown({ tag: "DropForeignKey", table: "posts", fk: fk() }, pg);
    expect(sql.startsWith('ALTER TABLE "posts" ADD CONSTRAINT "fk_posts_author_id"')).toBeTruthy();
    expect(sql.includes('REFERENCES "users" ("id")')).toBeTruthy();
  });
});

describe("diffSnapshots() detects FK changes on existing tables", () => {
  const usersTable = makeTable({
    columns: Object.freeze({ id: makeCol({ primaryKey: true }) }),
  });

  it("emits AddForeignKey when a FK appears", () => {
    const before = makeSnap({ users: usersTable, posts: makeTable() });
    const after = makeSnap({
      users: usersTable,
      posts: makeTable({ foreignKeys: [fk()] }),
    });
    const ops = diffSnapshots(before, after);
    const add = ops.find(o => o.tag === "AddForeignKey");
    expect(add !== undefined).toBeTruthy();
    if (add?.tag === "AddForeignKey") {
      expect(add.table).toBe("posts");
      expect(add.fk.column).toBe("author_id");
    }
  });

  it("emits DropForeignKey when a FK disappears", () => {
    const before = makeSnap({
      users: usersTable,
      posts: makeTable({ foreignKeys: [fk()] }),
    });
    const after = makeSnap({ users: usersTable, posts: makeTable() });
    const ops = diffSnapshots(before, after);
    const drop = ops.find(o => o.tag === "DropForeignKey");
    expect(drop !== undefined).toBeTruthy();
    if (drop?.tag === "DropForeignKey") {
      expect(drop.table).toBe("posts");
    }
  });

  it("models a FK action change as drop + add", () => {
    const before = makeSnap({
      users: usersTable,
      posts: makeTable({ foreignKeys: [fk({ onDelete: "cascade" })] }),
    });
    const after = makeSnap({
      users: usersTable,
      posts: makeTable({ foreignKeys: [fk({ onDelete: "set null" })] }),
    });
    const ops = diffSnapshots(before, after);
    expect(ops.some(o => o.tag === "DropForeignKey")).toBeTruthy();
    expect(ops.some(o => o.tag === "AddForeignKey")).toBeTruthy();
  });

  it("ordering: FK drops come first, FK adds come last", () => {
    const before = makeSnap({
      users: usersTable,
      posts: makeTable({ foreignKeys: [fk({ onDelete: "cascade" })] }),
    });
    const after = makeSnap({
      users: usersTable,
      posts: makeTable({ foreignKeys: [fk({ onDelete: "set null" })] }),
    });
    const ops = diffSnapshots(before, after);
    const firstDrop = ops.findIndex(o => o.tag === "DropForeignKey");
    const lastAdd = ops.length - 1 - [...ops].reverse().findIndex(o => o.tag === "AddForeignKey");
    expect(firstDrop).toBe(0);
    expect(lastAdd).toBe(ops.length - 1);
  });

  it("FK adds trail CreateTable so the target table exists when the FK is applied", () => {
    const before = makeSnap({ posts: makeTable() });
    const after = makeSnap({
      users: usersTable,
      posts: makeTable({ foreignKeys: [fk()] }),
    });
    const ops = diffSnapshots(before, after);
    const createIdx = ops.findIndex(o => o.tag === "CreateTable" && o.table === "users");
    const addFkIdx = ops.findIndex(o => o.tag === "AddForeignKey");
    expect(createIdx).toBeGreaterThan(-1);
    expect(addFkIdx).toBeGreaterThan(createIdx);
  });

  it("does not emit FK ops when foreignKeys arrays are unchanged", () => {
    const same = makeSnap({
      users: usersTable,
      posts: makeTable({ foreignKeys: [fk()] }),
    });
    const ops = diffSnapshots(same, same);
    expect(ops.some(o => o.tag === "AddForeignKey" || o.tag === "DropForeignKey")).toBe(false);
  });
});
