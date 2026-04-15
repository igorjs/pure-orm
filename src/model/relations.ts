/**
 * Relation definitions for models.
 *
 * Each factory creates a frozen, immutable relation descriptor that records
 * the foreign/local key mapping between two models. The target model is
 * wrapped in a thunk (() => Model) so that circular references between
 * models (User -> Post -> User) resolve correctly at call time rather than
 * at definition time, avoiding temporal dead zone errors.
 *
 * Relation descriptors are pure data: they carry no query or execution
 * logic. They are consumed by include() (eager loading) and lazy()
 * (on-demand loading) at query-build or execution time.
 */

import type { Model } from "./define.ts";

// ---- Relation types ----

type HasOneRelation = {
  readonly tag: "HasOne";
  readonly target: () => Model;
  readonly foreignKey: string;
  readonly localKey: string;
};

type HasManyRelation = {
  readonly tag: "HasMany";
  readonly target: () => Model;
  readonly foreignKey: string;
  readonly localKey: string;
};

type BelongsToRelation = {
  readonly tag: "BelongsTo";
  readonly target: () => Model;
  readonly foreignKey: string;
  readonly localKey: string;
};

type ManyToManyRelation = {
  readonly tag: "ManyToMany";
  readonly target: () => Model;
  readonly through: string;
  readonly localKey: string;
  readonly foreignKey: string;
  readonly otherKey: string;
  readonly otherLocalKey: string;
};

type RelationDef = HasOneRelation | HasManyRelation | BelongsToRelation | ManyToManyRelation;

type RelationMap = Readonly<Record<string, RelationDef>>;

// ---- Relation factories ----

/**
 * Defines a one-to-one relationship where the foreign key lives on the
 * target table. Example: User hasOne Profile (profiles.user_id -> users.id).
 */
const hasOne = (
  target: () => Model,
  config: { readonly foreignKey: string; readonly localKey: string },
): HasOneRelation =>
  Object.freeze({
    tag: "HasOne" as const,
    target,
    foreignKey: config.foreignKey,
    localKey: config.localKey,
  });

/**
 * Defines a one-to-many relationship where the foreign key lives on the
 * target table. Example: User hasMany Post (posts.author_id -> users.id).
 */
const hasMany = (
  target: () => Model,
  config: { readonly foreignKey: string; readonly localKey: string },
): HasManyRelation =>
  Object.freeze({
    tag: "HasMany" as const,
    target,
    foreignKey: config.foreignKey,
    localKey: config.localKey,
  });

/**
 * Defines a many-to-one relationship where the foreign key lives on the
 * source table. Example: Post belongsTo User (posts.author_id -> users.id).
 *
 * foreignKey is the column on the SOURCE model that points to the target.
 * localKey is the column on the TARGET model being referenced.
 */
const belongsTo = (
  target: () => Model,
  config: { readonly foreignKey: string; readonly localKey: string },
): BelongsToRelation =>
  Object.freeze({
    tag: "BelongsTo" as const,
    target,
    foreignKey: config.foreignKey,
    localKey: config.localKey,
  });

/**
 * Defines a many-to-many relationship via a junction table.
 *
 * Example: User manyToMany Tag through "user_tags":
 *   user_tags.user_id -> users.id
 *   user_tags.tag_id  -> tags.id
 */
const manyToMany = (
  target: () => Model,
  config: {
    readonly through: string;
    readonly localKey: string;
    readonly foreignKey: string;
    readonly otherKey: string;
    readonly otherLocalKey: string;
  },
): ManyToManyRelation =>
  Object.freeze({
    tag: "ManyToMany" as const,
    target,
    through: config.through,
    localKey: config.localKey,
    foreignKey: config.foreignKey,
    otherKey: config.otherKey,
    otherLocalKey: config.otherLocalKey,
  });

export type { BelongsToRelation, HasManyRelation, HasOneRelation, ManyToManyRelation, RelationDef, RelationMap };
export { belongsTo, hasMany, hasOne, manyToMany };
