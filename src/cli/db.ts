// Copyright 2026 igorjs. SPDX-License-Identifier: Apache-2.0

/**
 * CLI database client factory.
 *
 * Dynamically imports the driver package (pg or @libsql/client) based on
 * the dialect specified in the config. Returns a DatabaseClient ready
 * for migration operations.
 */

import { Database } from "@/connection/database";
import type { ConnectionConfig, DatabaseClient, DatabaseDriver } from "@/connection/types";
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

const REMOTE_URL_PREFIXES = ["file:", "libsql:", "http:", "https:", "ws:", "wss:"] as const;

const toLibsqlUrl = (target: string): string => {
  if (target === ":memory:") return target;
  for (const prefix of REMOTE_URL_PREFIXES) {
    if (target.startsWith(prefix)) return target;
  }
  return `file:${target}`;
};

const loadSqliteDriver = async (): Promise<DatabaseDriver> => {
  let mod: Record<string, unknown>;
  try {
    mod = await import("@libsql/client");
  } catch {
    throw new Error("Package '@libsql/client' is not installed. Run: pnpm add @libsql/client");
  }

  type LibsqlClient = {
    readonly execute: (q: { readonly sql: string; readonly args: unknown[] }) => Promise<{
      readonly rows: unknown[];
      readonly rowsAffected?: number;
    }>;
    readonly close: () => void;
  };
  const createClient = mod["createClient"] as (opts: { url: string }) => LibsqlClient;

  return {
    connect: async (config: ConnectionConfig) => {
      const client = createClient({ url: toLibsqlUrl(config.database) });

      return {
        query: async (sql: string, params: readonly unknown[]) => {
          const trimmed = sql.trim();
          if (trimmed.length === 0) {
            return { rows: [], rowCount: 0 };
          }
          const result = await client.execute({
            sql: trimmed,
            args: [...params],
          });
          return {
            rows: result.rows as readonly unknown[],
            rowCount: Number(result.rowsAffected ?? result.rows.length),
          };
        },
        release: async () => {
          // libsql client owns its lifecycle; release is a no-op.
        },
        end: async () => {
          client.close();
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
