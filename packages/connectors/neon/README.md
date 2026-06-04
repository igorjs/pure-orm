# `@igorjs/pure-orm-neon`

[Neon serverless](https://neon.tech/docs/serverless/serverless-driver)
connector for [`@igorjs/pure-orm`](https://github.com/igorjs/pure-orm).
Postgres over HTTP/WebSocket — runs on Cloudflare Workers, Vercel Edge,
Deno Deploy, and Node.

| Runtime | Supported |
| --- | :--: |
| Node 22+ | ✅ |
| Deno | ✅ |
| Bun | ✅ |
| Cloudflare Workers | ✅ |

Because Neon is just managed Postgres, the existing pure-orm Postgres dialect
works unchanged — this connector only bridges `@neondatabase/serverless`
(which is API-compatible with `pg`) into the `DatabaseDriver` contract.

## Install

```bash
pnpm add @igorjs/pure-orm @igorjs/pure-orm-neon @neondatabase/serverless
```

## Usage

```ts
import { Pool } from "@neondatabase/serverless";
import { Database } from "@igorjs/pure-orm";
import { createNeonDriver } from "@igorjs/pure-orm-neon";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const db = Database({
  dialect: "postgresql",
  driver: createNeonDriver(pool),
  connection: { host: "", port: 0, database: "", user: "", password: "" },
});
```

### Cloudflare Workers

```ts
import { Pool } from "@neondatabase/serverless";
import { Database } from "@igorjs/pure-orm";
import { createNeonDriver } from "@igorjs/pure-orm-neon";

export default {
  async fetch(_req: Request, env: { DATABASE_URL: string }): Promise<Response> {
    const pool = new Pool({ connectionString: env.DATABASE_URL });
    const db = Database({
      dialect: "postgresql",
      driver: createNeonDriver(pool),
      connection: { host: "", port: 0, database: "", user: "", password: "" },
    });
    // …use db; let the Worker's request lifetime hold the pool…
    return new Response("ok");
  },
};
```

## Lifecycle

- `connect()` acquires a `PoolClient` from the user-supplied `Pool`.
- `release()` returns the client to the pool — **important on Workers**
  because each isolate has a tight connection budget.
- `end()` is a no-op: the connector does not close the `Pool` because the
  caller owns its lifetime (Workers reuse pools across requests within the
  same isolate).

## License

Apache-2.0
