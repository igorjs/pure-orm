/**
 * PostgreSQL dialect implementation.
 *
 * Compiles SelectNode ASTs into PostgreSQL-flavoured SQL with positional
 * parameters ($1, $2, ...). Identifiers are double-quoted and inner quotes
 * are escaped to prevent injection through schema/column names.
 *
 * The dialect is stateless: all mutable state (parameter index) lives inside
 * each compile* call so concurrent compilations never interfere.
 */

import type { FieldConfig } from "../model/types.ts";
import type {
  CompiledQuery,
  ConditionNode,
  DeleteNode,
  InsertNode,
  SelectNode,
  UpdateNode,
} from "../query/types.ts";
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

const param = (index: number): string => `$${index}`;

// ---- Field type mapping ----

const mapFieldType = (schemaType: string, _config: Readonly<FieldConfig>): string => {
  if (schemaType === "number") return "INTEGER";
  if (schemaType === "boolean") return "BOOLEAN";
  return "TEXT";
};

// ---- Dialect config for shared mutation compiler ----

// Positional parameters: $1, $2, ...
// The counter is incremented by one each time a param is added.
const pgAddParam = (params: unknown[], counter: { index: number }, value: unknown): string => {
  params.push(value);
  const placeholder = param(counter.index);
  counter.index += 1;
  return placeholder;
};

const pgDialectConfig = Object.freeze({
  addParam: pgAddParam,
  nowExpression: "NOW()",
});

// ---- Compile context ----

// The unified context type shared between SELECT and mutation compilers.
// SELECT does not use dialectConfig but MutationCtx is a superset that
// works for both when we cast appropriately.
type CompileCtx = {
  readonly tableName: string;
  readonly columns: SelectNode["model"]["columns"];
  // Mutable parameter counter shared across recursive calls within one compile call.
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

// ---- Condition compilation ----

// compileCondition accepts MutationCtx so it can be passed to the shared
// mutation compilers (compileInsertShared etc.) without a separate adapter.
// MutationCtx is structurally compatible with CompileCtx — extra fields
// (dialectConfig) are ignored by callers that only need the base fields.
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
      return `${quotedCol(ctx, node.column)} ILIKE ${addParam(ctx, node.pattern)}`;

    case "IsNull":
      return `${quotedCol(ctx, node.column)} IS NULL`;

    case "IsNotNull":
      return `${quotedCol(ctx, node.column)} IS NOT NULL`;

    case "InArray": {
      if (node.values.length === 0) return "FALSE";
      const placeholders = node.values.map(v => addParam(ctx, v)).join(", ");
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
      const parts = node.conditions.map(c => compileCondition(c, ctx));
      return `(${parts.join(" AND ")})`;
    }

    case "Or": {
      const parts = node.conditions.map(c => compileCondition(c, ctx));
      return `(${parts.join(" OR ")})`;
    }

    case "Exists": {
      const sub = compileSelect(node.query);
      // Rewrite $N placeholders to account for the outer query's param count.
      const offset = ctx.counter.index - 1;
      const rewritten = sub.sql.replace(/\$(\d+)/g, (_, n) => `$${Number(n) + offset}`);
      for (const p of sub.params) addParam(ctx, p);
      return `EXISTS (${rewritten})`;
    }

    case "NotExists": {
      const sub = compileSelect(node.query);
      const offset = ctx.counter.index - 1;
      const rewritten = sub.sql.replace(/\$(\d+)/g, (_, n) => `$${Number(n) + offset}`);
      for (const p of sub.params) addParam(ctx, p);
      return `NOT EXISTS (${rewritten})`;
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
    // Mutable counter intentionally scoped to this call only.
    counter: { index: 1 },
    params: [],
    dialectConfig: pgDialectConfig,
  };

  // SELECT clause: when joins are present and select is "*", project from
  // all tables to include columns from joined tables in the result.
  let selectClause: string;
  if (node.columns === "*") {
    const tables = [quote(tableName), ...node.joins.map(j => quote(j.model.name))];
    selectClause = `SELECT ${tables.map(t => `${t}.*`).join(", ")}`;
  } else {
    selectClause = `SELECT ${node.columns
      .map(col => compileSelectColumn(col, tableName, node.model.columns))
      .join(", ")}`;
  }

  // CTE (WITH) clause: compiled FIRST so CTE params get the lowest $N indices.
  let ctePrefix = "";
  if (node.ctes.length > 0) {
    const cteParts = node.ctes.map(c => {
      const sub = compileSelect(c.query);
      const offset = ctx.counter.index - 1;
      const rewritten = sub.sql.replace(/\$(\d+)/g, (_, n) => `$${Number(n) + offset}`);
      for (const p of sub.params) addParam(ctx, p);
      return `${quote(c.name)} AS (${rewritten})`;
    });
    ctePrefix = `WITH ${cteParts.join(", ")} `;
  }

  // FROM clause
  const fromClause = `FROM ${quote(tableName)}`;

  // JOIN clauses (between FROM and WHERE)
  const joinClauses = compileJoins(node.joins, tableName, node.model.columns);

  // WHERE clause: user conditions + optional soft-delete filter
  const whereParts: string[] = node.conditions.map(c => compileCondition(c, ctx));

  if (node.softDeleteFilter) {
    whereParts.push(`${quote(tableName)}.${quote("deleted_at")} IS NULL`);
  }

  const whereClause = whereParts.length > 0 ? `WHERE ${whereParts.join(" AND ")}` : "";

  // GROUP BY clause
  const groupByClause =
    node.groupBy.length > 0
      ? `GROUP BY ${node.groupBy
          .map(col => `${quote(tableName)}.${quote(resolveColumnName(col, node.model.columns))}`)
          .join(", ")}`
      : "";

  // HAVING clause
  const havingClause =
    node.having.length > 0
      ? `HAVING ${node.having.map(c => compileCondition(c, ctx)).join(" AND ")}`
      : "";

  // ORDER BY clause
  const orderByClause =
    node.orderBy.length > 0
      ? `ORDER BY ${node.orderBy
          .map(o => {
            const colName = resolveColumnName(o.column, node.model.columns);
            return `${quote(tableName)}.${quote(colName)} ${o.direction === "asc" ? "ASC" : "DESC"}`;
          })
          .join(", ")}`
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
  ]
    .filter(part => part.length > 0)
    .join(" ");

  return Object.freeze({ sql: `${ctePrefix}${mainSql}`, params: Object.freeze([...ctx.params]) });
};

// ---- Mutation helpers ----

const makeMutationCtx = (node: {
  model: { name: string; columns: SelectNode["model"]["columns"] };
}): MutationCtx => ({
  tableName: node.model.name,
  columns: node.model.columns,
  counter: { index: 1 },
  params: [],
  dialectConfig: pgDialectConfig,
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

const createPostgresDialect = (): Dialect =>
  Object.freeze({
    name: "postgresql",
    compileSelect,
    compileInsert,
    compileUpdate,
    compileDelete,
    param,
    quote,
    mapFieldType,
  });

export { createPostgresDialect };
