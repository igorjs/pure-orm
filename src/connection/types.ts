// Copyright 2026 igorjs. SPDX-License-Identifier: Apache-2.0

/**
 * Connection layer types.
 *
 * The ORM never imports a database driver directly. Users provide a driver
 * that satisfies DatabaseDriver, keeping the ORM zero-dep and letting
 * users bring pg, postgres.js, @neondatabase/serverless, etc.
 */

import type { Dialect } from "@/dialect/dialect";
import type { DbError } from "@/errors/errors";
import type { Task } from "@/fx";
import type { Logger, QueryHooks } from "@/logging/types";

// ---- Driver interface ----

type RawConnection = {
  readonly query: (
    sql: string,
    params: readonly unknown[],
  ) => Promise<{ readonly rows: readonly unknown[]; readonly rowCount: number }>;
  readonly release: () => Promise<void>;
  readonly end: () => Promise<void>;
};

type DatabaseDriver = {
  readonly connect: (config: ConnectionConfig) => Promise<RawConnection>;
};

// ---- Configuration ----

type ConnectionConfig = {
  readonly host: string;
  readonly port: number;
  readonly database: string;
  readonly user: string;
  readonly password: string;
  readonly ssl?: unknown;
};

type PoolConfig = {
  readonly mode?: "pool" | "lambda";
  readonly min?: number;
  readonly max?: number;
  readonly idleTimeoutMs?: number;
  readonly acquireTimeoutMs?: number;
  readonly connectionTimeoutMs?: number;
};

type LoggingConfig = {
  readonly level?: "debug" | "info" | "warn" | "error" | "silent";
  readonly logger?: Logger;
};

type DatabaseConfig = {
  readonly dialect: string;
  readonly driver: DatabaseDriver;
  readonly connection: ConnectionConfig;
  readonly pool?: PoolConfig;
  readonly logging?: LoggingConfig;
  readonly hooks?: Partial<QueryHooks>;
};

// ---- Pool ----

type ConnectionPool = {
  readonly acquire: () => Task<RawConnection, DbError>;
  readonly release: (conn: RawConnection) => Task<void, DbError>;
  readonly end: () => Task<void, DbError>;
  readonly mode: "pool" | "lambda";
};

// ---- Database client (returned by Database() factory) ----

type DatabaseClient = {
  readonly dialect: Dialect;
  readonly pool: ConnectionPool;
  readonly logger: Logger;
  readonly hooks: Partial<QueryHooks>;
};

export type {
  ConnectionConfig,
  ConnectionPool,
  DatabaseClient,
  DatabaseConfig,
  DatabaseDriver,
  LoggingConfig,
  PoolConfig,
  RawConnection,
};
