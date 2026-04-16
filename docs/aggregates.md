# Aggregates & Window Functions

## Aggregate Functions

Aggregate expressions are passed to `select()` alongside plain column names. Each has a chainable `.as()` method for aliasing.

```typescript
import { count, sum, avg, min, max } from "@igorjs/pure-orm";

count()           // COUNT(*)
count("id")       // COUNT("posts"."id")
count("id").as("total")  // COUNT("posts"."id") AS "total"

sum("views")      // SUM("posts"."views")
avg("views")      // AVG("posts"."views")
min("price")      // MIN("products"."price")
max("price")      // MAX("products"."price")
```

### Full Aggregate Pipeline

```typescript
pipe(
  from(Post),
  select("authorId", count("id").as("postCount"), avg("views").as("avgViews")),
  groupBy("authorId"),
  having(gt("postCount", 5)),
  orderBy("authorId", "asc"),
  execute(db),
)
```

Compiles to:

```sql
SELECT "posts"."author_id", COUNT("posts"."id") AS "postCount",
       AVG("posts"."views") AS "avgViews"
FROM "posts"
GROUP BY "posts"."author_id"
HAVING "postCount" > $1
ORDER BY "posts"."author_id" ASC
```

### Immutability

`.as()` returns a new aggregate expression. The original is never mutated:

```typescript
const total = count("id");
const aliased = total.as("cnt");

total.alias   // null (unchanged)
aliased.alias // "cnt"
```

## Window Functions

Window functions compute a value across a set of rows related to the current row without collapsing rows (unlike aggregates).

```typescript
import { rowNumber, rank, denseRank } from "@igorjs/pure-orm";
```

### rowNumber()

```typescript
rowNumber()
  .partitionBy("authorId")
  .orderBy("createdAt", "desc")
  .as("rank")
```

Compiles to:

```sql
ROW_NUMBER() OVER (PARTITION BY "posts"."author_id" ORDER BY "posts"."created_at" DESC) AS "rank"
```

### rank() / denseRank()

```typescript
rank().orderBy("views", "desc").as("r")
// RANK() OVER (ORDER BY "posts"."views" DESC) AS "r"

denseRank().partitionBy("categoryId").orderBy("views", "desc").as("dr")
// DENSE_RANK() OVER (PARTITION BY "category_id" ORDER BY "views" DESC) AS "dr"
```

### Chainable Builder

All methods return a new frozen builder. Order of calls doesn't matter:

```typescript
const w = rowNumber()
  .partitionBy("authorId")
  .partitionBy("categoryId")  // accumulates
  .orderBy("createdAt", "desc")
  .orderBy("id", "asc")       // accumulates
  .as("rn");
```

### Mixing with Regular Columns

```typescript
pipe(
  from(Post),
  select(
    "title",
    "authorId",
    rowNumber().partitionBy("authorId").orderBy("createdAt", "desc").as("rn"),
    count("id").as("total"),
  ),
  groupBy("authorId", "title"),
  execute(db),
)
```
