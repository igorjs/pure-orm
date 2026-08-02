// Copyright 2026 igorjs. SPDX-License-Identifier: Apache-2.0

/**
 * Schema snapshot differ.
 *
 * Compares two SchemaSnapshots and produces an ordered list of
 * ChangeOperations describing how to transform the "from" schema into
 * the "to" schema. Operations are ordered so that drops come before
 * creates (to avoid name collisions).
 */

import type {
  ChangeOperation,
  CheckConstraintSnapshot,
  ColumnSnapshot,
  ForeignKeySnapshot,
  SchemaSnapshot,
  TableSnapshot,
} from "./types.ts";

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

// ---- Foreign-key differ (ADR-0005) ----

/**
 * Identity key for an FK in the differ. Mirrors the generated constraint name
 * (`fk_${table}_${column}`) so DROP ops in the generator can target the same
 * name without storing it on the snapshot. Two FKs on the same column are not
 * representable today; if that changes, the snapshot should carry an explicit
 * constraint name and this helper goes away.
 */
const fkKey = (fk: ForeignKeySnapshot): string => fk.column;

/** Structural equality across every field the generator emits. */
const fksEqual = (a: ForeignKeySnapshot, b: ForeignKeySnapshot): boolean =>
  a.column === b.column &&
  a.referencedTable === b.referencedTable &&
  a.referencedColumn === b.referencedColumn &&
  a.onDelete === b.onDelete &&
  a.onUpdate === b.onUpdate;

type FkDiff = {
  readonly drops: readonly { readonly table: string; readonly fk: ForeignKeySnapshot }[];
  readonly adds: readonly { readonly table: string; readonly fk: ForeignKeySnapshot }[];
};

/**
 * Returns FK adds and drops separately so the schema-level differ can place
 * them at the correct points in the global op order (drops early, adds late).
 * A definition change is modelled as drop + add — the wire forms are the same,
 * and most engines re-create the constraint under the hood for ALTER anyway.
 */
const diffForeignKeys = (table: string, from: TableSnapshot, to: TableSnapshot): FkDiff => {
  const drops: { table: string; fk: ForeignKeySnapshot }[] = [];
  const adds: { table: string; fk: ForeignKeySnapshot }[] = [];
  const fromByKey = new Map(from.foreignKeys.map(fk => [fkKey(fk), fk]));
  const toByKey = new Map(to.foreignKeys.map(fk => [fkKey(fk), fk]));

  for (const [key, fk] of fromByKey) {
    const next = toByKey.get(key);
    if (next === undefined || !fksEqual(fk, next)) {
      drops.push({ table, fk });
    }
  }
  for (const [key, fk] of toByKey) {
    const prev = fromByKey.get(key);
    if (prev === undefined || !fksEqual(prev, fk)) {
      adds.push({ table, fk });
    }
  }
  return Object.freeze({ drops: Object.freeze(drops), adds: Object.freeze(adds) });
};

// ---- Check-constraint differ (ADR-0005) ----

const checksEqual = (a: CheckConstraintSnapshot, b: CheckConstraintSnapshot): boolean =>
  a.name === b.name && a.expression === b.expression;

type CheckDiff = {
  readonly drops: readonly { readonly table: string; readonly check: CheckConstraintSnapshot }[];
  readonly adds: readonly { readonly table: string; readonly check: CheckConstraintSnapshot }[];
};

/**
 * Diff CHECK constraints by `name`. Same pattern as FK — expression changes
 * are modelled as drop + add so the wire form is uniform. The model author
 * keeps the name stable across edits; if it changes, the differ treats it
 * as a different constraint (intentionally — rename is uncommon and silent
 * coalescing would be surprising).
 */
const diffCheckConstraints = (table: string, from: TableSnapshot, to: TableSnapshot): CheckDiff => {
  const drops: { table: string; check: CheckConstraintSnapshot }[] = [];
  const adds: { table: string; check: CheckConstraintSnapshot }[] = [];
  const fromByName = new Map(from.checkConstraints.map(c => [c.name, c]));
  const toByName = new Map(to.checkConstraints.map(c => [c.name, c]));

  for (const [name, check] of fromByName) {
    const next = toByName.get(name);
    if (next === undefined || !checksEqual(check, next)) {
      drops.push({ table, check });
    }
  }
  for (const [name, check] of toByName) {
    const prev = fromByName.get(name);
    if (prev === undefined || !checksEqual(prev, check)) {
      adds.push({ table, check });
    }
  }
  return Object.freeze({ drops: Object.freeze(drops), adds: Object.freeze(adds) });
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
 * Ordering: DropForeignKey -> RenameTable -> DropTable -> table-diff (columns,
 * indexes) -> CreateTable -> AddForeignKey. Drops come before adds; FK drops
 * lead so column/table changes don't fail with reference errors, and FK adds
 * trail so target tables exist by the time they're referenced.
 *
 * FK ops are only collected for tables that exist in both snapshots and for
 * the targets of CreateTable/DropTable themselves — `CreateTable` already
 * emits inline FKs, and `DropTable` cascades them, so neither needs separate
 * ALTER ops.
 */
const diffSnapshots = (from: SchemaSnapshot, to: SchemaSnapshot): readonly ChangeOperation[] => {
  const ops: ChangeOperation[] = [];
  const fkDrops: { table: string; fk: ForeignKeySnapshot }[] = [];
  const fkAdds: { table: string; fk: ForeignKeySnapshot }[] = [];
  const ckDrops: { table: string; check: CheckConstraintSnapshot }[] = [];
  const ckAdds: { table: string; check: CheckConstraintSnapshot }[] = [];

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
    const prevTable = getTable(from.tables, src);
    ops.push(...diffTable(name, prevTable, toTable));
    // FKs and CHECKs follow the rename: ALTER ops target the new table name.
    const fkDiff = diffForeignKeys(name, prevTable, toTable);
    fkDrops.push(...fkDiff.drops);
    fkAdds.push(...fkDiff.adds);
    const ckDiff = diffCheckConstraints(name, prevTable, toTable);
    ckDrops.push(...ckDiff.drops);
    ckAdds.push(...ckDiff.adds);
  }

  // Tables in `from` but not in `to` -> DropTable (excluding rename sources)
  for (const table of Object.keys(from.tables)) {
    if (!(table in to.tables) && !renamedFromTables.has(table)) {
      ops.push(Object.freeze({ tag: "DropTable", table, snapshot: getTable(from.tables, table) }));
    }
  }

  // Tables in both -> diff columns/indexes (and collect FK ALTER ops)
  for (const table of Object.keys(to.tables)) {
    const fromTable = from.tables[table];
    if (fromTable !== undefined) {
      const toTable = getTable(to.tables, table);
      ops.push(...diffTable(table, fromTable, toTable));
      const fkDiff = diffForeignKeys(table, fromTable, toTable);
      fkDrops.push(...fkDiff.drops);
      fkAdds.push(...fkDiff.adds);
      const ckDiff = diffCheckConstraints(table, fromTable, toTable);
      ckDrops.push(...ckDiff.drops);
      ckAdds.push(...ckDiff.adds);
    }
  }

  // Tables in `to` but not in `from` -> CreateTable (excluding rename targets)
  for (const table of Object.keys(to.tables)) {
    if (!(table in from.tables) && !renamedToTables.has(table)) {
      ops.push(Object.freeze({ tag: "CreateTable", table, snapshot: getTable(to.tables, table) }));
    }
  }

  // FK and CHECK drops lead (so referenced columns / current row values can
  // change), adds trail (so target tables exist and new constraints see the
  // final shape). Both lists are stable in insertion order.
  return Object.freeze([
    ...fkDrops.map(d =>
      Object.freeze({ tag: "DropForeignKey", table: d.table, fk: d.fk } as const),
    ),
    ...ckDrops.map(d =>
      Object.freeze({ tag: "DropCheckConstraint", table: d.table, check: d.check } as const),
    ),
    ...ops,
    ...ckAdds.map(a =>
      Object.freeze({ tag: "AddCheckConstraint", table: a.table, check: a.check } as const),
    ),
    ...fkAdds.map(a => Object.freeze({ tag: "AddForeignKey", table: a.table, fk: a.fk } as const)),
  ]);
};

export {
  columnsEqual,
  detectRenameCandidates,
  diffCheckConstraints,
  diffForeignKeys,
  diffSnapshots,
  diffTable,
};
