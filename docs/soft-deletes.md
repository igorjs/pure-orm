# Soft Deletes

Models with `softDelete: true` automatically filter out deleted rows and convert `DELETE` operations to `UPDATE SET deleted_at = NOW()`.

## Setup

```typescript
const User = Model("users", {
  fields: {
    id: Field(Schema.string, { primaryKey: true, default: "uuid" }),
    name: Field(Schema.string),
    email: Field(Schema.string, { unique: true }),
  },
  options: { softDelete: true },
});
```

This automatically appends a `deletedAt` (`deleted_at`) column to the model metadata.

## Default Behaviour

All `from()` queries auto-filter deleted rows:

```typescript
pipe(from(User), execute(db))
// SELECT "users".* FROM "users" WHERE "users"."deleted_at" IS NULL
```

`remove()` emits a soft delete instead of a hard delete:

```typescript
pipe(remove(User), where(eq("id", userId)), execute(db))
// UPDATE "users" SET "deleted_at" = NOW() WHERE "users"."deleted_at" IS NULL AND "id" = $1
```

## withDeleted()

Include soft-deleted rows in results:

```typescript
import { withDeleted } from "@igorjs/pure-orm";

pipe(from(User), withDeleted(), execute(db))
// SELECT "users".* FROM "users"  (no deleted_at filter)
```

## onlyDeleted()

Query only soft-deleted rows:

```typescript
import { onlyDeleted } from "@igorjs/pure-orm";

pipe(from(User), onlyDeleted(), execute(db))
// SELECT "users".* FROM "users" WHERE "users"."deleted_at" IS NOT NULL
```

## restore()

Restore a soft-deleted row by clearing `deletedAt`:

```typescript
import { restore } from "@igorjs/pure-orm";

pipe(restore(User), where(eq("id", userId)), execute(db))
// UPDATE "users" SET "deleted_at" = $1 WHERE "deleted_at" IS NOT NULL AND "id" = $2
// params: [null, userId]
```

## hardRemove()

Permanently delete a row, bypassing soft delete:

```typescript
import { hardRemove } from "@igorjs/pure-orm";

pipe(hardRemove(User), where(eq("id", userId)), execute(db))
// DELETE FROM "users" WHERE "id" = $1
```
