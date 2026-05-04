# @igorjs/pure-orm

Functional-first, type-safe ORM built on [@igorjs/pure-fx](https://github.com/igorjs/pure-fx). Pure query composition, immutable AST, PostgreSQL and SQLite dialects, Lambda-ready connections. Zero runtime dependencies.

## Install

```bash
npm install @igorjs/pure-orm @igorjs/pure-fx
```

## Quick Start

```typescript
import { pipe } from "@igorjs/pure-fx";
import {
  Model, Field, Schema,
  from, select, where, orderBy, limit,
  eq, gt,
  execute,
} from "@igorjs/pure-orm";

// Define a model
const User = Model("users", {
  fields: {
    id: Field(Schema.string, { primaryKey: true, default: "uuid" }),
    name: Field(Schema.string),
    email: Field(Schema.string, { unique: true }),
    age: Field(Schema.number),
  },
  options: { timestamps: true },
});

// Build and execute a query
const adults = pipe(
  from(User),
  where(eq("age", 18)),
  orderBy("name", "asc"),
  limit(50),
  execute(db),
);

const result = await adults.run();
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
pipe(from(Post), select("authorId", count("id").as("cnt")), groupBy("authorId"), having(gt("cnt", 5)))

// Window functions
pipe(from(Post), select("title", rowNumber().partitionBy("authorId").orderBy("createdAt", "desc").as("rank")))

// CTEs
pipe(from(Post), withCte("recent", pipe(from(Post), where(gt("createdAt", cutoff)))), where(eq("published", true)))

// Subqueries
pipe(from(User), where(exists(pipe(from(Post), where(eq("authorId", "users.id"))))))

// Raw SQL escape hatch
raw("SELECT * FROM users WHERE id = $1", ["user-1"])
sql`SELECT * FROM users WHERE age > ${minAge}`
```

### Mutations

```typescript
// Insert
pipe(insert(User, { name: "Alice", email: "alice@example.com" }), returning("id"), execute(db))

// Upsert
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

```typescript
// Snapshot current schema
const snapshot = createSnapshot([User, Post, Comment]);

// Diff against previous snapshot
const changes = diffSnapshots(previousSnapshot, snapshot);

// Generate up/down SQL
const { up, down } = generateMigration(changes, dialect);

// Apply
await applyMigration(db, { name: "0002_add_comments", upSql: up, checksum: "..." }).run();
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

## Requirements

- Node.js >= 22
- TypeScript >= 5.5
- @igorjs/pure-fx >= 0.7.0

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, coding standards, and how to submit changes.

## Disclaimer

THIS SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES, OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT, OR OTHERWISE, ARISING FROM, OUT OF, OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## License

Apache-2.0
