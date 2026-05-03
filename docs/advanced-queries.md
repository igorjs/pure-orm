# Advanced Queries

## CTEs (Common Table Expressions)

`withCte()` attaches a named subquery that compiles into a SQL `WITH` clause.

```typescript
import { withCte, from, where, select, groupBy, execute } from "@igorjs/pure-orm";
import { eq, gt, count } from "@igorjs/pure-orm";
import { pipe } from "@igorjs/pure-fx/core";

// Define a CTE subquery
const activePosts = pipe(
  from(Post),
  where(eq("published", true)),
);

// Attach it to the main query
const result = await pipe(
  from(Post),
  withCte("active_posts", activePosts),
  select("authorId", count("id").as("cnt")),
  groupBy("authorId"),
  having(gt("cnt", 10)),
  execute(db),
).run();
```

Compiles to:

```sql
WITH "active_posts" AS (
  SELECT "posts".* FROM "posts" WHERE "posts"."published" = $1
)
SELECT "posts"."author_id", COUNT("posts"."id") AS "cnt"
FROM "posts"
GROUP BY "posts"."author_id"
HAVING "cnt" > $2
```

### Multiple CTEs

```typescript
pipe(
  from(User),
  withCte("recent_posts", pipe(from(Post), where(gt("createdAt", cutoff)))),
  withCte("top_authors", pipe(from(Post), select("authorId"), groupBy("authorId"))),
  execute(db),
)
// WITH "recent_posts" AS (...), "top_authors" AS (...) SELECT ...
```

### Parameter Handling

CTE parameters are numbered before the main query's parameters. The dialect handles renumbering automatically:

```sql
-- CTE params: $1 (cutoff)
-- Main params: $2 (active)
WITH "recent" AS (SELECT ... WHERE "created_at" > $1)
SELECT ... FROM "users" WHERE "active" = $2
```

## Subquery Conditions

### exists()

True if the subquery returns at least one row.

```typescript
import { exists, from, where, eq, execute } from "@igorjs/pure-orm";

pipe(
  from(User),
  where(exists(pipe(from(Post), where(eq("authorId", userId))))),
  execute(db),
)
// WHERE EXISTS (SELECT "posts".* FROM "posts" WHERE "author_id" = $1)
```

### notExists()

True if the subquery returns no rows.

```typescript
pipe(
  from(User),
  where(notExists(pipe(from(Post), where(eq("authorId", userId))))),
  execute(db),
)
// WHERE NOT EXISTS (SELECT ...)
```

### Parameter Renumbering

For PostgreSQL, subquery parameters are renumbered to avoid conflicts with the outer query:

```typescript
pipe(
  from(User),
  where(eq("active", true)),                  // $1
  where(exists(pipe(
    from(Post),
    where(eq("published", true)),              // $2 (renumbered from $1)
  ))),
  execute(db),
)
// params: [true, true]
```

SQLite uses `?` placeholders which are positional without indices, so no renumbering is needed.

## Raw SQL

### raw()

Creates a RawNode with explicit SQL and parameters. Use the dialect-appropriate placeholder style.

```typescript
import { raw, execute } from "@igorjs/pure-orm";

// PostgreSQL style
const node = raw('SELECT * FROM "users" WHERE id = $1', ["user-1"]);

// SQLite style
const node = raw("SELECT * FROM users WHERE id = ?", ["user-1"]);

await pipe(node, execute(db)).run();
```

### sql`` Tagged Template

Extracts interpolated values into parameters automatically with `?` placeholders.

```typescript
import { sql, execute } from "@igorjs/pure-orm";

const email = "alice@example.com";
const minAge = 18;

const node = sql`SELECT * FROM users WHERE email = ${email} AND age > ${minAge}`;
// sql:    "SELECT * FROM users WHERE email = ? AND age > ?"
// params: ["alice@example.com", 18]
```
