// Copyright 2026 igorjs. SPDX-License-Identifier: Apache-2.0

/**
 * injectSoftDeleteColumn appends the deletedAt column to a ColumnMetadata
 * array when a model has softDelete enabled. This ensures resolveColumnName
 * can map "deletedAt" -> "deleted_at" for conditions like onlyDeleted().
 *
 * Separated from define.ts for independent testability, mirroring the
 * pattern in timestamps.ts.
 */

import { Schema } from "@igorjs/pure-fx/data";
import type { ColumnMetadata } from "./types.ts";

const deletedAtColumn: ColumnMetadata = Object.freeze({
  name: "deletedAt",
  columnName: "deleted_at",
  // nullable: soft-deleted rows have a timestamp, non-deleted have null.
  schema: Schema.isoDate.optional(),
  config: Object.freeze({}),
});

/**
 * Returns a new readonly array with deletedAt appended.
 * The original array is not mutated.
 */
const injectSoftDeleteColumn = (columns: readonly ColumnMetadata[]): readonly ColumnMetadata[] =>
  Object.freeze([...columns, deletedAtColumn]);

export { injectSoftDeleteColumn };
