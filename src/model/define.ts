/**
 * Model() factory: converts a FieldsRecord into a frozen Model with a
 * runtime Schema (for validation), ColumnMetadata (for query generation),
 * and phantom types for insert/update inference.
 *
 * camelToSnake is co-located here because it is only used for column name
 * derivation. If it is needed elsewhere later, extract to a shared utils file.
 */

import { Schema } from "@igorjs/pure-ts";
import type { SchemaType } from "@igorjs/pure-ts";
import { injectTimestampColumns } from "./timestamps.ts";
import type { ColumnMetadata, FieldDef, FieldsRecord, ModelOptions } from "./types.ts";

// ---- Model type ----

/**
 * Runtime + type-level representation of a database table.
 *
 * Defined as an interface so it merges with the Model() factory function,
 * allowing consumers to use `Model` as both a value (factory) and a generic
 * type (`Model<T>`) from a single import.
 */
interface Model<T extends Record<string, unknown> = Record<string, unknown>> {
  readonly $name: string;
  readonly $schema: SchemaType<T>;
  readonly $columns: readonly ColumnMetadata[];
  readonly $options: Readonly<ModelOptions>;
  /** Phantom: full row type including timestamps and soft-delete fields. */
  readonly $type: T;
  /** Phantom: insert type (omits fields with defaults). */
  readonly $insert: Partial<T>;
  /** Phantom: update type (all fields optional). */
  readonly $update: Partial<T>;
}

// ---- camelToSnake ----

/**
 * Converts a camelCase or PascalCase identifier to snake_case.
 *
 * Rules:
 * - Insert an underscore before a capital letter that follows a lowercase letter
 *   or digit (e.g. "authorId" -> "author_id", "createdAt" -> "created_at").
 * - Insert an underscore before a capital letter that is followed by a lowercase
 *   letter when the preceding character was also a capital letter — this handles
 *   consecutive-uppercase acronyms correctly
 *   (e.g. "HTMLParser" -> "html_parser", "parseURL" -> "parse_url").
 * - Already-snake_case strings pass through unchanged.
 */
const camelToSnake = (name: string): string =>
  name
    // Handle transition from a run of uppercase letters into a lowercase letter:
    // "HTMLParser" -> "HTML_Parser" (boundary between 'L' and 'P')
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    // Handle transition from a lowercase letter / digit into an uppercase letter:
    // "authorId" -> "author_Id"
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase();

// ---- InferModelType ----

/**
 * Extracts the plain TypeScript object type for a FieldsRecord.
 * Each field's schema type T is pulled from FieldDef<T, HasDefault>.
 */
type InferModelType<F extends FieldsRecord> = {
  readonly [K in keyof F]: F[K] extends FieldDef<infer T, boolean> ? T : never;
};

// ---- Model factory ----

/**
 * Creates a frozen Model from a table name and field definitions.
 *
 * Internally it:
 * 1. Derives ColumnMetadata from each FieldDef, using camelToSnake for the
 *    database column name (overridable via FieldConfig.columnName).
 * 2. Builds a Schema.object from the field schemas for runtime validation.
 * 3. Injects timestamp columns when options.timestamps is true.
 */
function Model<F extends FieldsRecord>(
  tableName: string,
  config: { fields: F; options?: ModelOptions },
): Model<InferModelType<F>> {
  const { fields, options = {} } = config;

  // Derive column metadata from each field definition.
  const fieldEntries = Object.entries(fields) as readonly [string, FieldDef][];

  const baseColumns: readonly ColumnMetadata[] = Object.freeze(
    fieldEntries.map(([name, fieldDef]) =>
      Object.freeze<ColumnMetadata>({
        name,
        // Prefer an explicit columnName override; fall back to auto-derived snake_case.
        columnName: fieldDef.config.columnName ?? camelToSnake(name),
        schema: fieldDef.schema,
        config: fieldDef.config,
      })
    ),
  );

  // Optionally append createdAt / updatedAt columns.
  const columns = options.timestamps === true ? injectTimestampColumns(baseColumns) : baseColumns;

  // Build a Schema.object whose shape mirrors the FieldsRecord for runtime validation.
  // We need a plain Record<string, SchemaType<unknown>> for Schema.object.
  const schemaShape: Record<string, SchemaType<unknown>> = {};
  for (const [name, fieldDef] of fieldEntries) {
    schemaShape[name] = fieldDef.schema;
  }
  // Schema.object returns SchemaType<{ [K in keys]: inferred }>.
  // We cast through unknown here because TypeScript cannot prove that the
  // dynamically-built shape equals InferModelType<F> structurally at this call site.
  // The phantom type guarantee is upheld by the InferModelType mapped type above.
  const schema = Schema.object(schemaShape) as unknown as SchemaType<InferModelType<F>>;

  return Object.freeze<Model<InferModelType<F>>>({
    $name: tableName,
    $schema: schema,
    $columns: columns,
    $options: Object.freeze(options),
    // Phantom fields: present only at the type level for downstream inference.
    // The runtime value is undefined cast to the phantom type so no actual
    // memory is allocated beyond the undefined slot.
    $type: undefined as unknown as InferModelType<F>,
    $insert: undefined as unknown as Partial<InferModelType<F>>,
    $update: undefined as unknown as Partial<InferModelType<F>>,
  });
}

export { camelToSnake, Model };
export type { InferModelType };
