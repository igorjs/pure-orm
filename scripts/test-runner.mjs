// Copyright 2026 igorjs. SPDX-License-Identifier: Apache-2.0

/**
 * Test runner for @igorjs/pure-test with TypeScript support.
 *
 * Discovers .test.ts files and imports them all at once. Pure-test
 * accumulates describe/it registrations during module evaluation,
 * then auto-runs after all imports complete.
 *
 * Works across runtimes (tsconfig @/* aliases are honoured on each):
 *   Node:  node --import tsx scripts/test-runner.mjs
 *   Deno:  deno run --allow-all scripts/test-runner.mjs
 *   Bun:   bun scripts/test-runner.mjs
 *
 * Flags:
 *   --integration       Run only integration tests
 *   --skip-integration  Skip integration tests (for runtimes without native drivers)
 */

import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const args = typeof process !== "undefined" ? process.argv : [];
const integrationOnly = args.includes("--integration");
const skipIntegration = args.includes("--skip-integration");

const buildTestDirs = () => {
  if (integrationOnly) return ["tests/integration"];
  if (skipIntegration) return ["tests"];
  return ["tests", "tests/integration"];
};

const PATTERN = /\.test\.ts$/;

const discover = async () => {
  const files = [];
  for (const dir of buildTestDirs()) {
    try {
      const entries = await readdir(resolve(dir));
      for (const f of entries) {
        if (PATTERN.test(f)) {
          files.push(join(dir, f));
        }
      }
    } catch {
      // Directory may not exist
    }
  }
  return files.sort();
};

const files = await discover();

// Import all test files concurrently so pure-test's auto-run fires
// once after all modules finish loading (not between each import).
//
// Integration test files import native drivers (pg, mysql2, etc.) that are
// not installed in every environment (e.g. CI without a database). When a
// driver package is absent the import throws ERR_MODULE_NOT_FOUND; skip that
// integration file with a warning rather than failing the whole run. A
// missing module in a non-integration (unit) test is still a real error.
await Promise.all(
  files.map(async (file) => {
    try {
      await import(pathToFileURL(resolve(file)).href);
    } catch (err) {
      const isIntegration = file.replace(/\\/g, "/").includes("/integration/");
      if (isIntegration && err && err.code === "ERR_MODULE_NOT_FOUND") {
        console.warn(
          "[test-runner] skipping " + file + ": driver not installed (" +
            String(err.message || "").split("\n")[0] + ")",
        );
        return;
      }
      throw err;
    }
  }),
);
