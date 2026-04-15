/**
 * PostgreSQL dialect implementation.
 *
 * Compiles SelectNode ASTs into PostgreSQL-flavoured SQL with positional
 * parameters ($1, $2, ...). Identifiers are double-quoted and inner quotes
 * are escaped to prevent injection through schema/column names.
 *
 * The dialect is stateless: all mutable state (parameter index) lives inside
 * each compileSelect call so concurrent compilations never interfere.
 */

import type { FieldConfig } from "../model/types.ts";
import type { CompiledQuery, ConditionNode, SelectNode } from "../query/types.ts";
import type { Dialect } from "./dialect.ts";

// ---- Identifier quoting ----

/**
 * Wraps an identifier in double-quotes, escaping any embedded double-quotes
 * by doubling them (the SQL standard escape for double-quoted identifiers).
 */
const quote = (identifier: string): string => `"${identifier.replace(/"/g, "\"\"")}"`;

// ---- Parameter placeholder ----

const param = (index: number): string => `$${index}`;

// ---- Field type mapping ----

const mapFieldType = (schemaType: string, _config: Readonly<FieldConfig>): string => {
  if (schemaType === "number") return "INTEGER";
  if (schemaType === "boolean") return "BOOLEAN";
  return "TEXT";
};

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

// ---- Condition compilation ----

type CompileCtx = {
  readonly tableName: string;
  readonly columns: SelectNode["model"]["columns"];
  // Mutable parameter counter shared across recursive calls within one compileSelect.
  readonly counter: { index: number };
  readonly params: unknown[];
};

const addParam = (ctx: CompileCtx, value: unknown): string => {
  ctx.params.push(value);
  const placeholder = param(ctx.counter.index);
  ctx.counter.index += 1;
  return placeholder;
};

const quotedCol = (ctx: CompileCtx, field: string): string => {
  const colName = resolveColumnName(field, ctx.columns);
  return `${quote(ctx.tableName)}.${quote(colName)}`;
};

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
      return `${quotedCol(ctx, node.column)} ILIKE ${addParam(ctx, node.pattern)}`;

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
    // Mutable counter intentionally scoped to this call only.
    counter: { index: 1 },
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
  const limitClause = node.limit !== undefined ? `LIMIT ${addParam(ctx, node.limit)}` : "";
  const offsetClause = node.offset !== undefined ? `OFFSET ${addParam(ctx, node.offset)}` : "";

  const sql = [selectClause, fromClause, whereClause, orderByClause, limitClause, offsetClause]
    .filter((part) => part.length > 0)
    .join(" ");

  return Object.freeze({ sql, params: Object.freeze([...ctx.params]) });
};

// ---- Dialect factory ----

const createPostgresDialect = (): Dialect =>
  Object.freeze({
    name: "postgresql",
    compileSelect,
    param,
    quote,
    mapFieldType,
  });

export { createPostgresDialect };
