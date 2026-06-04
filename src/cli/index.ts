// Copyright 2026 igorjs. SPDX-License-Identifier: Apache-2.0

/**
 * pure-orm CLI entry point.
 *
 * Provides migration management commands:
 *   migrate:generate <name>  Generate a migration from model changes
 *   migrate:up               Apply pending migrations
 *   migrate:down             Rollback migrations
 *   migrate:status           Show migration status
 *   migrate:validate         Verify migration checksums
 */

import { parseArgs } from "node:util";
import { runDown } from "./commands/down.ts";
import { runGenerate } from "./commands/generate.ts";
import { runStatus } from "./commands/status.ts";
import { runUp } from "./commands/up.ts";
import { runValidate } from "./commands/validate.ts";
import { resolveConfig } from "./config.ts";
import { printError } from "./output.ts";
import type { CliFlags, CommandContext, CommandFn } from "./types.ts";

const USAGE = `
  pure-orm - Migration CLI for @igorjs/pure-orm

  Commands:
    migrate:generate <name>  Generate a migration from model changes
    migrate:up               Apply pending migrations
    migrate:down             Rollback migrations
    migrate:status           Show migration status
    migrate:validate         Verify migration checksums

  Options:
    --dry-run          Show SQL without executing
    --force            Skip checksum validation
    --allow-destructive  Permit DROP of tables/columns in migrate:generate
    --config, -c       Config file path (default: pure-orm.config.ts)
    --step <n>         Number of migrations to rollback (default: 1)
    --verbose, -v      Show stack traces on error
    --help, -h         Show this help
    --version          Show version
`;

let generateName: string | undefined;

const commands: Record<string, CommandFn> = {
  "migrate:generate": (ctx: CommandContext) => runGenerate(ctx, generateName),
  "migrate:up": runUp,
  "migrate:down": runDown,
  "migrate:status": runStatus,
  "migrate:validate": runValidate,
};

const printVersion = async (): Promise<void> => {
  const { readFileSync } = await import("node:fs");
  const { resolve } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const dir = fileURLToPath(new URL(".", import.meta.url));
  const pkgPath = resolve(dir, "..", "..", "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { version: string };
  console.info(pkg.version);
};

const buildFlags = (values: Record<string, unknown>): CliFlags => ({
  dryRun: (values["dry-run"] as boolean) ?? false,
  verbose: (values["verbose"] as boolean) ?? false,
  force: (values["force"] as boolean) ?? false,
  allowDestructive: (values["allow-destructive"] as boolean) ?? false,
  configPath: (values["config"] as string) ?? null,
  step: values["step"] !== undefined ? Number.parseInt(values["step"] as string, 10) : null,
});

const main = async (): Promise<void> => {
  const { values, positionals } = parseArgs({
    options: {
      "dry-run": { type: "boolean", default: false },
      force: { type: "boolean", default: false },
      "allow-destructive": { type: "boolean", default: false },
      config: { type: "string", short: "c" },
      step: { type: "string" },
      verbose: { type: "boolean", default: false, short: "v" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean" },
    },
    allowPositionals: true,
    strict: true,
  });

  if (values["help"] === true) {
    console.info(USAGE);
    process.exit(0);
  }

  if (values["version"] === true) {
    await printVersion();
    process.exit(0);
  }

  const command = positionals[0];
  if (command === undefined) {
    console.info(USAGE);
    process.exit(1);
  }

  generateName = positionals[1];

  const commandFn = commands[command];
  if (commandFn === undefined) {
    printError(`Unknown command: ${command}`);
    console.info(USAGE);
    process.exit(1);
  }

  try {
    const config = await resolveConfig(values["config"] ?? null, process.cwd());
    const ctx: CommandContext = { config, flags: buildFlags(values) };
    const exitCode = await commandFn(ctx);
    process.exit(exitCode);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    printError(message);
    if (values["verbose"] === true && err instanceof Error && err.stack !== undefined) {
      console.error(err.stack);
    }
    process.exit(1);
  }
};

void main();
