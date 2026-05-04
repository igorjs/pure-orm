// Copyright 2026 igorjs. SPDX-License-Identifier: Apache-2.0

/**
 * migrate:up - Apply pending migrations.
 */

import { resolve } from "node:path";
import { discoverMigrations } from "../../migration/discovery.ts";
import { executeBatch } from "../../migration/executor.ts";
import { createDatabaseClient } from "../db.ts";
import {
  printDivider,
  printError,
  printHeader,
  printInfo,
  printSql,
  printSuccess,
} from "../output.ts";
import type { CommandContext } from "../types.ts";

const runUp = async (ctx: CommandContext): Promise<number> => {
  const db = await createDatabaseClient(ctx.config);

  try {
    const dir = resolve(ctx.config.migrations.directory);
    const filesResult = await discoverMigrations(dir).run();
    if (filesResult.isErr) {
      printError(`Failed to discover migrations: ${filesResult.error.message}`);
      return 1;
    }

    const migrations = filesResult.value;
    if (migrations.length === 0) {
      printInfo("No migration files found.");
      return 0;
    }

    const result = await executeBatch(db, migrations, {
      dryRun: ctx.flags.dryRun,
      force: ctx.flags.force,
    }).run();

    if (result.isErr) {
      printError(`Migration failed: ${result.error.message}`);
      return 1;
    }

    const batch = result.value;

    if (batch.results.length === 0) {
      printInfo("No pending migrations.");
      return 0;
    }

    if (batch.dryRun) {
      printHeader(`Dry run: ${batch.results.length} pending migration(s)`);
      console.info("");
      for (const r of batch.results) {
        printDivider();
        printInfo(r.name);
        printSql(r.sql);
        console.info("");
      }
      return 0;
    }

    printHeader("Applying migrations...");
    console.info("");
    for (let i = 0; i < batch.results.length; i++) {
      const r = batch.results[i];
      if (r === undefined) continue;
      const idx = `[${i + 1}/${batch.results.length}]`;
      if (r.status === "applied") {
        printSuccess(`${idx} ${r.name} (${r.durationMs}ms)`);
      } else {
        printError(`${idx} ${r.name} - ${r.status}`);
      }
    }

    const totalMs = batch.results.reduce((sum, r) => sum + r.durationMs, 0);
    console.info("");
    printSuccess(`Applied ${batch.results.length} migration(s) in ${totalMs}ms.`);
    return 0;
  } finally {
    await db.pool.end().run();
  }
};

export { runUp };
