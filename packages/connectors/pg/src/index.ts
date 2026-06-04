// Copyright 2026 igorjs. SPDX-License-Identifier: Apache-2.0

/**
 * PostgreSQL connector for @igorjs/pure-orm.
 *
 * Wraps the `pg` package so the ORM can stay zero-runtime-dep at its core:
 * users install this connector only when they want a node-postgres-backed
 * connection. The connector implements `DatabaseDriver` and `RawConnection`
 * from the core's public types.
 *
 * Usage:
 *   import { Database, createPostgresDialect } from "@igorjs/pure-orm";
 *   import { createPgDriver } from "@igorjs/pure-orm-pg";
 *
 *   const db = Database({
 *     dialect: "postgresql",
 *     driver: createPgDriver(),
 *     connection: { host, port, database, user, password },
 *   });
 */

import type { ConnectionConfig, DatabaseDriver, RawConnection } from "@igorjs/pure-orm";
import pg from "pg";

/**
 * Wraps a connected pg.Client as a RawConnection.
 *
 * - `query()` delegates to `client.query()` and normalises the result shape.
 * - `release()` is a no-op: the core pool manages connection lifecycle.
 * - `end()` closes the underlying pg.Client.
 */
const wrapClient = (client: pg.Client): RawConnection =>
  Object.freeze({
    query: async (
      sql: string,
      params: readonly unknown[],
    ): Promise<{ readonly rows: readonly unknown[]; readonly rowCount: number }> => {
      const result = await client.query(sql, [...params]);
      return { rows: result.rows as readonly unknown[], rowCount: result.rowCount ?? 0 };
    },
    release: async (): Promise<void> => {
      // No-op: the connection pool controls the lifecycle.
    },
    end: async (): Promise<void> => {
      await client.end();
    },
  });

/**
 * Creates a `DatabaseDriver` backed by node-postgres (`pg`).
 *
 * Each `connect()` call constructs a fresh `pg.Client`. The core's pool/lambda
 * abstractions decide when to create and release these clients — this driver
 * is purely a transport adapter.
 */
const createPgDriver = (): DatabaseDriver =>
  Object.freeze({
    connect: async (config: ConnectionConfig): Promise<RawConnection> => {
      const client = new pg.Client({
        host: config.host,
        port: config.port,
        database: config.database,
        user: config.user,
        password: config.password,
        ssl: config.ssl !== undefined ? (config.ssl as pg.ConnectionConfig["ssl"]) : undefined,
      });
      await client.connect();
      return wrapClient(client);
    },
  });

export { createPgDriver };
