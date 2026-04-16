# Architecture

## Core Idea: Queries are Data

Every query operation produces an immutable AST (Abstract Syntax Tree) node rather than a SQL string. The AST is compiled to SQL only at execution time by the dialect layer.

```
Builder Functions -> Frozen AST Nodes -> Dialect Compilation -> SQL + Params -> Driver Execution
```

This separation enables:
- **Inspection**: print the AST to debug query construction
- **Composition**: reuse query fragments across different pipelines
- **Dialect agnosticism**: the same AST compiles to PostgreSQL or SQLite
- **Safety**: frozen objects prevent accidental mutation

## AST Node Types

| Node | Created by | Purpose |
|------|-----------|---------|
| `SelectNode` | `from()` | SELECT queries with all clauses |
| `InsertNode` | `insert()`, `insertMany()` | INSERT with RETURNING and ON CONFLICT |
| `UpdateNode` | `update()`, `restore()` | UPDATE with WHERE and RETURNING |
| `DeleteNode` | `remove()`, `hardRemove()` | DELETE or soft-delete UPDATE |
| `RawNode` | `raw()`, `` sql`...` `` | Pass-through SQL |
| `ConditionNode` | `eq()`, `gt()`, `and()`, etc. | WHERE/HAVING conditions (union of 17 variants) |
| `JoinClause` | `join()`, `leftJoin()`, etc. | JOIN with ON condition |
| `CteClause` | `withCte()` | WITH (Common Table Expression) |
| `AggregateExpr` | `count()`, `sum()`, etc. | Aggregate function call |
| `WindowExpr` | `rowNumber()`, `rank()`, etc. | Window function with OVER clause |

## SelectNode Structure

```typescript
type SelectNode = {
  readonly tag: "Select";
  readonly model: ModelRef;              // table name + column metadata
  readonly columns: SelectColumn[] | "*"; // column projection
  readonly conditions: ConditionNode[];   // WHERE conditions
  readonly joins: JoinClause[];           // JOIN clauses
  readonly ctes: CteClause[];            // WITH clauses
  readonly groupBy: string[];            // GROUP BY columns
  readonly having: ConditionNode[];       // HAVING conditions
  readonly orderBy: OrderByClause[];     // ORDER BY clauses
  readonly limit: number | null;
  readonly offset: number | null;
  readonly softDeleteFilter: boolean;     // auto-add deleted_at IS NULL
};
```

## Immutability

Every builder returns a **new frozen object**. The input is never mutated:

```typescript
const base = from(User);
const filtered = where(eq("active", true))(base);
const sorted = orderBy("name", "asc")(filtered);

// base.conditions is still []
// filtered.conditions has one condition
// sorted is a completely new object with the order clause added
```

This means query fragments are safely reusable:

```typescript
const activeUsers = pipe(from(User), where(eq("active", true)));

// Two different queries from the same base
const sorted = pipe(activeUsers, orderBy("name", "asc"));
const limited = pipe(activeUsers, limit(10));
```

## Compilation Pipeline

```
                    +-----------+
                    | SelectNode|
                    +-----------+
                         |
                    +-----------+
                    |  Dialect   |
                    +-----------+
                    /            \
        +-----------+        +-----------+
        | PostgreSQL|        |   SQLite  |
        +-----------+        +-----------+
              |                    |
     $1, $2, $3              ?, ?, ?
     ILIKE                   LIKE
     NOW()                   datetime('now')
     BOOLEAN                 INTEGER
```

### Clause Ordering

The dialect always compiles clauses in standard SQL order, regardless of the order builders were called:

```
WITH -> SELECT -> FROM -> JOIN -> WHERE -> GROUP BY -> HAVING -> ORDER BY -> LIMIT -> OFFSET
```

### Parameter Handling

- **PostgreSQL**: `$1, $2, $3` (positional with explicit index)
- **SQLite**: `?` (positional without index)

For subqueries (CTEs, EXISTS), PostgreSQL parameter indices are automatically renumbered to avoid conflicts:

```sql
-- CTE uses $1, main query continues at $2
WITH "cte" AS (SELECT ... WHERE col = $1)
SELECT ... WHERE other = $2
```

## Execution Layer

```
execute(db)(queryNode)
  -> dispatchHook("beforeCompile", node)
  -> dialect.compileSelect(node)     // or compileInsert, etc.
  -> dispatchHook("afterCompile", { sql, params })
  -> dispatchHook("beforeExecute", { sql, params })
  -> pool.acquire()
  -> conn.query(sql, params)
  -> mapRows(rows, columns)          // snake_case -> camelCase
  -> dispatchHook("afterExecute", { sql, params, rows, durationMs })
  -> pool.release(conn)              // always, even on error
  -> Result<ImmutableList<ImmutableRecord<T>>, DbError>
```

## Module Structure

```
src/
  model/         # Model, Field, relations, timestamps, soft-delete
  query/         # AST types, builders, conditions, joins, aggregates, window, CTE
  dialect/       # Dialect interface, PostgreSQL, SQLite, registry, shared compilation
  execute/       # compile(), execute(), findOne(), result mapper
  connection/    # Database factory, pool, lambda pool, transactions
  logging/       # Logger, hooks, timing
  errors/        # DbError discriminated union + smart constructors
  migration/     # Snapshot, differ, generator, runner, state table
  audit/         # Audit hooks, context, logger, table model
  index.ts       # Barrel re-exports (all public API)
```

## Dependencies

- **Runtime**: `@igorjs/pure-ts` (peer dependency)
  - `@igorjs/pure-ts/core`: Ok, Err, Result, Option, pipe, flow
  - `@igorjs/pure-ts/async`: Task
  - `@igorjs/pure-ts/data`: Schema, List, Record
- **Dev**: `@biomejs/biome` (lint/format), `@typescript/native-preview` (tsgo compiler)
- **Driver**: none (bring your own)
