// Copyright 2026 igorjs. SPDX-License-Identifier: Apache-2.0

/**
 * Connection helpers.
 *
 * Wraps raw async driver operations in Tasks so the rest of the ORM can
 * work in a purely functional pipeline without reaching for try/catch.
 */

import { Task } from "@igorjs/pure-fx/async";

import type { DbError } from "../errors/errors.ts";
import { connectionError } from "../errors/errors.ts";
import type { ConnectionConfig, DatabaseDriver, RawConnection } from "./types.ts";

/**
 * Wraps driver.connect() in a Task, converting any thrown error into a
 * ConnectionError rather than letting it bubble as an unhandled rejection.
 */
const connect = (driver: DatabaseDriver, config: ConnectionConfig): Task<RawConnection, DbError> =>
  Task.fromPromise(
    () => driver.connect(config),
    (cause: unknown) => connectionError("Failed to establish database connection", cause),
  );

/**
 * Wraps conn.end() in a Task, converting any thrown error into a
 * ConnectionError.
 */
const closeConnection = (conn: RawConnection): Task<void, DbError> =>
  Task.fromPromise(
    () => conn.end(),
    (cause: unknown) => connectionError("Failed to close database connection", cause),
  );

export { closeConnection, connect };
