// Copyright 2026 igorjs. SPDX-License-Identifier: Apache-2.0

/**
 * Migration system types.
 *
 * SchemaSnapshot is the portable, dialect-agnostic representation of a
 * database schema at a point in time. The differ compares two snapshots
 * to produce ChangeOperations, which the SQL generator compiles into
 * up/down DDL statements.
 */

// ---- Column snapshot ----

type ColumnSnapshot = {
  /** Schema type name: "string", "number", "boolean", "date". */
  readonly type: string;
  readonly primaryKey: boolean;
  readonly nullable: boolean;
  readonly unique: boolean;
  readonly default: string | null;
  readonly index: boolean;
  /**
   * The previous SQL name this column was renamed from (ADR-0004). Present only
   * while a rename is pending; it is a migration hint, not a schema attribute,
   * so it is excluded from column equality.
   */
  readonly renamedFrom?: string;
};

// ---- Index snapshot ----

type IndexSnapshot = {
  readonly name: string;
  readonly columns: readonly string[];
  readonly unique: boolean;
};

// ---- Foreign key snapshot ----

type ForeignKeySnapshot = {
  readonly column: string;
  readonly referencedTable: string;
  readonly referencedColumn: string;
  readonly onDelete: string;
  readonly onUpdate: string;
};

// ---- Table snapshot ----

type TableSnapshot = {
  readonly columns: Readonly<Record<string, ColumnSnapshot>>;
  readonly indexes: readonly IndexSnapshot[];
  readonly foreignKeys: readonly ForeignKeySnapshot[];
  /** The previous table name this table was renamed from (ADR-0004). */
  readonly renamedFrom?: string;
};

// ---- Full schema snapshot ----

type SchemaSnapshot = {
  readonly version: 1;
  readonly generatedAt: string;
  readonly tables: Readonly<Record<string, TableSnapshot>>;
};

// ---- Change operations ----

type CreateTable = {
  readonly tag: "CreateTable";
  readonly table: string;
  readonly snapshot: TableSnapshot;
};
type DropTable = {
  readonly tag: "DropTable";
  readonly table: string;
  readonly snapshot: TableSnapshot;
};
type AddColumn = {
  readonly tag: "AddColumn";
  readonly table: string;
  readonly column: string;
  readonly snapshot: ColumnSnapshot;
};
type DropColumn = {
  readonly tag: "DropColumn";
  readonly table: string;
  readonly column: string;
  readonly snapshot: ColumnSnapshot;
};
type AlterColumn = {
  readonly tag: "AlterColumn";
  readonly table: string;
  readonly column: string;
  readonly from: ColumnSnapshot;
  readonly to: ColumnSnapshot;
};
type AddIndex = { readonly tag: "AddIndex"; readonly table: string; readonly index: IndexSnapshot };
type DropIndex = {
  readonly tag: "DropIndex";
  readonly table: string;
  readonly index: IndexSnapshot;
};
/**
 * Add a foreign key to an existing table (ADR-0005). The constraint name is
 * derived from `fk_${table}_${fk.column}`, matching the inline CREATE TABLE
 * naming so DROP ops can target the same identifier without extra metadata.
 */
type AddForeignKey = {
  readonly tag: "AddForeignKey";
  readonly table: string;
  readonly fk: ForeignKeySnapshot;
};
type DropForeignKey = {
  readonly tag: "DropForeignKey";
  readonly table: string;
  readonly fk: ForeignKeySnapshot;
};
type RenameTable = { readonly tag: "RenameTable"; readonly from: string; readonly to: string };
type RenameColumn = {
  readonly tag: "RenameColumn";
  readonly table: string;
  readonly from: string;
  readonly to: string;
};

type ChangeOperation =
  | CreateTable
  | DropTable
  | RenameTable
  | AddColumn
  | DropColumn
  | RenameColumn
  | AlterColumn
  | AddIndex
  | DropIndex
  | AddForeignKey
  | DropForeignKey;

// ---- Migration record (state table) ----

type MigrationRecord = {
  readonly id: number;
  readonly name: string;
  readonly appliedAt: string;
  readonly checksum: string;
  readonly executionMs: number;
  readonly batch: number;
  readonly status: string;
};

// ---- Migration input/output ----

type MigrationStatus = "applied" | "failed" | "in_progress";

type Migration = {
  readonly up: string;
  readonly down: string;
  readonly transaction: boolean;
  readonly concurrent: boolean;
};

type MigrationFile = {
  readonly name: string;
  readonly path: string;
  readonly migration: Migration;
  readonly checksum: string;
};

type MigrationResult = {
  readonly name: string;
  readonly status: "applied" | "skipped" | "failed";
  readonly durationMs: number;
  readonly sql: string;
};

type BatchResult = {
  readonly batch: number;
  readonly results: readonly MigrationResult[];
  readonly dryRun: boolean;
};

type ChecksumMismatch = {
  readonly name: string;
  readonly expected: string;
  readonly actual: string;
};

// ---- Migration hooks ----

type MigrationHookContext = {
  readonly name: string;
  readonly direction: "up" | "down";
};

type MigrationHooks = {
  readonly beforeMigrate: (migration: MigrationHookContext) => void;
  readonly afterMigrate: (
    migration: MigrationHookContext & { readonly durationMs: number },
  ) => void;
  readonly onMigrationError: (migration: MigrationHookContext, error: unknown) => void;
};

// ---- Executor options ----

type ExecutorOptions = {
  readonly dryRun: boolean;
  readonly force: boolean;
  readonly hooks: Partial<MigrationHooks> | null;
};

export type {
  AddColumn,
  AddForeignKey,
  AlterColumn,
  BatchResult,
  ChangeOperation,
  ChecksumMismatch,
  ColumnSnapshot,
  CreateTable,
  DropColumn,
  DropForeignKey,
  DropIndex,
  DropTable,
  ExecutorOptions,
  ForeignKeySnapshot,
  IndexSnapshot,
  Migration,
  MigrationFile,
  MigrationHookContext,
  MigrationHooks,
  MigrationRecord,
  MigrationResult,
  MigrationStatus,
  RenameColumn,
  RenameTable,
  SchemaSnapshot,
  TableSnapshot,
};
