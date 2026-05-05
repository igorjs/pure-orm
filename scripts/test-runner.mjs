/**
 * Test runner for @igorjs/pure-test with TypeScript support.
 *
 * Discovers .test.ts files and imports them all at once. Pure-test
 * accumulates describe/it registrations during module evaluation,
 * then auto-runs after all imports complete.
 *
 * Works across runtimes:
 *   Node:  node --experimental-strip-types --no-warnings scripts/test-runner.mjs
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
await Promise.all(
  files.map(file => import(pathToFileURL(resolve(file)).href)),
);
