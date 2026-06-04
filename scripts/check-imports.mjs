// Copyright 2026 igorjs. SPDX-License-Identifier: Apache-2.0

/**
 * Enforces the `@/*` alias convention for internal imports in src/.
 *
 * Permitted:
 *   - `./<sibling>`             same-directory relative imports
 *   - `@/<subpath>`             alias to src/<subpath>
 *   - `node:*` / external pkg   anything not starting with `./` or `../`
 *
 * Forbidden:
 *   - `../*` or `../../*`       deep relative imports — use `@/<subpath>` instead
 *
 * Run by: `pnpm check:imports`
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { extname, join, relative } from "node:path";

const TARGET = "src";
const FORBIDDEN_PREFIX = "../";

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
    if (name === "dist" || name === "node_modules" || name === ".git") continue;
    const sub = join(path, name);
    if (extname(name) === ".ts" || (await stat(sub)).isDirectory()) {
      out.push(...(await collectFiles(sub)));
    }
  }
  return out;
};

const IMPORT_RE = /from\s+["']([^"']+)["']/g;

const scan = async (file) => {
  const src = await readFile(file, "utf8");
  const offenders = [];
  let m;
  // biome-ignore lint/suspicious/noAssignInExpressions: idiomatic regex loop
  while ((m = IMPORT_RE.exec(src)) !== null) {
    const spec = m[1];
    if (spec.startsWith(FORBIDDEN_PREFIX)) offenders.push(spec);
  }
  return offenders;
};

const main = async () => {
  const files = await collectFiles(TARGET);
  const report = [];
  let total = 0;
  for (const file of files) {
    const offenders = await scan(file);
    if (offenders.length > 0) {
      total += offenders.length;
      report.push({ file: relative(process.cwd(), file), offenders });
    }
  }

  if (total === 0) {
    console.info(`imports: ${files.length} files scanned, all internal paths use @/ alias.`);
    process.exit(0);
  }

  console.error(`imports: ${total} forbidden ../ import(s) in ${report.length} file(s):`);
  for (const { file, offenders } of report) {
    console.error(`  ${file}`);
    for (const o of offenders) console.error(`    - ${o}`);
  }
  console.error(
    "\nUse @/<subpath> (alias to src/<subpath>) instead of ../* deep relatives.",
  );
  console.error("Same-directory ./* imports are still fine.");
  process.exit(1);
};

await main();
