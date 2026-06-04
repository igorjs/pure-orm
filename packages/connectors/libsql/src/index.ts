// Copyright 2026 igorjs. SPDX-License-Identifier: Apache-2.0

/**
 * libsql / Turso connector for @igorjs/pure-orm.
 *
 * One `@libsql/client` covers three SQLite-compatible deployments with the
 * same SQL surface:
 *
 *   - Local file (`file:./data.db`) — Node, Bun, Deno
 *   - Turso cloud over HTTP (`libsql://…`) — Node, Bun, Deno, Cloudflare
 *   - Embedded replica (local + remote sync) — Node, Bun
 *
 * Because libsql speaks the SQLite dialect, the existing `createSqliteDialect`
 * from `@igorjs/pure-orm` works without modification — this connector only has
 * to bridge `@libsql/client` into the `DatabaseDriver` contract.
 *
 * Usage:
 *   import { createClient } from "@libsql/client";
 *   import { Database } from "@igorjs/pure-orm";
 *   import { createLibsqlDriver } from "@igorjs/pure-orm-libsql";
 *
 *   const client = createClient({ url: "libsql://my-db.turso.io", authToken: "…" });
 *   const db = Database({
 *     dialect: "sqlite",
 *     driver: createLibsqlDriver(client),
 *     connection: { host: "", port: 0, database: "", user: "", password: "" },
 *   });
 */

import type { DatabaseDriver, RawConnection } from "@igorjs/pure-orm";
import type { Client as LibsqlClient } from "@libsql/client";

const wrapLibsql = (client: LibsqlClient): RawConnection =>
  Object.freeze({
    query: async (
      sql: string,
      params: readonly unknown[],
    ): Promise<{ readonly rows: readonly unknown[]; readonly rowCount: number }> => {
      // @libsql/client returns rows as Record<string, unknown>[]; expose them
      // directly as readonly unknown[] so the core's result-mapper can take
      // over from there.
      const result = await client.execute({ sql, args: [...params] as unknown[] as never });
      return {
        rows: result.rows as readonly unknown[],
        rowCount: Number(result.rowsAffected ?? 0),
      };
    },
    release: async (): Promise<void> => {
      // No-op: libsql client owns its own connection lifecycle (HTTP pool or
      // local file handle); the core pool layer treats it as a singleton.
    },
    end: async (): Promise<void> => {
      client.close();
    },
  });

/**
 * Creates a `DatabaseDriver` that routes every query at the supplied
 * `@libsql/client` instance. The caller chooses local file, Turso URL, or
 * embedded replica when constructing the client; the connector is identical
 * across all three.
 */
const createLibsqlDriver = (client: LibsqlClient): DatabaseDriver =>
  Object.freeze({
    connect: async (): Promise<RawConnection> => wrapLibsql(client),
  });

export { createLibsqlDriver };
