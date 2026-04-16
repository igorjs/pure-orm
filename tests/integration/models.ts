/**
 * Shared test models for integration tests.
 *
 * These models exercise the full spectrum of ORM features: primary keys,
 * timestamps, soft deletes, foreign key references, unique constraints,
 * and various field types.
 */

import { Schema } from "@igorjs/pure-ts";
import { Model } from "../../src/model/define.ts";
import { Field } from "../../src/model/field.ts";
import { belongsTo, hasMany, hasOne } from "../../src/model/relations.ts";

// ---------------------------------------------------------------------------
// Category: simple model with no timestamps or soft delete
// ---------------------------------------------------------------------------

const Category = Model("categories", {
  fields: {
    id: Field(Schema.number, { primaryKey: true, default: "autoincrement" }),
    name: Field(Schema.string, { unique: true }),
  },
  options: {},
});

// ---------------------------------------------------------------------------
// User: timestamps + soft delete
// ---------------------------------------------------------------------------

const User = Model("users", {
  fields: {
    id: Field(Schema.number, { primaryKey: true, default: "autoincrement" }),
    email: Field(Schema.string, { unique: true }),
    name: Field(Schema.string),
    age: Field(Schema.number),
    role: Field(Schema.string, { default: "user" }),
  },
  options: { timestamps: true, softDelete: true },
  relations: () => ({
    posts: hasMany(() => Post, "authorId"),
    profile: hasOne(() => Profile, "userId"),
  }),
});

// ---------------------------------------------------------------------------
// Post: belongs to User and Category
// ---------------------------------------------------------------------------

const Post = Model("posts", {
  fields: {
    id: Field(Schema.number, { primaryKey: true, default: "autoincrement" }),
    title: Field(Schema.string),
    body: Field(Schema.string),
    published: Field(Schema.number), // SQLite: 0/1 for boolean
    authorId: Field(Schema.number, {
      references: () => [User, "id"] as const,
      onDelete: "cascade",
    }),
    categoryId: Field(Schema.number, {
      references: () => [Category, "id"] as const,
    }),
    views: Field(Schema.number, { default: 0 }),
  },
  options: { timestamps: true },
  relations: () => ({
    author: belongsTo(() => User, "authorId"),
    category: belongsTo(() => Category, "categoryId"),
  }),
});

// ---------------------------------------------------------------------------
// Profile: has one (User -> Profile)
// ---------------------------------------------------------------------------

const Profile = Model("profiles", {
  fields: {
    id: Field(Schema.number, { primaryKey: true, default: "autoincrement" }),
    bio: Field(Schema.string),
    userId: Field(Schema.number, {
      unique: true,
      references: () => [User, "id"] as const,
      onDelete: "cascade",
    }),
  },
  options: {},
});

// ---------------------------------------------------------------------------
// Tag: simple model for many-to-many (future)
// ---------------------------------------------------------------------------

const Tag = Model("tags", {
  fields: {
    id: Field(Schema.number, { primaryKey: true, default: "autoincrement" }),
    label: Field(Schema.string, { unique: true }),
  },
  options: {},
});

// ---------------------------------------------------------------------------
// DDL helpers: create and drop SQL for each database engine
// ---------------------------------------------------------------------------

/**
 * SQLite DDL for creating all test tables. Uses INTEGER PRIMARY KEY
 * for auto-increment and datetime('now') for timestamp defaults.
 */
const SQLITE_CREATE_TABLES = `
CREATE TABLE IF NOT EXISTS "categories" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "name" TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS "users" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "email" TEXT NOT NULL UNIQUE,
  "name" TEXT NOT NULL,
  "age" REAL NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'user',
  "created_at" TEXT NOT NULL DEFAULT (datetime('now')),
  "updated_at" TEXT NOT NULL DEFAULT (datetime('now')),
  "deleted_at" TEXT
);

CREATE TABLE IF NOT EXISTS "posts" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "published" REAL NOT NULL DEFAULT 0,
  "author_id" INTEGER NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "category_id" INTEGER NOT NULL REFERENCES "categories"("id"),
  "views" REAL NOT NULL DEFAULT 0,
  "created_at" TEXT NOT NULL DEFAULT (datetime('now')),
  "updated_at" TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS "profiles" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "bio" TEXT NOT NULL,
  "user_id" INTEGER NOT NULL UNIQUE REFERENCES "users"("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "tags" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "label" TEXT NOT NULL UNIQUE
);
`;

/**
 * PostgreSQL DDL for creating all test tables. Uses SERIAL for
 * auto-increment and NOW() for timestamp defaults.
 */
const PG_CREATE_TABLES = `
CREATE TABLE IF NOT EXISTS "categories" (
  "id" SERIAL PRIMARY KEY,
  "name" TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS "users" (
  "id" SERIAL PRIMARY KEY,
  "email" TEXT NOT NULL UNIQUE,
  "name" TEXT NOT NULL,
  "age" INTEGER NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'user',
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "deleted_at" TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS "posts" (
  "id" SERIAL PRIMARY KEY,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "published" BOOLEAN NOT NULL DEFAULT FALSE,
  "author_id" INTEGER NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "category_id" INTEGER NOT NULL REFERENCES "categories"("id"),
  "views" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "profiles" (
  "id" SERIAL PRIMARY KEY,
  "bio" TEXT NOT NULL,
  "user_id" INTEGER NOT NULL UNIQUE REFERENCES "users"("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "tags" (
  "id" SERIAL PRIMARY KEY,
  "label" TEXT NOT NULL UNIQUE
);
`;

const DROP_TABLES = `
DROP TABLE IF EXISTS "profiles";
DROP TABLE IF EXISTS "posts";
DROP TABLE IF EXISTS "tags";
DROP TABLE IF EXISTS "users";
DROP TABLE IF EXISTS "categories";
DROP TABLE IF EXISTS "_pure_orm_migrations";
`;

export { Category, DROP_TABLES, PG_CREATE_TABLES, Post, Profile, SQLITE_CREATE_TABLES, Tag, User };
