// Copyright 2026 igorjs. SPDX-License-Identifier: Apache-2.0

/**
 * CLI database client factory.
 *
 * Dynamically imports the driver package (pg or better-sqlite3) based on
 * the dialect specified in the config. Returns a DatabaseClient ready
 * for migration operations.
 */

import { Database } from "../connection/database.ts";
import type { ConnectionConfig, DatabaseClient, DatabaseDriver } from "../connection/types.ts";
import type { PureOrmConfig } from "./types.ts";

const loadPostgresDriver = async (): Promise<DatabaseDriver> => {
  let mod: Record<string, unknown>;
  try {
    mod = await import("pg");
  } catch {
    throw new Error("Package 'pg' is not installed. Run: pnpm add pg");
  }

  const PgPool = (mod["default"] as Record<string, unknown>)?.["Pool"] as
    | (new (
        opts: unknown,
      ) => unknown)
    | undefined;
  const PoolClass = PgPool ?? (mod["Pool"] as new (opts: unknown) => unknown);

  return {
    connect: async (config: ConnectionConfig) => {
      const pool = new PoolClass({
        host: config.host,
        port: config.port,
        database: config.database,
        user: config.user,
        password: config.password,
        ssl: config.ssl,
        max: 1,
      });
      const client = await (pool as Record<string, (...args: unknown[]) => Promise<unknown>>)[
        "connect"
      ]!();
      return {
        query: async (sql: string, params: readonly unknown[]) => {
          const result = await (
            client as Record<string, (...args: unknown[]) => Promise<Record<string, unknown>>>
          )["query"]!(sql, [...params]);
          return {
            rows: result["rows"] as readonly unknown[],
            rowCount: (result["rowCount"] as number) ?? 0,
          };
        },
        release: async () => {
          (client as Record<string, () => void>)["release"]!();
        },
        end: async () => {
          (client as Record<string, () => void>)["release"]!();
          await (pool as Record<string, () => Promise<void>>)["end"]!();
        },
      };
    },
  };
};

const loadSqliteDriver = async (): Promise<DatabaseDriver> => {
  let mod: Record<string, unknown>;
  try {
    mod = await import("better-sqlite3");
  } catch {
    throw new Error("Package 'better-sqlite3' is not installed. Run: pnpm add better-sqlite3");
  }

  const BetterSqlite = (mod["default"] ?? mod["Database"]) as new (
    filename: string,
  ) => Record<string, unknown>;

  return {
    connect: async (config: ConnectionConfig) => {
      const filename = config.database;
      const db = new BetterSqlite(filename);
      const prepare = db["prepare"] as (s: string) => Record<string, (...p: unknown[]) => unknown>;

      return {
        query: async (sql: string, params: readonly unknown[]) => {
          const stmt = prepare(sql);
          const upper = sql.trim().toUpperCase();
          if (upper.startsWith("SELECT") || upper.startsWith("PRAGMA")) {
            const rows = (stmt["all"] as (...p: unknown[]) => unknown[])(...params);
            return { rows, rowCount: rows.length };
          }
          const info = (stmt["run"] as (...p: unknown[]) => Record<string, unknown>)(...params);
          return { rows: [], rowCount: (info["changes"] as number) ?? 0 };
        },
        release: async () => {
          // SQLite connections are shared; release is a no-op
        },
        end: async () => {
          (db["close"] as () => void)();
        },
      };
    },
  };
};

const buildConnectionConfig = (config: PureOrmConfig): ConnectionConfig => ({
  host: config.connection.host ?? "localhost",
  port: config.connection.port ?? 5432,
  database: config.connection.filename ?? config.connection.database,
  user: config.connection.user ?? "postgres",
  password: config.connection.password ?? "",
  ssl: config.connection.ssl,
});

const createDatabaseClient = async (config: PureOrmConfig): Promise<DatabaseClient> => {
  const driver =
    config.dialect === "sqlite" ? await loadSqliteDriver() : await loadPostgresDriver();

  return Database({
    dialect: config.dialect,
    driver,
    connection: buildConnectionConfig(config),
  });
};

export { createDatabaseClient };
