/**
 * Common Table Expression (CTE) builder.
 *
 * Attaches named subqueries that appear in the SQL WITH clause, compiled
 * before the main SELECT. CTEs are useful for breaking complex queries
 * into readable named steps.
 *
 * Usage:
 *   import { with as withCte } from "@igorjs/pure-orm"
 *
 *   pipe(
 *     from(Post),
 *     withCte("active_posts", pipe(from(Post), where(eq("published", true)))),
 *     select("authorId", count("id").as("cnt")),
 *     groupBy("authorId"),
 *     execute(db),
 *   )
 *
 * Compiles to:
 *   WITH "active_posts" AS (SELECT ... FROM "posts" WHERE ...)
 *   SELECT ... FROM "posts" GROUP BY ...
 */

import type { CteClause, SelectNode } from "./types.ts";

/**
 * Attaches a CTE (WITH clause) to the SelectNode.
 *
 * Multiple with() calls accumulate: each invocation adds another CTE.
 * CTEs are compiled in the order they were added.
 *
 * Exported as `with` (a reserved word in JS). Import with rename:
 *   import { with as withCte } from "@igorjs/pure-orm"
 */
const withFn = (name: string, query: SelectNode) => (node: SelectNode): SelectNode => {
  const clause: CteClause = Object.freeze({ name, query });
  return Object.freeze({
    ...node,
    ctes: Object.freeze([...node.ctes, clause]),
  });
};

// `with` is a reserved word so it cannot be a local variable name,
// but it CAN be an export name via the `as` syntax.
// eslint-disable-next-line @typescript-eslint/naming-convention
export { withFn as with };
