// Copyright 2026 igorjs. SPDX-License-Identifier: Apache-2.0

/**
 * Neon serverless connector for @igorjs/pure-orm.
 *
 * Postgres over HTTP/WebSocket — runs in Node, Deno, Bun, and Cloudflare
 * Workers. Uses the existing Postgres dialect from `@igorjs/pure-orm` because
 * Neon is just managed Postgres. The connector accepts a caller-constructed
 * `Pool` from `@neondatabase/serverless` (API-compatible with `pg.Pool`) and
 * lifts each `pool.connect()` call into the core's `RawConnection` contract.
 *
 * Usage on Cloudflare Workers:
 *   import { Pool } from "@neondatabase/serverless";
 *   import { Database } from "@igorjs/pure-orm";
 *   import { createNeonDriver } from "@igorjs/pure-orm-neon";
 *
 *   const pool = new Pool({ connectionString: env.DATABASE_URL });
 *   const db = Database({
 *     dialect: "postgresql",
 *     driver: createNeonDriver(pool),
 *     connection: { host: "", port: 0, database: "", user: "", password: "" },
 *   });
 */

import type { DatabaseDriver, RawConnection } from "@igorjs/pure-orm";
import type { Pool, PoolClient } from "@neondatabase/serverless";

const wrapNeonClient = (client: PoolClient): RawConnection =>
  Object.freeze({
    query: async (
      sql: string,
      params: readonly unknown[],
    ): Promise<{ readonly rows: readonly unknown[]; readonly rowCount: number }> => {
      const result = await client.query(sql, [...params]);
      return { rows: result.rows as readonly unknown[], rowCount: result.rowCount ?? 0 };
    },
    release: async (): Promise<void> => {
      // Real release back to the pool — this matters for the connection
      // budget on Workers and on Neon's serverless tier.
      client.release();
    },
    end: async (): Promise<void> => {
      // The Pool's lifetime is owned by the caller; the connector intentionally
      // does not end it here so the user can reuse the pool across requests.
    },
  });

/**
 * Creates a `DatabaseDriver` that acquires connections from a caller-supplied
 * Neon serverless `Pool`. The pool is API-compatible with `pg.Pool`, so the
 * existing Postgres dialect works unchanged.
 */
const createNeonDriver = (pool: Pool): DatabaseDriver =>
  Object.freeze({
    connect: async (): Promise<RawConnection> => {
      const client = await pool.connect();
      return wrapNeonClient(client);
    },
  });

export { createNeonDriver };
