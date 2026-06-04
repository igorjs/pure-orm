// Copyright 2026 igorjs. SPDX-License-Identifier: Apache-2.0

/**
 * Schema snapshot serialisation.
 *
 * Converts Model definitions into a portable, dialect-agnostic JSON
 * snapshot that captures the full table structure. Two snapshots can be
 * compared by the differ to detect schema changes.
 *
 * The snapshot uses snake_case column names (the SQL names), not camelCase
 * field names, because the differ needs to detect column renames.
 */

import type { Model } from "@/model/define";
import type { ColumnMetadata } from "@/model/types";
import type {
  ColumnSnapshot,
  ForeignKeySnapshot,
  IndexSnapshot,
  SchemaSnapshot,
  TableSnapshot,
} from "./types.ts";

// ---- Column type inference ----

/**
 * Infers a generic type name from a FieldConfig + ColumnMetadata.
 *
 * Uses a simple heuristic: the schema's string representation carries
 * type information we can match. For fields without clear schema type
 * markers, defaults to "string".
 */
const inferType = (meta: ColumnMetadata): string => {
  const schemaStr = String(meta.schema);
  if (schemaStr.includes("number") || schemaStr.includes("Number")) return "number";
  if (schemaStr.includes("boolean") || schemaStr.includes("Boolean")) return "boolean";
  if (schemaStr.includes("Date") || schemaStr.includes("isoDate")) return "date";
  return "string";
};

/**
 * Detects whether a column is nullable by checking if the schema is
 * wrapped in .optional(). The heuristic checks the string representation.
 */
const isNullable = (meta: ColumnMetadata): boolean => {
  const schemaStr = String(meta.schema);
  return schemaStr.includes("optional") || schemaStr.includes("Optional");
};

// ---- Snapshot builders ----

const snapshotColumn = (meta: ColumnMetadata): ColumnSnapshot =>
  Object.freeze({
    type: inferType(meta),
    primaryKey: meta.config.primaryKey ?? false,
    nullable: isNullable(meta),
    unique: meta.config.unique ?? false,
    default: meta.config.default !== undefined ? String(meta.config.default) : null,
    index: meta.config.index ?? false,
    ...(meta.config.renamedFrom !== undefined ? { renamedFrom: meta.config.renamedFrom } : {}),
  });

const snapshotTable = (model: Model): TableSnapshot => {
  const columns: Record<string, ColumnSnapshot> = {};
  const indexes: IndexSnapshot[] = [];
  const foreignKeys: ForeignKeySnapshot[] = [];

  for (const col of model.$columns) {
    columns[col.columnName] = snapshotColumn(col);

    // Generate implicit index entries for indexed/unique columns.
    if (col.config.index === true) {
      indexes.push(
        Object.freeze({
          name: `idx_${model.$name}_${col.columnName}`,
          columns: Object.freeze([col.columnName]),
          unique: false,
        }),
      );
    }
    if (col.config.unique === true && col.config.primaryKey !== true) {
      indexes.push(
        Object.freeze({
          name: `${model.$name}_${col.columnName}_unique`,
          columns: Object.freeze([col.columnName]),
          unique: true,
        }),
      );
    }

    // Foreign key from references config. The reference names a *field*, so we
    // resolve it to the referenced model's SQL column name for correct DDL.
    if (col.config.references !== undefined) {
      const ref = col.config.references();
      const referencedModel = ref[0] as Model;
      const referencedField = ref[1] as string;
      const referencedColumn =
        referencedModel.$columns.find(c => c.name === referencedField)?.columnName ??
        referencedField;
      foreignKeys.push(
        Object.freeze({
          column: col.columnName,
          referencedTable: referencedModel.$name,
          referencedColumn,
          onDelete: col.config.onDelete ?? "no action",
          onUpdate: col.config.onUpdate ?? "no action",
        }),
      );
    }
  }

  return Object.freeze({
    columns: Object.freeze(columns),
    indexes: Object.freeze(indexes),
    foreignKeys: Object.freeze(foreignKeys),
    ...(model.$options.renamedFrom !== undefined
      ? { renamedFrom: model.$options.renamedFrom }
      : {}),
  });
};

/**
 * Creates a full SchemaSnapshot from an array of Models.
 *
 * Each model produces one table entry keyed by its table name.
 */
const createSnapshot = (models: readonly Model[]): SchemaSnapshot =>
  Object.freeze({
    version: 1 as const,
    generatedAt: new Date().toISOString(),
    tables: Object.freeze(Object.fromEntries(models.map(m => [m.$name, snapshotTable(m)]))),
  });

export { createSnapshot, snapshotColumn, snapshotTable };
