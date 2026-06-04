# `@igorjs/pure-orm-pg`

PostgreSQL connector for [`@igorjs/pure-orm`](https://github.com/igorjs/pure-orm),
backed by the [`pg`](https://node-postgres.com/) (node-postgres) driver.

The core ORM has zero runtime dependencies (only `@igorjs/pure-fx` as a peer);
this connector owns the `pg` dependency so you install only the driver you want.

## Install

```bash
pnpm add @igorjs/pure-orm @igorjs/pure-orm-pg
```

## Usage

```ts
import { Database } from "@igorjs/pure-orm";
import { createPgDriver } from "@igorjs/pure-orm-pg";

const db = Database({
  dialect: "postgresql",
  driver: createPgDriver(),
  connection: {
    host: "localhost",
    port: 5432,
    database: "myapp",
    user: "postgres",
    password: "secret",
  },
});
```

The connector implements `DatabaseDriver` and `RawConnection` from
`@igorjs/pure-orm` — its only job is to bridge `pg.Client` into those
interfaces so the core can run unchanged on top of node-postgres. Pooling,
transactions, retries, and observability are all handled by the core; this
package is intentionally minimal.

## Runtimes

| Runtime | Supported |
| --- | :--: |
| Node 22+ | ✅ |
| Deno 2.x (with `node:` compat) | ✅ |
| Bun (latest) | ✅ |

For serverless/edge Postgres (Cloudflare Workers), use
`@igorjs/pure-orm-neon` (HTTP) or `@igorjs/pure-orm-pglite` (WASM) instead —
this connector requires a TCP socket.

## License

Apache-2.0
