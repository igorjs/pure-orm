# Models & Fields

## Model()

`Model(tableName, config)` creates a frozen, immutable model definition that maps a TypeScript type to a database table.

```typescript
import { Schema } from "@igorjs/pure-fx/data";
import { Model, Field } from "@igorjs/pure-orm";

const Post = Model("posts", {
  fields: {
    id: Field(Schema.string, { primaryKey: true, default: "uuid" }),
    title: Field(Schema.string),
    body: Field(Schema.string),
    authorId: Field(Schema.string),
    views: Field(Schema.number, { default: "0" }),
    published: Field(Schema.boolean, { default: "false" }),
  },
  options: { timestamps: true },
});
```

### Model Properties

| Property | Type | Description |
|----------|------|-------------|
| `$name` | `string` | Table name |
| `$schema` | `SchemaType<T>` | Runtime validation schema |
| `$columns` | `ColumnMetadata[]` | Column definitions with snake_case names |
| `$options` | `ModelOptions` | timestamps, softDelete, audit flags |
| `$relations` | `() => RelationMap` | Lazily resolved relation definitions |
| `$type` | `T` (phantom) | Full row type for inference |
| `$insert` | `Partial<T>` (phantom) | Insert type (fields with defaults are optional) |
| `$update` | `Partial<T>` (phantom) | Update type (all fields optional) |

## Field()

`Field(schema, config?)` wraps a pure-fx Schema with ORM metadata.

```typescript
// Required field (no default)
Field(Schema.string)

// Field with default (optional in inserts)
Field(Schema.string, { primaryKey: true, default: "uuid" })

// Nullable field
Field(Schema.string.optional())

// Field with custom column name
Field(Schema.string, { columnName: "user_email" })
```

### Field Config Options

| Option | Type | Description |
|--------|------|-------------|
| `primaryKey` | `boolean` | Marks as primary key |
| `unique` | `boolean` | Adds UNIQUE constraint |
| `index` | `boolean` | Creates an index |
| `default` | `"uuid" \| "cuid" \| "now" \| "autoincrement" \| string` | Server-side default |
| `columnName` | `string` | Override auto-derived snake_case name |
| `references` | `() => [Model, string]` | Foreign key reference (lazy) |
| `onDelete` | `"cascade" \| "restrict" \| "set null" \| "no action"` | FK delete action |
| `onUpdate` | `"cascade" \| "restrict" \| "set null" \| "no action"` | FK update action |

## Column Name Derivation

Field names are automatically converted from camelCase to snake_case:

```
authorId    -> author_id
createdAt   -> created_at
HTMLParser  -> html_parser
parseURL    -> parse_url
```

Override with `columnName`:

```typescript
Field(Schema.string, { columnName: "custom_col" })
```

## Model Options

```typescript
Model("users", {
  fields: { ... },
  options: {
    timestamps: true,   // adds createdAt (created_at) and updatedAt (updated_at)
    softDelete: true,   // adds deletedAt (deleted_at), auto-filters in queries
    audit: true,        // marks model for audit logging
  },
});
```

### Timestamps

When `timestamps: true`, two columns are automatically appended:

| Field | Column | Type | Default |
|-------|--------|------|---------|
| `createdAt` | `created_at` | `isoDate` | `now` |
| `updatedAt` | `updated_at` | `isoDate` | `now` |

### Soft Delete

When `softDelete: true`, a `deletedAt` (`deleted_at`) column is appended. All queries via `from()` automatically add `WHERE deleted_at IS NULL`. See [Soft Deletes](./soft-deletes.md) for overriding this behaviour.

## Relations

Models can define relations to other models. See [Relations](./relations.md) for full documentation.

```typescript
const User = Model("users", {
  fields: { ... },
  relations: () => ({
    posts: hasMany(() => Post, { foreignKey: "authorId", localKey: "id" }),
    profile: hasOne(() => Profile, { foreignKey: "userId", localKey: "id" }),
  }),
});
```

The `relations` config accepts either a plain object or a thunk `() => RelationMap` for circular references.

## InferModelType

Extract the TypeScript type from a model's fields:

```typescript
import type { InferModelType } from "@igorjs/pure-orm";

// { id: string; name: string; email: string; age: number | undefined }
type UserRow = InferModelType<typeof User["$columns"]>;
```
