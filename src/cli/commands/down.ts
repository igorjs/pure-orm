// Copyright 2026 igorjs. SPDX-License-Identifier: Apache-2.0

/**
 * migrate:down - Rollback migrations.
 */

import { resolve } from "node:path";
import { createDatabaseClient } from "@/cli/db";
import {
  printDivider,
  printError,
  printHeader,
  printInfo,
  printSql,
  printSuccess,
} from "@/cli/output";
import type { CommandContext } from "@/cli/types";
import { discoverMigrations } from "@/migration/discovery";
import type { RollbackTarget } from "@/migration/executor";
import { rollbackBatch } from "@/migration/executor";
import { ensureMigrationTable, getMigrationStatus } from "@/migration/runner";
import type { MigrationFile } from "@/migration/types";

const buildRollbackTargets = (
  toRollback: readonly Record<string, unknown>[],
  fileMap: ReadonlyMap<string, MigrationFile>,
): { targets: RollbackTarget[]; missingFile: string | null } => {
  const targets: RollbackTarget[] = [];
  for (const record of toRollback) {
    const name = String(record["name"]);
    const file = fileMap.get(name);
    if (file === undefined) return { targets: [], missingFile: name };
    targets.push({ name, downSql: file.migration.down, transaction: file.migration.transaction });
  }
  return { targets, missingFile: null };
};

const runDown = async (ctx: CommandContext): Promise<number> => {
  const db = await createDatabaseClient(ctx.config);

  try {
    const ensureResult = await ensureMigrationTable(db).run();
    if (ensureResult.isErr) {
      printError(`Failed to initialise migration table: ${ensureResult.error.message}`);
      return 1;
    }

    const dbResult = await getMigrationStatus(db).run();
    if (dbResult.isErr) {
      printError(`Failed to query migration status: ${dbResult.error.message}`);
      return 1;
    }
    const applied = dbResult.value.filter(r => r["status"] === "applied");
    if (applied.length === 0) {
      printInfo("No migrations to roll back.");
      return 0;
    }

    const step = ctx.flags.step ?? 1;
    const toRollback = applied.slice(-step).reverse();

    const dir = resolve(ctx.config.migrations.directory);
    const filesResult = await discoverMigrations(dir).run();
    const fileMap = new Map(filesResult.isOk ? filesResult.value.map(f => [f.name, f]) : []);

    const { targets, missingFile } = buildRollbackTargets(toRollback, fileMap);
    if (missingFile !== null) {
      printError(`Cannot rollback "${missingFile}": migration file not found.`);
      return 1;
    }

    const result = await rollbackBatch(db, targets, { dryRun: ctx.flags.dryRun }).run();
    if (result.isErr) {
      printError(`Rollback failed: ${result.error.message}`);
      return 1;
    }

    const batch = result.value;
    if (batch.dryRun) {
      printHeader(`Dry run: rolling back ${batch.results.length} migration(s)`);
      console.info("");
      for (const r of batch.results) {
        printDivider();
        printInfo(r.name);
        printSql(r.sql);
        console.info("");
      }
      return 0;
    }

    printHeader("Rolling back migrations...");
    console.info("");
    for (let i = 0; i < batch.results.length; i++) {
      const r = batch.results[i];
      if (r === undefined) continue;
      printSuccess(`[${i + 1}/${batch.results.length}] ${r.name} rolled back (${r.durationMs}ms)`);
    }

    console.info("");
    printSuccess(`Rolled back ${batch.results.length} migration(s).`);
    return 0;
  } finally {
    await db.pool.end().run();
  }
};

export { runDown };
