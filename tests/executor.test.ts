// Copyright 2026 igorjs. SPDX-License-Identifier: Apache-2.0

import { Task } from "@igorjs/pure-fx/async";
import { describe, expect, it } from "@igorjs/pure-test";
import type { DatabaseClient, RawConnection } from "../src/connection/types.ts";
import { createSqliteDialect } from "../src/dialect/sqlite.ts";
import { createNoopLogger } from "../src/logging/logger.ts";
import { executeBatch, rollbackBatch } from "../src/migration/executor.ts";
import type { MigrationFile } from "../src/migration/types.ts";

// ── Mock infrastructure ──

type QueryLog = { sql: string; params: readonly unknown[] };

type QueryResult = { rows: readonly unknown[]; rowCount: number };

const PRAGMA_COLUMNS = [
  { name: "id" },
  { name: "name" },
  { name: "applied_at" },
  { name: "checksum" },
  { name: "execution_ms" },
  { name: "batch" },
  { name: "status" },
];

const handleInsert = (tables: Map<string, unknown[]>, params: readonly unknown[]): QueryResult => {
  const migrations = tables.get("_pure_orm_migrations") ?? [];
  if (migrations.some((r: unknown) => (r as { name: unknown }).name === params[0])) {
    throw new Error("UNIQUE constraint failed");
  }
  migrations.push({
    name: params[0],
    checksum: params[1],
    execution_ms: params[2],
    batch: params[3],
    status: params[4],
  });
  return { rows: [], rowCount: 1 };
};

const handleSelect = (tables: Map<string, unknown[]>, sql: string): QueryResult => {
  const migrations = tables.get("_pure_orm_migrations") ?? [];
  if (sql.includes("status") && sql.includes("applied")) {
    const applied = migrations.filter(
      (r: unknown) => (r as { status: string }).status === "applied",
    );
    return { rows: applied, rowCount: applied.length };
  }
  return { rows: migrations, rowCount: migrations.length };
};

const handleMax = (tables: Map<string, unknown[]>): QueryResult => {
  const migrations = tables.get("_pure_orm_migrations") ?? [];
  const maxBatch = migrations.reduce(
    (max: number, r: unknown) => Math.max(max, (r as { batch: number }).batch ?? 0),
    0,
  );
  return { rows: [{ maxBatch }], rowCount: 1 };
};

const handleDelete = (tables: Map<string, unknown[]>, params: readonly unknown[]): QueryResult => {
  const migrations = tables.get("_pure_orm_migrations") ?? [];
  const idx = migrations.findIndex((r: unknown) => (r as { name: unknown }).name === params[0]);
  if (idx >= 0) migrations.splice(idx, 1);
  return { rows: [], rowCount: 1 };
};

const createStatefulMockDb = (): {
  db: DatabaseClient;
  queries: QueryLog[];
  tables: Map<string, unknown[]>;
} => {
  const queries: QueryLog[] = [];
  const tables = new Map<string, unknown[]>();
  tables.set("_pure_orm_migrations", []);

  const conn: RawConnection = {
    query: async (sql: string, params: readonly unknown[]) => {
      queries.push({ sql, params });

      if (sql.includes("CREATE TABLE IF NOT EXISTS")) return { rows: [], rowCount: 0 };
      if (sql.includes("PRAGMA table_info")) return { rows: PRAGMA_COLUMNS, rowCount: 7 };
      if (sql.includes("INSERT INTO")) return handleInsert(tables, params);
      if (sql.includes("SELECT")) return handleSelect(tables, sql);
      if (sql.includes("MAX")) return handleMax(tables);
      if (sql.includes("DELETE")) return handleDelete(tables, params);
      return { rows: [], rowCount: 0 };
    },
    release: async () => {
      // no-op in mock
    },
    end: async () => {
      // no-op in mock
    },
  };

  const db: DatabaseClient = {
    dialect: createSqliteDialect(),
    pool: {
      acquire: () => Task.of(conn),
      release: () => Task.of<void>(undefined),
      end: () => Task.of<void>(undefined),
      mode: "pool",
    },
    logger: createNoopLogger(),
    hooks: {},
  };

  return { db, queries, tables };
};

const makeMigrationFile = (name: string, up: string, down: string): MigrationFile =>
  Object.freeze({
    name,
    path: `migrations/${name}.sql`,
    migration: Object.freeze({ up, down, transaction: true, concurrent: false }),
    checksum: `checksum_${name}`,
  });

// ── Tests ──

describe("executeBatch", () => {
  it("applies pending migrations", async () => {
    const { db, tables } = createStatefulMockDb();
    const migrations = [
      makeMigrationFile(
        "20260101_001_create_users",
        'CREATE TABLE "users" ("id" INT);',
        'DROP TABLE "users";',
      ),
      makeMigrationFile(
        "20260102_001_create_posts",
        'CREATE TABLE "posts" ("id" INT);',
        'DROP TABLE "posts";',
      ),
    ];

    const result = await executeBatch(db, migrations).run();
    expect(result.isOk).toBe(true);
    if (!result.isOk) return;

    expect(result.value.results.length).toBe(2);
    expect(result.value.results[0]?.status).toBe("applied");
    expect(result.value.results[1]?.status).toBe("applied");
    expect(result.value.dryRun).toBe(false);

    // Lock row should be cleaned up (only migration records remain)
    const records = tables.get("_pure_orm_migrations") ?? [];
    expect(records.length).toBe(2);
  });

  it("skips already-applied migrations", async () => {
    const { db, tables } = createStatefulMockDb();
    // Pre-populate an applied migration
    (tables.get("_pure_orm_migrations") ?? []).push({
      name: "20260101_001_create_users",
      checksum: "checksum_20260101_001_create_users",
      execution_ms: 10,
      batch: 1,
      status: "applied",
    });

    const migrations = [
      makeMigrationFile("20260101_001_create_users", "CREATE TABLE ...", "DROP TABLE ..."),
      makeMigrationFile("20260102_001_create_posts", "CREATE TABLE ...", "DROP TABLE ..."),
    ];

    const result = await executeBatch(db, migrations).run();
    expect(result.isOk).toBe(true);
    if (!result.isOk) return;

    // Only the second migration should be applied
    expect(result.value.results.length).toBe(1);
    expect(result.value.results[0]?.name).toBe("20260102_001_create_posts");
  });

  it("returns empty results when all migrations are applied", async () => {
    const { db, tables } = createStatefulMockDb();
    (tables.get("_pure_orm_migrations") ?? []).push({
      name: "20260101_001_create_users",
      checksum: "checksum_20260101_001_create_users",
      execution_ms: 10,
      batch: 1,
      status: "applied",
    });

    const migrations = [
      makeMigrationFile("20260101_001_create_users", "CREATE TABLE ...", "DROP TABLE ..."),
    ];

    const result = await executeBatch(db, migrations).run();
    expect(result.isOk).toBe(true);
    if (!result.isOk) return;
    expect(result.value.results.length).toBe(0);
  });

  it("dry-run returns SQL without executing", async () => {
    const { db, queries } = createStatefulMockDb();
    const migrations = [
      makeMigrationFile(
        "20260101_001_create_users",
        'CREATE TABLE "users" ("id" INT);',
        'DROP TABLE "users";',
      ),
    ];

    const result = await executeBatch(db, migrations, { dryRun: true }).run();
    expect(result.isOk).toBe(true);
    if (!result.isOk) return;

    expect(result.value.dryRun).toBe(true);
    expect(result.value.results.length).toBe(1);
    expect(result.value.results[0]?.status).toBe("skipped");
    expect(result.value.results[0]?.sql).toBe('CREATE TABLE "users" ("id" INT);');

    // No INSERT for migration state in dry-run (only ensure table + checksum queries)
    const inserts = queries.filter(
      q => q.sql.includes("INSERT") && !q.sql.includes("_pure_orm_lock_"),
    );
    expect(inserts.length).toBe(0);
  });

  it("assigns batch numbers", async () => {
    const { db } = createStatefulMockDb();
    const migrations = [
      makeMigrationFile("20260101_001_create_users", "CREATE TABLE ...", "DROP TABLE ..."),
    ];

    const result = await executeBatch(db, migrations).run();
    expect(result.isOk).toBe(true);
    if (!result.isOk) return;
    expect(result.value.batch).toBe(1);
  });

  it("detects checksum mismatch", async () => {
    const { db, tables } = createStatefulMockDb();
    (tables.get("_pure_orm_migrations") ?? []).push({
      name: "20260101_001_create_users",
      checksum: "old_checksum",
      execution_ms: 10,
      batch: 1,
      status: "applied",
    });

    const migrations = [
      makeMigrationFile("20260101_001_create_users", "CREATE TABLE ...", "DROP TABLE ..."),
    ];

    const result = await executeBatch(db, migrations).run();
    expect(result.isErr).toBe(true);
    if (result.isErr) {
      expect(result.error.message.includes("Checksum mismatch")).toBeTruthy();
    }
  });

  it("skips checksum validation with force flag", async () => {
    const { db, tables } = createStatefulMockDb();
    (tables.get("_pure_orm_migrations") ?? []).push({
      name: "20260101_001_create_users",
      checksum: "old_checksum",
      execution_ms: 10,
      batch: 1,
      status: "applied",
    });

    const migrations = [
      makeMigrationFile("20260101_001_create_users", "CREATE TABLE ...", "DROP TABLE ..."),
    ];

    const result = await executeBatch(db, migrations, { force: true }).run();
    expect(result.isOk).toBe(true);
  });
});

describe("rollbackBatch", () => {
  it("rolls back migrations in dry-run mode", async () => {
    const { db } = createStatefulMockDb();
    const targets = [
      { name: "20260101_001_create_users", downSql: 'DROP TABLE "users";', transaction: true },
    ];

    const result = await rollbackBatch(db, targets, { dryRun: true }).run();
    expect(result.isOk).toBe(true);
    if (!result.isOk) return;
    expect(result.value.dryRun).toBe(true);
    expect(result.value.results[0]?.sql).toBe('DROP TABLE "users";');
  });
});
