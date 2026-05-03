// Copyright 2026 igorjs. SPDX-License-Identifier: Apache-2.0

/**
 * Migration state table model.
 *
 * The _pure_orm_migrations table tracks which migrations have been applied
 * to the database, with checksums for tamper detection.
 *
 * CREATE TABLE _pure_orm_migrations (
 *   id            SERIAL PRIMARY KEY,
 *   name          TEXT NOT NULL UNIQUE,
 *   applied_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 *   checksum      TEXT NOT NULL,
 *   execution_ms  INTEGER NOT NULL
 * );
 */

import { Schema } from "@igorjs/pure-fx/data";
import { Model } from "../model/define.ts";
import { Field } from "../model/field.ts";

const MigrationModel = Model("_pure_orm_migrations", {
  fields: {
    id: Field(Schema.number, { primaryKey: true, default: "autoincrement" }),
    name: Field(Schema.string, { unique: true }),
    appliedAt: Field(Schema.isoDate, { default: "now" }),
    checksum: Field(Schema.string),
    executionMs: Field(Schema.number),
  },
});

export { MigrationModel };
