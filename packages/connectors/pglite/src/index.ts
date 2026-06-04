// Copyright 2026 igorjs. SPDX-License-Identifier: Apache-2.0

/**
 * PGlite (Postgres WASM) connector for @igorjs/pure-orm.
 *
 * PGlite is Postgres compiled to WebAssembly — it speaks the Postgres dialect
 * but runs in-process on every JavaScript runtime: Node, Deno, Bun, Cloudflare
 * Workers, and the browser. This connector exposes a `DatabaseDriver` over a
 * caller-constructed PGlite instance so the same `@igorjs/pure-orm` core can
 * target the entire matrix.
 *
 * Unlike a TCP driver, PGlite is a single in-process database — there is no
 * pool. The factory wraps the shared PGlite instance so the core's pool/lambda
 * abstractions work uniformly (`connect()` returns the same handle every time;
 * `release()` is a no-op; `end()` closes the WASM instance).
 *
 * Usage (Node, Bun, Deno, Workers, browser — same code):
 *   import { PGlite } from "@electric-sql/pglite";
 *   import { Database } from "@igorjs/pure-orm";
 *   import { createPgliteDriver } from "@igorjs/pure-orm-pglite";
 *
 *   const pglite = new PGlite();                  // in-memory; or `new PGlite("file://./data")`
 *   const db = Database({
 *     dialect: "postgresql",
 *     driver: createPgliteDriver(pglite),
 *     connection: { host: "", port: 0, database: "", user: "", password: "" },
 *   });
 */

import type { PGlite } from "@electric-sql/pglite";
import type { DatabaseDriver, RawConnection } from "@igorjs/pure-orm";

/**
 * Minimal PGlite query-result shape we depend on. Avoids tying the public
 * surface to a specific PGlite minor version.
 */
type PGliteQueryResult = {
  readonly rows: readonly unknown[];
  readonly affectedRows?: number;
};

const wrapPglite = (pglite: PGlite): RawConnection =>
  Object.freeze({
    query: async (
      sql: string,
      params: readonly unknown[],
    ): Promise<{ readonly rows: readonly unknown[]; readonly rowCount: number }> => {
      const result = (await pglite.query(sql, [...params])) as PGliteQueryResult;
      return {
        rows: result.rows,
        rowCount: result.affectedRows ?? result.rows.length,
      };
    },
    release: async (): Promise<void> => {
      // No-op: PGlite is a single in-process database, not a pool.
    },
    end: async (): Promise<void> => {
      await pglite.close();
    },
  });

/**
 * Creates a `DatabaseDriver` that routes every query at the supplied PGlite
 * instance. The caller owns the PGlite lifecycle (it may share the instance
 * with other consumers); the connector only borrows it.
 */
const createPgliteDriver = (pglite: PGlite): DatabaseDriver =>
  Object.freeze({
    connect: async (): Promise<RawConnection> => wrapPglite(pglite),
  });

export { createPgliteDriver };
