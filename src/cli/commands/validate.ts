// Copyright 2026 igorjs. SPDX-License-Identifier: Apache-2.0

/**
 * migrate:validate - Verify checksums of applied migrations.
 */

import { resolve } from "node:path";
import { validateChecksums } from "../../migration/checksum.ts";
import { discoverMigrations } from "../../migration/discovery.ts";
import { ensureMigrationTable } from "../../migration/runner.ts";
import { createDatabaseClient } from "../db.ts";
import { printError, printHeader, printInfo, printSuccess } from "../output.ts";
import type { CommandContext } from "../types.ts";

const runValidate = async (ctx: CommandContext): Promise<number> => {
  const db = await createDatabaseClient(ctx.config);

  try {
    const ensureResult = await ensureMigrationTable(db).run();
    if (ensureResult.isErr) {
      printError(`Failed to initialise migration table: ${ensureResult.error.message}`);
      return 1;
    }

    const dir = resolve(ctx.config.migrations.directory);
    const filesResult = await discoverMigrations(dir).run();
    if (filesResult.isErr) {
      printError(`Failed to discover migrations: ${filesResult.error.message}`);
      return 1;
    }

    const checksumResult = await validateChecksums(db, filesResult.value).run();
    if (checksumResult.isErr) {
      printError(`Validation failed: ${checksumResult.error.message}`);
      return 1;
    }

    const mismatches = checksumResult.value;
    printHeader("Checksum Validation");
    console.info("");

    if (mismatches.length === 0) {
      printSuccess(`All applied migrations have valid checksums.`);
      return 0;
    }

    printError("Checksum validation failed:");
    console.info("");
    for (const m of mismatches) {
      printInfo(`${m.name}`);
      console.info(`    stored:  ${m.expected}`);
      console.info(`    current: ${m.actual}`);
      console.info("");
    }

    printError(`${mismatches.length} migration(s) have been modified after being applied.`);
    return 1;
  } finally {
    await db.pool.end().run();
  }
};

export { runValidate };
