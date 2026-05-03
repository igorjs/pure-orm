// Copyright 2026 igorjs. SPDX-License-Identifier: Apache-2.0

/**
 * Pure join builder functions, composable via pipe() from @igorjs/pure-fx.
 *
 * Each builder appends a frozen JoinClause to the SelectNode's joins array,
 * never mutating the input node. Join clauses carry the target model's
 * metadata so the dialect can resolve column names from both tables.
 *
 * Usage with pipe():
 *
 *   pipe(
 *     from(Post),
 *     join(User, on("authorId", "id")),
 *     leftJoin(Category, on("categoryId", "id")),
 *     where(eq("published", true)),
 *     execute(db),
 *   )
 *
 * The on() helper creates the JoinCondition: leftColumn is resolved from the
 * source table (or a qualified "Table.field"), rightColumn from the target.
 */

import type { Model } from "../model/define.ts";
import type { JoinClause, JoinCondition, JoinType, SelectNode } from "./types.ts";

// ---- on() condition factory ----

/**
 * Creates a JoinCondition describing a column-to-column equality.
 *
 * leftColumn: field name in the source table, or "Table.field" for qualified refs.
 * rightColumn: field name in the joined (target) table.
 */
const on = (leftColumn: string, rightColumn: string): JoinCondition =>
  Object.freeze({ leftColumn, rightColumn });

// ---- Generic join builder ----

const addJoin =
  (joinType: JoinType, model: Model, condition: JoinCondition) =>
  (node: SelectNode): SelectNode => {
    const clause: JoinClause = Object.freeze({
      model: Object.freeze({
        name: model.$name,
        columns: model.$columns,
        options: model.$options,
      }),
      joinType,
      condition,
    });
    return Object.freeze({
      ...node,
      joins: Object.freeze([...node.joins, clause]),
    });
  };

// ---- Public join builders ----

/**
 * Appends an INNER JOIN. Only rows with matches in both tables are returned.
 */
const join = (model: Model, condition: JoinCondition) => addJoin("inner", model, condition);

/**
 * Appends a LEFT (OUTER) JOIN. All rows from the source table are returned,
 * with NULL for unmatched columns in the joined table.
 */
const leftJoin = (model: Model, condition: JoinCondition) => addJoin("left", model, condition);

/**
 * Appends a RIGHT (OUTER) JOIN. All rows from the joined table are returned,
 * with NULL for unmatched columns in the source table.
 */
const rightJoin = (model: Model, condition: JoinCondition) => addJoin("right", model, condition);

/**
 * Appends a FULL (OUTER) JOIN. All rows from both tables are returned,
 * with NULL padding where there is no match.
 */
const fullJoin = (model: Model, condition: JoinCondition) => addJoin("full", model, condition);

export { fullJoin, join, leftJoin, on, rightJoin };
