// Copyright 2026 igorjs. SPDX-License-Identifier: Apache-2.0

/**
 * migrate:status - Show migration status.
 */

import { resolve } from "node:path";
import { createDatabaseClient } from "@/cli/db";
import { printError, printHeader, printInfo, printTable } from "@/cli/output";
import type { CommandContext } from "@/cli/types";
import { discoverMigrations } from "@/migration/discovery";
import { ensureMigrationTable, getMigrationStatus } from "@/migration/runner";
import type { MigrationFile } from "@/migration/types";

const buildStatusRow = (
  name: string,
  record: Record<string, unknown> | undefined,
  file: MigrationFile | undefined,
): { row: string[]; isApplied: boolean; isMismatch: boolean } => {
  if (record === undefined) {
    return { row: [name, "pending", "--", "--"], isApplied: false, isMismatch: false };
  }

  const status = String(record["status"] ?? "applied");
  const appliedAt = String(record["applied_at"] ?? "--").slice(0, 19);
  const dbChecksum = String(record["checksum"] ?? "");

  let checksumStatus = "ok";
  let isMismatch = false;
  if (file === undefined) {
    checksumStatus = "file missing";
  } else if (file.checksum !== dbChecksum) {
    checksumStatus = "mismatch!";
    isMismatch = true;
  }

  return { row: [name, status, appliedAt, checksumStatus], isApplied: true, isMismatch };
};

const runStatus = async (ctx: CommandContext): Promise<number> => {
  const db = await createDatabaseClient(ctx.config);

  try {
    const ensureResult = await ensureMigrationTable(db).run();
    if (ensureResult.isErr) {
      printError(`Failed to initialise migration table: ${ensureResult.error.message}`);
      return 1;
    }

    const dir = resolve(ctx.config.migrations.directory);
    const filesResult = await discoverMigrations(dir).run();
    const files = filesResult.isOk ? filesResult.value : [];

    const dbResult = await getMigrationStatus(db).run();
    if (dbResult.isErr) {
      printError(`Failed to query migration status: ${dbResult.error.message}`);
      return 1;
    }

    const appliedMap = new Map<string, Record<string, unknown>>();
    for (const row of dbResult.value) {
      const name = row["name"];
      if (typeof name === "string") appliedMap.set(name, row);
    }
    const fileMap = new Map(files.map(f => [f.name, f]));

    const allNames = [...new Set([...fileMap.keys(), ...appliedMap.keys()])].sort((a, b) =>
      a.localeCompare(b),
    );

    const rows: string[][] = [];
    let appliedCount = 0;
    let pendingCount = 0;
    let mismatchCount = 0;

    for (const name of allNames) {
      const result = buildStatusRow(name, appliedMap.get(name), fileMap.get(name));
      rows.push(result.row);
      if (result.isApplied) appliedCount++;
      else pendingCount++;
      if (result.isMismatch) mismatchCount++;
    }

    printHeader("Migration Status");
    console.info("");
    printTable(["Name", "Status", "Applied At", "Checksum"], rows);
    console.info("");
    printInfo(
      `${appliedCount} applied, ${pendingCount} pending${mismatchCount > 0 ? `, ${mismatchCount} checksum mismatch` : ""}`,
    );

    return 0;
  } finally {
    await db.pool.end().run();
  }
};

export { runStatus };
