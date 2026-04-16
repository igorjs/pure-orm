# Queries

All query builders are pure functions that accept a `SelectNode` and return a new frozen `SelectNode`. They compose naturally with `pipe()`.

## from()

Entry point: lifts a Model into an initial SelectNode.

```typescript
import { from } from "@igorjs/pure-orm";

const query = from(User);
// SelectNode with columns: "*", conditions: [], joins: [], etc.
```

If the model has `softDelete: true`, `from()` automatically sets `softDeleteFilter: true`, which adds `WHERE deleted_at IS NULL` at compilation time.

## select()

Replaces the column projection. Accepts plain field names, aggregate expressions, and window functions.

```typescript
import { from, select } from "@igorjs/pure-orm";
import { count } from "@igorjs/pure-orm";

// Specific columns
pipe(from(User), select("name", "email"))

// With aggregates
pipe(from(Post), select("authorId", count("id").as("postCount")))

// Default is "*" (all columns)
pipe(from(User))  // SELECT "users".*
```

## where()

Appends a condition (AND semantics). Multiple `where()` calls accumulate.

```typescript
import { from, where } from "@igorjs/pure-orm";
import { eq, gt, like } from "@igorjs/pure-orm";

pipe(
  from(User),
  where(eq("role", "admin")),
  where(gt("age", 21)),
  where(like("name", "A%")),
)
// WHERE "role" = $1 AND "age" > $2 AND "name" LIKE $3
```

See [Conditions](./conditions.md) for the full list of condition builders.

## orderBy()

Appends an ORDER BY clause. Multiple calls accumulate in order.

```typescript
pipe(
  from(User),
  orderBy("name", "asc"),
  orderBy("createdAt", "desc"),
)
// ORDER BY "name" ASC, "created_at" DESC
```

## limit() / offset()

Sets pagination. Last call wins (overwrites previous value).

```typescript
pipe(
  from(User),
  limit(20),
  offset(40),
)
// LIMIT $1 OFFSET $2  (params: [20, 40])
```

## groupBy()

Appends columns to GROUP BY. Multiple calls accumulate.

```typescript
pipe(
  from(Post),
  select("authorId", count("id").as("cnt")),
  groupBy("authorId"),
)
// GROUP BY "posts"."author_id"
```

## having()

Appends HAVING conditions (AND semantics). Used after `groupBy()`.

```typescript
pipe(
  from(Post),
  select("authorId", count("id").as("cnt")),
  groupBy("authorId"),
  having(gt("cnt", 5)),
)
// HAVING "cnt" > $1
```

## Execution

### execute()

Terminal stage: runs the query and returns all rows.

```typescript
import { execute } from "@igorjs/pure-orm";

const result = await pipe(
  from(User),
  where(eq("active", true)),
  execute(db),
).run();
// Result<ImmutableList<ImmutableRecord<T>>, DbError>
```

### findOne()

Terminal stage: returns the first row or None.

```typescript
import { findOne } from "@igorjs/pure-orm";

const result = await pipe(
  from(User),
  where(eq("id", userId)),
  findOne(db),
).run();
// Result<Option<ImmutableRecord<T>>, DbError>
```

### compile()

Inspects the SQL without executing. Useful for debugging.

```typescript
import { compile } from "@igorjs/pure-orm";

const { sql, params } = compile(query, "postgresql");
```

## Clause Ordering

The dialect compiles clauses in standard SQL order:

```
WITH (CTEs)
SELECT
FROM
JOIN
WHERE
GROUP BY
HAVING
ORDER BY
LIMIT
OFFSET
```

The order you call builders in the pipe doesn't matter: the AST captures semantics, not syntax.
