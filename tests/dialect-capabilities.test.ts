// Copyright 2026 igorjs. SPDX-License-Identifier: Apache-2.0

/**
 * Conformance: each dialect exposes the typed DialectCapabilities descriptor
 * the compiler/differ/generator/runner branch on (ADR-0002 Part A).
 *
 * If you add a dialect, add it to the matrix below; the test makes the
 * required capability surface explicit.
 */

import { describe, expect, it } from "@igorjs/pure-test";
import type { Dialect, DialectCapabilities } from "../src/dialect/dialect.ts";
import { createPostgresDialect } from "../src/dialect/postgresql.ts";
import { createSqliteDialect } from "../src/dialect/sqlite.ts";

const REQUIRED_KEYS: readonly (keyof DialectCapabilities)[] = [
  "parameterStyle",
  "identifierQuote",
  "supportsReturning",
  "upsertStyle",
  "supportsTransactionalDDL",
  "currentTimestampSql",
  "lockStrategy",
  "supportsAddColumnIfNotExists",
];

const dialects: readonly { readonly name: string; readonly d: Dialect }[] = Object.freeze([
  { name: "postgresql", d: createPostgresDialect() },
  { name: "sqlite", d: createSqliteDialect() },
]);

describe("DialectCapabilities", () => {
  for (const { name, d } of dialects) {
    describe(name, () => {
      it("exposes every required capability key", () => {
        for (const k of REQUIRED_KEYS) {
          expect(k in d.capabilities).toBeTruthy();
        }
      });

      it("returns a frozen capabilities object", () => {
        expect(Object.isFrozen(d.capabilities)).toBeTruthy();
      });

      it("currentTimestampSql is a non-empty string", () => {
        expect(typeof d.capabilities.currentTimestampSql).toBe("string");
        expect(d.capabilities.currentTimestampSql.length > 0).toBeTruthy();
      });
    });
  }

  describe("postgresql declares the expected values", () => {
    const c = createPostgresDialect().capabilities;
    it("uses numbered parameters", () => {
      expect(c.parameterStyle).toBe("numbered");
    });
    it("uses double-quote identifiers", () => {
      expect(c.identifierQuote).toBe('"');
    });
    it("supports RETURNING and transactional DDL", () => {
      expect(c.supportsReturning).toBe(true);
      expect(c.supportsTransactionalDDL).toBe(true);
    });
    it("uses ON CONFLICT upsert", () => {
      expect(c.upsertStyle).toBe("onConflict");
    });
    it("uses NOW() for current timestamp", () => {
      expect(c.currentTimestampSql).toBe("NOW()");
    });
    it("uses advisory locks", () => {
      expect(c.lockStrategy).toBe("advisoryLock");
    });
    it("supports ADD COLUMN IF NOT EXISTS", () => {
      expect(c.supportsAddColumnIfNotExists).toBe(true);
    });
  });

  describe("sqlite declares the expected values", () => {
    const c = createSqliteDialect().capabilities;
    it("uses question-mark parameters", () => {
      expect(c.parameterStyle).toBe("question");
    });
    it("uses double-quote identifiers", () => {
      expect(c.identifierQuote).toBe('"');
    });
    it("supports RETURNING (3.35+) and transactional DDL", () => {
      expect(c.supportsReturning).toBe(true);
      expect(c.supportsTransactionalDDL).toBe(true);
    });
    it("uses ON CONFLICT upsert", () => {
      expect(c.upsertStyle).toBe("onConflict");
    });
    it("uses datetime('now') for current timestamp", () => {
      expect(c.currentTimestampSql).toBe("datetime('now')");
    });
    it("uses lock-table strategy", () => {
      expect(c.lockStrategy).toBe("lockTable");
    });
    it("does not support ADD COLUMN IF NOT EXISTS", () => {
      expect(c.supportsAddColumnIfNotExists).toBe(false);
    });
  });
});
