// Copyright 2026 igorjs. SPDX-License-Identifier: Apache-2.0

/**
 * MySQL / MariaDB dialect — surface-level tests.
 *
 * The dialect mirrors the SQLite structure (same `?` parameter style and
 * delegation to shared.ts mutation compilers); the focus of this file is the
 * MySQL-specific differences: backtick identifiers, MySQL type mapping,
 * NOW() current-timestamp, and the capability flags that downstream connectors
 * and the migration engine read.
 */

import { pipe, Schema } from "@igorjs/pure-fx";
import { describe, expect, it } from "@igorjs/pure-test";
import { createMysqlDialect } from "../src/dialect/mysql.ts";
import { resolveDialect } from "../src/dialect/registry.ts";
import { Model } from "../src/model/define.ts";
import { Field } from "../src/model/field.ts";
import { from, where } from "../src/query/builders.ts";
import { eq } from "../src/query/conditions.ts";

const mysql = createMysqlDialect();

const User = Model("users", {
  fields: {
    id: Field(Schema.string, { primaryKey: true, default: "uuid" }),
    email: Field(Schema.string, { unique: true }),
    name: Field(Schema.string),
  },
});

// ---------------------------------------------------------------------------
// Identifier quoting (backticks)
// ---------------------------------------------------------------------------

describe("MySQL quote()", () => {
  it("wraps identifiers in backticks", () => {
    expect(mysql.quote("users")).toBe("`users`");
  });

  it("escapes embedded backticks by doubling them", () => {
    expect(mysql.quote("we`ird")).toBe("`we``ird`");
  });
});

// ---------------------------------------------------------------------------
// Parameter placeholder (?)
// ---------------------------------------------------------------------------

describe("MySQL param()", () => {
  it("always returns ? regardless of index", () => {
    expect(mysql.param(1)).toBe("?");
    expect(mysql.param(2)).toBe("?");
    expect(mysql.param(42)).toBe("?");
  });
});

// ---------------------------------------------------------------------------
// Field type mapping
// ---------------------------------------------------------------------------

describe("MySQL mapFieldType()", () => {
  it("maps string to VARCHAR(255)", () => {
    expect(mysql.mapFieldType("string", {})).toBe("VARCHAR(255)");
  });

  it("maps number to BIGINT", () => {
    expect(mysql.mapFieldType("number", {})).toBe("BIGINT");
  });

  it("maps boolean to TINYINT(1)", () => {
    expect(mysql.mapFieldType("boolean", {})).toBe("TINYINT(1)");
  });

  it("maps date to DATETIME", () => {
    expect(mysql.mapFieldType("date", {})).toBe("DATETIME");
  });
});

// ---------------------------------------------------------------------------
// SELECT compilation — verifies backtick quoting reaches the SQL output
// ---------------------------------------------------------------------------

describe("MySQL compileSelect()", () => {
  it("emits backtick-quoted identifiers throughout", () => {
    const query = from(User);
    const compiled = mysql.compileSelect(query);

    expect(compiled.sql.includes("`users`")).toBeTruthy();
    expect(compiled.sql.includes('"users"')).toBe(false);
  });

  it("uses ? for WHERE parameters and collects them in order", () => {
    const query = pipe(from(User), where(eq("email", "a@example.com")));
    const compiled = mysql.compileSelect(query);

    expect(compiled.sql.includes("?")).toBeTruthy();
    expect(compiled.sql.includes("$1")).toBe(false);
    expect(compiled.params.length).toBe(1);
    expect(compiled.params[0]).toBe("a@example.com");
  });
});

// ---------------------------------------------------------------------------
// Capabilities — the contract downstream code branches on
// ---------------------------------------------------------------------------

describe("MySQL capabilities", () => {
  const c = mysql.capabilities;

  it("uses question-mark parameters", () => {
    expect(c.parameterStyle).toBe("question");
  });

  it("uses backtick identifiers", () => {
    expect(c.identifierQuote).toBe("`");
  });

  it("uses ON DUPLICATE KEY upserts", () => {
    expect(c.upsertStyle).toBe("onDuplicateKey");
  });

  it("declares non-transactional DDL", () => {
    expect(c.supportsTransactionalDDL).toBe(false);
  });

  it("declares no RETURNING by default (connectors lift per version)", () => {
    expect(c.supportsReturning).toBe(false);
  });

  it("uses NOW() for the current timestamp", () => {
    expect(c.currentTimestampSql).toBe("NOW()");
  });

  it("uses the lock-table strategy", () => {
    expect(c.lockStrategy).toBe("lockTable");
  });
});

// ---------------------------------------------------------------------------
// Registry — both 'mysql' and 'mariadb' resolve to the same dialect
// ---------------------------------------------------------------------------

describe("dialect registry", () => {
  it("resolves 'mysql' to the MySQL dialect", () => {
    const result = resolveDialect("mysql");
    expect(result.isOk).toBeTruthy();
    if (result.isOk) {
      expect(result.value.name).toBe("mysql");
    }
  });

  it("resolves 'mariadb' to the same MySQL dialect", () => {
    const result = resolveDialect("mariadb");
    expect(result.isOk).toBeTruthy();
    if (result.isOk) {
      // Both names share the implementation; the name reported reflects the
      // physical dialect, not the registered alias.
      expect(result.value.name).toBe("mysql");
    }
  });
});
