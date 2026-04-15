/**
 * Shared dialect utilities.
 *
 * Functions that are identical across dialects are extracted here so each
 * dialect implementation can import rather than duplicate them.
 *
 * Only truly dialect-agnostic logic lives here; anything that varies by
 * dialect (param style, ILIKE handling, type mappings) stays in the
 * individual dialect files.
 */

import type { ColumnMetadata } from "../model/types.ts";
import type {
  AggregateExpr,
  ConditionNode,
  DeleteNode,
  InsertNode,
  JoinClause,
  JoinType,
  ReturningClause,
  SelectColumn,
  SelectNode,
  UpdateNode,
} from "../query/types.ts";

// ---- Identifier quoting ----

/**
 * Wraps an identifier in double-quotes, escaping any embedded double-quotes
 * by doubling them (the SQL standard escape for double-quoted identifiers).
 *
 * Both PostgreSQL and SQLite use the same quoting rules per the SQL standard.
 */
const quote = (identifier: string): string => `"${identifier.replace(/"/g, "\"\"")}"`;

// ---- Column name resolution ----

/**
 * Resolves a camelCase field reference (optionally qualified as "Model.field")
 * to its snake_case database column name using the model's ColumnMetadata.
 *
 * Falls back to the raw field name when no metadata entry is found, which
 * allows raw column names to pass through unmodified.
 */
const resolveColumnName = (
  field: string,
  columns: SelectNode["model"]["columns"],
): string => {
  // Strip a leading qualifier such as "User." if present.
  const fieldName = field.includes(".") ? field.slice(field.indexOf(".") + 1) : field;

  const meta = columns.find((col) => col.name === fieldName);
  return meta !== undefined ? meta.columnName : fieldName;
};

// ---- Select column compilation ----

/**
 * Compiles a single SelectColumn (plain field, aggregate, or window function)
 * into its SQL representation. Shared across dialects since both use the same syntax.
 */
const compileSelectColumn = (
  col: SelectColumn,
  tableName: string,
  columns: readonly ColumnMetadata[],
): string => {
  if (typeof col === "string") {
    return `${quote(tableName)}.${quote(resolveColumnName(col, columns))}`;
  }

  if (col.tag === "Aggregate") {
    const inner = col.column === "*"
      ? "*"
      : `${quote(tableName)}.${quote(resolveColumnName(col.column, columns))}`;
    const expr = `${col.fn}(${inner})`;
    return col.alias !== null ? `${expr} AS ${quote(col.alias)}` : expr;
  }

  // WindowExpr
  const overParts: string[] = [];
  if (col.partitions.length > 0) {
    const partCols = col.partitions
      .map((c) => `${quote(tableName)}.${quote(resolveColumnName(c, columns))}`)
      .join(", ");
    overParts.push(`PARTITION BY ${partCols}`);
  }
  if (col.orders.length > 0) {
    const ordCols = col.orders
      .map((o) =>
        `${quote(tableName)}.${quote(resolveColumnName(o.column, columns))} ${o.direction === "asc" ? "ASC" : "DESC"}`
      )
      .join(", ");
    overParts.push(`ORDER BY ${ordCols}`);
  }
  const overClause = overParts.length > 0 ? overParts.join(" ") : "";
  const expr = `${col.fn}() OVER (${overClause})`;
  return col.alias !== null ? `${expr} AS ${quote(col.alias)}` : expr;
};

// ---- Join compilation ----

const JOIN_TYPE_SQL: Readonly<Record<JoinType, string>> = Object.freeze({
  inner: "INNER JOIN",
  left: "LEFT JOIN",
  right: "RIGHT JOIN",
  full: "FULL JOIN",
});

/**
 * Resolves the left side of a join condition to a quoted "table"."column"
 * expression. If the field contains a dot qualifier (e.g. "User.roleId"),
 * the qualifier names the source table; otherwise the main (from) table
 * is used as the default.
 */
const resolveJoinLeft = (
  field: string,
  mainTable: string,
  mainColumns: readonly ColumnMetadata[],
  priorJoins: readonly JoinClause[],
): string => {
  if (field.includes(".")) {
    const dotIndex = field.indexOf(".");
    const tableName = field.slice(0, dotIndex);
    const fieldName = field.slice(dotIndex + 1);

    // Try main table first, then previously joined tables.
    if (tableName === mainTable) {
      return `${quote(mainTable)}.${quote(resolveColumnName(fieldName, mainColumns))}`;
    }
    const joined = priorJoins.find((j) => j.model.name === tableName);
    if (joined !== undefined) {
      return `${quote(tableName)}.${quote(resolveColumnName(fieldName, joined.model.columns))}`;
    }
    // Fallback: use the raw names.
    return `${quote(tableName)}.${quote(fieldName)}`;
  }
  // Unqualified: resolve from main table.
  return `${quote(mainTable)}.${quote(resolveColumnName(field, mainColumns))}`;
};

/**
 * Compiles all JoinClause entries into their SQL fragments.
 *
 * Both PostgreSQL and SQLite use identical JOIN syntax so this is shared.
 * Returns an array of strings like:
 *   ["INNER JOIN \"users\" ON \"posts\".\"author_id\" = \"users\".\"id\""]
 */
const compileJoins = (
  joins: readonly JoinClause[],
  mainTable: string,
  mainColumns: readonly ColumnMetadata[],
): readonly string[] =>
  joins.map((clause, index) => {
    const keyword = JOIN_TYPE_SQL[clause.joinType];
    const targetTable = clause.model.name;

    // Left column: resolved from main table or a previously joined table.
    const leftExpr = resolveJoinLeft(
      clause.condition.leftColumn,
      mainTable,
      mainColumns,
      joins.slice(0, index),
    );

    // Right column: always resolved from the target (joined) table.
    const rightCol = resolveColumnName(clause.condition.rightColumn, clause.model.columns);
    const rightExpr = `${quote(targetTable)}.${quote(rightCol)}`;

    return `${keyword} ${quote(targetTable)} ON ${leftExpr} = ${rightExpr}`;
  });

// ---- Shared mutation compilation ----

/**
 * Dialect-specific configuration injected into shared mutation compilers.
 * Parameterises the two things that differ between PG and SQLite:
 * the placeholder generator and the current-timestamp expression.
 */
type MutationDialectConfig = {
  /** Adds a value to the params list and returns its placeholder string. */
  readonly addParam: (params: unknown[], counter: { index: number }, value: unknown) => string;
  /** SQL expression for the current timestamp: "NOW()" or "datetime('now')". */
  readonly nowExpression: string;
};

// Shared compile context for mutation operations — mirrors the select context
// but without the counter for dialects that use anonymous placeholders (?).
type MutationCtx = {
  readonly tableName: string;
  readonly columns: readonly ColumnMetadata[];
  readonly counter: { index: number };
  readonly params: unknown[];
  readonly dialectConfig: MutationDialectConfig;
};

const addMutationParam = (ctx: MutationCtx, value: unknown): string =>
  ctx.dialectConfig.addParam(ctx.params, ctx.counter, value);

// Reuse condition compilation in mutation WHERE clauses. Mirrors the approach
// in each dialect's compileSelect but calls into the shared context type so
// both dialects can share it without duplicating the condition logic here.
// Instead, each dialect passes its own compileCondition function down.
type ConditionCompiler = (node: ConditionNode, ctx: MutationCtx) => string;

const buildWhereClause = (
  conditions: readonly ConditionNode[],
  softDeleteFilter: boolean,
  ctx: MutationCtx,
  compileCondition: ConditionCompiler,
): string => {
  const parts: string[] = conditions.map((c) => compileCondition(c, ctx));
  if (softDeleteFilter) {
    parts.push(`${quote(ctx.tableName)}.${quote("deleted_at")} IS NULL`);
  }
  return parts.length > 0 ? `WHERE ${parts.join(" AND ")}` : "";
};

/**
 * Builds the RETURNING clause SQL fragment, or an empty string when
 * returning is null. Column names are resolved via model metadata.
 */
const buildReturningClause = (returning: ReturningClause, columns: readonly ColumnMetadata[]): string => {
  if (returning === null) return "";
  if (returning === "*") return "RETURNING *";
  const cols = returning.map((col) => quote(resolveColumnName(col, columns))).join(", ");
  return `RETURNING ${cols}`;
};

/**
 * Shared INSERT compiler. Both dialects call this, injecting their own
 * addParam implementation and compileCondition via the dialect config and ctx.
 *
 * Generates: INSERT INTO "table" ("col1", "col2") VALUES ($1, $2), ($3, $4)
 * plus optional ON CONFLICT and RETURNING clauses.
 */
const compileInsertShared = (node: InsertNode, ctx: MutationCtx): string => {
  const { tableName, columns } = ctx;

  // Column list from the first row's keys — all rows must share the same shape.
  const firstRow = node.rows[0];
  if (firstRow === undefined) {
    throw new Error("INSERT requires at least one row");
  }

  const fieldKeys = Object.keys(firstRow);
  const colNames = fieldKeys.map((key) => resolveColumnName(key, columns));
  const colList = colNames.map(quote).join(", ");

  // One VALUES group per row: ($1, $2) or (?, ?)
  const valueGroups = node.rows.map((row) => {
    const placeholders = fieldKeys.map((key) => addMutationParam(ctx, row[key])).join(", ");
    return `(${placeholders})`;
  });

  let sql = `INSERT INTO ${quote(tableName)} (${colList}) VALUES ${valueGroups.join(", ")}`;

  // ON CONFLICT clause
  if (node.onConflict !== null) {
    const conflictCols = node.onConflict.columns.map((col) => quote(resolveColumnName(col, columns))).join(", ");
    const action = node.onConflict.action;
    if (action === "nothing") {
      sql += ` ON CONFLICT (${conflictCols}) DO NOTHING`;
    } else {
      // { update: string[] }
      const setClauses = action.update
        .map((col) => {
          const colName = quote(resolveColumnName(col, columns));
          return `${colName} = EXCLUDED.${colName}`;
        })
        .join(", ");
      sql += ` ON CONFLICT (${conflictCols}) DO UPDATE SET ${setClauses}`;
    }
  }

  const returningClause = buildReturningClause(node.returning, columns);
  if (returningClause.length > 0) sql += ` ${returningClause}`;

  return sql;
};

/**
 * Shared UPDATE compiler.
 *
 * Generates: UPDATE "table" SET "col1" = $1 WHERE conditions [RETURNING ...]
 */
const compileUpdateShared = (
  node: UpdateNode,
  ctx: MutationCtx,
  compileCondition: ConditionCompiler,
): string => {
  const { tableName, columns } = ctx;

  const setClauses = Object.keys(node.values)
    .map((key) => {
      const colName = quote(resolveColumnName(key, columns));
      const placeholder = addMutationParam(ctx, node.values[key]);
      return `${colName} = ${placeholder}`;
    })
    .join(", ");

  const whereClause = buildWhereClause(node.conditions, node.softDeleteFilter, ctx, compileCondition);

  const parts = [`UPDATE ${quote(tableName)} SET ${setClauses}`, whereClause].filter(
    (p) => p.length > 0,
  );

  const returningClause = buildReturningClause(node.returning, columns);
  if (returningClause.length > 0) parts.push(returningClause);

  return parts.join(" ");
};

/**
 * Shared DELETE/soft-delete compiler.
 *
 * Hard delete: DELETE FROM "table" WHERE conditions [RETURNING ...]
 * Soft delete: UPDATE "table" SET "deleted_at" = NOW() WHERE conditions [RETURNING ...]
 */
const compileDeleteShared = (
  node: DeleteNode,
  ctx: MutationCtx,
  compileCondition: ConditionCompiler,
): string => {
  const { tableName, columns } = ctx;
  const { nowExpression } = ctx.dialectConfig;

  if (node.isSoftDelete) {
    // Soft delete — mark deleted_at rather than removing the row.
    const whereClause = buildWhereClause(node.conditions, node.softDeleteFilter, ctx, compileCondition);
    const parts = [
      `UPDATE ${quote(tableName)} SET ${quote("deleted_at")} = ${nowExpression}`,
      whereClause,
    ].filter((p) => p.length > 0);

    const returningClause = buildReturningClause(node.returning, columns);
    if (returningClause.length > 0) parts.push(returningClause);

    return parts.join(" ");
  }

  // Hard delete
  const whereClause = buildWhereClause(node.conditions, node.softDeleteFilter, ctx, compileCondition);
  const parts = [`DELETE FROM ${quote(tableName)}`, whereClause].filter((p) => p.length > 0);

  const returningClause = buildReturningClause(node.returning, columns);
  if (returningClause.length > 0) parts.push(returningClause);

  return parts.join(" ");
};

export type { ConditionCompiler, MutationCtx, MutationDialectConfig };
export {
  addMutationParam,
  buildReturningClause,
  buildWhereClause,
  compileDeleteShared,
  compileInsertShared,
  compileJoins,
  compileSelectColumn,
  compileUpdateShared,
  quote,
  resolveColumnName,
};
