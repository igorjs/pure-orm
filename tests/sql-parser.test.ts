// Copyright 2026 igorjs. SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "@igorjs/pure-test";
import { parseSqlMigration } from "../src/migration/sql-parser.ts";

describe("parseSqlMigration", () => {
  it("parses a valid SQL migration with @up and @down", () => {
    const content = `
-- @up
CREATE TABLE "users" ("id" SERIAL PRIMARY KEY);

-- @down
DROP TABLE "users";
`;
    const result = parseSqlMigration(content, "test.sql");
    expect(result.up).toBe('CREATE TABLE "users" ("id" SERIAL PRIMARY KEY);');
    expect(result.down).toBe('DROP TABLE "users";');
    expect(result.transaction).toBe(true);
    expect(result.concurrent).toBe(false);
  });

  it("parses directives before sections", () => {
    const content = `
-- @transaction false
-- @concurrent true

-- @up
CREATE INDEX CONCURRENTLY "idx" ON "users" ("email");

-- @down
DROP INDEX "idx";
`;
    const result = parseSqlMigration(content, "test.sql");
    expect(result.transaction).toBe(false);
    expect(result.concurrent).toBe(true);
  });

  it("preserves multi-line SQL in sections", () => {
    const content = `-- @up
CREATE TABLE "posts" (
  "id" SERIAL PRIMARY KEY,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL
);

-- @down
DROP TABLE "posts";
`;
    const result = parseSqlMigration(content, "test.sql");
    expect(result.up.includes('"title" TEXT NOT NULL')).toBeTruthy();
    expect(result.up.includes('"body" TEXT NOT NULL')).toBeTruthy();
  });

  it("returns frozen Migration object", () => {
    const content = `-- @up\nSELECT 1;\n\n-- @down\nSELECT 0;`;
    const result = parseSqlMigration(content, "test.sql");
    expect(Object.isFrozen(result)).toBeTruthy();
  });

  it("throws on missing @up section", () => {
    const content = `-- @down\nDROP TABLE "users";`;
    expect(() => parseSqlMigration(content, "test.sql")).toThrow();
  });

  it("throws on missing @down section", () => {
    const content = `-- @up\nCREATE TABLE "users" ("id" INT);`;
    expect(() => parseSqlMigration(content, "test.sql")).toThrow();
  });

  it("throws on empty @up section", () => {
    const content = `-- @up\n\n-- @down\nDROP TABLE "users";`;
    expect(() => parseSqlMigration(content, "test.sql")).toThrow();
  });

  it("throws on empty @down section", () => {
    const content = `-- @up\nCREATE TABLE "users" ("id" INT);\n\n-- @down\n`;
    expect(() => parseSqlMigration(content, "test.sql")).toThrow();
  });

  it("throws on duplicate @up section", () => {
    const content = `-- @up\nSELECT 1;\n-- @up\nSELECT 2;\n-- @down\nSELECT 0;`;
    expect(() => parseSqlMigration(content, "test.sql")).toThrow();
  });

  it("throws on duplicate @down section", () => {
    const content = `-- @up\nSELECT 1;\n-- @down\nSELECT 2;\n-- @down\nSELECT 3;`;
    expect(() => parseSqlMigration(content, "test.sql")).toThrow();
  });

  it("ignores comments before sections", () => {
    const content = `
-- This is a migration for users table
-- Author: igorjs

-- @up
CREATE TABLE "users" ("id" INT);

-- @down
DROP TABLE "users";
`;
    const result = parseSqlMigration(content, "test.sql");
    expect(result.up).toBe('CREATE TABLE "users" ("id" INT);');
  });

  it("defaults transaction to true when not specified", () => {
    const content = `-- @up\nSELECT 1;\n\n-- @down\nSELECT 0;`;
    expect(parseSqlMigration(content, "test.sql").transaction).toBe(true);
  });

  it("defaults concurrent to false when not specified", () => {
    const content = `-- @up\nSELECT 1;\n\n-- @down\nSELECT 0;`;
    expect(parseSqlMigration(content, "test.sql").concurrent).toBe(false);
  });

  it("error message includes the filename", () => {
    try {
      parseSqlMigration("no markers", "my_migration.sql");
      expect(false).toBeTruthy();
    } catch (err) {
      expect((err as { message: string }).message.includes("my_migration.sql")).toBeTruthy();
    }
  });
});
