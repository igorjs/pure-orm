/**
 * Soft-delete query modifiers.
 *
 * Models with softDelete: true automatically filter out deleted rows
 * (WHERE deleted_at IS NULL) in every query produced by from().
 * These pipe stages let callers override that default behaviour:
 *
 *   pipe(from(User), withDeleted(), execute(db))   // include deleted
 *   pipe(from(User), onlyDeleted(), execute(db))   // only deleted
 */

import { makeIsNotNull } from "./ast.ts";
import type { SelectNode } from "./types.ts";

/**
 * Removes the automatic soft-delete filter, returning ALL rows including
 * those with a non-null deleted_at.
 *
 * Idempotent: calling withDeleted() on a node that already has the filter
 * disabled is a no-op (the filter stays disabled).
 */
const withDeleted =
  () =>
  (node: SelectNode): SelectNode =>
    Object.freeze({ ...node, softDeleteFilter: false });

/**
 * Inverts the soft-delete filter to return ONLY soft-deleted rows
 * (WHERE deleted_at IS NOT NULL).
 *
 * Disables the default IS NULL filter and injects an IS NOT NULL condition
 * so only rows that have been soft-deleted are returned.
 */
const onlyDeleted =
  () =>
  (node: SelectNode): SelectNode =>
    Object.freeze({
      ...node,
      softDeleteFilter: false,
      conditions: Object.freeze([...node.conditions, makeIsNotNull("deletedAt")]),
    });

export { onlyDeleted, withDeleted };
