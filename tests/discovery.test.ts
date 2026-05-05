// Copyright 2026 igorjs. SPDX-License-Identifier: Apache-2.0

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "@igorjs/pure-test";
import { discoverMigrations, parseFilename } from "../src/migration/discovery.ts";

const TEST_DIR = join("tests", ".tmp-discovery-test");

describe("parseFilename", () => {
  it("extracts name from valid migration filename", () => {
    expect(parseFilename("20260505_001_create_users.sql")).toBe("20260505_001_create_users");
  });

  it("handles .ts extension", () => {
    expect(parseFilename("20260505_002_add_index.ts")).toBe("20260505_002_add_index");
  });

  it("returns null for non-matching filenames", () => {
    expect(parseFilename("README.md")).toBe(null);
    expect(parseFilename("migration.sql")).toBe(null);
    expect(parseFilename("001_create_users.sql")).toBe(null);
  });

  it("rejects filenames with uppercase", () => {
    expect(parseFilename("20260505_001_Create_Users.sql")).toBe(null);
  });

  it("rejects filenames without sequence number", () => {
    expect(parseFilename("20260505_create_users.sql")).toBe(null);
  });
});

describe("discoverMigrations", () => {
  beforeAll(() => {
    mkdirSync(TEST_DIR, { recursive: true });

    writeFileSync(
      join(TEST_DIR, "20260501_001_create_users.sql"),
      "-- @up\nCREATE TABLE users (id INT);\n\n-- @down\nDROP TABLE users;\n",
    );

    writeFileSync(
      join(TEST_DIR, "20260502_001_add_email.sql"),
      "-- @transaction false\n\n-- @up\nALTER TABLE users ADD email TEXT;\n\n-- @down\nALTER TABLE users DROP email;\n",
    );

    // Non-matching file should be ignored
    writeFileSync(join(TEST_DIR, "README.md"), "# Migrations\n");
  });

  afterAll(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("discovers .sql files matching the pattern", async () => {
    const result = await discoverMigrations(TEST_DIR).run();
    expect(result.isOk).toBe(true);
    if (!result.isOk) return;
    expect(result.value.length).toBe(2);
  });

  it("sorts files lexicographically", async () => {
    const result = await discoverMigrations(TEST_DIR).run();
    if (!result.isOk) return;
    expect(result.value[0]?.name).toBe("20260501_001_create_users");
    expect(result.value[1]?.name).toBe("20260502_001_add_email");
  });

  it("parses SQL content into Migration objects", async () => {
    const result = await discoverMigrations(TEST_DIR).run();
    if (!result.isOk) return;
    const first = result.value[0];
    expect(first?.migration.up.includes("CREATE TABLE")).toBeTruthy();
    expect(first?.migration.down.includes("DROP TABLE")).toBeTruthy();
    expect(first?.migration.transaction).toBe(true);
  });

  it("parses directives from SQL files", async () => {
    const result = await discoverMigrations(TEST_DIR).run();
    if (!result.isOk) return;
    const second = result.value[1];
    expect(second?.migration.transaction).toBe(false);
  });

  it("computes checksums for each file", async () => {
    const result = await discoverMigrations(TEST_DIR).run();
    if (!result.isOk) return;
    expect(result.value[0]?.checksum.length).toBe(64);
    expect(result.value[1]?.checksum.length).toBe(64);
    expect(result.value[0]?.checksum).not.toBe(result.value[1]?.checksum);
  });

  it("returns frozen MigrationFile objects", async () => {
    const result = await discoverMigrations(TEST_DIR).run();
    if (!result.isOk) return;
    expect(Object.isFrozen(result.value)).toBeTruthy();
    expect(Object.isFrozen(result.value[0])).toBeTruthy();
  });

  it("ignores non-matching files", async () => {
    const result = await discoverMigrations(TEST_DIR).run();
    if (!result.isOk) return;
    const names = result.value.map(f => f.name);
    expect(names.includes("README")).toBe(false);
  });

  it("returns error for non-existent directory", async () => {
    const result = await discoverMigrations("/tmp/nonexistent-dir-xyz").run();
    expect(result.isErr).toBe(true);
  });
});
