/**
 * SQLite dialect implementation.
 *
 * Compiles SelectNode ASTs into SQLite-flavoured SQL with anonymous positional
 * parameters (?). Identifiers are double-quoted following the SQL standard,
 * identical to PostgreSQL.
 *
 * Key differences from the PostgreSQL dialect:
 *   - Parameters use ? (no index) rather than $1, $2, ...
 *   - ILIKE is compiled as LIKE (SQLite LIKE is case-insensitive for ASCII by default)
 *   - Type mapping: number -> REAL, boolean -> INTEGER (SQLite has no native BOOLEAN)
 *   - Current timestamp expression is datetime('now') instead of NOW()
 *
 * The dialect is stateless: all mutable state (parameter accumulation) lives
 * inside each compile* call so concurrent compilations never interfere.
 */

import type { FieldConfig } from "../model/types.ts";
import type { CompiledQuery, ConditionNode, DeleteNode, InsertNode, SelectNode, UpdateNode } from "../query/types.ts";
import type { Dialect } from "./dialect.ts";
import type { MutationCtx } from "./shared.ts";
import {
  compileDeleteShared,
  compileInsertShared,
  compileJoins,
  compileSelectColumn,
  compileUpdateShared,
  quote,
  resolveColumnName,
} from "./shared.ts";

// ---- Parameter placeholder ----

// SQLite uses anonymous positional ? placeholders — the index is ignored.
const param = (_index: number): string => "?";

// ---- Field type mapping ----

const mapFieldType = (schemaType: string, _config: Readonly<FieldConfig>): string => {
  if (schemaType === "number") return "REAL";
  // SQLite has no native BOOLEAN type; store as INTEGER (0/1).
  if (schemaType === "boolean") return "INTEGER";
  return "TEXT";
};

// ---- Dialect config for shared mutation compiler ----

// Anonymous ? placeholders — counter is unused but kept for interface compatibility.
const sqliteAddParam = (params: unknown[], _counter: { index: number }, value: unknown): string => {
  params.push(value);
  return "?";
};

const sqliteDialectConfig = Object.freeze({
  addParam: sqliteAddParam,
  nowExpression: "datetime('now')",
});

// ---- Compile context ----

type CompileCtx = {
  readonly tableName: string;
  readonly columns: SelectNode["model"]["columns"];
  // Mutable params array shared across recursive calls within one compile call.
  readonly params: unknown[];
};

const addParam = (ctx: CompileCtx, value: unknown): string => {
  ctx.params.push(value);
  // Always return ? regardless of position.
  return "?";
};

const quotedCol = (ctx: CompileCtx, field: string): string => {
  const colName = resolveColumnName(field, ctx.columns);
  return `${quote(ctx.tableName)}.${quote(colName)}`;
};

// ---- Condition compilation ----

// compileCondition accepts MutationCtx so it can be passed to the shared
// mutation compilers without a separate adapter. MutationCtx is structurally
// compatible with CompileCtx — the extra counter field is simply not used
// by SQLite (anonymous placeholders don't need an index).
const compileCondition = (node: ConditionNode, ctx: MutationCtx): string => {
  switch (node.tag) {
    case "Eq":
      return `${quotedCol(ctx, node.column)} = ${addParam(ctx, node.value)}`;

    case "Ne":
      return `${quotedCol(ctx, node.column)} != ${addParam(ctx, node.value)}`;

    case "Gt":
      return `${quotedCol(ctx, node.column)} > ${addParam(ctx, node.value)}`;

    case "Gte":
      return `${quotedCol(ctx, node.column)} >= ${addParam(ctx, node.value)}`;

    case "Lt":
      return `${quotedCol(ctx, node.column)} < ${addParam(ctx, node.value)}`;

    case "Lte":
      return `${quotedCol(ctx, node.column)} <= ${addParam(ctx, node.value)}`;

    case "Like":
      return `${quotedCol(ctx, node.column)} LIKE ${addParam(ctx, node.pattern)}`;

    case "ILike":
      // SQLite's LIKE is case-insensitive for ASCII letters by default, so
      // ILIKE conditions are compiled as plain LIKE rather than failing with
      // an unknown keyword error.
      return `${quotedCol(ctx, node.column)} LIKE ${addParam(ctx, node.pattern)}`;

    case "IsNull":
      return `${quotedCol(ctx, node.column)} IS NULL`;

    case "IsNotNull":
      return `${quotedCol(ctx, node.column)} IS NOT NULL`;

    case "InArray": {
      if (node.values.length === 0) return "FALSE";
      const placeholders = node.values.map((v) => addParam(ctx, v)).join(", ");
      return `${quotedCol(ctx, node.column)} IN (${placeholders})`;
    }

    case "Between": {
      const lo = addParam(ctx, node.low);
      const hi = addParam(ctx, node.high);
      return `${quotedCol(ctx, node.column)} BETWEEN ${lo} AND ${hi}`;
    }

    case "Not": {
      const inner = compileCondition(node.condition, ctx);
      return `NOT (${inner})`;
    }

    case "And": {
      const parts = node.conditions.map((c) => compileCondition(c, ctx));
      return `(${parts.join(" AND ")})`;
    }

    case "Or": {
      const parts = node.conditions.map((c) => compileCondition(c, ctx));
      return `(${parts.join(" OR ")})`;
    }

    case "Exists": {
      const sub = compileSelect(node.query);
      for (const p of sub.params) addParam(ctx, p);
      return `EXISTS (${sub.sql})`;
    }

    case "NotExists": {
      const sub = compileSelect(node.query);
      for (const p of sub.params) addParam(ctx, p);
      return `NOT EXISTS (${sub.sql})`;
    }
  }
};

// ---- SELECT compilation ----

const compileSelect = (node: SelectNode): CompiledQuery => {
  const tableName = node.model.name;
  // MutationCtx is used directly so compileCondition can be shared.
  const ctx: MutationCtx = {
    tableName,
    columns: node.model.columns,
    counter: { index: 1 },
    params: [],
    dialectConfig: sqliteDialectConfig,
  };

  // SELECT clause: when joins are present and select is "*", project from
  // all tables to include columns from joined tables in the result.
  let selectClause: string;
  if (node.columns === "*") {
    const tables = [quote(tableName), ...node.joins.map((j) => quote(j.model.name))];
    selectClause = `SELECT ${tables.map((t) => `${t}.*`).join(", ")}`;
  } else {
    selectClause = `SELECT ${
      node.columns.map((col) => compileSelectColumn(col, tableName, node.model.columns)).join(", ")
    }`;
  }

  // CTE (WITH) clause: compiled FIRST so CTE params precede main query params.
  let ctePrefix = "";
  if (node.ctes.length > 0) {
    const cteParts = node.ctes.map((c) => {
      const sub = compileSelect(c.query);
      for (const p of sub.params) addParam(ctx, p);
      return `${quote(c.name)} AS (${sub.sql})`;
    });
    ctePrefix = `WITH ${cteParts.join(", ")} `;
  }

  // FROM clause
  const fromClause = `FROM ${quote(tableName)}`;

  // JOIN clauses (between FROM and WHERE)
  const joinClauses = compileJoins(node.joins, tableName, node.model.columns);

  // WHERE clause: user conditions + optional soft-delete filter
  const whereParts: string[] = node.conditions.map((c) => compileCondition(c, ctx));

  if (node.softDeleteFilter) {
    whereParts.push(`${quote(tableName)}.${quote("deleted_at")} IS NULL`);
  }

  const whereClause = whereParts.length > 0 ? `WHERE ${whereParts.join(" AND ")}` : "";

  // GROUP BY clause
  const groupByClause = node.groupBy.length > 0
    ? `GROUP BY ${
      node.groupBy
        .map((col) => `${quote(tableName)}.${quote(resolveColumnName(col, node.model.columns))}`)
        .join(", ")
    }`
    : "";

  // HAVING clause
  const havingClause = node.having.length > 0
    ? `HAVING ${node.having.map((c) => compileCondition(c, ctx)).join(" AND ")}`
    : "";

  // ORDER BY clause
  const orderByClause = node.orderBy.length > 0
    ? `ORDER BY ${
      node.orderBy
        .map((o) => {
          const colName = resolveColumnName(o.column, node.model.columns);
          return `${quote(tableName)}.${quote(colName)} ${o.direction === "asc" ? "ASC" : "DESC"}`;
        })
        .join(", ")
    }`
    : "";

  // LIMIT / OFFSET (parameterised — never interpolated)
  const limitClause = node.limit !== null ? `LIMIT ${addParam(ctx, node.limit)}` : "";
  const offsetClause = node.offset !== null ? `OFFSET ${addParam(ctx, node.offset)}` : "";

  const mainSql = [
    selectClause,
    fromClause,
    ...joinClauses,
    whereClause,
    groupByClause,
    havingClause,
    orderByClause,
    limitClause,
    offsetClause,
  ].filter((part) => part.length > 0)
    .join(" ");

  return Object.freeze({ sql: `${ctePrefix}${mainSql}`, params: Object.freeze([...ctx.params]) });
};

// ---- Mutation helpers ----

const makeMutationCtx = (node: { model: { name: string; columns: SelectNode["model"]["columns"] } }): MutationCtx => ({
  tableName: node.model.name,
  columns: node.model.columns,
  counter: { index: 1 },
  params: [],
  dialectConfig: sqliteDialectConfig,
});

// ---- INSERT compilation ----

const compileInsert = (node: InsertNode): CompiledQuery => {
  const ctx = makeMutationCtx(node);
  const sql = compileInsertShared(node, ctx);
  return Object.freeze({ sql, params: Object.freeze([...ctx.params]) });
};

// ---- UPDATE compilation ----

const compileUpdate = (node: UpdateNode): CompiledQuery => {
  const ctx = makeMutationCtx(node);
  const sql = compileUpdateShared(node, ctx, compileCondition);
  return Object.freeze({ sql, params: Object.freeze([...ctx.params]) });
};

// ---- DELETE compilation ----

const compileDelete = (node: DeleteNode): CompiledQuery => {
  const ctx = makeMutationCtx(node);
  const sql = compileDeleteShared(node, ctx, compileCondition);
  return Object.freeze({ sql, params: Object.freeze([...ctx.params]) });
};

// ---- Dialect factory ----

const createSqliteDialect = (): Dialect =>
  Object.freeze({
    name: "sqlite",
    compileSelect,
    compileInsert,
    compileUpdate,
    compileDelete,
    param,
    quote,
    mapFieldType,
  });

export { createSqliteDialect };
