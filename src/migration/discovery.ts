// Copyright 2026 igorjs. SPDX-License-Identifier: Apache-2.0

/**
 * Migration file discovery.
 *
 * Scans a directory for .sql and .ts migration files, parses them,
 * computes checksums, and returns a sorted list of MigrationFile objects.
 *
 * File naming convention: YYYYMMDD_NNN_description.(sql|ts)
 * Example: 20260505_001_create_users.sql
 */

import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Task } from "@igorjs/pure-fx/async";
import type { DbError } from "../errors/errors.ts";
import { migrationError } from "../errors/errors.ts";
import { computeChecksum } from "./checksum.ts";
import { parseSqlMigration } from "./sql-parser.ts";
import type { Migration, MigrationFile } from "./types.ts";

const MIGRATION_PATTERN = /^\d{8}_\d{3}_[a-z0-9_]+\.(sql|ts)$/;

/**
 * Extracts the migration name from a filename (strips extension).
 */
const parseFilename = (filename: string): string | null => {
  if (!MIGRATION_PATTERN.test(filename)) {
    return null;
  }
  return filename.replace(/\.(sql|ts)$/, "");
};

/**
 * Loads a .ts migration file via dynamic import.
 * Expects a named export `migration` of type Migration.
 */
const loadTsMigration = async (filePath: string): Promise<Migration> => {
  const fileUrl = pathToFileURL(filePath).href;
  const mod: Record<string, unknown> = await import(fileUrl);
  const exported = mod["migration"];

  if (exported === null || exported === undefined || typeof exported !== "object") {
    throw new Error(`Missing named export "migration" in ${filePath}`);
  }

  const m = exported as Record<string, unknown>;
  if (typeof m["up"] !== "string" || typeof m["down"] !== "string") {
    throw new Error(
      `Export "migration" in ${filePath} must have "up" and "down" string properties`,
    );
  }

  return Object.freeze({
    up: m["up"] as string,
    down: m["down"] as string,
    transaction: m["transaction"] !== false,
    concurrent: m["concurrent"] === true,
  });
};

/**
 * Discovers migration files in a directory.
 *
 * Scans for .sql and .ts files matching the naming convention,
 * parses their content, computes checksums, and returns them
 * sorted by filename (chronological due to timestamp prefix).
 */
const discoverMigrations = (dir: string): Task<readonly MigrationFile[], DbError> =>
  Task.fromPromise(
    async () => {
      const absoluteDir = resolve(dir);
      let entries: string[];
      try {
        entries = await readdir(absoluteDir);
      } catch (cause) {
        throw Object.assign(new Error(`Migrations directory not found: ${absoluteDir}`), { cause });
      }

      const migrationFiles = entries.filter(f => parseFilename(f) !== null).sort();

      const results: MigrationFile[] = [];

      for (const filename of migrationFiles) {
        const name = parseFilename(filename);
        if (name === null) continue;

        const filePath = join(absoluteDir, filename);
        const content = await readFile(filePath, "utf-8");
        const checksum = computeChecksum(content);

        let migration: Migration;
        if (filename.endsWith(".sql")) {
          migration = parseSqlMigration(content, filename);
        } else {
          migration = await loadTsMigration(filePath);
        }

        results.push(Object.freeze({ name, path: filePath, migration, checksum }));
      }

      return Object.freeze(results);
    },
    (cause: unknown) => {
      const message = cause instanceof Error ? cause.message : "Failed to discover migrations";
      return migrationError(message, "_discovery_", cause);
    },
  );

export { discoverMigrations, parseFilename };
