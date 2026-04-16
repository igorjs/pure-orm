/**
 * Pure mutation builder functions.
 *
 * Each function produces a frozen AST node (InsertNode, UpdateNode, DeleteNode)
 * that can be further refined by curried transformer functions and ultimately
 * compiled to SQL by a dialect. No SQL is ever produced here.
 *
 * Builders follow the same curried-transformer style as builders.ts so they
 * compose naturally with pipe():
 *
 *   pipe(
 *     insert(UserModel, { email: "alice@example.com" }),
 *     returning("id", "email"),
 *     onConflict("email", "nothing"),
 *   )
 */

import type { Model } from "../model/define.ts";
import { makeIsNotNull } from "./ast.ts";
import type {
  DeleteNode,
  InsertNode,
  OnConflictClause,
  ReturningClause,
  UpdateNode,
} from "./types.ts";

// ---- Shared model-ref builder ----

/**
 * Extracts the frozen ModelRef from a Model without repeating the three-field
 * destructure at every call site.
 */
const modelRef = <T extends Record<string, unknown>>(model: Model<T>) =>
  Object.freeze({
    name: model.$name,
    columns: model.$columns,
    options: model.$options,
  });

// ---- insert ----

/**
 * Creates an InsertNode for a single row.
 *
 * The values object is shallow-cloned and frozen so mutations to the original
 * cannot affect the AST node after creation.
 */
const insert = <T extends Record<string, unknown>>(
  model: Model<T>,
  values: Readonly<Record<string, unknown>>,
): InsertNode =>
  Object.freeze({
    tag: "Insert",
    model: modelRef(model),
    rows: Object.freeze([Object.freeze({ ...values })]),
    returning: null,
    onConflict: null,
  });

// ---- insertMany ----

/**
 * Creates an InsertNode for multiple rows.
 *
 * Each row is independently frozen so the caller cannot observe mutations
 * through retained references.
 */
const insertMany = <T extends Record<string, unknown>>(
  model: Model<T>,
  values: readonly Readonly<Record<string, unknown>>[],
): InsertNode =>
  Object.freeze({
    tag: "Insert",
    model: modelRef(model),
    rows: Object.freeze(values.map(row => Object.freeze({ ...row }))),
    returning: null,
    onConflict: null,
  });

// ---- update ----

/**
 * Creates an UpdateNode with no conditions set.
 *
 * Call where() from builders.ts to add conditions before executing.
 * softDeleteFilter mirrors model.$options.softDelete so the dialect can
 * automatically scope updates to non-deleted rows.
 */
const update = <T extends Record<string, unknown>>(
  model: Model<T>,
  values: Readonly<Record<string, unknown>>,
): UpdateNode =>
  Object.freeze({
    tag: "Update",
    model: modelRef(model),
    values: Object.freeze({ ...values }),
    conditions: Object.freeze([]),
    returning: null,
    softDeleteFilter: model.$options.softDelete ?? false,
  });

// ---- remove ----

/**
 * Creates a DeleteNode.
 *
 * When the model has softDelete enabled, isSoftDelete is set to true so the
 * dialect emits an UPDATE … SET deleted = true rather than a physical DELETE.
 * softDeleteFilter scopes the operation to rows that are not already deleted.
 */
const remove = <T extends Record<string, unknown>>(model: Model<T>): DeleteNode =>
  Object.freeze({
    tag: "Delete",
    model: modelRef(model),
    conditions: Object.freeze([]),
    returning: null,
    isSoftDelete: model.$options.softDelete ?? false,
    softDeleteFilter: model.$options.softDelete ?? false,
  });

// ---- hardRemove ----

/**
 * Creates a DeleteNode that always performs a physical DELETE, even when
 * the model has softDelete enabled.
 *
 * Use this to permanently purge rows that were previously soft-deleted.
 */
const hardRemove = <T extends Record<string, unknown>>(model: Model<T>): DeleteNode =>
  Object.freeze({
    tag: "Delete",
    model: modelRef(model),
    conditions: Object.freeze([]),
    returning: null,
    isSoftDelete: false,
    softDeleteFilter: false,
  });

// ---- restore ----

/**
 * Creates an UpdateNode that clears deletedAt, restoring a soft-deleted row.
 *
 * Automatically scopes to rows where deleted_at IS NOT NULL so only
 * genuinely soft-deleted rows are affected. Call where() to further narrow
 * the target set (e.g. a specific primary key).
 *
 * Only meaningful for models with softDelete: true. For models without it,
 * this produces a regular UPDATE (setting a deletedAt column that may not exist).
 */
const restore = <T extends Record<string, unknown>>(model: Model<T>): UpdateNode =>
  Object.freeze({
    tag: "Update",
    model: modelRef(model),
    values: Object.freeze({ deletedAt: null }),
    conditions: Object.freeze([makeIsNotNull("deletedAt")]),
    returning: null,
    // Do NOT apply the IS NULL filter: we want to target deleted rows.
    softDeleteFilter: false,
  });

// ---- returning ----

/**
 * Sets the RETURNING clause on a mutation node.
 *
 * Called with no arguments or with "*" returns all columns.
 * Called with specific column names returns only those columns.
 * Works on InsertNode, UpdateNode, and DeleteNode.
 */
const returning =
  (...columns: string[]) =>
  <N extends InsertNode | UpdateNode | DeleteNode>(node: N): N => {
    const clause: ReturningClause =
      columns.length === 0 || (columns.length === 1 && columns[0] === "*")
        ? "*"
        : Object.freeze([...columns]);
    return Object.freeze({ ...node, returning: clause }) as N;
  };

// ---- onConflict ----

/**
 * Sets the ON CONFLICT clause on an InsertNode (upsert semantics).
 *
 * action "nothing" produces ON CONFLICT DO NOTHING.
 * action { update: [...cols] } produces ON CONFLICT DO UPDATE SET col = EXCLUDED.col.
 */
const onConflict =
  (columns: string | readonly string[], action: OnConflictClause["action"]) =>
  (node: InsertNode): InsertNode => {
    const clause: OnConflictClause = Object.freeze({
      columns: typeof columns === "string" ? Object.freeze([columns]) : Object.freeze([...columns]),
      action,
    });
    return Object.freeze({ ...node, onConflict: clause });
  };

export { hardRemove, insert, insertMany, onConflict, remove, restore, returning, update };
