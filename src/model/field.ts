/**
 * Field() wraps a pure-ts SchemaType with ORM metadata (FieldConfig) to produce
 * a frozen FieldDef. The HasDefault phantom type enables compile-time tracking
 * of which fields are optional in insert operations.
 */

import type { SchemaType } from "@igorjs/pure-ts";
import type { FieldConfig, FieldDef } from "./types.ts";

// Overload: no config -> HasDefault is false (insert requires this field)
function Field<T>(schema: SchemaType<T>): FieldDef<T, false>;
// Overload: config with default -> HasDefault is true (insert may omit this field)
function Field<T>(schema: SchemaType<T>, config: FieldConfig & { default: unknown }): FieldDef<T, true>;
// Overload: primary key with default -> HasDefault is true
function Field<T>(
  schema: SchemaType<T>,
  config: FieldConfig & { primaryKey: true; default: unknown },
): FieldDef<T, true>;
// Overload: config without default -> HasDefault is boolean (unknown at this callsite)
function Field<T>(schema: SchemaType<T>, config: FieldConfig): FieldDef<T, boolean>;
// Implementation
function Field<T>(schema: SchemaType<T>, config?: FieldConfig): FieldDef<T, boolean> {
  // Determine whether this field has a server-side or application-level default,
  // which controls whether inserts can omit the field safely.
  const hasDefault = config !== undefined && "default" in config;

  return Object.freeze<FieldDef<T, boolean>>({
    _tag: "FieldDef",
    schema,
    config: Object.freeze(config ?? {}),
    _hasDefault: hasDefault,
  });
}

export { Field };
