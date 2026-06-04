// Copyright 2026 igorjs. SPDX-License-Identifier: Apache-2.0

/**
 * MySQL / MariaDB dialect implementation.
 *
 * Compiles SelectNode ASTs into MySQL-flavoured SQL with anonymous positional
 * parameters (?). Identifiers are backtick-quoted, the MySQL convention.
 *
 * Key differences from the PostgreSQL dialect:
 *   - Parameters use ? rather than $1, $2, …
 *   - Identifiers are backtick-quoted instead of double-quoted
 *   - ILIKE compiles to LIKE (MySQL LIKE is case-insensitive under the default
 *     *_ci collations, which is the typical setup)
 *   - Type mapping: number -> BIGINT, boolean -> TINYINT(1), date -> DATETIME
 *   - Current-timestamp expression is NOW() (also valid for MariaDB)
 *   - Upsert uses ON DUPLICATE KEY UPDATE (capability flag only — emitted by the
 *     shared mutation compiler in a follow-up)
 *   - DDL is not transactional on MySQL
 *
 * Covers MariaDB at the same level; version-specific behaviour (RETURNING in
 * MariaDB 10.5+ / MySQL 8.0.21+, etc.) is declared via capabilities and can
 * be tightened per connector.
 *
 * The dialect is stateless: all mutable state (parameter accumulation) lives
 * inside each compile* call so concurrent compilations never interfere.
 */

import type { FieldConfig } from "@/model/types";
import type {
  CompiledQuery,
  ConditionNode,
  DeleteNode,
  InsertNode,
  SelectNode,
  UpdateNode,
} from "@/query/types";
import type { Dialect } from "./dialect.ts";
import type { MutationCtx } from "./shared.ts";
import {
  compileDeleteShared,
  compileInsertShared,
  compileJoins,
  compileSelectColumn,
  compileUpdateShared,
  resolveColumnName,
} from "./shared.ts";

// ---- Identifier quoting (backticks; MySQL convention) ----

/** MySQL identifier quote: wraps in backticks and doubles embedded backticks. */
const quote = (identifier: string): string => `\`${identifier.replace(/`/g, "``")}\``;

// ---- Parameter placeholder ----

// MySQL uses anonymous positional ? placeholders — the index is ignored.
const param = (_index: number): string => "?";

// ---- Field type mapping ----

const mapFieldType = (schemaType: string, _config: Readonly<FieldConfig>): string => {
  if (schemaType === "number") return "BIGINT";
  // MySQL has no native BOOLEAN type; TINYINT(1) is the conventional store.
  if (schemaType === "boolean") return "TINYINT(1)";
  if (schemaType === "date") return "DATETIME";
  // VARCHAR(255) is the historical safe default before utf8mb4 row-size caveats;
  // users who need longer can override via FieldConfig (future capability).
  return "VARCHAR(255)";
};

// ---- Dialect config for shared mutation compiler ----

// Anonymous ? placeholders — counter is unused but kept for interface compatibility.
const mysqlAddParam = (params: unknown[], _counter: { index: number }, value: unknown): string => {
  params.push(value);
  return "?";
};

const mysqlDialectConfig = Object.freeze({
  addParam: mysqlAddParam,
  nowExpression: "NOW()",
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
// by MySQL (anonymous placeholders don't need an index).
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
      // MySQL's LIKE is case-insensitive for ASCII letters by default, so
      // ILIKE conditions are compiled as plain LIKE rather than failing with
      // an unknown keyword error.
      return `${quotedCol(ctx, node.column)} LIKE ${addParam(ctx, node.pattern)}`;

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
    dialectConfig: mysqlDialectConfig,
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

  // CTE (WITH) clause: compiled FIRST so CTE params precede main query params.
  let ctePrefix = "";
  if (node.ctes.length > 0) {
    const cteParts = node.ctes.map(c => {
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
  dialectConfig: mysqlDialectConfig,
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

const mysqlCapabilities = Object.freeze({
  parameterStyle: "question" as const,
  identifierQuote: "`" as const,
  // Conservative default. MariaDB 10.5+ and MySQL 8.0.21+ support RETURNING
  // (with caveats); a follow-up connector can lift this per detected version.
  supportsReturning: false,
  upsertStyle: "onDuplicateKey" as const,
  // Most MySQL DDL implicitly commits the current transaction.
  supportsTransactionalDDL: false,
  currentTimestampSql: "NOW()",
  lockStrategy: "lockTable" as const,
  supportsAddColumnIfNotExists: false,
});

const createMysqlDialect = (): Dialect =>
  Object.freeze({
    name: "mysql",
    capabilities: mysqlCapabilities,
    compileSelect,
    compileInsert,
    compileUpdate,
    compileDelete,
    param,
    quote,
    mapFieldType,
  });

export { createMysqlDialect };
