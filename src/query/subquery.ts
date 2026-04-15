/**
 * Subquery condition builders.
 *
 * exists() and notExists() wrap a SelectNode as a correlated subquery
 * condition. They compile to EXISTS (SELECT ...) and NOT EXISTS (SELECT ...)
 * respectively in the WHERE clause.
 *
 * Usage:
 *   pipe(
 *     from(User),
 *     where(exists(pipe(from(Post), where(eq("authorId", "User.id"))))),
 *     execute(db),
 *   )
 */

import type { ConditionNode, ExistsNode, NotExistsNode, SelectNode } from "./types.ts";

/** Creates an EXISTS (subquery) condition. */
const exists = (query: SelectNode): ConditionNode => {
  const node: ExistsNode = Object.freeze({ tag: "Exists", query });
  return node;
};

/** Creates a NOT EXISTS (subquery) condition. */
const notExists = (query: SelectNode): ConditionNode => {
  const node: NotExistsNode = Object.freeze({ tag: "NotExists", query });
  return node;
};

export { exists, notExists };
