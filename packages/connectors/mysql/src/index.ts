// Copyright 2026 igorjs. SPDX-License-Identifier: Apache-2.0

/**
 * MySQL / MariaDB connector for @igorjs/pure-orm.
 *
 * Wraps the `mysql2` driver so the ORM can stay zero-runtime-dep at its core.
 * The connector implements `DatabaseDriver` and `RawConnection` from the
 * core's public types and pairs with the `mysql` dialect (`createMysqlDialect`)
 * — same dialect serves MariaDB.
 *
 * Usage:
 *   import { Database } from "@igorjs/pure-orm";
 *   import { createMysqlDriver } from "@igorjs/pure-orm-mysql";
 *
 *   const db = Database({
 *     dialect: "mysql", // or "mariadb"
 *     driver: createMysqlDriver(),
 *     connection: { host, port, database, user, password },
 *   });
 */

import type { ConnectionConfig, DatabaseDriver, RawConnection } from "@igorjs/pure-orm";
import mysql from "mysql2/promise";

const wrapConnection = (conn: mysql.Connection): RawConnection =>
  Object.freeze({
    query: async (
      sql: string,
      params: readonly unknown[],
    ): Promise<{ readonly rows: readonly unknown[]; readonly rowCount: number }> => {
      // mysql2/promise returns [rows, fields] for SELECT and ResultSetHeader
      // for INSERT/UPDATE/DELETE; normalise both shapes for the core.
      const [rowsOrHeader] = await conn.query(sql, [...params]);
      if (Array.isArray(rowsOrHeader)) {
        return { rows: rowsOrHeader as readonly unknown[], rowCount: rowsOrHeader.length };
      }
      const header = rowsOrHeader as { affectedRows?: number };
      return { rows: [], rowCount: header.affectedRows ?? 0 };
    },
    release: async (): Promise<void> => {
      // No-op: the core pool layer owns the lifecycle.
    },
    end: async (): Promise<void> => {
      await conn.end();
    },
  });

/**
 * Creates a `DatabaseDriver` backed by `mysql2/promise`. Each `connect()` call
 * opens a fresh `mysql.Connection` — the core's pool/lambda abstractions
 * decide when to create and release these.
 */
const createMysqlDriver = (): DatabaseDriver =>
  Object.freeze({
    connect: async (config: ConnectionConfig): Promise<RawConnection> => {
      const conn = await mysql.createConnection({
        host: config.host,
        port: config.port,
        database: config.database,
        user: config.user,
        password: config.password,
        // Match the core's expectation that parameterised values stay typed —
        // mysql2 otherwise stringifies numbers in some edge cases.
        supportBigNumbers: true,
        ...(config.ssl !== undefined
          ? { ssl: config.ssl as NonNullable<mysql.ConnectionOptions["ssl"]> }
          : {}),
      });
      return wrapConnection(conn);
    },
  });

export { createMysqlDriver };
