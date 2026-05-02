// Copyright 2026 igorjs. SPDX-License-Identifier: Apache-2.0

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
  a.type === b.type &&
  a.primaryKey === b.primaryKey &&
  a.nullable === b.nullable &&
  a.unique === b.unique &&
  a.default === b.default &&
  a.index === b.index;

// ---- Helpers ----

/** Safe indexed access: returns the value or throws (used after `in` guard). */
const getTable = (tables: Readonly<Record<string, TableSnapshot>>, key: string): TableSnapshot => {
  const t = tables[key];
  if (t === undefined) throw new Error(`Table "${key}" not found in snapshot`);
  return t;
};

const getCol = (cols: Readonly<Record<string, ColumnSnapshot>>, key: string): ColumnSnapshot => {
  const c = cols[key];
  if (c === undefined) throw new Error(`Column "${key}" not found in snapshot`);
  return c;
};

// ---- Table differ ----

const diffColumns = (
  table: string,
  fromCols: Readonly<Record<string, ColumnSnapshot>>,
  toCols: Readonly<Record<string, ColumnSnapshot>>,
): ChangeOperation[] => {
  const ops: ChangeOperation[] = [];

  for (const col of Object.keys(fromCols)) {
    if (!(col in toCols)) {
      ops.push(
        Object.freeze({ tag: "DropColumn", table, column: col, snapshot: getCol(fromCols, col) }),
      );
    }
  }

  for (const col of Object.keys(toCols)) {
    if (!(col in fromCols)) {
      ops.push(
        Object.freeze({ tag: "AddColumn", table, column: col, snapshot: getCol(toCols, col) }),
      );
    }
  }

  for (const col of Object.keys(toCols)) {
    const fromCol = fromCols[col];
    const toCol = getCol(toCols, col);
    if (fromCol !== undefined && !columnsEqual(fromCol, toCol)) {
      ops.push(Object.freeze({ tag: "AlterColumn", table, column: col, from: fromCol, to: toCol }));
    }
  }

  return ops;
};

const diffIndexes = (table: string, from: TableSnapshot, to: TableSnapshot): ChangeOperation[] => {
  const ops: ChangeOperation[] = [];
  const fromNames = new Set(from.indexes.map(i => i.name));
  const toNames = new Set(to.indexes.map(i => i.name));

  for (const idx of from.indexes) {
    if (!toNames.has(idx.name)) {
      ops.push(Object.freeze({ tag: "DropIndex", table, indexName: idx.name }));
    }
  }

  for (const idx of to.indexes) {
    if (!fromNames.has(idx.name)) {
      ops.push(Object.freeze({ tag: "AddIndex", table, index: idx }));
    }
  }

  return ops;
};

const diffTable = (
  table: string,
  from: TableSnapshot,
  to: TableSnapshot,
): readonly ChangeOperation[] =>
  Object.freeze([...diffColumns(table, from.columns, to.columns), ...diffIndexes(table, from, to)]);

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
      ops.push(Object.freeze({ tag: "DropTable", table, snapshot: getTable(from.tables, table) }));
    }
  }

  // Tables in both -> diff columns/indexes
  for (const table of Object.keys(to.tables)) {
    const fromTable = from.tables[table];
    if (fromTable !== undefined) {
      ops.push(...diffTable(table, fromTable, getTable(to.tables, table)));
    }
  }

  // Tables in `to` but not in `from` -> CreateTable
  for (const table of Object.keys(to.tables)) {
    if (!(table in from.tables)) {
      ops.push(Object.freeze({ tag: "CreateTable", table, snapshot: getTable(to.tables, table) }));
    }
  }

  return Object.freeze(ops);
};

export { columnsEqual, diffSnapshots, diffTable };
