# Migrations

The migration system has three layers: **snapshots** (serialise models), **differ** (detect changes), and **generator** (produce SQL). The **runner** applies migrations to a database.

## Pipeline

```
Models[] -> createSnapshot() -> SchemaSnapshot
                                     |
previousSnapshot + currentSnapshot -> diffSnapshots() -> ChangeOperation[]
                                                              |
                                             generateMigration(ops, dialect) -> { up, down }
                                                              |
                                             applyMigration(db, { name, upSql, checksum })
```

## 1. Create a Snapshot

A snapshot is a dialect-agnostic JSON representation of your schema at a point in time.

```typescript
import { createSnapshot } from "@igorjs/pure-orm";

const snapshot = createSnapshot([User, Post, Comment, Tag]);
```

Output:

```json
{
  "version": 1,
  "generatedAt": "2026-04-14T12:00:00.000Z",
  "tables": {
    "users": {
      "columns": {
        "id": { "type": "string", "primaryKey": true, "nullable": false, "unique": false, "default": "uuid", "index": false },
        "name": { "type": "string", "primaryKey": false, "nullable": false, "unique": false, "default": null, "index": false },
        "email": { "type": "string", "primaryKey": false, "nullable": false, "unique": true, "default": null, "index": false }
      },
      "indexes": [
        { "name": "users_email_unique", "columns": ["email"], "unique": true }
      ],
      "foreignKeys": []
    }
  }
}
```

### Save Snapshots to Disk

```typescript
import { writeFileSync } from "node:fs";

const snapshot = createSnapshot([User, Post]);
writeFileSync(
  `migrations/snapshots/${Date.now()}.json`,
  JSON.stringify(snapshot, null, 2),
);
```

## 2. Diff Snapshots

Compare two snapshots to detect changes:

```typescript
import { diffSnapshots } from "@igorjs/pure-orm";

const previous = JSON.parse(readFileSync("migrations/snapshots/previous.json", "utf8"));
const current = createSnapshot([User, Post, Comment]);

const changes = diffSnapshots(previous, current);
```

### Detected Changes

| Operation | Description |
|-----------|-------------|
| `CreateTable` | New table in current, absent in previous |
| `DropTable` | Table in previous, absent in current |
| `AddColumn` | New column in existing table |
| `DropColumn` | Column removed from existing table |
| `AlterColumn` | Column type, nullability, default, or unique changed |
| `AddIndex` | New index |
| `DropIndex` | Index removed |

## 3. Generate SQL

Convert changes into dialect-specific up/down DDL:

```typescript
import { generateMigration, createPostgresDialect } from "@igorjs/pure-orm";

const dialect = createPostgresDialect();
const { up, down } = generateMigration(changes, dialect);

console.log(up);
// CREATE TABLE "comments" (
//   "id" TEXT PRIMARY KEY,
//   "body" TEXT NOT NULL,
//   "post_id" TEXT NOT NULL
// );

console.log(down);
// DROP TABLE "comments";
```

### Save Migration Files

```typescript
import { writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";

const name = `${Date.now()}_add_comments`;
const dir = `migrations/${name}`;
mkdirSync(dir, { recursive: true });

writeFileSync(`${dir}/up.sql`, up);
writeFileSync(`${dir}/down.sql`, down);
writeFileSync(`${dir}/snapshot.json`, JSON.stringify(current, null, 2));

const checksum = createHash("sha256").update(up).digest("hex").slice(0, 16);
writeFileSync(`${dir}/meta.json`, JSON.stringify({ name, checksum }));
```

## 4. Apply Migrations

### Ensure State Table

```typescript
import { ensureMigrationTable, applyMigration } from "@igorjs/pure-orm";

// Create _pure_orm_migrations if it doesn't exist (idempotent)
await ensureMigrationTable(db).run();
```

### Apply a Migration

```typescript
const result = await applyMigration(db, {
  name: "1713100000000_add_comments",
  upSql: up,
  checksum: "a1b2c3d4e5f6g7h8",
}).run();

if (result.isErr) {
  console.error("Migration failed:", result.error);
}
```

### Rollback a Migration

```typescript
import { rollbackMigration } from "@igorjs/pure-orm";

await rollbackMigration(db, {
  name: "1713100000000_add_comments",
  downSql: down,
}).run();
```

### Check Migration Status

```typescript
import { getMigrationStatus } from "@igorjs/pure-orm";

const result = await getMigrationStatus(db).run();
if (result.isOk) {
  for (const m of result.value) {
    console.log(`${m.name} applied at ${m.applied_at} (${m.execution_ms}ms)`);
  }
}
```

## 5. Migration Script Example

A complete migration script for a project:

```typescript
// scripts/migrate.ts
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { pipe } from "@igorjs/pure-fx/core";
import {
  Database, createSnapshot, diffSnapshots, generateMigration,
  ensureMigrationTable, applyMigration, getMigrationStatus,
  createPostgresDialect,
} from "@igorjs/pure-orm";
import { User, Post, Comment, Tag } from "./models.ts";

const MODELS = [User, Post, Comment, Tag];
const MIGRATIONS_DIR = "migrations";
const SNAPSHOTS_DIR = `${MIGRATIONS_DIR}/snapshots`;

const db = Database({
  dialect: "postgresql",
  driver: pgDriver,
  connection: {
    host: process.env.DB_HOST ?? "localhost",
    port: Number(process.env.DB_PORT ?? 5432),
    database: process.env.DB_NAME ?? "myapp",
    user: process.env.DB_USER ?? "postgres",
    password: process.env.DB_PASSWORD ?? "",
  },
});

const dialect = createPostgresDialect();

async function generate() {
  const current = createSnapshot(MODELS);

  // Load previous snapshot if it exists
  const snapshotFiles = existsSync(SNAPSHOTS_DIR)
    ? readdirSync(SNAPSHOTS_DIR).filter(f => f.endsWith(".json")).sort()
    : [];

  const previous = snapshotFiles.length > 0
    ? JSON.parse(readFileSync(`${SNAPSHOTS_DIR}/${snapshotFiles.at(-1)}`, "utf8"))
    : { version: 1, generatedAt: "", tables: {} };

  const changes = diffSnapshots(previous, current);

  if (changes.length === 0) {
    console.log("No schema changes detected.");
    return;
  }

  const { up, down } = generateMigration(changes, dialect);
  const timestamp = Date.now();
  const name = `${timestamp}_auto`;
  const checksum = createHash("sha256").update(up).digest("hex").slice(0, 16);

  // Write migration files
  const dir = `${MIGRATIONS_DIR}/${name}`;
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/up.sql`, up);
  writeFileSync(`${dir}/down.sql`, down);
  writeFileSync(`${dir}/meta.json`, JSON.stringify({ name, checksum }));

  // Save current snapshot
  mkdirSync(SNAPSHOTS_DIR, { recursive: true });
  writeFileSync(`${SNAPSHOTS_DIR}/${timestamp}.json`, JSON.stringify(current, null, 2));

  console.log(`Generated migration: ${name}`);
  console.log(`  Up:   ${dir}/up.sql`);
  console.log(`  Down: ${dir}/down.sql`);
}

async function migrate() {
  await ensureMigrationTable(db).run();

  const statusResult = await getMigrationStatus(db).run();
  if (statusResult.isErr) throw statusResult.error;

  const applied = new Set(statusResult.value.map((m: any) => m.name));

  // Find unapplied migrations
  const migrationDirs = existsSync(MIGRATIONS_DIR)
    ? readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
        .filter(d => d.isDirectory() && d.name !== "snapshots")
        .map(d => d.name)
        .sort()
    : [];

  for (const dir of migrationDirs) {
    if (applied.has(dir)) continue;

    const metaPath = `${MIGRATIONS_DIR}/${dir}/meta.json`;
    const upPath = `${MIGRATIONS_DIR}/${dir}/up.sql`;

    if (!existsSync(metaPath) || !existsSync(upPath)) continue;

    const meta = JSON.parse(readFileSync(metaPath, "utf8"));
    const upSql = readFileSync(upPath, "utf8");

    console.log(`Applying: ${dir}...`);
    const result = await applyMigration(db, {
      name: dir,
      upSql,
      checksum: meta.checksum,
    }).run();

    if (result.isErr) {
      console.error(`Failed: ${dir}`, result.error);
      process.exit(1);
    }

    console.log(`  Applied: ${dir}`);
  }

  console.log("All migrations applied.");
}

// CLI
const command = process.argv[2];
if (command === "generate") await generate();
else if (command === "migrate") await migrate();
else console.log("Usage: migrate.ts [generate|migrate]");

await db.pool.end().run();
```

## 6. CI/CD Integration

### GitHub Actions: Auto-Migrate on Deploy

```yaml
# .github/workflows/deploy.yml
name: Deploy

on:
  push:
    branches: [main]

jobs:
  migrate-and-deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6

      - uses: pnpm/action-setup@v4

      - uses: actions/setup-node@v6
        with:
          node-version: 22
          cache: pnpm

      - run: pnpm install --frozen-lockfile
      - run: pnpm run build

      # Run migrations against the production database
      - name: Run database migrations
        run: node --experimental-strip-types scripts/migrate.ts migrate
        env:
          DB_HOST: ${{ secrets.DB_HOST }}
          DB_PORT: ${{ secrets.DB_PORT }}
          DB_NAME: ${{ secrets.DB_NAME }}
          DB_USER: ${{ secrets.DB_USER }}
          DB_PASSWORD: ${{ secrets.DB_PASSWORD }}

      # Deploy the application
      - name: Deploy
        run: pnpm run deploy
```

### PR Preview: Generate Migration Diff

```yaml
# .github/workflows/migration-check.yml
name: Migration Check

on:
  pull_request:
    paths:
      - "src/models/**"

jobs:
  check-migrations:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6

      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v6
        with:
          node-version: 22
          cache: pnpm

      - run: pnpm install --frozen-lockfile
      - run: pnpm run build

      - name: Generate migration preview
        run: |
          node --experimental-strip-types scripts/migrate.ts generate
          if [ -d "migrations" ]; then
            echo "### Migration Preview" >> $GITHUB_STEP_SUMMARY
            echo '```sql' >> $GITHUB_STEP_SUMMARY
            cat migrations/*/up.sql 2>/dev/null >> $GITHUB_STEP_SUMMARY || echo "No new migrations" >> $GITHUB_STEP_SUMMARY
            echo '```' >> $GITHUB_STEP_SUMMARY
          fi
```

### Docker Entrypoint

```dockerfile
# Dockerfile
FROM node:22-slim
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile && pnpm run build

# Run migrations before starting the app
CMD ["sh", "-c", "node scripts/migrate.ts migrate && node dist/server.js"]
```

### Kubernetes Init Container

```yaml
# k8s/deployment.yaml
spec:
  initContainers:
    - name: migrate
      image: myapp:latest
      command: ["node", "scripts/migrate.ts", "migrate"]
      env:
        - name: DB_HOST
          valueFrom:
            secretKeyRef:
              name: db-credentials
              key: host
        - name: DB_PASSWORD
          valueFrom:
            secretKeyRef:
              name: db-credentials
              key: password
  containers:
    - name: app
      image: myapp:latest
      command: ["node", "dist/server.js"]
```

## MigrationModel

The `_pure_orm_migrations` state table tracks applied migrations:

| Column | Type | Description |
|--------|------|-------------|
| `id` | SERIAL / INTEGER | Auto-increment primary key |
| `name` | TEXT UNIQUE | Migration name (e.g., `1713100000000_add_comments`) |
| `applied_at` | TIMESTAMPTZ | When the migration was applied |
| `checksum` | TEXT | SHA-256 hash of the up SQL for tamper detection |
| `execution_ms` | INTEGER | How long the migration took |
