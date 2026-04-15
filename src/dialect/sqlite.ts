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
 *
 * The dialect is stateless: all mutable state (parameter accumulation) lives
 * inside each compileSelect call so concurrent compilations never interfere.
 */

import type { FieldConfig } from "../model/types.ts";
import type { CompiledQuery, ConditionNode, SelectNode } from "../query/types.ts";
import type { Dialect } from "./dialect.ts";
import { quote, resolveColumnName } from "./shared.ts";

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

// ---- Compile context ----

type CompileCtx = {
  readonly tableName: string;
  readonly columns: SelectNode["model"]["columns"];
  // Mutable params array shared across recursive calls within one compileSelect.
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

const compileCondition = (node: ConditionNode, ctx: CompileCtx): string => {
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
  }
};

// ---- SELECT compilation ----

const compileSelect = (node: SelectNode): CompiledQuery => {
  const tableName = node.model.name;
  const ctx: CompileCtx = {
    tableName,
    columns: node.model.columns,
    params: [],
  };

  // SELECT clause
  const selectClause = node.columns === "*"
    ? `SELECT ${quote(tableName)}.*`
    : `SELECT ${
      node.columns.map((col) => `${quote(tableName)}.${quote(resolveColumnName(col, node.model.columns))}`).join(", ")
    }`;

  // FROM clause
  const fromClause = `FROM ${quote(tableName)}`;

  // WHERE clause: user conditions + optional soft-delete filter
  const whereParts: string[] = node.conditions.map((c) => compileCondition(c, ctx));

  if (node.softDeleteFilter) {
    whereParts.push(`${quote(tableName)}.${quote("deleted_at")} IS NULL`);
  }

  const whereClause = whereParts.length > 0 ? `WHERE ${whereParts.join(" AND ")}` : "";

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

  const sql = [selectClause, fromClause, whereClause, orderByClause, limitClause, offsetClause]
    .filter((part) => part.length > 0)
    .join(" ");

  return Object.freeze({ sql, params: Object.freeze([...ctx.params]) });
};

// ---- Dialect factory ----

const createSqliteDialect = (): Dialect =>
  Object.freeze({
    name: "sqlite",
    compileSelect,
    param,
    quote,
    mapFieldType,
  });

export { createSqliteDialect };
