/**
 * Database factory.
 *
 * Assembles a DatabaseClient by resolving the requested dialect, building the
 * appropriate connection pool, and wiring up the logger.  Callers receive a
 * frozen DatabaseClient ready for use by the query execution layer.
 */

import type { Dialect } from "../dialect/dialect.ts";
import type { Result } from "../dialect/registry.ts";
import { resolveDialect } from "../dialect/registry.ts";
import type { DbError } from "../errors/errors.ts";
import { createConsoleLogger, createNoopLogger } from "../logging/logger.ts";
import { createLambdaPool } from "./lambda.ts";
import { createPool } from "./pool.ts";
import type { DatabaseClient, DatabaseConfig } from "./types.ts";

/**
 * Creates a DatabaseClient from the provided config.
 *
 * Returns a plain DatabaseClient (not a Task) because dialect resolution and
 * pool/logger construction are synchronous.  Errors in dialect resolution
 * throw — callers should handle them at application startup.
 *
 * @throws {DbError} when the requested dialect is not registered.
 */
const Database = (config: DatabaseConfig): DatabaseClient => {
  // Resolve dialect by name. The registry exports a discriminated Result so
  // the missing-dialect case is handled explicitly without type assertions.
  const dialectResult: Result<Dialect, DbError> = resolveDialect(config.dialect);

  if (dialectResult.tag === "Err") {
    // Dialect resolution errors are programmer mistakes (wrong config), so we
    // surface them immediately as thrown errors rather than hiding them in a
    // Task or returning null.
    throw dialectResult.error;
  }

  const dialect = dialectResult.value;

  // Build logger from logging config.
  const loggingConfig = config.logging;
  const logger =
    loggingConfig?.logger !== undefined
      ? loggingConfig.logger
      : loggingConfig?.level === "silent" || loggingConfig === undefined
        ? createNoopLogger()
        : createConsoleLogger(loggingConfig.level ?? "info");

  // Build the connection pool based on the requested mode.
  const poolConfig = config.pool ?? {};
  const pool =
    poolConfig.mode === "lambda"
      ? createLambdaPool(config.driver, config.connection, poolConfig, logger)
      : createPool(config.driver, config.connection, poolConfig, logger);

  return Object.freeze({
    dialect,
    pool,
    logger,
    hooks: config.hooks ?? {},
  });
};

export { Database };
