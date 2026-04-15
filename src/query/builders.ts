/**
 * Pure query builder functions, composable via pipe() from @igorjs/pure-ts.
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

import type { Model } from "../model/define.ts";
import type { ConditionNode, OrderByClause, SelectNode, SortDirection } from "./types.ts";

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
    orderBy: Object.freeze([]),
    limit: null,
    offset: null,
    softDeleteFilter: model.$options.softDelete ?? false,
  });

/**
 * Replaces the column projection with the provided set of column names.
 *
 * Calling select() multiple times replaces the previous projection entirely.
 * To project all columns, simply omit select() from the pipeline (the default
 * produced by from() is already "*").
 */
const select = (...columns: string[]) => (node: SelectNode): SelectNode =>
  Object.freeze({ ...node, columns: Object.freeze([...columns]) });

/**
 * Appends a condition to the conditions array (AND semantics).
 *
 * Multiple where() calls accumulate: each invocation adds to the existing
 * list rather than replacing it, so the dialect compiles them as
 * condition1 AND condition2 AND … .
 */
const where = (condition: ConditionNode) => (node: SelectNode): SelectNode =>
  Object.freeze({ ...node, conditions: Object.freeze([...node.conditions, condition]) });

/**
 * Appends an ORDER BY clause, accumulating across multiple calls.
 *
 * Order matters: clauses are applied in the order they were added.
 */
const orderBy = (column: string, direction: SortDirection) => (node: SelectNode): SelectNode => {
  const clause: OrderByClause = Object.freeze({ column, direction });
  return Object.freeze({ ...node, orderBy: Object.freeze([...node.orderBy, clause]) });
};

/**
 * Sets the maximum number of rows to return.
 *
 * Overwrites any previously set limit (last call wins).
 */
const limit = (n: number) => (node: SelectNode): SelectNode => Object.freeze({ ...node, limit: n });

/**
 * Sets the number of rows to skip before returning results.
 *
 * Overwrites any previously set offset (last call wins).
 */
const offset = (n: number) => (node: SelectNode): SelectNode => Object.freeze({ ...node, offset: n });

export { from, limit, offset, orderBy, select, where };
