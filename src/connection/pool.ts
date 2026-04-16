/**
 * Standard connection pool.
 *
 * Maintains a list of idle RawConnections and a count of active (in-use)
 * connections. Callers acquire() a connection before work and release() it
 * afterwards. end() drains all connections gracefully.
 *
 * The internal state (idle array, active count, shutdown flag) is necessarily
 * mutable, but all public operations return Tasks so consumers remain in a
 * purely functional pipeline.
 */

import { Ok, Task } from "@igorjs/pure-ts";

import type { DbError } from "../errors/errors.ts";
import { connectionError } from "../errors/errors.ts";
import type { Logger } from "../logging/types.ts";
import { closeConnection, connect } from "./connection.ts";
import type {
  ConnectionConfig,
  ConnectionPool,
  DatabaseDriver,
  PoolConfig,
  RawConnection,
} from "./types.ts";

const DEFAULT_MAX = 10;
const DEFAULT_ACQUIRE_TIMEOUT_MS = 5000;

/**
 * Builds a standard connection pool that opens new connections on demand up
 * to a configured maximum and parks idle connections for reuse.
 */
const createPool = (
  driver: DatabaseDriver,
  config: ConnectionConfig,
  poolConfig: PoolConfig,
  logger: Logger,
): ConnectionPool => {
  const max = poolConfig.max ?? DEFAULT_MAX;
  const acquireTimeoutMs = poolConfig.acquireTimeoutMs ?? DEFAULT_ACQUIRE_TIMEOUT_MS;

  // Mutable internal state — intentionally not exposed to callers.
  const idle: RawConnection[] = [];
  let active = 0;
  let shuttingDown = false;

  // Pending acquire waiters: each waiter is a pair of resolve/reject from a
  // Promise that will complete once a connection becomes available.
  type Waiter = {
    readonly resolve: (conn: RawConnection) => void;
    readonly reject: (err: DbError) => void;
  };
  const waiters: Waiter[] = [];

  // Try to hand a connection to the next waiter, if any.
  const drainWaiter = (conn: RawConnection): void => {
    const waiter = waiters.shift();
    if (waiter !== undefined) {
      waiter.resolve(conn);
    } else {
      idle.push(conn);
      active -= 1;
    }
  };

  const acquire = (): Task<RawConnection, DbError> => {
    // Happy path: idle connection available.
    const reused = idle.shift();
    if (reused !== undefined) {
      active += 1;
      logger.debug("pool: reusing idle connection", { active, idle: idle.length });
      return Task.fromResult(Ok(reused));
    }

    // Under the limit: create a new connection.
    if (active < max) {
      active += 1;
      logger.debug("pool: opening new connection", { active, idle: idle.length });
      return connect(driver, config).mapErr(e => {
        active -= 1;
        return e;
      });
    }

    // At the limit: wait until a connection is released or the timeout fires.
    logger.debug("pool: at max connections, waiting", { active, idle: idle.length });
    return Task.fromPromise(
      () =>
        new Promise<RawConnection>((resolve, reject) => {
          const timer = setTimeout(() => {
            const idx = waiters.findIndex(w => w.resolve === resolve);
            if (idx !== -1) waiters.splice(idx, 1);
            reject(connectionError(`Pool acquire timed out after ${acquireTimeoutMs}ms`));
          }, acquireTimeoutMs);

          waiters.push({
            resolve: conn => {
              clearTimeout(timer);
              resolve(conn);
            },
            reject: err => {
              clearTimeout(timer);
              reject(err);
            },
          });
        }),
      (cause: unknown) =>
        cause instanceof Object && "tag" in cause && cause.tag === "ConnectionError"
          ? (cause as DbError)
          : connectionError("Pool acquire failed", cause),
    );
  };

  const release = (conn: RawConnection): Task<void, DbError> => {
    // If the pool is shutting down, close the connection rather than parking it.
    if (shuttingDown) {
      logger.debug("pool: shutting down — closing released connection");
      return closeConnection(conn).map(() => {
        active -= 1;
        return undefined;
      });
    }

    // Pass to a waiting acquirer or park in idle list.
    logger.debug("pool: releasing connection", { active, idle: idle.length });
    drainWaiter(conn);
    return Task.fromResult<void, DbError>(Ok(undefined));
  };

  const end = (): Task<void, DbError> => {
    shuttingDown = true;
    logger.debug("pool: ending — closing all connections", { active, idle: idle.length });

    // Reject any pending waiters so they don't hang.
    for (const waiter of waiters.splice(0)) {
      waiter.reject(connectionError("Pool is shutting down"));
    }

    // Close all idle connections in parallel, then resolve.
    const closeAll = idle.splice(0).map(conn => closeConnection(conn));

    return Task.fromPromise(
      async () => {
        const results = await Promise.all(closeAll.map(t => t.run()));
        for (const result of results) {
          if (result.tag === "Err") {
            logger.error("pool: error closing idle connection during end()", {
              error: String(result.error),
            });
          }
        }
      },
      (cause: unknown) => connectionError("Pool end() failed", cause),
    );
  };

  return Object.freeze({ acquire, release, end, mode: "pool" as const });
};

export { createPool };
