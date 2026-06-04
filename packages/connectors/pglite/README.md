# `@igorjs/pure-orm-pglite`

[PGlite](https://github.com/electric-sql/pglite) connector for
[`@igorjs/pure-orm`](https://github.com/igorjs/pure-orm). PGlite is Postgres
compiled to WebAssembly — same dialect, **every JS runtime**.

| Runtime | Supported |
| --- | :--: |
| Node 22+ | ✅ |
| Deno | ✅ |
| Bun | ✅ |
| Cloudflare Workers | ✅ |
| Browser | ✅ |

The same `@igorjs/pure-orm` code runs unchanged across the matrix; PGlite is
the only connector that delivers the **Web** column.

## Install

```bash
pnpm add @igorjs/pure-orm @igorjs/pure-orm-pglite @electric-sql/pglite
```

## Usage

```ts
import { PGlite } from "@electric-sql/pglite";
import { Database } from "@igorjs/pure-orm";
import { createPgliteDriver } from "@igorjs/pure-orm-pglite";

// In-memory — fast, ephemeral, perfect for tests
const pglite = new PGlite();

// or file-backed (Node/Bun):
//   const pglite = new PGlite("file://./data");
// or IndexedDB-backed (browser):
//   const pglite = new PGlite("idb://my-app");

const db = Database({
  dialect: "postgresql",
  driver: createPgliteDriver(pglite),
  // PGlite is single-process; connection fields are required by the core
  // type but unused — supply empty strings/zeros:
  connection: { host: "", port: 0, database: "", user: "", password: "" },
});
```

## Why this is interesting

PGlite is a real Postgres (everything that uses the Postgres wire protocol
and SQL grammar — including extensions like `pgvector` — works). For
applications that want:

- **Offline-first web apps** with the same schema as the production server.
- **CI/test databases** that spin up in milliseconds.
- **Cloudflare Workers** without a managed Postgres.

…this connector is the easiest path because the core ORM doesn't change.

## Lifecycle

PGlite is a single in-process database, not a pool. The connector wraps the
shared instance so the core's pool/lambda abstractions work uniformly:

- `connect()` returns the same handle every time.
- `release()` is a no-op (no pool to return to).
- `end()` closes the underlying WASM instance.

The caller owns the PGlite lifecycle — you can share one PGlite across
multiple consumers in your application.

## License

Apache-2.0
