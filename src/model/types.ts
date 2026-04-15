/**
 * Model layer types.
 *
 * FieldDef wraps a pure-ts Schema with ORM metadata (primaryKey, unique, etc.)
 * without modifying the schema itself. Model is the runtime + type-level
 * representation of a database table, carrying phantom types for $type,
 * $insert, and $update inference.
 */

import type { SchemaType } from "@igorjs/pure-ts";

// ---- Field configuration ----

type FieldConfig = {
  readonly primaryKey?: boolean;
  readonly unique?: boolean;
  readonly index?: boolean;
  readonly default?: "uuid" | "cuid" | "now" | "autoincrement" | (unknown & {});
  /** Lazy reference to another model's field. Phase 3 (relations). */
  readonly references?: () => readonly [unknown, string];
  readonly onDelete?: "cascade" | "restrict" | "set null" | "no action";
  readonly onUpdate?: "cascade" | "restrict" | "set null" | "no action";
  readonly columnName?: string;
};

/**
 * FieldDef pairs a pure-ts Schema with ORM metadata.
 * The HasDefault phantom distinguishes fields that are optional in inserts
 * (those with defaults, primary keys with auto-generation, etc.).
 */
type FieldDef<T = unknown, HasDefault extends boolean = boolean> = {
  readonly _tag: "FieldDef";
  readonly schema: SchemaType<T>;
  readonly config: Readonly<FieldConfig>;
  /** Phantom type for compile-time insert optionality tracking. */
  readonly _hasDefault: HasDefault;
};

// ---- Column metadata ----

type ColumnMetadata = {
  readonly name: string;
  readonly columnName: string;
  /**
   * Raw schema reference stored as unknown due to SchemaType<T> invariance.
   * Recover the typed schema from Model.$schema when validation is needed.
   */
  readonly schema: unknown;
  readonly config: Readonly<FieldConfig>;
};

// ---- Model options ----

type ModelOptions = {
  readonly timestamps?: boolean;
  readonly softDelete?: boolean;
  readonly audit?: boolean;
};

// ---- Model reference (embedded in AST to avoid circular refs) ----

type ModelRef = {
  readonly name: string;
  readonly columns: readonly ColumnMetadata[];
  readonly options: Readonly<ModelOptions>;
};

// ---- Fields record (input to Model()) ----

type FieldsRecord = Readonly<Record<string, FieldDef>>;

export type { ColumnMetadata, FieldConfig, FieldDef, FieldsRecord, ModelOptions, ModelRef };
