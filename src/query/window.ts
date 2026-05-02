// Copyright 2026 igorjs. SPDX-License-Identifier: Apache-2.0

/**
 * Window function expression builders.
 *
 * Window functions compute a value across a set of rows related to the
 * current row. Unlike aggregates, they don't collapse rows.
 *
 * Usage:
 *   pipe(
 *     from(Post),
 *     select("*", rowNumber().partitionBy("authorId").orderBy("createdAt", "desc").as("rank")),
 *     execute(db),
 *   )
 *
 * Compiles to:
 *   SELECT "posts".*, ROW_NUMBER() OVER (PARTITION BY "author_id" ORDER BY "created_at" DESC) AS "rank"
 */

import type { OrderByClause, SortDirection, WindowExpr, WindowFn } from "./types.ts";

/**
 * A WindowExpr with chainable builder methods.
 * Structurally a superset of WindowExpr so it's assignable to SelectColumn.
 */
type WindowBuilder = WindowExpr & {
  readonly partitionBy: (...columns: string[]) => WindowBuilder;
  readonly orderBy: (column: string, direction: SortDirection) => WindowBuilder;
  readonly as: (alias: string) => WindowBuilder;
};

const makeWindow = (
  fn: WindowFn,
  partitions: readonly string[] = [],
  orders: readonly OrderByClause[] = [],
  alias: string | null = null,
): WindowBuilder =>
  Object.freeze({
    tag: "Window" as const,
    fn,
    partitions: Object.freeze(partitions),
    orders: Object.freeze(orders),
    alias,
    partitionBy: (...cols: string[]): WindowBuilder =>
      makeWindow(fn, Object.freeze([...partitions, ...cols]), orders, alias),
    orderBy: (col: string, dir: SortDirection): WindowBuilder =>
      makeWindow(
        fn,
        partitions,
        Object.freeze([...orders, Object.freeze({ column: col, direction: dir })]),
        alias,
      ),
    as: (a: string): WindowBuilder => makeWindow(fn, partitions, orders, a),
  });

/** ROW_NUMBER() window function. */
const rowNumber = (): WindowBuilder => makeWindow("ROW_NUMBER");

/** RANK() window function. */
const rank = (): WindowBuilder => makeWindow("RANK");

/** DENSE_RANK() window function. */
const denseRank = (): WindowBuilder => makeWindow("DENSE_RANK");

export type { WindowBuilder };
export { denseRank, rank, rowNumber };
