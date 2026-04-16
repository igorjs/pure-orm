# Joins

Explicit SQL joins via `join()`, `leftJoin()`, `rightJoin()`, `fullJoin()` with `on()` conditions.

## on()

Creates a column-to-column equality condition for JOIN ON clauses.

```typescript
import { on } from "@igorjs/pure-orm";

// Left column from main table, right from joined table
on("authorId", "id")
// -> "posts"."author_id" = "users"."id"

// Table-qualified left column (for multi-table joins)
on("users.roleId", "id")
// -> "users"."role_id" = "roles"."id"
```

## join() / leftJoin() / rightJoin() / fullJoin()

```typescript
import { join, leftJoin, rightJoin, fullJoin, on } from "@igorjs/pure-orm";

// INNER JOIN: only rows with matches
pipe(from(Post), join(User, on("authorId", "id")))

// LEFT JOIN: all source rows, NULL for unmatched
pipe(from(Post), leftJoin(Category, on("categoryId", "id")))

// RIGHT JOIN: all joined rows, NULL for unmatched source
pipe(from(Post), rightJoin(User, on("authorId", "id")))

// FULL JOIN: all rows from both sides
pipe(from(Post), fullJoin(User, on("authorId", "id")))
```

## Multiple Joins

Joins accumulate. Each `join()` call appends to the joins array.

```typescript
pipe(
  from(Post),
  join(User, on("authorId", "id")),
  leftJoin(Category, on("categoryId", "id")),
)
// FROM "posts"
// INNER JOIN "users" ON "posts"."author_id" = "users"."id"
// LEFT JOIN "categories" ON "posts"."category_id" = "categories"."id"
```

## Multi-Table Join References

When joining a third table based on a previously joined table's column, use table-qualified names:

```typescript
pipe(
  from(Post),
  join(User, on("authorId", "id")),
  leftJoin(Role, on("users.roleId", "id")),
)
// LEFT JOIN "roles" ON "users"."role_id" = "roles"."id"
```

## SELECT with Joins

When `select("*")` (the default) is used with joins, all tables are projected:

```sql
SELECT "posts".*, "users".* FROM "posts"
INNER JOIN "users" ON "posts"."author_id" = "users"."id"
```

Use explicit `select()` to pick specific columns:

```typescript
pipe(
  from(Post),
  join(User, on("authorId", "id")),
  select("title", "body"),  // resolves from main table
)
```

## Composing with Other Builders

Joins work with all other query builders:

```typescript
pipe(
  from(Post),
  join(User, on("authorId", "id")),
  where(eq("published", true)),
  orderBy("title", "asc"),
  limit(10),
  execute(db),
)
```
