# Transactions

## Basic Usage

```typescript
import { transaction, execute, insert } from "@igorjs/pure-orm";

const result = await transaction(db, async (tx) => {
  await pipe(insert(User, { name: "Alice" }), execute(tx)).run();
  await pipe(insert(Post, { title: "Hello", authorId: "..." }), execute(tx)).run();
  return "done";
}).run();

if (result.isOk) {
  console.log(result.value); // "done"
}
```

The transaction automatically:
- Sends `BEGIN` before the callback
- Sends `COMMIT` if the callback succeeds
- Sends `ROLLBACK` if the callback throws

## Isolation Levels

```typescript
await transaction(db, async (tx) => {
  // ...
}, { isolationLevel: "serializable" }).run();
// BEGIN ISOLATION LEVEL SERIALIZABLE
```

Available levels: `"serializable"`, `"repeatable read"`, `"read committed"`, `"read uncommitted"`.

## Read-Only Transactions

```typescript
await transaction(db, async (tx) => {
  return pipe(from(User), execute(tx)).run();
}, { readOnly: true }).run();
// BEGIN READ ONLY
```

## Combined Options

```typescript
await transaction(db, async (tx) => {
  // ...
}, {
  isolationLevel: "repeatable read",
  readOnly: true,
}).run();
// BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY
```

## Savepoints (Nested Transactions)

Nested `transaction()` calls use savepoints instead of `BEGIN`/`COMMIT`:

```typescript
await transaction(db, async (tx) => {
  await pipe(insert(User, { name: "Alice" }), execute(tx)).run();

  await transaction(tx, async (sp) => {
    await pipe(insert(Post, { title: "Draft" }), execute(sp)).run();
    // If this throws, only the savepoint is rolled back
  }).run();
}).run();
// BEGIN
// INSERT INTO "users" ...
// SAVEPOINT sp_1
// INSERT INTO "posts" ...
// RELEASE SAVEPOINT sp_1
// COMMIT
```

## Error Handling

Transactions return `Task<T, DbError>`. Errors are surfaced via the Result:

```typescript
const result = await transaction(db, async (tx) => {
  // ...
}).run();

if (result.isErr) {
  // result.error is a DbError (TransactionError, QueryError, etc.)
}
```

## Connection Release

The transaction always releases its connection back to the pool, even on error:

```typescript
// Connection acquired -> BEGIN -> callback -> COMMIT/ROLLBACK -> connection released
```
