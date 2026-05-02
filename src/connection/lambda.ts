// Copyright 2026 igorjs. SPDX-License-Identifier: Apache-2.0

/**
 * Lambda single-connection strategy.
 *
 * In a Lambda (serverless) environment each function instance handles one
 * request at a time, so a shared connection pool adds unnecessary overhead.
 * This strategy keeps a single connection open across warm invocations and
 * creates it lazily on the first acquire().
 *
 * Health checking is deferred to Phase 2.
 */

import { Task } from "@igorjs/pure-ts/async";
import { Ok } from "@igorjs/pure-ts/core";

import type { DbError } from "../errors/errors.ts";
import type { Logger } from "../logging/types.ts";
import { closeConnection, connect } from "./connection.ts";
import type {
  ConnectionConfig,
  ConnectionPool,
  DatabaseDriver,
  PoolConfig,
  RawConnection,
} from "./types.ts";

/**
 * Module-scoped singleton connection.  Intentionally mutable — it persists
 * across Lambda warm invocations so subsequent requests skip the connect
 * round-trip.
 */
// eslint-disable-next-line fp/no-let
let singletonConnection: RawConnection | null = null;

const createLambdaPool = (
  driver: DatabaseDriver,
  config: ConnectionConfig,
  _poolConfig: PoolConfig,
  logger: Logger,
): ConnectionPool => {
  const acquire = (): Task<RawConnection, DbError> => {
    if (singletonConnection !== null) {
      logger.debug("lambda pool: reusing existing connection");
      return Task.fromResult(Ok(singletonConnection));
    }

    logger.debug("lambda pool: creating new connection");
    return connect(driver, config).tap(conn => {
      singletonConnection = conn;
    });
  };

  // Release is intentionally a no-op: the connection stays alive for the next
  // warm invocation.
  const release = (_conn: RawConnection): Task<void, DbError> => {
    logger.debug("lambda pool: release is a no-op");
    return Task.fromResult<void, DbError>(Ok(undefined));
  };

  const end = (): Task<void, DbError> => {
    if (singletonConnection === null) {
      logger.debug("lambda pool: end() called but no connection to close");
      return Task.fromResult<void, DbError>(Ok(undefined));
    }

    logger.debug("lambda pool: closing connection");
    const connToClose = singletonConnection;
    singletonConnection = null;
    return closeConnection(connToClose);
  };

  return Object.freeze({ acquire, release, end, mode: "lambda" as const });
};

// Exported for tests that need to reset the singleton between runs.
const resetLambdaConnection = (): void => {
  singletonConnection = null;
};

export { createLambdaPool, resetLambdaConnection };
