// Copyright 2026 igorjs. SPDX-License-Identifier: Apache-2.0

/**
 * Tests for the destructive-change guard (ADR-0004 interim safety net).
 *
 * The guard converts silent data loss (a drop emitted by the differ) into an
 * explicit, opt-in choice: `generate` fails closed on any DropTable/DropColumn
 * unless the operator passes --allow-destructive.
 */

import { describe, expect, it } from "@igorjs/pure-test";
import {
  checkDestructive,
  describeDestructiveOp,
  findDestructiveOps,
  isDestructiveOp,
} from "../src/migration/guard.ts";
import type { ChangeOperation, ColumnSnapshot, TableSnapshot } from "../src/migration/types.ts";

// ---- Fixtures ----

const col: ColumnSnapshot = Object.freeze({
  type: "string",
  primaryKey: false,
  nullable: false,
  unique: false,
  default: null,
  index: false,
});

const table: TableSnapshot = Object.freeze({
  columns: Object.freeze({ id: col }),
  indexes: Object.freeze([]),
  foreignKeys: Object.freeze([]),
});

const dropTable: ChangeOperation = Object.freeze({
  tag: "DropTable",
  table: "users",
  snapshot: table,
});
const dropColumn: ChangeOperation = Object.freeze({
  tag: "DropColumn",
  table: "users",
  column: "age",
  snapshot: col,
});
const addColumn: ChangeOperation = Object.freeze({
  tag: "AddColumn",
  table: "users",
  column: "email",
  snapshot: col,
});
const createTable: ChangeOperation = Object.freeze({
  tag: "CreateTable",
  table: "posts",
  snapshot: table,
});
const dropIndex: ChangeOperation = Object.freeze({
  tag: "DropIndex",
  table: "users",
  index: { name: "idx_old", columns: ["x"], unique: false },
});

// ---------------------------------------------------------------------------
// isDestructiveOp()
// ---------------------------------------------------------------------------

describe("isDestructiveOp()", () => {
  it("is true for DropTable", () => {
    expect(isDestructiveOp(dropTable)).toBe(true);
  });

  it("is true for DropColumn", () => {
    expect(isDestructiveOp(dropColumn)).toBe(true);
  });

  it("is false for AddColumn", () => {
    expect(isDestructiveOp(addColumn)).toBe(false);
  });

  it("is false for CreateTable", () => {
    expect(isDestructiveOp(createTable)).toBe(false);
  });

  it("is false for DropIndex (drops no data)", () => {
    expect(isDestructiveOp(dropIndex)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// findDestructiveOps()
// ---------------------------------------------------------------------------

describe("findDestructiveOps()", () => {
  it("returns only the destructive ops, preserving order", () => {
    const ops = [createTable, dropColumn, addColumn, dropTable];
    const found = findDestructiveOps(ops);

    expect(found.length).toBe(2);
    expect(found[0].tag).toBe("DropColumn");
    expect(found[1].tag).toBe("DropTable");
  });

  it("returns an empty frozen array when none are destructive", () => {
    const found = findDestructiveOps([createTable, addColumn, dropIndex]);

    expect(found.length).toBe(0);
    expect(Object.isFrozen(found)).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// describeDestructiveOp()
// ---------------------------------------------------------------------------

describe("describeDestructiveOp()", () => {
  it("describes a DropTable with the table name", () => {
    expect(describeDestructiveOp(dropTable)).toBe('DROP TABLE "users"');
  });

  it("describes a DropColumn with table and column", () => {
    expect(describeDestructiveOp(dropColumn)).toBe('DROP COLUMN "users"."age"');
  });
});

// ---------------------------------------------------------------------------
// checkDestructive()
// ---------------------------------------------------------------------------

describe("checkDestructive()", () => {
  it("passes with no warnings when there are no destructive ops", () => {
    const result = checkDestructive([createTable, addColumn], false);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.warnings.length).toBe(0);
  });

  it("blocks (fails closed) when destructive ops exist and the flag is absent", () => {
    const result = checkDestructive([createTable, dropColumn, dropTable], false);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.blocked.length).toBe(2);
      expect(result.blocked.includes('DROP COLUMN "users"."age"')).toBeTruthy();
      expect(result.blocked.includes('DROP TABLE "users"')).toBeTruthy();
    }
  });

  it("passes with warnings when destructive ops exist and the flag is set", () => {
    const result = checkDestructive([dropColumn, dropTable], true);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warnings.length).toBe(2);
      expect(result.warnings.includes('DROP TABLE "users"')).toBeTruthy();
    }
  });
});
