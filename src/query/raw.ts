// Copyright 2026 igorjs. SPDX-License-Identifier: Apache-2.0

/**
 * Raw SQL escape hatch.
 *
 * raw() creates a RawNode from a SQL string and parameters. The SQL
 * is passed through to the driver unmodified, so the caller is responsible
 * for using the correct placeholder style ($1 for PostgreSQL, ? for SQLite).
 *
 * For a safer alternative, rawTemplate() accepts a tagged template literal
 * that automatically extracts interpolated values into the params array,
 * using ? as the universal placeholder.
 */

import type { RawNode } from "./types.ts";

/**
 * Creates a RawNode from a SQL string and parameters.
 *
 * The SQL is passed through to the driver without modification. Use
 * the dialect-appropriate placeholder style.
 */
const raw = (sql: string, params: readonly unknown[] = []): RawNode =>
  Object.freeze({
    tag: "Raw" as const,
    sql,
    params: Object.freeze([...params]),
  });

/**
 * Tagged template literal for raw SQL with automatic parameterisation.
 *
 * Interpolated values are extracted into the params array and replaced
 * with ? placeholders. The resulting RawNode uses ? placeholders which
 * work directly with SQLite. For PostgreSQL, the execute layer converts
 * ? to $N at compile time.
 *
 * Usage:
 *   const node = sql`SELECT * FROM users WHERE email = ${email} AND age > ${minAge}`
 */
const sql = (strings: TemplateStringsArray, ...values: unknown[]): RawNode => {
  const parts: string[] = [];
  for (let i = 0; i < strings.length; i++) {
    parts.push(strings[i] ?? "");
    if (i < values.length) {
      parts.push("?");
    }
  }
  return Object.freeze({
    tag: "Raw" as const,
    sql: parts.join(""),
    params: Object.freeze([...values]),
  });
};

export { raw, sql };
