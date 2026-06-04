// Copyright 2026 igorjs. SPDX-License-Identifier: Apache-2.0

/**
 * Migration state table model.
 *
 * The _pure_orm_migrations table tracks which migrations have been applied
 * to the database, with checksums for tamper detection and batch grouping.
 *
 * CREATE TABLE _pure_orm_migrations (
 *   id            SERIAL PRIMARY KEY,
 *   name          TEXT NOT NULL UNIQUE,
 *   applied_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 *   checksum      TEXT NOT NULL,
 *   execution_ms  INTEGER NOT NULL,
 *   batch         INTEGER NOT NULL DEFAULT 0,
 *   status        TEXT NOT NULL DEFAULT 'applied'
 * );
 */

import { Schema } from "@/fx";
import { Model } from "@/model/define";
import { Field } from "@/model/field";

const MigrationModel = Model("_pure_orm_migrations", {
  fields: {
    id: Field(Schema.number, { primaryKey: true, default: "autoincrement" }),
    name: Field(Schema.string, { unique: true }),
    appliedAt: Field(Schema.isoDate, { default: "now" }),
    checksum: Field(Schema.string),
    executionMs: Field(Schema.number),
    batch: Field(Schema.number, { default: 0 }),
    status: Field(Schema.string, { default: "applied" }),
  },
});

export { MigrationModel };
