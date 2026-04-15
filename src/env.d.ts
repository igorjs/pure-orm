/**
 * Ambient declarations for Node.js globals used by pure-orm.
 *
 * We target "lib": ["es2024"] without "dom" because pure-orm is server-only.
 * These declarations cover the small set of Node globals the library needs
 * without pulling in the full @types/node or DOM lib.
 */

/* eslint-disable no-var */
declare var console: {
  info(...args: readonly unknown[]): void;
  warn(...args: readonly unknown[]): void;
  error(...args: readonly unknown[]): void;
};

declare var performance: {
  now(): number;
};

declare function setTimeout(callback: (...args: readonly unknown[]) => void, ms?: number): number;
declare function clearTimeout(id: number | undefined): void;
