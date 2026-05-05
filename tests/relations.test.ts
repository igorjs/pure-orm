/**
 * Tests for model relation definitions.
 *
 * Verifies that hasOne, hasMany, belongsTo, and manyToMany factories produce
 * correctly tagged, frozen relation descriptors, and that Model() stores them
 * in $relations as a lazily-evaluated thunk.
 */

import { Schema } from "@igorjs/pure-fx";
import { describe, expect, it } from "@igorjs/pure-test";
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

    expect(rel.tag).toBe("HasOne");
    expect(Object.isFrozen(rel)).toBeTruthy();
  });

  it("stores foreignKey and localKey", () => {
    const rel = hasOne(() => ProfileModel, { foreignKey: "userId", localKey: "id" });

    expect(rel.foreignKey).toBe("userId");
    expect(rel.localKey).toBe("id");
  });

  it("stores a lazy target thunk that resolves to the target model", () => {
    const rel = hasOne(() => ProfileModel, { foreignKey: "userId", localKey: "id" });

    expect(typeof rel.target).toBe("function");
    expect(rel.target().$name).toBe("profiles");
  });
});

// ---------------------------------------------------------------------------
// hasMany()
// ---------------------------------------------------------------------------

describe("hasMany()", () => {
  it("creates a frozen HasManyRelation with tag 'HasMany'", () => {
    const rel = hasMany(() => PostModel, { foreignKey: "authorId", localKey: "id" });

    expect(rel.tag).toBe("HasMany");
    expect(Object.isFrozen(rel)).toBeTruthy();
  });

  it("stores foreignKey and localKey", () => {
    const rel = hasMany(() => PostModel, { foreignKey: "authorId", localKey: "id" });

    expect(rel.foreignKey).toBe("authorId");
    expect(rel.localKey).toBe("id");
  });

  it("stores a lazy target thunk", () => {
    const rel = hasMany(() => PostModel, { foreignKey: "authorId", localKey: "id" });

    expect(rel.target().$name).toBe("posts");
  });
});

// ---------------------------------------------------------------------------
// belongsTo()
// ---------------------------------------------------------------------------

describe("belongsTo()", () => {
  it("creates a frozen BelongsToRelation with tag 'BelongsTo'", () => {
    const rel = belongsTo(() => UserModel, { foreignKey: "authorId", localKey: "id" });

    expect(rel.tag).toBe("BelongsTo");
    expect(Object.isFrozen(rel)).toBeTruthy();
  });

  it("stores foreignKey and localKey", () => {
    const rel = belongsTo(() => UserModel, { foreignKey: "authorId", localKey: "id" });

    expect(rel.foreignKey).toBe("authorId");
    expect(rel.localKey).toBe("id");
  });

  it("stores a lazy target thunk", () => {
    const rel = belongsTo(() => UserModel, { foreignKey: "authorId", localKey: "id" });

    expect(rel.target().$name).toBe("users");
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

    expect(rel.tag).toBe("ManyToMany");
    expect(Object.isFrozen(rel)).toBeTruthy();
  });

  it("stores all junction table keys", () => {
    const rel = manyToMany(() => TagModel, {
      through: "user_tags",
      localKey: "id",
      foreignKey: "userId",
      otherKey: "tagId",
      otherLocalKey: "id",
    });

    expect(rel.through).toBe("user_tags");
    expect(rel.localKey).toBe("id");
    expect(rel.foreignKey).toBe("userId");
    expect(rel.otherKey).toBe("tagId");
    expect(rel.otherLocalKey).toBe("id");
  });

  it("stores a lazy target thunk", () => {
    const rel = manyToMany(() => TagModel, {
      through: "user_tags",
      localKey: "id",
      foreignKey: "userId",
      otherKey: "tagId",
      otherLocalKey: "id",
    });

    expect(rel.target().$name).toBe("tags");
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
    expect(relations).toEqual({});
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
    expect(Object.keys(rels).length).toBe(2);
    expect(rels.posts.tag).toBe("HasMany");
    expect(rels.profile.tag).toBe("HasOne");
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
    expect(userRels.posts.tag).toBe("HasMany");
    expect(userRels.posts.target().$name).toBe("posts");

    const postRels = PostWithAuthor.$relations();
    expect(postRels.author.tag).toBe("BelongsTo");
    expect(postRels.author.target().$name).toBe("users");
  });

  it("$relations is a function (thunk), not a direct value", () => {
    const m = Model("things", {
      fields: { id: Field(Schema.string, { primaryKey: true }) },
      relations: { foo: hasOne(() => UserModel, { foreignKey: "thingId", localKey: "id" }) },
    });

    expect(typeof m.$relations).toBe("function");
  });
});
