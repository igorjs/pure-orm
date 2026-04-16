/**
 * Logger factories for pure-orm.
 *
 * createConsoleLogger: writes to the Node console at or above the configured
 * level, prefixing every message with "[pure-orm]" so output is easy to filter.
 *
 * createNoopLogger: all methods are no-ops — useful in tests and for callers
 * that want to opt out of logging entirely.
 */

import type { Logger, LogLevel } from "./types.ts";

// Numeric rank lets a single comparison gate each log call.
const LEVEL_RANK: Readonly<Record<LogLevel, number>> = Object.freeze({
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4,
});

const PREFIX = "[pure-orm]";

const formatMessage = (message: string): string => `${PREFIX} ${message}`;

const createConsoleLogger = (level: LogLevel): Logger => {
  const threshold = LEVEL_RANK[level];

  return Object.freeze({
    debug: (message: string, context?: Readonly<Record<string, unknown>>): void => {
      if (LEVEL_RANK.debug < threshold) return;
      // biome-ignore lint/suspicious/noConsole: logger wraps console by design
      console.info(formatMessage(message), ...(context !== undefined ? [context] : []));
    },
    info: (message: string, context?: Readonly<Record<string, unknown>>): void => {
      if (LEVEL_RANK.info < threshold) return;
      // biome-ignore lint/suspicious/noConsole: logger wraps console by design
      console.info(formatMessage(message), ...(context !== undefined ? [context] : []));
    },
    warn: (message: string, context?: Readonly<Record<string, unknown>>): void => {
      if (LEVEL_RANK.warn < threshold) return;
      // biome-ignore lint/suspicious/noConsole: logger wraps console by design
      console.warn(formatMessage(message), ...(context !== undefined ? [context] : []));
    },
    error: (message: string, context?: Readonly<Record<string, unknown>>): void => {
      if (LEVEL_RANK.error < threshold) return;
      // biome-ignore lint/suspicious/noConsole: logger wraps console by design
      console.error(formatMessage(message), ...(context !== undefined ? [context] : []));
    },
  });
};

const createNoopLogger = (): Logger =>
  Object.freeze({
    debug: (): void => undefined,
    info: (): void => undefined,
    warn: (): void => undefined,
    error: (): void => undefined,
  });

export { createConsoleLogger, createNoopLogger };
