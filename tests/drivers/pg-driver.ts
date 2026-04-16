/**
 * PostgreSQL DatabaseDriver adapter wrapping the 'pg' package.
 *
 * Implements DatabaseDriver and RawConnection from src/connection/types.ts
 * so that the ORM connection layer can manage pg.Client instances
 * through the standard pool abstraction.
 */

import pg from "pg";

import type {
  ConnectionConfig,
  DatabaseDriver,
  RawConnection,
} from "../../src/connection/types.ts";

/**
 * Creates a RawConnection backed by a connected pg.Client.
 *
 * - query() delegates to client.query() and normalises the result shape.
 * - release() is a no-op: the pool layer manages connection lifecycle.
 * - end() closes the underlying pg.Client.
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
 * PostgreSQL driver adapter.
 *
 * connect() creates a new pg.Client using the provided ConnectionConfig,
 * establishes the TCP connection, and returns a wrapped RawConnection.
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
