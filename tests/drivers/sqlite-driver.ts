/**
 * SQLite DatabaseDriver adapter for the integration test suite.
 *
 * Backed by `@libsql/client` with an in-memory database — genuinely async
 * under the hood (Promise-returning APIs all the way down), unlike a
 * better-sqlite3 wrapper which has to fake async over a synchronous C addon.
 *
 * A single libsql client is created on the first connect() call and shared
 * across every subsequent connection so DDL and data mutations are visible
 * pool-wide (each in-memory libsql client owns its own database — without
 * sharing, the pool would route to disjoint databases).
 */

import { type Client, createClient } from "@libsql/client";

import type {
  ConnectionConfig,
  DatabaseDriver,
  RawConnection,
} from "../../src/connection/types.ts";

const wrapClient = (client: Client, closeFn: () => void): RawConnection =>
  Object.freeze({
    query: async (
      sql: string,
      params: readonly unknown[],
    ): Promise<{ readonly rows: readonly unknown[]; readonly rowCount: number }> => {
      const trimmed = sql.trim();
      if (trimmed.length === 0) {
        return { rows: [], rowCount: 0 };
      }
      const result = await client.execute({
        sql: trimmed,
        args: [...params] as never,
      });
      return {
        rows: result.rows as readonly unknown[],
        rowCount: Number(result.rowsAffected ?? result.rows.length),
      };
    },
    release: async (): Promise<void> => {
      // No-op: the connection pool controls the lifecycle.
    },
    end: async (): Promise<void> => {
      closeFn();
    },
  });

/**
 * SQLite driver adapter using a shared in-memory libsql client.
 *
 * The ConnectionConfig is ignored — in-memory libsql needs no host/port/creds.
 */
const createSqliteDriver = (): DatabaseDriver => {
  let sharedClient: Client | null = null;

  return Object.freeze({
    connect: async (_config: ConnectionConfig): Promise<RawConnection> => {
      if (sharedClient === null) {
        sharedClient = createClient({ url: ":memory:" });
      }

      const closeFn = (): void => {
        if (sharedClient !== null) {
          sharedClient.close();
          sharedClient = null;
        }
      };

      return wrapClient(sharedClient, closeFn);
    },
  });
};

export { createSqliteDriver };
