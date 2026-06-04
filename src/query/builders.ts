// Copyright 2026 igorjs. SPDX-License-Identifier: Apache-2.0

/**
 * Pure query builder functions, composable via pipe() from @igorjs/pure-fx.
 *
 * Each builder accepts a SelectNode and returns a NEW frozen SelectNode,
 * never mutating the input. This immutability guarantee means builders are
 * safe to reuse across multiple query branches without risk of cross-contamination.
 *
 * The from() function is the entry point: it lifts a Model into a SelectNode
 * with sensible defaults. All other builders are curried transformers intended
 * for use with pipe():
 *
 *   pipe(
 *     from(UserModel),
 *     where(eq("active", true)),
 *     orderBy("name", "asc"),
 *     limit(20),
 *   )
 */

import type { Model } from "@/model/define";
import type {
  ConditionNode,
  DeleteNode,
  OrderByClause,
  SelectColumn,
  SelectNode,
  SortDirection,
  UpdateNode,
} from "./types.ts";

/**
 * Lifts a Model into the initial SelectNode with all defaults applied.
 *
 * softDeleteFilter mirrors model.$options.softDelete so the dialect layer
 * can automatically inject the soft-delete predicate without the caller
 * having to remember to add it manually.
 */
const from = <T extends Record<string, unknown>>(model: Model<T>): SelectNode =>
  Object.freeze({
    tag: "Select",
    model: Object.freeze({
      name: model.$name,
      columns: model.$columns,
      options: model.$options,
    }),
    columns: "*",
    conditions: Object.freeze([]),
    joins: Object.freeze([]),
    ctes: Object.freeze([]),
    groupBy: Object.freeze([]),
    having: Object.freeze([]),
    orderBy: Object.freeze([]),
    limit: null,
    offset: null,
    softDeleteFilter: model.$options.softDelete ?? false,
  });

/**
 * Replaces the column projection with the provided set of columns.
 *
 * Accepts plain field names (strings) and aggregate expressions (from
 * count(), sum(), avg(), min(), max()). Calling select() multiple times
 * replaces the previous projection entirely.
 *
 * To project all columns, simply omit select() from the pipeline (the
 * default produced by from() is already "*").
 */
const select =
  (...columns: SelectColumn[]) =>
  (node: SelectNode): SelectNode =>
    Object.freeze({ ...node, columns: Object.freeze([...columns]) });

/**
 * Appends a condition to the conditions array (AND semantics).
 *
 * Multiple where() calls accumulate: each invocation adds to the existing
 * list rather than replacing it, so the dialect compiles them as
 * condition1 AND condition2 AND … .
 *
 * Accepts SelectNode, UpdateNode, and DeleteNode — any node that carries
 * a conditions array. The generic preserves the exact input type so the
 * caller never loses type information through a pipe.
 */
type HasConditions = SelectNode | UpdateNode | DeleteNode;
const where =
  (condition: ConditionNode) =>
  <N extends HasConditions>(node: N): N =>
    Object.freeze({ ...node, conditions: Object.freeze([...node.conditions, condition]) }) as N;

/**
 * Appends an ORDER BY clause, accumulating across multiple calls.
 *
 * Order matters: clauses are applied in the order they were added.
 */
const orderBy =
  (column: string, direction: SortDirection) =>
  (node: SelectNode): SelectNode => {
    const clause: OrderByClause = Object.freeze({ column, direction });
    return Object.freeze({ ...node, orderBy: Object.freeze([...node.orderBy, clause]) });
  };

/**
 * Appends columns to the GROUP BY clause, accumulating across multiple calls.
 *
 * Column names are resolved through model metadata at compilation time,
 * so camelCase field names are accepted.
 */
const groupBy =
  (...columns: string[]) =>
  (node: SelectNode): SelectNode =>
    Object.freeze({ ...node, groupBy: Object.freeze([...node.groupBy, ...columns]) });

/**
 * Appends a HAVING condition, accumulating across multiple calls (AND semantics).
 *
 * HAVING filters grouped rows, so it is only meaningful after groupBy().
 * The dialect compiles conditions identically to WHERE but places them
 * after the GROUP BY clause.
 */
const having =
  (condition: ConditionNode) =>
  (node: SelectNode): SelectNode =>
    Object.freeze({ ...node, having: Object.freeze([...node.having, condition]) });

/**
 * Sets the maximum number of rows to return.
 *
 * Overwrites any previously set limit (last call wins).
 */
const limit =
  (n: number) =>
  (node: SelectNode): SelectNode =>
    Object.freeze({ ...node, limit: n });

/**
 * Sets the number of rows to skip before returning results.
 *
 * Overwrites any previously set offset (last call wins).
 */
const offset =
  (n: number) =>
  (node: SelectNode): SelectNode =>
    Object.freeze({ ...node, offset: n });

export type { HasConditions };
export { from, groupBy, having, limit, offset, orderBy, select, where };
