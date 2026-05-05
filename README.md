# @igorjs/pure-orm

Functional-first, type-safe ORM built on [@igorjs/pure-fx](https://github.com/igorjs/pure-fx). Pure query composition, immutable AST, PostgreSQL and SQLite dialects, Lambda-ready connections, migration CLI with locking and checksums.

![Node.js](https://img.shields.io/badge/Node.js_22+-339933?logo=nodedotjs&logoColor=white)
![Deno](https://img.shields.io/badge/Deno_2.0+-000000?logo=deno&logoColor=white)
![Bun](https://img.shields.io/badge/Bun-000000?logo=bun&logoColor=white)
![Tests](https://img.shields.io/badge/tests-935_passing-brightgreen)

## Install

```bash
npm install @igorjs/pure-orm @igorjs/pure-fx
```

Database drivers are optional peer dependencies. Install only what you need:

```bash
npm install pg                # PostgreSQL
npm install better-sqlite3    # SQLite
```

## Quick Start

```typescript
import { pipe, Schema } from "@igorjs/pure-fx";
import {
  Model, Field,
  from, select, where, orderBy, limit,
  eq, gt,
  execute, Database,
} from "@igorjs/pure-orm";

// Define a model
const User = Model("users", {
  fields: {
    id: Field(Schema.string, { primaryKey: true, default: "uuid" }),
    name: Field(Schema.string),
    email: Field(Schema.string, { unique: true }),
    age: Field(Schema.number),
  },
  options: { timestamps: true, softDelete: true },
});

// Connect
const db = Database({ dialect: "postgresql", driver, connection: config });

// Build and execute a query
const result = await pipe(
  from(User),
  where(gt("age", 18)),
  orderBy("name", "asc"),
  limit(50),
  execute(db),
).run();
```

## Features

### Query Building

Every query is an immutable AST node composed via `pipe()`. No SQL is generated until `execute()`.

```typescript
// Select with conditions
pipe(from(User), where(eq("role", "admin")), select("name", "email"))

// Joins
pipe(from(Post), join(User, on("authorId", "id")), where(eq("published", true)))

// Aggregates with groupBy
pipe(from(Post), select("authorId", count("id").as("cnt")), groupBy("authorId"))

// Window functions
pipe(from(Post), select("title", rowNumber().partitionBy("authorId").orderBy("createdAt", "desc").as("rank")))

// CTEs
pipe(from(Post), withCte("recent", pipe(from(Post), where(gt("createdAt", cutoff)))))

// Subqueries
pipe(from(User), where(exists(pipe(from(Post), where(eq("authorId", "users.id"))))))

// Raw SQL escape hatch
raw("SELECT * FROM users WHERE id = $1", ["user-1"])
sql`SELECT * FROM users WHERE age > ${minAge}`
```

### Mutations

```typescript
// Insert with returning
pipe(insert(User, { name: "Alice", email: "alice@example.com" }), returning("id"), execute(db))

// Upsert (ON CONFLICT)
pipe(insert(User, { email: "alice@example.com" }), onConflict("email", { update: ["name"] }), execute(db))

// Update
pipe(update(User, { name: "Bob" }), where(eq("id", userId)), execute(db))

// Soft delete (auto when model has softDelete: true)
pipe(remove(User), where(eq("id", userId)), execute(db))

// Hard delete (bypasses soft delete)
pipe(hardRemove(User), where(eq("id", userId)), execute(db))

// Restore soft-deleted row
pipe(restore(User), where(eq("id", userId)), execute(db))
```

### Relations

```typescript
const User = Model("users", {
  fields: { id: Field(Schema.string, { primaryKey: true }), name: Field(Schema.string) },
  relations: () => ({
    posts: hasMany(() => Post, { foreignKey: "authorId", localKey: "id" }),
    profile: hasOne(() => Profile, { foreignKey: "userId", localKey: "id" }),
  }),
});

// Eager loading (hasOne/belongsTo via LEFT JOIN)
pipe(from(Post), include(Post, "author"), execute(db))

// Lazy loading (on-demand query)
const postsQuery = lazy(User, userRecord, "posts");
pipe(postsQuery, execute(db))
```

### Soft Deletes

Models with `softDelete: true` auto-filter deleted rows.

```typescript
pipe(from(User))                        // WHERE deleted_at IS NULL (auto)
pipe(from(User), withDeleted())         // include deleted rows
pipe(from(User), onlyDeleted())         // only deleted rows
pipe(restore(User), where(eq("id", x))) // restore a soft-deleted row
```

### Transactions

```typescript
const result = await transaction(db, async (tx) => {
  await execute(tx)(insert(User, { name: "Alice" })).run();
  await execute(tx)(insert(Post, { title: "Hello", authorId: "..." })).run();
}, { isolationLevel: "serializable" }).run();
```

### Migrations

#### CLI

```bash
# Generate a migration from model changes
npx pure-orm migrate:generate create_users

# Apply all pending migrations
npx pure-orm migrate:up

# Preview SQL without executing
npx pure-orm migrate:up --dry-run

# Roll back the last migration
npx pure-orm migrate:down

# Roll back the last 3 migrations
npx pure-orm migrate:down --step 3

# Show migration status
npx pure-orm migrate:status

# Verify migration checksums
npx pure-orm migrate:validate
```

#### Configuration

Create `pure-orm.config.ts` in your project root:

```typescript
import type { PureOrmConfig } from "@igorjs/pure-orm/cli";

export const config: PureOrmConfig = {
  dialect: "postgresql",
  connection: {
    host: "localhost",
    port: 5432,
    database: "mydb",
    user: "postgres",
    password: "",
  },
  migrations: {
    directory: "migrations",
  },
  models: () => [User, Post, Comment],
};
```

#### SQL Migration Files

Migrations use `-- @up` and `-- @down` markers:

```sql
-- @up
CREATE TABLE "users" (
  "id" SERIAL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL UNIQUE
);

-- @down
DROP TABLE "users";
```

For concurrent index creation (PostgreSQL):

```sql
-- @transaction false
-- @concurrent true

-- @up
CREATE INDEX CONCURRENTLY "idx_users_email" ON "users" ("email");

-- @down
DROP INDEX "idx_users_email";
```

#### Programmatic API

```typescript
import { createSnapshot, diffSnapshots, generateMigration, executeBatch } from "@igorjs/pure-orm";

// Snapshot current schema
const snapshot = createSnapshot([User, Post, Comment]);

// Diff against previous snapshot
const changes = diffSnapshots(previousSnapshot, snapshot);

// Generate up/down SQL
const { up, down } = generateMigration(changes, dialect);

// Execute a batch with locking and checksum validation
await executeBatch(db, migrations, { dryRun: false }).run();
```

### Dialects

```typescript
import { createPostgresDialect, createSqliteDialect } from "@igorjs/pure-orm";

// PostgreSQL: $1, $2, ... params, ILIKE, NOW()
const pg = createPostgresDialect();

// SQLite: ? params, LIKE for ILIKE, datetime('now')
const sqlite = createSqliteDialect();
```

### Audit

```typescript
// Hooks-based mutation logging
const hooks = createAuditHooks({
  callback: (entry) => console.log(entry.operation, entry.tableName),
  context: { actorId: user.id },
});

// Query audit history
pipe(auditLog(User), where(eq("rowId", userId)), orderBy("createdAt", "desc"), limit(50), execute(db))
```

## Design Principles

- **Pure composition**: queries are data (immutable AST nodes), not strings
- **Dialect-agnostic AST**: SQL is generated only at execution time
- **Zero mutation**: every builder returns a new frozen object
- **Bring your own driver**: works with pg, postgres.js, better-sqlite3, etc.
- **Lambda-ready**: connection pooling designed for serverless
- **Cross-runtime**: core query builder works on Node, Deno, and Bun

## Requirements

- Node.js >= 22 (also works on Deno 2.x and Bun)
- @igorjs/pure-fx >= 0.1.0
- TypeScript >= 5.7 (optional)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, coding standards, and how to submit changes.

## Disclaimer

THIS SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES, OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT, OR OTHERWISE, ARISING FROM, OUT OF, OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## License

[Apache-2.0](LICENSE)
