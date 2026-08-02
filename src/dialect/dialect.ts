// Copyright 2026 igorjs. SPDX-License-Identifier: Apache-2.0

/**
 * Dialect interface.
 *
 * Abstracts SQL generation so the core ORM is database-agnostic.
 * Each dialect knows how to compile AST nodes into its SQL flavour,
 * handle parameterisation, and quote identifiers correctly.
 */

import type { FieldConfig } from "@/model/types";
import type { CompiledQuery, DeleteNode, InsertNode, SelectNode, UpdateNode } from "@/query/types";

/**
 * Typed dialect capabilities (ADR-0002 Part A).
 *
 * Every dialect declares what it can do via this descriptor; the compiler,
 * differ, generator, and runner branch on declared capabilities — not on
 * `dialect.name` — so adding a new dialect is additive and explicit instead
 * of hunting through string conditionals.
 */
type DialectCapabilities = {
  /** Parameter placeholder syntax: `$1, $2, …` (PG) vs `?, ?, …` (SQLite, MySQL). */
  readonly parameterStyle: "numbered" | "question";
  /** Identifier quote character: `"` (PG, SQLite, MSSQL) vs `` ` `` (MySQL). */
  readonly identifierQuote: '"' | "`";
  /** Whether the dialect supports `RETURNING` on INSERT/UPDATE/DELETE. */
  readonly supportsReturning: boolean;
  /** Upsert grammar: `ON CONFLICT` (PG, SQLite) vs `ON DUPLICATE KEY` (MySQL). */
  readonly upsertStyle: "onConflict" | "onDuplicateKey";
  /** Whether DDL participates in transactions (PG, SQLite yes; MySQL no). */
  readonly supportsTransactionalDDL: boolean;
  /** SQL expression returning the current timestamp at row insert/update. */
  readonly currentTimestampSql: string;
  /** Strategy the migration runner uses to take an exclusive migration lock. */
  readonly lockStrategy: "advisoryLock" | "lockTable";
  /** Whether `ALTER TABLE ADD COLUMN IF NOT EXISTS` is supported. */
  readonly supportsAddColumnIfNotExists: boolean;
  /**
   * Whether `ALTER TABLE ADD/DROP` for foreign-key constraints is supported on
   * an existing table. PG and MySQL: true. SQLite: false (requires a table
   * rebuild; the generator throws so the operator sees an explicit failure
   * instead of silently producing invalid SQL).
   */
  readonly supportsForeignKeyAlter: boolean;
  /**
   * Keyword the dialect uses to remove a foreign-key constraint by name.
   * PG/SQLite use `DROP CONSTRAINT <name>`; MySQL uses `DROP FOREIGN KEY <name>`.
   */
  readonly dropForeignKeyKeyword: "CONSTRAINT" | "FOREIGN KEY";
  /**
   * Whether `ALTER TABLE ADD/DROP CONSTRAINT … CHECK` works on an existing
   * table. PG and MySQL 8.0.16+: true. SQLite: false — CHECKs are inline-only
   * in CREATE TABLE; the generator throws on ALTER ops so the operator hand-
   * writes a table-rebuild migration instead of getting silent invalid SQL.
   */
  readonly supportsCheckConstraintAlter: boolean;
  /**
   * Keyword the dialect uses to remove a CHECK constraint by name.
   * PG/SQLite use `DROP CONSTRAINT <name>`; MySQL uses `DROP CHECK <name>`.
   */
  readonly dropCheckConstraintKeyword: "CONSTRAINT" | "CHECK";
};

type Dialect = {
  readonly name: string;
  readonly capabilities: DialectCapabilities;
  readonly compileSelect: (node: SelectNode) => CompiledQuery;
  readonly compileInsert: (node: InsertNode) => CompiledQuery;
  readonly compileUpdate: (node: UpdateNode) => CompiledQuery;
  readonly compileDelete: (node: DeleteNode) => CompiledQuery;
  readonly param: (index: number) => string;
  readonly quote: (identifier: string) => string;
  readonly mapFieldType: (schemaType: string, config: Readonly<FieldConfig>) => string;
};

export type { Dialect, DialectCapabilities };
