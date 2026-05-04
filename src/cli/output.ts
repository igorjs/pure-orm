// Copyright 2026 igorjs. SPDX-License-Identifier: Apache-2.0

/**
 * CLI output formatting with ANSI colour support.
 * Respects the NO_COLOR standard (https://no-color.org/).
 */

const useColor = process.env["NO_COLOR"] === undefined && process.stdout.isTTY === true;

const ansi = Object.freeze({
  reset: useColor ? "\x1b[0m" : "",
  bold: useColor ? "\x1b[1m" : "",
  dim: useColor ? "\x1b[2m" : "",
  green: useColor ? "\x1b[32m" : "",
  yellow: useColor ? "\x1b[33m" : "",
  red: useColor ? "\x1b[31m" : "",
  cyan: useColor ? "\x1b[36m" : "",
});

const printSuccess = (msg: string): void => {
  console.info(`${ansi.green}  ✓${ansi.reset} ${msg}`);
};

const printWarning = (msg: string): void => {
  console.info(`${ansi.yellow}  ⚠${ansi.reset} ${msg}`);
};

const printError = (msg: string): void => {
  console.error(`${ansi.red}  ✗${ansi.reset} ${msg}`);
};

const printInfo = (msg: string): void => {
  console.info(`${ansi.cyan}  →${ansi.reset} ${msg}`);
};

const printHeader = (msg: string): void => {
  console.info(`\n${ansi.bold}${msg}${ansi.reset}`);
};

const printDivider = (): void => {
  console.info(`${ansi.dim}${"─".repeat(60)}${ansi.reset}`);
};

const printSql = (sql: string): void => {
  console.info(`${ansi.dim}${sql}${ansi.reset}`);
};

const padRight = (str: string, len: number): string =>
  str + " ".repeat(Math.max(0, len - str.length));

const printTable = (headers: readonly string[], rows: readonly (readonly string[])[]): void => {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map(r => (r[i] ?? "").length)));

  const headerLine = headers.map((h, i) => padRight(h, widths[i] ?? 0)).join("  ");
  console.info(`  ${ansi.bold}${headerLine}${ansi.reset}`);

  const dividerLine = widths.map(w => "─".repeat(w)).join("  ");
  console.info(`  ${ansi.dim}${dividerLine}${ansi.reset}`);

  for (const row of rows) {
    const line = row.map((cell, i) => padRight(cell, widths[i] ?? 0)).join("  ");
    console.info(`  ${line}`);
  }
};

export {
  ansi,
  printDivider,
  printError,
  printHeader,
  printInfo,
  printSql,
  printSuccess,
  printTable,
  printWarning,
};
