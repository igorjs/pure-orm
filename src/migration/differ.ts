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

/**
 * Resolves annotated column renames (ADR-0004): a `to` column whose renamedFrom
 * names an existing `from` column yields a RenameColumn (plus an AlterColumn if
 * its definition also changed), never a data-destroying drop-plus-add. Returns
 * the emitted ops and the source/target names consumed, so the caller can skip
 * them in the drop/add passes.
 */
const resolveColumnRenames = (
  table: string,
  fromCols: Readonly<Record<string, ColumnSnapshot>>,
  toCols: Readonly<Record<string, ColumnSnapshot>>,
): { ops: ChangeOperation[]; sources: Set<string>; targets: Set<string> } => {
  const ops: ChangeOperation[] = [];
  const sources = new Set<string>();
  const targets = new Set<string>();
  for (const [name, toCol] of Object.entries(toCols)) {
    const src = toCol.renamedFrom;
    if (src === undefined || !(src in fromCols) || src in toCols) continue;
    ops.push(Object.freeze({ tag: "RenameColumn", table, from: src, to: name }));
    sources.add(src);
    targets.add(name);
    const fromCol = getCol(fromCols, src);
    if (!columnsEqual(fromCol, toCol)) {
      ops.push(
        Object.freeze({ tag: "AlterColumn", table, column: name, from: fromCol, to: toCol }),
      );
    }
  }
  return { ops, sources, targets };
};

const diffColumns = (
  table: string,
  fromCols: Readonly<Record<string, ColumnSnapshot>>,
  toCols: Readonly<Record<string, ColumnSnapshot>>,
): ChangeOperation[] => {
  const {
    ops: renameOps,
    sources: renamedSources,
    targets: renamedTargets,
  } = resolveColumnRenames(table, fromCols, toCols);
  const ops: ChangeOperation[] = [...renameOps];

  for (const col of Object.keys(fromCols)) {
    if (!(col in toCols) && !renamedSources.has(col)) {
      ops.push(
        Object.freeze({ tag: "DropColumn", table, column: col, snapshot: getCol(fromCols, col) }),
      );
    }
  }

  for (const col of Object.keys(toCols)) {
    if (!(col in fromCols) && !renamedTargets.has(col)) {
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

/**
 * Heuristic rename detection (ADR-0004). Pairs each unannotated added column
 * with a dropped column of identical shape so the CLI can *suggest* a rename.
 * This never auto-applies — silent guessing is exactly what the guard exists to
 * prevent; the operator confirms by adding a `renamedFrom` annotation.
 */
const detectRenameCandidates = (
  fromCols: Readonly<Record<string, ColumnSnapshot>>,
  toCols: Readonly<Record<string, ColumnSnapshot>>,
): readonly { readonly from: string; readonly to: string }[] => {
  const annotatedTargets = new Set(
    Object.entries(toCols)
      .filter(([, c]) => c.renamedFrom !== undefined)
      .map(([n]) => n),
  );
  const annotatedSources = new Set(
    Object.values(toCols)
      .map(c => c.renamedFrom)
      .filter((s): s is string => s !== undefined),
  );

  const dropped = Object.keys(fromCols).filter(n => !(n in toCols) && !annotatedSources.has(n));
  const added = Object.keys(toCols).filter(n => !(n in fromCols) && !annotatedTargets.has(n));

  const candidates: { from: string; to: string }[] = [];
  const usedDropped = new Set<string>();
  for (const a of added) {
    const aCol = getCol(toCols, a);
    const match = dropped.find(d => !usedDropped.has(d) && columnsEqual(getCol(fromCols, d), aCol));
    if (match !== undefined) {
      usedDropped.add(match);
      candidates.push({ from: match, to: a });
    }
  }
  return Object.freeze(candidates);
};

const diffIndexes = (table: string, from: TableSnapshot, to: TableSnapshot): ChangeOperation[] => {
  const ops: ChangeOperation[] = [];
  const fromNames = new Set(from.indexes.map(i => i.name));
  const toNames = new Set(to.indexes.map(i => i.name));

  for (const idx of from.indexes) {
    if (!toNames.has(idx.name)) {
      ops.push(Object.freeze({ tag: "DropIndex", table, index: idx }));
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

  // Annotated table renames (ADR-0004): a `to` table whose renamedFrom names an
  // existing `from` table produces a RenameTable, never a drop-plus-create.
  const renamedFromTables = new Set<string>();
  const renamedToTables = new Set<string>();
  for (const [name, toTable] of Object.entries(to.tables)) {
    const src = toTable.renamedFrom;
    if (src === undefined || !(src in from.tables) || src in to.tables) continue;
    ops.push(Object.freeze({ tag: "RenameTable", from: src, to: name }));
    renamedFromTables.add(src);
    renamedToTables.add(name);
    // Diff the renamed table's columns/indexes against its previous definition.
    ops.push(...diffTable(name, getTable(from.tables, src), toTable));
  }

  // Tables in `from` but not in `to` -> DropTable (excluding rename sources)
  for (const table of Object.keys(from.tables)) {
    if (!(table in to.tables) && !renamedFromTables.has(table)) {
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

  // Tables in `to` but not in `from` -> CreateTable (excluding rename targets)
  for (const table of Object.keys(to.tables)) {
    if (!(table in from.tables) && !renamedToTables.has(table)) {
      ops.push(Object.freeze({ tag: "CreateTable", table, snapshot: getTable(to.tables, table) }));
    }
  }

  return Object.freeze(ops);
};

export { columnsEqual, detectRenameCandidates, diffSnapshots, diffTable };
