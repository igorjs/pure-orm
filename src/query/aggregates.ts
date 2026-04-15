/**
 * Aggregate expression builders.
 *
 * Each function returns a frozen AggregateExpr with a chainable .as()
 * method for aliasing. Aggregate expressions are passed to select()
 * alongside plain column names:
 *
 *   pipe(
 *     from(Post),
 *     select("authorId", count("id").as("postCount"), avg("views").as("avgViews")),
 *     groupBy("authorId"),
 *     execute(db),
 *   )
 *
 * The dialect compiles them into SQL aggregate function calls:
 *   SELECT "posts"."author_id", COUNT("posts"."id") AS "postCount", AVG("posts"."views") AS "avgViews"
 */

import type { AggregateExpr, AggregateFn } from "./types.ts";

/**
 * An AggregateExpr with a chainable .as() method for aliasing.
 * Structurally a superset of AggregateExpr so it's assignable to SelectColumn.
 */
type AggregateBuilder = AggregateExpr & {
  readonly as: (alias: string) => AggregateBuilder;
};

const makeAggregate = (fn: AggregateFn, column: string, alias: string | null = null): AggregateBuilder => {
  const expr: AggregateBuilder = Object.freeze({
    tag: "Aggregate" as const,
    fn,
    column,
    alias,
    as: (a: string): AggregateBuilder => makeAggregate(fn, column, a),
  });
  return expr;
};

/** COUNT(column) or COUNT(*) when called with no arguments. */
const count = (column: string = "*"): AggregateBuilder => makeAggregate("COUNT", column);

/** SUM(column) */
const sum = (column: string): AggregateBuilder => makeAggregate("SUM", column);

/** AVG(column) */
const avg = (column: string): AggregateBuilder => makeAggregate("AVG", column);

/** MIN(column) */
const min = (column: string): AggregateBuilder => makeAggregate("MIN", column);

/** MAX(column) */
const max = (column: string): AggregateBuilder => makeAggregate("MAX", column);

export type { AggregateBuilder };
export { avg, count, max, min, sum };
