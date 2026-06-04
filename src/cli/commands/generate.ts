// Copyright 2026 igorjs. SPDX-License-Identifier: Apache-2.0

/**
 * migrate:generate - Generate a migration from model changes.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { resolveDialect } from "../../dialect/registry.ts";
import { detectRenameCandidates, diffSnapshots } from "../../migration/differ.ts";
import { generateMigration } from "../../migration/generator.ts";
import { checkDestructive } from "../../migration/guard.ts";
import { orderOperations } from "../../migration/ordering.ts";
import { createSnapshot } from "../../migration/snapshot.ts";
import type { ChangeOperation, SchemaSnapshot } from "../../migration/types.ts";
import { printError, printHeader, printInfo, printSuccess, printWarning } from "../output.ts";
import type { CommandContext } from "../types.ts";

const EMPTY_SNAPSHOT: SchemaSnapshot = Object.freeze({
  version: 1 as const,
  generatedAt: "",
  tables: Object.freeze({}),
});

const findLatestSnapshot = (dir: string): SchemaSnapshot => {
  if (!existsSync(dir)) return EMPTY_SNAPSHOT;

  const files = readdirSync(dir)
    .filter((f: string) => f.endsWith(".snapshot.json"))
    .sort((a: string, b: string) => b.localeCompare(a));

  const latest = files[0];
  if (latest === undefined) return EMPTY_SNAPSHOT;

  const content = readFileSync(join(dir, latest), "utf-8");
  return JSON.parse(content) as SchemaSnapshot;
};

const formatDate = (): string => {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
};

const getNextSequence = (dir: string): string => {
  if (!existsSync(dir)) return "001";

  const files = readdirSync(dir).filter((f: string) => /^\d{8}_\d{3}_/.test(f));
  const maxSeq = files.reduce((max: number, f: string) => {
    const match = /^\d{8}_(\d{3})_/.exec(f);
    const seq = match?.[1];
    return seq !== undefined ? Math.max(max, Number.parseInt(seq, 10)) : max;
  }, 0);
  return String(maxSeq + 1).padStart(3, "0");
};

/** Collects per-table heuristic rename candidates as "table.old → table.new" strings. */
const collectRenameHints = (prev: SchemaSnapshot, curr: SchemaSnapshot): readonly string[] => {
  const hints: string[] = [];
  for (const [table, currTable] of Object.entries(curr.tables)) {
    const prevTable = prev.tables[table];
    if (prevTable === undefined) continue;
    for (const { from, to } of detectRenameCandidates(prevTable.columns, currTable.columns)) {
      hints.push(`${table}.${from} → ${table}.${to}`);
    }
  }
  return hints;
};

/** Prints the fail-closed message for blocked destructive ops, with rename hints. */
const reportGuardBlock = (
  blocked: readonly string[],
  prev: SchemaSnapshot,
  curr: SchemaSnapshot,
): void => {
  printError("Refusing to generate a migration with destructive operations:");
  for (const desc of blocked) {
    printError(`    ${desc}`);
  }
  printInfo("A renamed table or column looks like a drop plus an add and would destroy data.");

  const hints = collectRenameHints(prev, curr);
  if (hints.length > 0) {
    printInfo("Possible renames detected — add `renamedFrom` to preserve data:");
    for (const hint of hints) {
      printInfo(`    ${hint}`);
    }
  }
  printInfo("Otherwise re-run with --allow-destructive to confirm these drops are intended.");
};

const summarizeOp = (op: ChangeOperation): string => {
  switch (op.tag) {
    case "CreateTable":
      return `+ CREATE TABLE "${op.table}"`;
    case "DropTable":
      return `- DROP TABLE "${op.table}"`;
    case "RenameTable":
      return `~ RENAME TABLE "${op.from}" -> "${op.to}"`;
    case "RenameColumn":
      return `~ RENAME COLUMN "${op.table}"."${op.from}" -> "${op.to}"`;
    case "AddColumn":
      return `+ ADD COLUMN "${op.table}"."${op.column}"`;
    case "DropColumn":
      return `- DROP COLUMN "${op.table}"."${op.column}"`;
    case "AlterColumn":
      return `~ ALTER COLUMN "${op.table}"."${op.column}"`;
    case "AddIndex":
      return `+ CREATE INDEX "${op.index.name}"`;
    case "DropIndex":
      return `- DROP INDEX "${op.index.name}"`;
  }
};

const runGenerate = async (ctx: CommandContext, name?: string): Promise<number> => {
  if (name === undefined || name.length === 0) {
    printError("Usage: pure-orm migrate:generate <name>");
    return 1;
  }

  if (ctx.config.models === undefined) {
    printError(`Config must define a "models" function for migrate:generate.`);
    return 1;
  }

  const dialectResult = resolveDialect(ctx.config.dialect);
  if (dialectResult.isErr) {
    printError(`Failed to resolve dialect: ${dialectResult.error.message}`);
    return 1;
  }
  const dialect = dialectResult.value;

  const dir = resolve(ctx.config.migrations.directory);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  // Get current models and previous snapshot
  const models = ctx.config.models();
  const previousSnapshot = findLatestSnapshot(dir);
  const currentSnapshot = createSnapshot(models);

  // Diff
  const rawOps = diffSnapshots(previousSnapshot, currentSnapshot);
  const ops = orderOperations(rawOps, models);

  if (ops.length === 0) {
    printInfo("No schema changes detected.");
    return 0;
  }

  // Destructive-change guard (ADR-0004): fail closed on drops unless opted in.
  const guard = checkDestructive(ops, ctx.flags.allowDestructive);
  if (!guard.ok) {
    reportGuardBlock(guard.blocked, previousSnapshot, currentSnapshot);
    return 1;
  }
  if (guard.warnings.length > 0) {
    printWarning("Generating a migration with destructive operations:");
    for (const desc of guard.warnings) {
      printWarning(`    ${desc}`);
    }
  }

  // Generate SQL
  const { up, down } = generateMigration(ops, dialect);

  // Build filename
  const date = formatDate();
  const seq = getNextSequence(dir);
  const safeName = name.toLowerCase().replace(/[^a-z0-9_]/g, "_");
  const basename = `${date}_${seq}_${safeName}`;

  // Write migration file
  const migrationContent = `-- @up\n${up}\n\n-- @down\n${down}\n`;
  writeFileSync(join(dir, `${basename}.sql`), migrationContent);

  // Write snapshot
  writeFileSync(
    join(dir, `${basename}.snapshot.json`),
    `${JSON.stringify(currentSnapshot, null, 2)}\n`,
  );

  printHeader("Generated migration");
  console.info("");
  printSuccess(`${basename}.sql`);
  console.info("");

  // Summary
  for (const op of ops) {
    printInfo(summarizeOp(op));
  }

  return 0;
};

export { runGenerate };
