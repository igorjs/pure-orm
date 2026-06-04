# Connector packages

Each subdirectory here is a published npm package implementing the
`DriverAdapter` contract from `@igorjs/pure-orm`. Connectors keep the core at
zero runtime dependencies (only `pure-fx` as a peer) — every concrete driver
(`pg`, `mysql2`, `@libsql/client`, `@electric-sql/pglite`, …) is declared on the
connector that wraps it, never on core.

Consumers install only the connector they want:

```bash
pnpm add @igorjs/pure-orm @igorjs/pure-orm-libsql @libsql/client
```

## Convention for a new connector

A connector at `packages/connectors/<name>/` must contain:

1. **`package.json`** — name `@igorjs/pure-orm-<name>`, declares the driver as
   `dependencies` (not optional peer), declares `@igorjs/pure-orm` as a peer
   via `workspace:^`.
2. **`src/index.ts`** — exports a factory (e.g. `pgConnector(config)`,
   `libsql(config)`) that returns an object satisfying `DriverAdapter` from
   core. Resolves the matching dialect from core and bundles a
   `DatabaseClient` ready for the user.
3. **`tests/`** — at minimum a smoke test that constructs the client and runs
   one round-trip query against a real instance (or in-memory where possible).
4. **`README.md`** — install + minimal usage example.
5. **`tsconfig.json`** — extends the workspace base (TODO: add
   `tsconfig.base.json` once the capability layer lands).

## Planned connectors

| Connector | Dialect | Driver | Runtimes |
|---|---|---|---|
| `@igorjs/pure-orm-pg` | postgresql | `pg` (TCP) | Node, Deno, Bun |
| `@igorjs/pure-orm-pglite` | postgresql | `@electric-sql/pglite` (WASM) | Node, Deno, Bun, Cloudflare, Web |
| `@igorjs/pure-orm-neon` | postgresql | `@neondatabase/serverless` (HTTP) | Cloudflare |
| `@igorjs/pure-orm-mysql` | mysql | `mysql2` (TCP) | Node, Deno, Bun |
| `@igorjs/pure-orm-sqlite-better` | sqlite | `better-sqlite3` (native) | Node |
| `@igorjs/pure-orm-sqlite-node` | sqlite | `node:sqlite` (built-in) | Node 22.5+ |
| `@igorjs/pure-orm-sqlite-bun` | sqlite | `bun:sqlite` (built-in) | Bun |
| `@igorjs/pure-orm-libsql` | sqlite | `@libsql/client` | Node, Deno, Bun, Cloudflare, Web (local + Turso + embedded replicas) |
