// Copyright 2026 igorjs. SPDX-License-Identifier: Apache-2.0

/**
 * CLI configuration file discovery and loading.
 *
 * Searches for pure-orm.config.ts, .mjs, or .js in the current working
 * directory (or a path specified via --config). Uses dynamic import to
 * load the config, expecting a named export `config`.
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { PureOrmConfig } from "./types.ts";

const CONFIG_FILENAMES = ["pure-orm.config.ts", "pure-orm.config.mjs", "pure-orm.config.js"];

const discoverConfigPath = (cwd: string): string | null => {
  for (const filename of CONFIG_FILENAMES) {
    const fullPath = resolve(cwd, filename);
    if (existsSync(fullPath)) return fullPath;
  }
  return null;
};

const loadConfig = async (configPath: string): Promise<PureOrmConfig> => {
  const absolutePath = resolve(configPath);
  if (!existsSync(absolutePath)) {
    throw new Error(`Config file not found: ${absolutePath}`);
  }

  const fileUrl = pathToFileURL(absolutePath).href;
  const mod: Record<string, unknown> = await import(fileUrl);
  const exported = mod["config"];

  if (exported === null || exported === undefined || typeof exported !== "object") {
    throw new Error(
      `Config file "${configPath}" must export a named "config" object.\n` +
        "Example: export const config: PureOrmConfig = { ... }",
    );
  }

  const cfg = exported as Record<string, unknown>;
  validateConfig(cfg, configPath);
  return exported as PureOrmConfig;
};

const validateConfig = (cfg: Record<string, unknown>, path: string): void => {
  if (typeof cfg["dialect"] !== "string") {
    throw new Error(`Config "${path}": missing "dialect" (must be "postgresql" or "sqlite")`);
  }
  if (cfg["dialect"] !== "postgresql" && cfg["dialect"] !== "sqlite") {
    throw new Error(
      `Config "${path}": invalid dialect "${String(cfg["dialect"])}". Must be "postgresql" or "sqlite".`,
    );
  }
  if (
    cfg["connection"] === null ||
    cfg["connection"] === undefined ||
    typeof cfg["connection"] !== "object"
  ) {
    throw new Error(`Config "${path}": missing "connection" object`);
  }
  if (
    cfg["migrations"] === null ||
    cfg["migrations"] === undefined ||
    typeof cfg["migrations"] !== "object"
  ) {
    throw new Error(`Config "${path}": missing "migrations" object with "directory" property`);
  }
};

const resolveConfig = async (explicitPath: string | null, cwd: string): Promise<PureOrmConfig> => {
  if (explicitPath !== null) {
    return loadConfig(explicitPath);
  }

  const discovered = discoverConfigPath(cwd);
  if (discovered === null) {
    throw new Error(
      `No config file found. Searched for:\n${CONFIG_FILENAMES.map(f => `  - ${f}`).join("\n")}\n\n` +
        "Create a pure-orm.config.ts or specify --config <path>.",
    );
  }

  return loadConfig(discovered);
};

export { resolveConfig };
