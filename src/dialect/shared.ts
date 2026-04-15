/**
 * Shared dialect utilities.
 *
 * Functions that are identical across dialects are extracted here so each
 * dialect implementation can import rather than duplicate them.
 *
 * Only truly dialect-agnostic logic lives here; anything that varies by
 * dialect (param style, ILIKE handling, type mappings) stays in the
 * individual dialect files.
 */

import type { SelectNode } from "../query/types.ts";

// ---- Identifier quoting ----

/**
 * Wraps an identifier in double-quotes, escaping any embedded double-quotes
 * by doubling them (the SQL standard escape for double-quoted identifiers).
 *
 * Both PostgreSQL and SQLite use the same quoting rules per the SQL standard.
 */
const quote = (identifier: string): string => `"${identifier.replace(/"/g, "\"\"")}"`;

// ---- Column name resolution ----

/**
 * Resolves a camelCase field reference (optionally qualified as "Model.field")
 * to its snake_case database column name using the model's ColumnMetadata.
 *
 * Falls back to the raw field name when no metadata entry is found, which
 * allows raw column names to pass through unmodified.
 */
const resolveColumnName = (
  field: string,
  columns: SelectNode["model"]["columns"],
): string => {
  // Strip a leading qualifier such as "User." if present.
  const fieldName = field.includes(".") ? field.slice(field.indexOf(".") + 1) : field;

  const meta = columns.find((col) => col.name === fieldName);
  return meta !== undefined ? meta.columnName : fieldName;
};

export { quote, resolveColumnName };
