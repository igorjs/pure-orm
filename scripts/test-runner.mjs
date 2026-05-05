/**
 * Test runner for @igorjs/pure-test with TypeScript support.
 *
 * Discovers .test.ts files and imports them sequentially. Since
 * @igorjs/pure-test auto-runs on import, each file executes its
 * tests immediately. Node's --experimental-strip-types handles TS.
 *
 * Usage:
 *   node --experimental-strip-types --no-warnings scripts/test-runner.mjs
 *   node --experimental-strip-types --no-warnings scripts/test-runner.mjs --integration
 */

import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const integrationOnly = process.argv.includes("--integration");
const TEST_DIRS = integrationOnly
  ? ["tests/integration"]
  : ["tests", "tests/integration"];
const PATTERN = /\.test\.ts$/;

const discover = async () => {
  const files = [];
  for (const dir of TEST_DIRS) {
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

for (const file of files) {
  await import(pathToFileURL(resolve(file)).href);
}
