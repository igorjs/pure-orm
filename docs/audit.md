# Audit

The audit system provides hooks-based mutation logging and a query helper for reading audit history.

## Audit Hooks

`createAuditHooks()` returns query lifecycle hooks that capture every mutation (INSERT, UPDATE, DELETE, SOFT_DELETE) and invoke a callback.

```typescript
import { createAuditHooks, Database } from "@igorjs/pure-orm";

const auditHooks = createAuditHooks({
  callback: (entry) => {
    console.log(`[AUDIT] ${entry.operation} on ${entry.tableName}`, {
      sql: entry.sql,
      rowCount: entry.rowCount,
      durationMs: entry.durationMs,
      actor: entry.actorId,
    });
  },
  context: {
    actorId: "system",
    actorIp: "127.0.0.1",
  },
});

const db = Database({
  dialect: "postgresql",
  driver: pgDriver,
  connection: { ... },
  hooks: auditHooks,
});
```

### AuditEntryInput

The callback receives an `AuditEntryInput`:

| Field | Type | Description |
|-------|------|-------------|
| `tableName` | `string` | Extracted from SQL (e.g., `"users"`) |
| `operation` | `AuditOperation` | `"INSERT"`, `"UPDATE"`, `"DELETE"`, `"SOFT_DELETE"`, `"RESTORE"` |
| `sql` | `string` | The executed SQL statement |
| `params` | `readonly unknown[]` | Query parameters |
| `rowCount` | `number` | Number of affected rows |
| `durationMs` | `number` | Execution time |
| `actorId` | `string \| null` | From context |
| `actorIp` | `string \| null` | From context |
| `metadata` | `Record<string, unknown> \| null` | From context |

### Operation Detection

| SQL starts with | Operation |
|----------------|-----------|
| `INSERT` | `INSERT` |
| `UPDATE ... SET "deleted_at"` | `SOFT_DELETE` |
| `UPDATE` (other) | `UPDATE` |
| `DELETE` | `DELETE` |
| `SELECT` | Ignored (no callback) |

## Per-Request Context

`withAuditContext()` creates a new DatabaseClient with actor context injected:

```typescript
import { withAuditContext } from "@igorjs/pure-orm";

// In a request handler
const requestDb = withAuditContext(db, {
  actorId: currentUser.id,
  actorIp: request.ip,
  metadata: { requestId: request.id },
});

// All mutations via requestDb carry this context
await pipe(insert(User, { name: "Alice" }), execute(requestDb)).run();
```

## Querying Audit Logs

`auditLog(Model)` creates a SelectNode for the `_pure_orm_audit` table, pre-filtered by the model's table name.

```typescript
import { auditLog, where, orderBy, limit, execute } from "@igorjs/pure-orm";
import { eq } from "@igorjs/pure-orm";

const history = await pipe(
  auditLog(User),
  where(eq("rowId", userId)),
  orderBy("createdAt", "desc"),
  limit(50),
  execute(db),
).run();
```

Compiles to:

```sql
SELECT "_pure_orm_audit".* FROM "_pure_orm_audit"
WHERE "table_name" = $1 AND "row_id" = $2
ORDER BY "created_at" DESC LIMIT $3
```

## Audit Table Schema

Create the `_pure_orm_audit` table in your database:

```sql
CREATE TABLE _pure_orm_audit (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name    TEXT NOT NULL,
  operation     TEXT NOT NULL,
  row_id        TEXT NOT NULL,
  old_data      JSONB,
  new_data      JSONB,
  changed_fields TEXT[],
  actor_id      TEXT,
  actor_ip      TEXT,
  metadata      JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_table_name ON _pure_orm_audit (table_name);
CREATE INDEX idx_audit_row_id ON _pure_orm_audit (row_id);
CREATE INDEX idx_audit_created_at ON _pure_orm_audit (created_at);
```

## Writing Audit Entries to the Database

Combine `createAuditHooks` with `insert()` to persist audit entries:

```typescript
const auditHooks = createAuditHooks({
  callback: async (entry) => {
    // Use a separate connection to avoid transaction conflicts
    await pipe(
      insert(AuditModel, {
        tableName: entry.tableName,
        operation: entry.operation,
        rowId: "unknown",  // extract from params if needed
        actorId: entry.actorId,
        actorIp: entry.actorIp,
        metadata: JSON.stringify(entry.metadata),
      }),
      execute(auditDb),
    ).run();
  },
});
```
