// Copyright 2026 igorjs. SPDX-License-Identifier: Apache-2.0

/**
 * migrate:generate - Generate a migration from model changes.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { resolveDialect } from "../../dialect/registry.ts";
import { diffSnapshots } from "../../migration/differ.ts";
import { generateMigration } from "../../migration/generator.ts";
import { orderOperations } from "../../migration/ordering.ts";
import { createSnapshot } from "../../migration/snapshot.ts";
import type { SchemaSnapshot } from "../../migration/types.ts";
import { printError, printHeader, printInfo, printSuccess } from "../output.ts";
import type { CommandContext } from "../types.ts";

const EMPTY_SNAPSHOT: SchemaSnapshot = Object.freeze({
  version: 1 as const,
  generatedAt: "",
  tables: Object.freeze({}),
});

const findLatestSnapshot = (dir: string): SchemaSnapshot => {
  if (!existsSync(dir)) return EMPTY_SNAPSHOT;

  const { readdirSync } = require("node:fs") as typeof import("node:fs");
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

  const { readdirSync } = require("node:fs") as typeof import("node:fs");
  const files = readdirSync(dir).filter((f: string) => /^\d{8}_\d{3}_/.test(f));
  const maxSeq = files.reduce((max: number, f: string) => {
    const match = /^\d{8}_(\d{3})_/.exec(f);
    const seq = match?.[1];
    return seq !== undefined ? Math.max(max, Number.parseInt(seq, 10)) : max;
  }, 0);
  return String(maxSeq + 1).padStart(3, "0");
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
    switch (op.tag) {
      case "CreateTable":
        printInfo(`+ CREATE TABLE "${op.table}"`);
        break;
      case "DropTable":
        printInfo(`- DROP TABLE "${op.table}"`);
        break;
      case "AddColumn":
        printInfo(`+ ADD COLUMN "${op.table}"."${op.column}"`);
        break;
      case "DropColumn":
        printInfo(`- DROP COLUMN "${op.table}"."${op.column}"`);
        break;
      case "AlterColumn":
        printInfo(`~ ALTER COLUMN "${op.table}"."${op.column}"`);
        break;
      case "AddIndex":
        printInfo(`+ CREATE INDEX "${op.index.name}"`);
        break;
      case "DropIndex":
        printInfo(`- DROP INDEX "${op.indexName}"`);
        break;
    }
  }

  return 0;
};

export { runGenerate };
