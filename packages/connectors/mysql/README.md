# `@igorjs/pure-orm-mysql`

MySQL / MariaDB connector for
[`@igorjs/pure-orm`](https://github.com/igorjs/pure-orm), backed by
[`mysql2`](https://github.com/sidorares/node-mysql2).

| Runtime | Supported |
| --- | :--: |
| Node 22+ | ✅ |
| Deno 2.x (node compat) | ✅ |
| Bun | ✅ |

Targets **both MySQL and MariaDB** — the dialect declares MySQL semantics and
MariaDB is wire-compatible at this level. Both are registered under
`"mysql"` / `"mariadb"` in the core dialect registry.

## Install

```bash
pnpm add @igorjs/pure-orm @igorjs/pure-orm-mysql
```

## Usage

```ts
import { Database } from "@igorjs/pure-orm";
import { createMysqlDriver } from "@igorjs/pure-orm-mysql";

const db = Database({
  dialect: "mysql",  // or "mariadb" — same dialect
  driver: createMysqlDriver(),
  connection: {
    host: "localhost",
    port: 3306,
    database: "myapp",
    user: "root",
    password: "secret",
  },
});
```

## Dialect notes

- Identifiers are **backtick-quoted** (the MySQL convention).
- Parameters use `?` placeholders.
- Type mapping: `string` → `VARCHAR(255)`, `number` → `BIGINT`,
  `boolean` → `TINYINT(1)`, `date` → `DATETIME`.
- `ILIKE` compiles to `LIKE` because MySQL's default collations are
  case-insensitive for ASCII letters.
- Upsert syntax is `ON DUPLICATE KEY UPDATE` (declared via the capability
  layer; emitted by the shared mutation compiler in a follow-up).
- `RETURNING` is conservatively declared **unsupported**. MariaDB 10.5+ and
  MySQL 8.0.21+ do support a restricted form — a future revision of this
  connector can detect the server version and lift the capability.
- DDL is **not transactional** on MySQL; the migration runner branches on
  the capability to use lock-table-style locks instead of advisory locks.

## License

Apache-2.0
