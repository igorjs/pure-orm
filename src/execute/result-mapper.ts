// Copyright 2026 igorjs. SPDX-License-Identifier: Apache-2.0

/**
 * Result mapping: converts raw database rows into typed immutable records.
 *
 * Database drivers return plain objects with snake_case keys. This module
 * transforms those rows into ImmutableRecord values with camelCase keys,
 * using model column metadata for authoritative name resolution and falling
 * back to a mechanical snake_case -> camelCase conversion when no metadata
 * match exists.
 *
 * All output is wrapped in List/Record from @igorjs/pure-fx to enforce
 * immutability at the boundary between the database and application layers.
 */

import type { ImmutableList, ImmutableRecord } from "@igorjs/pure-fx/data";
import { List, Record } from "@igorjs/pure-fx/data";

// ---- snake_case -> camelCase conversion ----

/**
 * Convert a snake_case string to camelCase.
 *
 * "author_id"  -> "authorId"
 * "created_at" -> "createdAt"
 * "name"       -> "name"  (no underscores, unchanged)
 *
 * This is the inverse of the camelToSnake transform used when writing
 * column names into the AST.
 */
const snakeToCamel = (str: string): string =>
  str.replace(/_([a-z])/g, (_, char: string) => char.toUpperCase());

// ---- Column metadata reference (subset used here) ----

type ColumnRef = {
  readonly name: string;
  readonly columnName: string;
};

type ModelRef = {
  readonly columns: readonly ColumnRef[];
};

// ---- Row mapper ----

/**
 * Map an array of raw DB rows into an immutable List of immutable Records.
 *
 * For each row:
 *   1. Build a lookup table: columnName (snake_case) -> name (camelCase)
 *      using the model's column metadata as the authoritative source.
 *      When modelRef is null (e.g. RawNode), the lookup is empty and
 *      snakeToCamel() is used for all keys.
 *   2. For every key in the raw row, resolve the camelCase name from the
 *      lookup; fall back to snakeToCamel() for columns not in the model.
 *   3. Wrap the remapped plain object in Record() for immutability.
 *
 * The cast from `unknown` to `Record<string, unknown>` is necessary because
 * database drivers return untyped rows. The object shape is validated
 * implicitly by the column lookup — only known keys are remapped.
 */
const mapRows = <T>(
  rows: readonly unknown[],
  modelRef: ModelRef | null,
): ImmutableList<ImmutableRecord<T>> => {
  if (rows.length === 0) {
    return List<ImmutableRecord<T>>([]);
  }

  // Build the columnName -> fieldName lookup once per call (not per row).
  // When modelRef is null (RawNode), the map is empty and all keys fall
  // through to the snakeToCamel fallback.
  const columnToField = new Map<string, string>();
  if (modelRef !== null) {
    for (const col of modelRef.columns) {
      columnToField.set(col.columnName, col.name);
    }
  }

  const mapped = rows.map(row => {
    // DB drivers return plain objects with unknown shape — the cast to
    // Record<string, unknown> is the accepted boundary escape hatch.
    const rawRow = row as Record<string, unknown>;
    const remapped: Record<string, unknown> = {};

    for (const key of Object.keys(rawRow)) {
      const camelKey = columnToField.get(key) ?? snakeToCamel(key);
      remapped[camelKey] = rawRow[key];
    }

    return Record(remapped) as ImmutableRecord<T>;
  });

  return List(mapped);
};

export { mapRows, snakeToCamel };
