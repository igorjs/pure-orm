// Copyright 2026 igorjs. SPDX-License-Identifier: Apache-2.0

/**
 * Model layer types.
 *
 * FieldDef wraps a pure-fx Schema with ORM metadata (primaryKey, unique, etc.)
 * without modifying the schema itself. Model is the runtime + type-level
 * representation of a database table, carrying phantom types for $type,
 * $insert, and $update inference.
 */

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
  /**
   * Previous SQL column name, so the differ emits a RenameColumn instead of a
   * data-destroying drop-plus-add (ADR-0004).
   */
  readonly renamedFrom?: string;
};

/**
 * FieldDef pairs a pure-fx Schema with ORM metadata.
 * The HasDefault phantom distinguishes fields that are optional in inserts
 * (those with defaults, primary keys with auto-generation, etc.).
 *
 * The schema field is stored as `unknown` (not SchemaType<T>) to avoid
 * SchemaType<T> invariance making FieldDef<string> non-assignable to
 * FieldDef<unknown>. The phantom type T is preserved for InferModelType.
 */
type FieldDef<T = unknown, HasDefault extends boolean = boolean> = {
  readonly _tag: "FieldDef";
  readonly schema: unknown;
  readonly config: Readonly<FieldConfig>;
  /** Phantom: preserves T for InferModelType without affecting runtime. */
  readonly _type: T;
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

/**
 * Table-level CHECK constraint declaration (ADR-0005). The `name` is the
 * stable identity key the differ uses to detect adds/drops/changes — keep it
 * stable across edits or a rename will look like a drop + add.
 */
type CheckSpec = {
  readonly name: string;
  readonly expression: string;
};

type ModelOptions = {
  readonly timestamps?: boolean;
  readonly softDelete?: boolean;
  readonly audit?: boolean;
  /** Previous table name, so the differ emits a RenameTable, not drop+create (ADR-0004). */
  readonly renamedFrom?: string;
  /** Table-level CHECK constraints (ADR-0005). */
  readonly checks?: readonly CheckSpec[];
};

// ---- Model reference (embedded in AST to avoid circular refs) ----

type ModelRef = {
  readonly name: string;
  readonly columns: readonly ColumnMetadata[];
  readonly options: Readonly<ModelOptions>;
};

// ---- Fields record (input to Model()) ----

type FieldsRecord = Readonly<Record<string, FieldDef>>;

export type {
  CheckSpec,
  ColumnMetadata,
  FieldConfig,
  FieldDef,
  FieldsRecord,
  ModelOptions,
  ModelRef,
};
