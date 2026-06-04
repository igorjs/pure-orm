// Copyright 2026 igorjs. SPDX-License-Identifier: Apache-2.0

/**
 * Migration checksum computation and validation.
 *
 * Uses SHA-256 to produce a hex digest of normalised migration content.
 * Normalisation ensures consistent checksums across operating systems
 * (CRLF/CR → LF, trimmed whitespace).
 */

import { createHash } from "node:crypto";
import type { DatabaseClient } from "../connection/types.ts";
import type { DbError } from "../errors/errors.ts";
import type { Task } from "../fx.ts";
import { execQuery } from "./runner.ts";
import type { ChecksumMismatch, MigrationFile } from "./types.ts";

/**
 * Normalises migration content for consistent hashing across platforms.
 */
const normaliseContent = (content: string): string =>
  content.trim().replace(/\r\n/g, "\n").replace(/\r/g, "\n");

/**
 * Computes a SHA-256 hex digest of the normalised migration content.
 * Pure function: no side effects.
 */
const computeChecksum = (content: string): string =>
  createHash("sha256").update(normaliseContent(content), "utf8").digest("hex");

/**
 * Validates that all previously-applied migrations still match their
 * on-disk checksums. Returns a list of mismatches (empty if all valid).
 */
const validateChecksums = (
  db: DatabaseClient,
  migrations: readonly MigrationFile[],
): Task<readonly ChecksumMismatch[], DbError> => {
  const sql =
    'SELECT "name", "checksum" FROM "_pure_orm_migrations" WHERE "status" = \'applied\' ORDER BY "id" ASC';

  return execQuery(db, sql, []).map(rows => {
    const dbChecksums = new Map<string, string>();
    for (const row of rows as readonly { name: string; checksum: string }[]) {
      dbChecksums.set(row.name, row.checksum);
    }

    const mismatches: ChecksumMismatch[] = [];
    for (const file of migrations) {
      const dbChecksum = dbChecksums.get(file.name);
      if (dbChecksum !== undefined && dbChecksum !== file.checksum) {
        mismatches.push(
          Object.freeze({
            name: file.name,
            expected: dbChecksum,
            actual: file.checksum,
          }),
        );
      }
    }

    return Object.freeze(mismatches);
  });
};

export { computeChecksum, normaliseContent, validateChecksums };
