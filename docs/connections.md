# Connections

## Database Factory

`Database()` assembles a `DatabaseClient` from configuration. It resolves the dialect, builds the connection pool, and wires up logging.

```typescript
import { Database } from "@igorjs/pure-orm";

const db = Database({
  dialect: "postgresql",  // or "sqlite"
  driver: pgDriver,       // bring your own driver
  connection: {
    host: "localhost",
    port: 5432,
    database: "myapp",
    user: "postgres",
    password: "secret",
  },
  pool: {
    mode: "pool",       // "pool" (default) or "lambda"
    min: 2,
    max: 10,
    idleTimeoutMs: 30000,
  },
  logging: {
    level: "info",      // "debug" | "info" | "warn" | "error" | "silent"
  },
  hooks: {
    afterExecute: (result) => {
      console.log(`Query took ${result.durationMs}ms`);
    },
  },
});
```

## Bring Your Own Driver

The ORM never imports a database driver directly. Provide a `DatabaseDriver` that satisfies:

```typescript
type DatabaseDriver = {
  readonly connect: (config: ConnectionConfig) => Promise<RawConnection>;
};

type RawConnection = {
  readonly query: (sql: string, params: readonly unknown[]) =>
    Promise<{ readonly rows: readonly unknown[]; readonly rowCount: number }>;
  readonly release: () => Promise<void>;
  readonly end: () => Promise<void>;
};
```

### Example: pg adapter

```typescript
import pg from "pg";

const pgDriver: DatabaseDriver = {
  connect: async (config) => {
    const client = new pg.Client(config);
    await client.connect();
    return {
      query: async (sql, params) => {
        const result = await client.query(sql, params as any[]);
        return { rows: result.rows, rowCount: result.rowCount ?? 0 };
      },
      release: async () => { /* return to pool */ },
      end: async () => { await client.end(); },
    };
  },
};
```

## Pool Modes

### Standard Pool

For long-running servers. Maintains a set of idle connections.

```typescript
Database({
  ...config,
  pool: {
    mode: "pool",
    min: 2,       // minimum idle connections
    max: 10,      // maximum total connections
    idleTimeoutMs: 30000,  // close idle connections after 30s
  },
});
```

### Lambda Pool

For serverless environments. Reuses a single connection across warm invocations.

```typescript
Database({
  ...config,
  pool: { mode: "lambda" },
});
```

- `acquire()` creates a connection on first call, reuses it thereafter
- `release()` is a no-op (keeps connection alive for next invocation)
- `end()` closes the connection (call at shutdown)

## DatabaseClient

The `Database()` factory returns a frozen `DatabaseClient`:

```typescript
type DatabaseClient = {
  readonly dialect: Dialect;
  readonly pool: ConnectionPool;
  readonly logger: Logger;
  readonly hooks: Partial<QueryHooks>;
};
```

## Lifecycle Hooks

```typescript
type QueryHooks = {
  readonly beforeCompile: (ast: unknown) => void;
  readonly afterCompile: (compiled: { sql: string; params: readonly unknown[] }) => void;
  readonly beforeExecute: (compiled: { sql: string; params: readonly unknown[] }) => void;
  readonly afterExecute: (result: QueryEvent) => void;
  readonly onError: (error: DbError, context: { sql?: string; params?: readonly unknown[] }) => void;
  readonly onConnectionAcquire: (durationMs: number) => void;
  readonly onConnectionRelease: () => void;
  readonly onTransactionBegin: (isolationLevel?: string) => void;
  readonly onTransactionCommit: (durationMs: number) => void;
  readonly onTransactionRollback: (reason?: string) => void;
};
```

All hooks are optional. Provide only the ones you need.

## Shutdown

Always close the pool when your application exits:

```typescript
await db.pool.end().run();
```
