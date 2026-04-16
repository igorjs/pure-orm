# Conditions

Condition builders create frozen `ConditionNode` AST nodes. They are used with `where()` and `having()`.

## Comparison

```typescript
import { eq, ne, gt, gte, lt, lte } from "@igorjs/pure-orm";

eq("role", "admin")      // "role" = $1
ne("status", "banned")   // "status" != $1
gt("age", 18)            // "age" > $1
gte("score", 90)         // "score" >= $1
lt("price", 100)         // "price" < $1
lte("quantity", 0)       // "quantity" <= $1
```

## Pattern Matching

```typescript
import { like, ilike } from "@igorjs/pure-orm";

like("name", "A%")       // "name" LIKE $1
ilike("email", "%@example.com")  // "email" ILIKE $1 (PG) / LIKE $1 (SQLite)
```

`ilike` compiles to `ILIKE` on PostgreSQL and `LIKE` on SQLite (SQLite LIKE is case-insensitive for ASCII by default).

## Null Checks

```typescript
import { isNull, isNotNull } from "@igorjs/pure-orm";

isNull("deletedAt")      // "deleted_at" IS NULL
isNotNull("verifiedAt")  // "verified_at" IS NOT NULL
```

## Range

```typescript
import { between, inArray } from "@igorjs/pure-orm";

between("age", 18, 65)           // "age" BETWEEN $1 AND $2
inArray("role", ["admin", "mod"]) // "role" IN ($1, $2)
```

`inArray` with an empty array compiles to `FALSE` (no matches).

## Logical Combinators

```typescript
import { and, or, not } from "@igorjs/pure-orm";

// AND: explicit grouping (where() already uses AND semantics)
and(eq("active", true), gt("age", 18))
// ("active" = $1 AND "age" > $2)

// OR: at least one condition
or(eq("role", "admin"), eq("role", "moderator"))
// ("role" = $1 OR "role" = $2)

// NOT: negate a condition
not(eq("banned", true))
// NOT ("banned" = $1)
```

## Subquery Conditions

```typescript
import { exists, notExists } from "@igorjs/pure-orm";

// EXISTS: true if subquery returns any rows
where(exists(pipe(from(Post), where(eq("authorId", userId)))))
// WHERE EXISTS (SELECT "posts".* FROM "posts" WHERE "author_id" = $1)

// NOT EXISTS: true if subquery returns no rows
where(notExists(pipe(from(Comment), where(eq("postId", postId)))))
// WHERE NOT EXISTS (SELECT ...)
```

## Composing Complex Conditions

```typescript
pipe(
  from(User),
  where(
    or(
      and(eq("role", "admin"), gt("age", 21)),
      and(eq("role", "moderator"), isNotNull("verifiedAt")),
    )
  ),
)
// WHERE (("role" = $1 AND "age" > $2) OR ("role" = $3 AND "verified_at" IS NOT NULL))
```
