// Copyright 2026 igorjs. SPDX-License-Identifier: Apache-2.0

/**
 * injectTimestampColumns appends standard audit columns (created_at, updated_at)
 * to a ColumnMetadata array. Keeping this separate from define.ts makes the
 * injection logic independently testable and composable.
 */

import { Schema } from "../fx.ts";
import type { ColumnMetadata } from "./types.ts";

// Reusable frozen metadata for the two standard timestamp columns.
const createdAtColumn: ColumnMetadata = Object.freeze({
  name: "createdAt",
  columnName: "created_at",
  schema: Schema.isoDate,
  config: Object.freeze({ default: "now" as const }),
});

const updatedAtColumn: ColumnMetadata = Object.freeze({
  name: "updatedAt",
  columnName: "updated_at",
  schema: Schema.isoDate,
  config: Object.freeze({ default: "now" as const }),
});

/**
 * Returns a new readonly array with createdAt and updatedAt appended.
 * The original array is not mutated.
 */
const injectTimestampColumns = (columns: readonly ColumnMetadata[]): readonly ColumnMetadata[] =>
  Object.freeze([...columns, createdAtColumn, updatedAtColumn]);

export { injectTimestampColumns };
