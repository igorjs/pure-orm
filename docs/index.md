# @igorjs/pure-orm Documentation

Functional-first, type-safe ORM built on [@igorjs/pure-fx](https://github.com/igorjs/pure-fx). Pure query composition via immutable AST nodes, PostgreSQL and SQLite dialects, Lambda-ready connections.

## Guides

| Guide | Description |
|-------|-------------|
| [Getting Started](./getting-started.md) | Installation, first model, first query |
| [Models & Fields](./models.md) | Defining tables, field types, options, timestamps |
| [Queries](./queries.md) | from, select, where, orderBy, limit, offset |
| [Conditions](./conditions.md) | eq, ne, gt, lt, like, ilike, isNull, between, and, or, not |
| [Joins](./joins.md) | join, leftJoin, rightJoin, fullJoin, on |
| [Mutations](./mutations.md) | insert, update, remove, hardRemove, returning, onConflict |
| [Relations](./relations.md) | hasOne, hasMany, belongsTo, manyToMany, include, lazy |
| [Aggregates & Window Functions](./aggregates.md) | count, sum, avg, min, max, rowNumber, rank, denseRank |
| [Advanced Queries](./advanced-queries.md) | groupBy, having, CTEs, subqueries, raw SQL |
| [Soft Deletes](./soft-deletes.md) | withDeleted, onlyDeleted, restore |
| [Transactions](./transactions.md) | transaction, savepoints, isolation levels |
| [Dialects](./dialects.md) | PostgreSQL, SQLite, custom dialects |
| [Migrations](./migrations.md) | Snapshots, diffing, SQL generation, runner |
| [Audit](./audit.md) | Audit hooks, context, audit log queries |
| [Connections](./connections.md) | Database factory, pools, Lambda mode |
| [Architecture](./architecture.md) | AST design, immutability, compilation pipeline |

## Design Principles

- **Pure composition**: queries are immutable AST nodes, not mutable builders
- **Dialect-agnostic**: SQL is generated only at execution time by the dialect layer
- **Zero mutation**: every builder returns a new frozen object
- **Bring your own driver**: works with pg, postgres.js, better-sqlite3, etc.
- **Tree-shakable**: subpath imports, no top-level side effects, `sideEffects: false`
- **Lambda-ready**: connection pooling designed for serverless environments

## Requirements

- Node.js >= 22
- TypeScript >= 5.5
- @igorjs/pure-fx >= 0.7.4
