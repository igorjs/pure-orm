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
};

// ---- Full schema snapshot ----

type SchemaSnapshot = {
  readonly version: 1;
  readonly generatedAt: string;
  readonly tables: Readonly<Record<string, TableSnapshot>>;
};

// ---- Change operations ----

type CreateTable = { readonly tag: "CreateTable"; readonly table: string; readonly snapshot: TableSnapshot };
type DropTable = { readonly tag: "DropTable"; readonly table: string; readonly snapshot: TableSnapshot };
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
type DropIndex = { readonly tag: "DropIndex"; readonly table: string; readonly indexName: string };

type ChangeOperation = CreateTable | DropTable | AddColumn | DropColumn | AlterColumn | AddIndex | DropIndex;

// ---- Migration record (state table) ----

type MigrationRecord = {
  readonly id: number;
  readonly name: string;
  readonly appliedAt: string;
  readonly checksum: string;
  readonly executionMs: number;
};

export type {
  AddColumn,
  AlterColumn,
  ChangeOperation,
  ColumnSnapshot,
  CreateTable,
  DropColumn,
  DropIndex,
  DropTable,
  ForeignKeySnapshot,
  IndexSnapshot,
  MigrationRecord,
  SchemaSnapshot,
  TableSnapshot,
};
