// Copyright 2026 igorjs. SPDX-License-Identifier: Apache-2.0

/**
 * Edge-runtime safety check.
 *
 * Cloudflare Workers, Vercel Edge, and Deno Deploy do not provide the full
 * Node built-in surface. Code paths that ship to those environments — the
 * query / execute / dialect modules of core, and every connector source —
 * must not import `node:*` modules that the edge runtimes can't satisfy.
 *
 * This script does a textual scan rather than a full import-graph traversal:
 * cheap, runtime-agnostic, and good enough to catch the regressions we
 * actually see (someone adding a `import "node:fs"` to dialect code).
 *
 *   pnpm check:edge   # runs from package root
 *
 * Exits 1 on any forbidden import in the watched paths.
 *
 * Watched paths (relative to repo root):
 *   - src/dialect/**           the SQL compilers
 *   - src/execute/**           query execution path
 *   - src/query/**             AST + builders
 *   - src/model/**             field/model definitions
 *   - src/errors/**            error helpers
 *   - src/fx.ts                pure-fx chokepoint
 *   - packages/connectors/**   every connector
 *
 * Allow-listed Node imports that have known edge polyfills:
 *   - none (yet). Add via ALLOWED below if/when needed.
 */

import { readFile, readdir, stat } from "node:fs/promises";
import { extname, join, relative } from "node:path";

const REPO_ROOT = process.cwd();
const WATCHED = [
  "src/dialect",
  "src/execute",
  "src/query",
  "src/model",
  "src/errors",
  "src/fx.ts",
  "packages/connectors",
];

const FORBIDDEN_PREFIXES = [
  "node:fs",
  "node:net",
  "node:tls",
  "node:dgram",
  "node:cluster",
  "node:child_process",
  "node:worker_threads",
  "node:os",
  "node:v8",
  "node:vm",
  "node:repl",
  "node:tty",
  "node:readline",
  "node:perf_hooks",
];

const ALLOWED = new Set([
  // e.g. "node:stream" once we have a documented edge polyfill story
]);

// Connector packages need build artifacts ignored.
const SKIP_DIRS = new Set(["dist", "node_modules", ".git"]);

const collectFiles = async (path) => {
  let entry;
  try {
    entry = await stat(path);
  } catch {
    return [];
  }
  if (entry.isFile()) return path.endsWith(".ts") ? [path] : [];
  if (!entry.isDirectory()) return [];

  const names = await readdir(path);
  const out = [];
  for (const name of names) {
    if (SKIP_DIRS.has(name)) continue;
    const sub = join(path, name);
    if (extname(name) === ".ts" || (await stat(sub)).isDirectory()) {
      out.push(...(await collectFiles(sub)));
    }
  }
  return out;
};

const FORBIDDEN_RE = /from\s+["']([^"']+)["']/g;

const scanFile = async (file) => {
  const src = await readFile(file, "utf8");
  const offenders = [];
  let m;
  // biome-ignore lint/suspicious/noAssignInExpressions: idiomatic regex loop
  while ((m = FORBIDDEN_RE.exec(src)) !== null) {
    const spec = m[1];
    if (ALLOWED.has(spec)) continue;
    if (FORBIDDEN_PREFIXES.some((p) => spec === p || spec.startsWith(`${p}/`))) {
      offenders.push(spec);
    }
  }
  return offenders;
};

const main = async () => {
  let totalFiles = 0;
  let totalOffenders = 0;
  const report = [];

  for (const target of WATCHED) {
    const files = await collectFiles(join(REPO_ROOT, target));
    totalFiles += files.length;
    for (const file of files) {
      const offenders = await scanFile(file);
      if (offenders.length > 0) {
        totalOffenders += offenders.length;
        report.push({ file: relative(REPO_ROOT, file), offenders });
      }
    }
  }

  if (totalOffenders === 0) {
    console.info(`edge-safe: ${totalFiles} files scanned, no forbidden Node-only imports.`);
    process.exit(0);
  }

  console.error(
    `edge-safe: ${totalOffenders} forbidden Node-only import(s) in ${report.length} file(s):`,
  );
  for (const { file, offenders } of report) {
    console.error(`  ${file}`);
    for (const o of offenders) {
      console.error(`    - ${o}`);
    }
  }
  console.error(
    "\nThese paths ship to Cloudflare Workers / Vercel Edge / Deno Deploy. Either",
  );
  console.error(
    "move the Node-only logic into a non-edge module, or add an edge polyfill",
  );
  console.error("entry to ALLOWED in scripts/check-edge-safe.mjs with a justification.");
  process.exit(1);
};

await main();
