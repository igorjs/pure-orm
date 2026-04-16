# Relations

Relations define how models reference each other. They are pure data descriptors consumed by `include()` (eager loading) and `lazy()` (on-demand loading).

## Defining Relations

Relations are set on the Model via the `relations` config. Use a thunk `() => ({...})` to handle circular references between models.

```typescript
import { Model, Field, hasOne, hasMany, belongsTo, manyToMany } from "@igorjs/pure-orm";

const User = Model("users", {
  fields: {
    id: Field(Schema.string, { primaryKey: true, default: "uuid" }),
    name: Field(Schema.string),
  },
  relations: () => ({
    posts: hasMany(() => Post, { foreignKey: "authorId", localKey: "id" }),
    profile: hasOne(() => Profile, { foreignKey: "userId", localKey: "id" }),
  }),
});

const Post = Model("posts", {
  fields: {
    id: Field(Schema.string, { primaryKey: true, default: "uuid" }),
    title: Field(Schema.string),
    authorId: Field(Schema.string),
    categoryId: Field(Schema.string),
  },
  relations: () => ({
    author: belongsTo(() => User, { foreignKey: "authorId", localKey: "id" }),
    category: belongsTo(() => Category, { foreignKey: "categoryId", localKey: "id" }),
  }),
});
```

## Relation Types

### hasOne

One-to-one where the foreign key lives on the **target** table.

```typescript
hasOne(() => Profile, { foreignKey: "userId", localKey: "id" })
// User.id -> Profile.userId (FK on Profile)
```

### hasMany

One-to-many where the foreign key lives on the **target** table.

```typescript
hasMany(() => Post, { foreignKey: "authorId", localKey: "id" })
// User.id -> Post.authorId (FK on Post)
```

### belongsTo

Many-to-one where the foreign key lives on the **source** table.

```typescript
belongsTo(() => User, { foreignKey: "authorId", localKey: "id" })
// Post.authorId -> User.id (FK on Post)
```

### manyToMany

Many-to-many via a junction table.

```typescript
manyToMany(() => Tag, {
  through: "post_tags",
  localKey: "id",
  foreignKey: "postId",
  otherKey: "tagId",
  otherLocalKey: "id",
})
```

## Eager Loading: include()

`include()` converts a hasOne or belongsTo relation into a LEFT JOIN.

```typescript
import { include } from "@igorjs/pure-orm";

// Eagerly load the author with each post
pipe(from(Post), include(Post, "author"), execute(db))
// LEFT JOIN "users" ON "posts"."author_id" = "users"."id"

// Eagerly load the profile with each user
pipe(from(User), include(User, "profile"), execute(db))
// LEFT JOIN "profiles" ON "users"."id" = "profiles"."user_id"
```

`include()` throws for `hasMany` and `manyToMany` relations (they cause row multiplication with a simple JOIN). Use `lazy()` instead.

## Lazy Loading: lazy()

`lazy()` builds a SelectNode for loading related records on demand.

```typescript
import { lazy, execute } from "@igorjs/pure-orm";

// Given a user record, build a query to load their posts
const userRecord = { id: "u-1", name: "Alice" };
const postsQuery = lazy(User, userRecord, "posts");

const result = await pipe(postsQuery, execute(db)).run();
// SELECT "posts".* FROM "posts" WHERE "author_id" = $1
// params: ["u-1"]
```

### Lazy loading by relation type

| Relation | Query |
|----------|-------|
| `hasOne` / `hasMany` | `SELECT * FROM target WHERE foreignKey = record[localKey]` |
| `belongsTo` | `SELECT * FROM target WHERE localKey = record[foreignKey]` |
| `manyToMany` | Not yet supported (use raw query with junction table) |

## Circular References

The thunk pattern `() => ({...})` for relations and `() => Model` for targets allows models to reference each other without temporal dead zone issues:

```typescript
// Both models reference each other
const User = Model("users", {
  fields: { ... },
  relations: () => ({
    posts: hasMany(() => Post, { foreignKey: "authorId", localKey: "id" }),
  }),
});

const Post = Model("posts", {
  fields: { ... },
  relations: () => ({
    author: belongsTo(() => User, { foreignKey: "authorId", localKey: "id" }),
  }),
});
```

The thunks are only called when `model.$relations()` is invoked, by which time both models are fully initialised.
