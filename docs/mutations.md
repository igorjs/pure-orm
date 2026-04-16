# Mutations

Mutation builders create `InsertNode`, `UpdateNode`, or `DeleteNode` AST nodes. They compose with `where()`, `returning()`, and `onConflict()`.

## insert()

Creates an InsertNode for a single row.

```typescript
import { insert, returning, execute } from "@igorjs/pure-orm";

const result = await pipe(
  insert(User, { name: "Alice", email: "alice@example.com" }),
  returning("id", "email"),
  execute(db),
).run();
// INSERT INTO "users" ("name", "email") VALUES ($1, $2) RETURNING "id", "email"
```

## insertMany()

Creates an InsertNode for multiple rows.

```typescript
import { insertMany, execute } from "@igorjs/pure-orm";

await pipe(
  insertMany(User, [
    { name: "Alice", email: "alice@example.com" },
    { name: "Bob", email: "bob@example.com" },
  ]),
  execute(db),
).run();
// INSERT INTO "users" ("name", "email") VALUES ($1, $2), ($3, $4)
```

## update()

Creates an UpdateNode. Always pair with `where()` to target specific rows.

```typescript
import { update, where, returning, execute } from "@igorjs/pure-orm";
import { eq } from "@igorjs/pure-orm";

await pipe(
  update(User, { name: "Bob", email: "bob@new.com" }),
  where(eq("id", userId)),
  returning("*"),
  execute(db),
).run();
// UPDATE "users" SET "name" = $1, "email" = $2 WHERE "id" = $3 RETURNING *
```

## remove()

Creates a DeleteNode. Respects soft delete: if the model has `softDelete: true`, emits `UPDATE SET deleted_at = NOW()` instead of `DELETE`.

```typescript
import { remove, where, execute } from "@igorjs/pure-orm";

// Soft delete (model has softDelete: true)
await pipe(remove(User), where(eq("id", userId)), execute(db)).run();
// UPDATE "users" SET "deleted_at" = NOW() WHERE "id" = $1 AND "deleted_at" IS NULL

// Hard delete (model without softDelete, or use hardRemove)
await pipe(remove(HardModel), where(eq("id", id)), execute(db)).run();
// DELETE FROM "hard_models" WHERE "id" = $1
```

## hardRemove()

Always performs a physical DELETE, even on soft-delete models.

```typescript
import { hardRemove, where, execute } from "@igorjs/pure-orm";

await pipe(hardRemove(User), where(eq("id", userId)), execute(db)).run();
// DELETE FROM "users" WHERE "id" = $1
```

## returning()

Sets the RETURNING clause on any mutation. Call with no arguments or `"*"` for all columns.

```typescript
returning()             // RETURNING *
returning("*")          // RETURNING *
returning("id", "name") // RETURNING "id", "name"
```

## onConflict()

Adds an ON CONFLICT (upsert) clause to an InsertNode.

```typescript
import { insert, onConflict, execute } from "@igorjs/pure-orm";

// DO NOTHING on conflict
await pipe(
  insert(User, { email: "alice@example.com", name: "Alice" }),
  onConflict("email", "nothing"),
  execute(db),
).run();
// ON CONFLICT ("email") DO NOTHING

// DO UPDATE on conflict (upsert)
await pipe(
  insert(User, { email: "alice@example.com", name: "Alice Updated" }),
  onConflict("email", { update: ["name"] }),
  execute(db),
).run();
// ON CONFLICT ("email") DO UPDATE SET "name" = EXCLUDED."name"
```

## restore()

Restores a soft-deleted row by setting `deletedAt` to null. Only targets rows where `deleted_at IS NOT NULL`.

```typescript
import { restore, where, execute } from "@igorjs/pure-orm";

await pipe(restore(User), where(eq("id", userId)), execute(db)).run();
// UPDATE "users" SET "deleted_at" = $1 WHERE "deleted_at" IS NOT NULL AND "id" = $2
// params: [null, userId]
```
