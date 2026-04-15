/**
 * Schema snapshot differ.
 *
 * Compares two SchemaSnapshots and produces an ordered list of
 * ChangeOperations describing how to transform the "from" schema into
 * the "to" schema. Operations are ordered so that drops come before
 * creates (to avoid name collisions).
 */

import type { ChangeOperation, ColumnSnapshot, SchemaSnapshot, TableSnapshot } from "./types.ts";

// ---- Column comparison ----

const columnsEqual = (a: ColumnSnapshot, b: ColumnSnapshot): boolean =>
  a.type === b.type
  && a.primaryKey === b.primaryKey
  && a.nullable === b.nullable
  && a.unique === b.unique
  && a.default === b.default
  && a.index === b.index;

// ---- Table differ ----

const diffTable = (table: string, from: TableSnapshot, to: TableSnapshot): readonly ChangeOperation[] => {
  const ops: ChangeOperation[] = [];
  const fromCols = from.columns;
  const toCols = to.columns;

  // Dropped columns
  for (const col of Object.keys(fromCols)) {
    if (!(col in toCols)) {
      ops.push(Object.freeze({ tag: "DropColumn", table, column: col, snapshot: fromCols[col] }));
    }
  }

  // Added columns
  for (const col of Object.keys(toCols)) {
    if (!(col in fromCols)) {
      ops.push(Object.freeze({ tag: "AddColumn", table, column: col, snapshot: toCols[col] }));
    }
  }

  // Altered columns
  for (const col of Object.keys(toCols)) {
    if (col in fromCols && !columnsEqual(fromCols[col], toCols[col])) {
      ops.push(Object.freeze({ tag: "AlterColumn", table, column: col, from: fromCols[col], to: toCols[col] }));
    }
  }

  // Index changes
  const fromIndexNames = new Set(from.indexes.map((i) => i.name));
  const toIndexNames = new Set(to.indexes.map((i) => i.name));

  for (const idx of from.indexes) {
    if (!toIndexNames.has(idx.name)) {
      ops.push(Object.freeze({ tag: "DropIndex", table, indexName: idx.name }));
    }
  }

  for (const idx of to.indexes) {
    if (!fromIndexNames.has(idx.name)) {
      ops.push(Object.freeze({ tag: "AddIndex", table, index: idx }));
    }
  }

  return Object.freeze(ops);
};

// ---- Schema differ ----

/**
 * Produces an ordered list of ChangeOperations to transform `from` into `to`.
 *
 * Ordering: DropTable -> DropColumn -> AlterColumn -> AddColumn -> CreateTable -> Indexes
 * This ordering avoids name collisions and ensures foreign key targets exist
 * before references are created.
 */
const diffSnapshots = (from: SchemaSnapshot, to: SchemaSnapshot): readonly ChangeOperation[] => {
  const ops: ChangeOperation[] = [];

  // Tables in `from` but not in `to` -> DropTable
  for (const table of Object.keys(from.tables)) {
    if (!(table in to.tables)) {
      ops.push(Object.freeze({ tag: "DropTable", table, snapshot: from.tables[table] }));
    }
  }

  // Tables in both -> diff columns/indexes
  for (const table of Object.keys(to.tables)) {
    if (table in from.tables) {
      ops.push(...diffTable(table, from.tables[table], to.tables[table]));
    }
  }

  // Tables in `to` but not in `from` -> CreateTable
  for (const table of Object.keys(to.tables)) {
    if (!(table in from.tables)) {
      ops.push(Object.freeze({ tag: "CreateTable", table, snapshot: to.tables[table] }));
    }
  }

  return Object.freeze(ops);
};

export { columnsEqual, diffSnapshots, diffTable };
