# Getting Started

## Installation

```bash
npm install @igorjs/pure-orm @igorjs/pure-fx
```

Both packages use tree-shakable subpath exports. Import only what you need:

```typescript
import { Model, Field } from "@igorjs/pure-orm";
import { Schema } from "@igorjs/pure-fx/data";
import { pipe } from "@igorjs/pure-fx/core";
```

## Define a Model

A Model maps a TypeScript type to a database table. Fields define columns with schema validation and ORM metadata.

```typescript
import { Schema } from "@igorjs/pure-fx/data";
import { Model, Field } from "@igorjs/pure-orm";

const User = Model("users", {
  fields: {
    id: Field(Schema.string, { primaryKey: true, default: "uuid" }),
    name: Field(Schema.string),
    email: Field(Schema.string, { unique: true }),
    age: Field(Schema.number.optional()),
    active: Field(Schema.boolean, { default: "true" }),
  },
  options: {
    timestamps: true,   // adds createdAt, updatedAt columns
    softDelete: true,   // adds deletedAt column, auto-filters deleted rows
  },
});
```

## Build a Query

Queries are built by composing pure functions via `pipe()`. No SQL is generated until execution.

```typescript
import { pipe } from "@igorjs/pure-fx/core";
import { from, where, orderBy, limit, execute } from "@igorjs/pure-orm";
import { eq, gt } from "@igorjs/pure-orm";

const query = pipe(
  from(User),
  where(eq("active", true)),
  where(gt("age", 18)),
  orderBy("name", "asc"),
  limit(50),
);
```

## Inspect the SQL

Use `compile()` to see what SQL would be generated without executing:

```typescript
import { compile, createPostgresDialect } from "@igorjs/pure-orm";

const dialect = createPostgresDialect();
const { sql, params } = dialect.compileSelect(query);

// sql:    SELECT "users".* FROM "users" WHERE "users"."active" = $1
//         AND "users"."age" > $2 AND "users"."deleted_at" IS NULL
//         ORDER BY "users"."name" ASC LIMIT $3
// params: [true, 18, 50]
```

## Execute Against a Database

Connect to a database and execute the query:

```typescript
import { Database, execute } from "@igorjs/pure-orm";

const db = Database({
  dialect: "postgresql",
  driver: pgDriver,  // bring your own: pg, postgres.js, etc.
  connection: {
    host: "localhost",
    port: 5432,
    database: "myapp",
    user: "postgres",
    password: "secret",
  },
});

const result = await pipe(
  from(User),
  where(eq("active", true)),
  execute(db),
).run();

if (result.isOk) {
  const users = result.value;  // ImmutableList<ImmutableRecord<User>>
}
```

## Next Steps

- [Models & Fields](./models.md): field types, column names, options
- [Queries](./queries.md): full query builder API
- [Mutations](./mutations.md): insert, update, delete
- [Relations](./relations.md): hasOne, hasMany, joins
