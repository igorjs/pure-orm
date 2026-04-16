# Dialects

Dialects abstract SQL generation so the core ORM is database-agnostic. Each dialect knows how to compile AST nodes into its SQL flavour.

## Built-in Dialects

### PostgreSQL

```typescript
import { createPostgresDialect } from "@igorjs/pure-orm";

const pg = createPostgresDialect();
pg.name;  // "postgresql"
```

| Feature | PostgreSQL |
|---------|-----------|
| Parameters | `$1`, `$2`, `$3` |
| Case-insensitive LIKE | `ILIKE` |
| Current timestamp | `NOW()` |
| Boolean type | `BOOLEAN` |
| Number type | `INTEGER` |

### SQLite

```typescript
import { createSqliteDialect } from "@igorjs/pure-orm";

const sqlite = createSqliteDialect();
sqlite.name;  // "sqlite"
```

| Feature | SQLite |
|---------|--------|
| Parameters | `?` |
| Case-insensitive LIKE | `LIKE` (ASCII case-insensitive by default) |
| Current timestamp | `datetime('now')` |
| Boolean type | `INTEGER` (0/1) |
| Number type | `REAL` |

## Using Dialects

### Via Database Factory

```typescript
const db = Database({
  dialect: "postgresql",  // or "sqlite"
  driver: myDriver,
  connection: { ... },
});
```

The dialect is resolved lazily from the registry on first use.

### Direct Compilation

```typescript
const dialect = createPostgresDialect();
const { sql, params } = dialect.compileSelect(queryNode);
```

## Custom Dialects

Register a custom dialect for the Database factory:

```typescript
import { registerDialect } from "@igorjs/pure-orm";
import type { Dialect } from "@igorjs/pure-orm";

const myDialect: Dialect = {
  name: "mysql",
  compileSelect: (node) => { /* ... */ },
  compileInsert: (node) => { /* ... */ },
  compileUpdate: (node) => { /* ... */ },
  compileDelete: (node) => { /* ... */ },
  param: (index) => `?`,
  quote: (id) => `\`${id}\``,
  mapFieldType: (type, config) => { /* ... */ },
};

registerDialect("mysql", myDialect);

// Now usable via Database factory
const db = Database({ dialect: "mysql", ... });
```

## Dialect Interface

```typescript
type Dialect = {
  readonly name: string;
  readonly compileSelect: (node: SelectNode) => CompiledQuery;
  readonly compileInsert: (node: InsertNode) => CompiledQuery;
  readonly compileUpdate: (node: UpdateNode) => CompiledQuery;
  readonly compileDelete: (node: DeleteNode) => CompiledQuery;
  readonly param: (index: number) => string;
  readonly quote: (identifier: string) => string;
  readonly mapFieldType: (schemaType: string, config: Readonly<FieldConfig>) => string;
};
```

## Tree-Shaking

Dialects are instantiated lazily. If you import `createPostgresDialect` directly, the SQLite dialect code is never pulled into your bundle (and vice versa). The `resolveDialect()` registry instantiates a dialect only on first call.
