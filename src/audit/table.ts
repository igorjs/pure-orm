/**
 * Pre-built model for the _pure_orm_audit table.
 *
 * This model is used by auditLog() to query audit entries. The table
 * schema matches the AuditEntry type from ./types.ts.
 *
 * Users create the table themselves (via migrations or DDL) using this schema:
 *
 *   CREATE TABLE _pure_orm_audit (
 *     id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 *     table_name    TEXT NOT NULL,
 *     operation     TEXT NOT NULL,
 *     row_id        TEXT NOT NULL,
 *     old_data      JSONB,
 *     new_data      JSONB,
 *     changed_fields TEXT[],
 *     actor_id      TEXT,
 *     actor_ip      TEXT,
 *     metadata      JSONB,
 *     created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
 *   );
 */

import { Schema } from "@igorjs/pure-ts";
import { Model } from "../model/define.ts";
import { Field } from "../model/field.ts";

const AuditModel = Model("_pure_orm_audit", {
  fields: {
    id: Field(Schema.string, { primaryKey: true, default: "uuid" }),
    tableName: Field(Schema.string),
    operation: Field(Schema.string),
    rowId: Field(Schema.string),
    oldData: Field(Schema.string.optional()),
    newData: Field(Schema.string.optional()),
    changedFields: Field(Schema.string.optional()),
    actorId: Field(Schema.string.optional()),
    actorIp: Field(Schema.string.optional()),
    metadata: Field(Schema.string.optional()),
    createdAt: Field(Schema.isoDate, { default: "now" }),
  },
});

export { AuditModel };
