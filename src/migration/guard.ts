// Copyright 2026 igorjs. SPDX-License-Identifier: Apache-2.0

/**
 * Destructive-change guard.
 *
 * The differ has no rename concept: a renamed table or column appears as a
 * drop of the old name plus a create of the new one, which destroys data
 * silently when applied. Until full rename detection lands (ADR-0004), this
 * guard converts that silent loss into a loud, explicit choice — `generate`
 * fails closed on any DropTable/DropColumn unless --allow-destructive is set.
 *
 * The check is intentionally conservative: at generate time there is no live
 * database to probe for row counts, so every drop is treated as destructive.
 */

import type { ChangeOperation } from "./types.ts";

/** A drop of a table or column can destroy data; index/alter/add operations cannot. */
const isDestructiveOp = (op: ChangeOperation): boolean =>
  op.tag === "DropTable" || op.tag === "DropColumn";

const findDestructiveOps = (ops: readonly ChangeOperation[]): readonly ChangeOperation[] =>
  Object.freeze(ops.filter(isDestructiveOp));

/** Human-readable, dialect-agnostic description used in warnings and errors. */
const describeDestructiveOp = (op: ChangeOperation): string => {
  switch (op.tag) {
    case "DropTable":
      return `DROP TABLE "${op.table}"`;
    case "DropColumn":
      return `DROP COLUMN "${op.table}"."${op.column}"`;
    default:
      return op.tag;
  }
};

type GuardResult =
  | { readonly ok: true; readonly warnings: readonly string[] }
  | { readonly ok: false; readonly blocked: readonly string[] };

/**
 * Decides whether a set of operations may proceed.
 *
 * - No destructive ops: ok, no warnings.
 * - Destructive ops with `allowDestructive`: ok, but the descriptions are
 *   returned as warnings so the caller can print them loudly.
 * - Destructive ops without the flag: blocked (fail closed).
 */
const checkDestructive = (
  ops: readonly ChangeOperation[],
  allowDestructive: boolean,
): GuardResult => {
  const destructive = findDestructiveOps(ops);
  if (destructive.length === 0) {
    return Object.freeze({ ok: true as const, warnings: Object.freeze([]) });
  }
  const descriptions = Object.freeze(destructive.map(describeDestructiveOp));
  return allowDestructive
    ? Object.freeze({ ok: true as const, warnings: descriptions })
    : Object.freeze({ ok: false as const, blocked: descriptions });
};

export type { GuardResult };
export { checkDestructive, describeDestructiveOp, findDestructiveOps, isDestructiveOp };
