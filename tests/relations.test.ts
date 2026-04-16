/**
 * Tests for model relation definitions.
 *
 * Verifies that hasOne, hasMany, belongsTo, and manyToMany factories produce
 * correctly tagged, frozen relation descriptors, and that Model() stores them
 * in $relations as a lazily-evaluated thunk.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Schema } from "@igorjs/pure-ts";
import { Model } from "../src/model/define.ts";
import { Field } from "../src/model/field.ts";
import { belongsTo, hasMany, hasOne, manyToMany } from "../src/model/relations.ts";

// ---- Test models ----

const UserModel = Model("users", {
  fields: {
    id: Field(Schema.string, { primaryKey: true, default: "uuid" }),
    email: Field(Schema.string, { unique: true }),
    name: Field(Schema.string),
  },
});

const PostModel = Model("posts", {
  fields: {
    id: Field(Schema.string, { primaryKey: true, default: "uuid" }),
    title: Field(Schema.string),
    body: Field(Schema.string),
    authorId: Field(Schema.string),
  },
});

const ProfileModel = Model("profiles", {
  fields: {
    id: Field(Schema.string, { primaryKey: true, default: "uuid" }),
    userId: Field(Schema.string),
    bio: Field(Schema.string),
  },
});

const TagModel = Model("tags", {
  fields: {
    id: Field(Schema.string, { primaryKey: true, default: "uuid" }),
    name: Field(Schema.string),
  },
});

// ---------------------------------------------------------------------------
// hasOne()
// ---------------------------------------------------------------------------

describe("hasOne()", () => {
  it("creates a frozen HasOneRelation with tag 'HasOne'", () => {
    const rel = hasOne(() => ProfileModel, { foreignKey: "userId", localKey: "id" });

    assert.equal(rel.tag, "HasOne");
    assert.ok(Object.isFrozen(rel));
  });

  it("stores foreignKey and localKey", () => {
    const rel = hasOne(() => ProfileModel, { foreignKey: "userId", localKey: "id" });

    assert.equal(rel.foreignKey, "userId");
    assert.equal(rel.localKey, "id");
  });

  it("stores a lazy target thunk that resolves to the target model", () => {
    const rel = hasOne(() => ProfileModel, { foreignKey: "userId", localKey: "id" });

    assert.equal(typeof rel.target, "function");
    assert.equal(rel.target().$name, "profiles");
  });
});

// ---------------------------------------------------------------------------
// hasMany()
// ---------------------------------------------------------------------------

describe("hasMany()", () => {
  it("creates a frozen HasManyRelation with tag 'HasMany'", () => {
    const rel = hasMany(() => PostModel, { foreignKey: "authorId", localKey: "id" });

    assert.equal(rel.tag, "HasMany");
    assert.ok(Object.isFrozen(rel));
  });

  it("stores foreignKey and localKey", () => {
    const rel = hasMany(() => PostModel, { foreignKey: "authorId", localKey: "id" });

    assert.equal(rel.foreignKey, "authorId");
    assert.equal(rel.localKey, "id");
  });

  it("stores a lazy target thunk", () => {
    const rel = hasMany(() => PostModel, { foreignKey: "authorId", localKey: "id" });

    assert.equal(rel.target().$name, "posts");
  });
});

// ---------------------------------------------------------------------------
// belongsTo()
// ---------------------------------------------------------------------------

describe("belongsTo()", () => {
  it("creates a frozen BelongsToRelation with tag 'BelongsTo'", () => {
    const rel = belongsTo(() => UserModel, { foreignKey: "authorId", localKey: "id" });

    assert.equal(rel.tag, "BelongsTo");
    assert.ok(Object.isFrozen(rel));
  });

  it("stores foreignKey and localKey", () => {
    const rel = belongsTo(() => UserModel, { foreignKey: "authorId", localKey: "id" });

    assert.equal(rel.foreignKey, "authorId");
    assert.equal(rel.localKey, "id");
  });

  it("stores a lazy target thunk", () => {
    const rel = belongsTo(() => UserModel, { foreignKey: "authorId", localKey: "id" });

    assert.equal(rel.target().$name, "users");
  });
});

// ---------------------------------------------------------------------------
// manyToMany()
// ---------------------------------------------------------------------------

describe("manyToMany()", () => {
  it("creates a frozen ManyToManyRelation with tag 'ManyToMany'", () => {
    const rel = manyToMany(() => TagModel, {
      through: "user_tags",
      localKey: "id",
      foreignKey: "userId",
      otherKey: "tagId",
      otherLocalKey: "id",
    });

    assert.equal(rel.tag, "ManyToMany");
    assert.ok(Object.isFrozen(rel));
  });

  it("stores all junction table keys", () => {
    const rel = manyToMany(() => TagModel, {
      through: "user_tags",
      localKey: "id",
      foreignKey: "userId",
      otherKey: "tagId",
      otherLocalKey: "id",
    });

    assert.equal(rel.through, "user_tags");
    assert.equal(rel.localKey, "id");
    assert.equal(rel.foreignKey, "userId");
    assert.equal(rel.otherKey, "tagId");
    assert.equal(rel.otherLocalKey, "id");
  });

  it("stores a lazy target thunk", () => {
    const rel = manyToMany(() => TagModel, {
      through: "user_tags",
      localKey: "id",
      foreignKey: "userId",
      otherKey: "tagId",
      otherLocalKey: "id",
    });

    assert.equal(rel.target().$name, "tags");
  });
});

// ---------------------------------------------------------------------------
// Model $relations
// ---------------------------------------------------------------------------

describe("Model.$relations", () => {
  it("defaults to an empty relation map when no relations are provided", () => {
    const m = Model("items", {
      fields: { id: Field(Schema.string, { primaryKey: true }) },
    });

    const relations = m.$relations();
    assert.deepEqual(relations, {});
  });

  it("accepts a plain RelationMap object", () => {
    const m = Model("users", {
      fields: {
        id: Field(Schema.string, { primaryKey: true }),
        name: Field(Schema.string),
      },
      relations: {
        posts: hasMany(() => PostModel, { foreignKey: "authorId", localKey: "id" }),
        profile: hasOne(() => ProfileModel, { foreignKey: "userId", localKey: "id" }),
      },
    });

    const rels = m.$relations();
    assert.equal(Object.keys(rels).length, 2);
    assert.equal(rels.posts.tag, "HasMany");
    assert.equal(rels.profile.tag, "HasOne");
  });

  it("accepts a lazy thunk for circular references", () => {
    // Simulate circular: UserWithPosts -> PostWithAuthor -> UserWithPosts
    const UserWithPosts: ReturnType<typeof Model> = Model("users", {
      fields: {
        id: Field(Schema.string, { primaryKey: true }),
      },
      relations: () => ({
        posts: hasMany(() => PostWithAuthor, { foreignKey: "authorId", localKey: "id" }),
      }),
    });

    const PostWithAuthor = Model("posts", {
      fields: {
        id: Field(Schema.string, { primaryKey: true }),
        authorId: Field(Schema.string),
      },
      relations: () => ({
        author: belongsTo(() => UserWithPosts, { foreignKey: "authorId", localKey: "id" }),
      }),
    });

    // Relations resolve correctly despite circular definition.
    const userRels = UserWithPosts.$relations();
    assert.equal(userRels.posts.tag, "HasMany");
    assert.equal(userRels.posts.target().$name, "posts");

    const postRels = PostWithAuthor.$relations();
    assert.equal(postRels.author.tag, "BelongsTo");
    assert.equal(postRels.author.target().$name, "users");
  });

  it("$relations is a function (thunk), not a direct value", () => {
    const m = Model("things", {
      fields: { id: Field(Schema.string, { primaryKey: true }) },
      relations: { foo: hasOne(() => UserModel, { foreignKey: "thingId", localKey: "id" }) },
    });

    assert.equal(typeof m.$relations, "function");
  });
});
