# `@igorjs/pure-orm-libsql`

[libsql](https://github.com/tursodatabase/libsql) / [Turso](https://turso.tech/)
connector for [`@igorjs/pure-orm`](https://github.com/igorjs/pure-orm). One
client covers three SQLite-compatible deployments:

- **Local file** — Node, Bun, Deno
- **Turso cloud** over HTTP — Node, Bun, Deno, Cloudflare Workers
- **Embedded replica** (local file + remote sync) — Node, Bun

| Runtime | Supported |
| --- | :--: |
| Node 22+ | ✅ |
| Deno | ✅ |
| Bun | ✅ |
| Cloudflare Workers | ✅ |

## Install

```bash
pnpm add @igorjs/pure-orm @igorjs/pure-orm-libsql @libsql/client
```

## Usage

```ts
import { createClient } from "@libsql/client";
import { Database } from "@igorjs/pure-orm";
import { createLibsqlDriver } from "@igorjs/pure-orm-libsql";

// Local SQLite file:
const client = createClient({ url: "file:./data.db" });

// or Turso cloud (Cloudflare-compatible, HTTP):
// const client = createClient({
//   url: "libsql://my-db.turso.io",
//   authToken: process.env.TURSO_AUTH_TOKEN,
// });

// or embedded replica (Node/Bun): local file synced from Turso:
// const client = createClient({
//   url: "file:./local-replica.db",
//   syncUrl: "libsql://my-db.turso.io",
//   authToken: process.env.TURSO_AUTH_TOKEN,
// });

const db = Database({
  dialect: "sqlite",
  driver: createLibsqlDriver(client),
  connection: { host: "", port: 0, database: "", user: "", password: "" },
});
```

The `dialect` stays `"sqlite"` for all three deployment modes — libsql is
SQLite at the SQL level, so the existing pure-orm SQLite dialect works
unchanged.

## Lifecycle

- `connect()` returns the same handle every time (libsql owns its own
  connection pooling internally).
- `release()` is a no-op.
- `end()` closes the libsql client.

## License

Apache-2.0
