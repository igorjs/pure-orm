// Copyright 2026 igorjs. SPDX-License-Identifier: Apache-2.0

/**
 * End-to-end integration tests for @igorjs/pure-orm.
 *
 * Exercises the full pipeline — model definition, query building, compilation,
 * and execution — using mock drivers so no real database connection is needed.
 *
 * These tests verify that all public exports wire together correctly and that
 * data flows cleanly from a QueryNode through the dialect into typed results.
 */

import { Schema, Task } from "@igorjs/pure-fx";
import { describe, expect, it } from "@igorjs/pure-test";

import type { DatabaseClient, RawConnection } from "../src/connection/types.ts";
import {
  and,
  between,
  // Execution
  compile,
  // Logging
  createConsoleLogger,
  createLambdaPool,
  createNoopLogger,
  // Connection
  createPool,
  // Dialect
  createPostgresDialect,
  createSqliteDialect,
  Database,
  dispatchHook,
  // Condition functions
  eq,
  execute,
  Field,
  findOne,
  // Query builders
  from,
  gt,
  gte,
  // Phase 2 mutations
  hardRemove,
  ilike,
  inArray,
  insert,
  insertMany,
  isNotNull,
  isNull,
  isTransactionClient,
  like,
  limit,
  lt,
  lte,
  // Model layer
  Model,
  mapRows,
  ne,
  not,
  offset,
  onConflict,
  or,
  orderBy,
  registerDialect,
  remove,
  resolveDialect,
  returning,
  select,
  snakeToCamel,
  startTimer,
  transaction,
  update,
  where,
} from "../src/index.ts";

// ---------------------------------------------------------------------------
// Shared test model
// ---------------------------------------------------------------------------

const User = Model("users", {
  fields: {
    id: Field(Schema.string, { primaryKey: true, default: "uuid" }),
    email: Field(Schema.string, { unique: true }),
    name: Field(Schema.string),
    role: Field(Schema.string, { default: "user" }),
    age: Field(Schema.number),
  },
  options: { timestamps: true, softDelete: true },
});

// ---------------------------------------------------------------------------
// Mock DatabaseClient helpers (mirrors the pattern from execute.test.ts)
// ---------------------------------------------------------------------------

const createMockDb = (rows: readonly Record<string, unknown>[]): DatabaseClient => {
  const mockConn: RawConnection = {
    query: async () => ({ rows, rowCount: rows.length }),
    release: async () => undefined,
    end: async () => undefined,
  };
  return {
    dialect: createPostgresDialect(),
    pool: {
      acquire: () => Task.of(mockConn),
      release: () => Task.of<void>(undefined),
      end: () => Task.of<void>(undefined),
      mode: "pool" as const,
    },
    logger: createNoopLogger(),
    hooks: {},
  };
};

// ---------------------------------------------------------------------------
// 1. Full compile pipeline
// ---------------------------------------------------------------------------

describe("integration: full compile pipeline", () => {
  it("compiles a query with WHERE, ORDER BY, and LIMIT into correct SQL", () => {
    // Build query using manual composition to avoid importing pipe from @igorjs/pure-fx
    // (the public API test below confirms it works with the barrel export).
    const query = limit(10)(
      orderBy("name", "asc")(where(and(eq("role", "admin"), gt("age", 25)))(from(User))),
    );

    const { sql, params } = compile(query);

    // SELECT and FROM clauses
    expect(sql.includes("SELECT")).toBeTruthy();
    expect(sql.includes('FROM "users"')).toBeTruthy();

    // WHERE clause: soft-delete model always adds deleted_at IS NULL
    expect(sql.includes("WHERE")).toBeTruthy();
    expect(sql.includes('"role"')).toBeTruthy();
    expect(sql.includes('"age"')).toBeTruthy();
    expect(sql.includes('"deleted_at" IS NULL')).toBeTruthy();

    // ORDER BY clause
    expect(sql.includes("ORDER BY")).toBeTruthy();
    expect(sql.includes('"name" ASC')).toBeTruthy();

    // LIMIT clause
    expect(sql.includes("LIMIT")).toBeTruthy();

    // Parameters: "admin" (role eq), 25 (age gt), 10 (limit)
    expect(params.length).toBe(3);
    expect(params[0]).toBe("admin");
    expect(params[1]).toBe(25);
    expect(params[2]).toBe(10);
  });

  it("compiles a bare from() into a simple SELECT *", () => {
    const { sql, params } = compile(from(User));

    // Soft-delete model always injects the deleted_at filter even with no
    // explicit where(), so the WHERE clause is still present.
    expect(sql.startsWith("SELECT")).toBeTruthy();
    expect(sql.includes('FROM "users"')).toBeTruthy();
    // Soft-delete adds WHERE deleted_at IS NULL, so no user-supplied params.
    expect(params.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 2. Full execute pipeline with mock driver
// ---------------------------------------------------------------------------

describe("integration: full execute pipeline with mock driver", () => {
  it("executes a query and returns Ok with a typed List of camelCase Records", async () => {
    const mockRows = [
      {
        id: "u1",
        email: "alice@example.com",
        name: "Alice",
        role: "admin",
        age: 30,
        created_at: "2026-01-01",
        updated_at: "2026-01-01",
      },
    ];
    const db = createMockDb(mockRows);

    // Build query manually (same shape as pipe would produce).
    const query = where(eq("role", "admin"))(from(User));
    const result = await execute(db)(query).run();

    expect(result.isOk).toBe(true);
    if (result.isOk) {
      const list = result.value;
      expect(list.length).toBe(1);

      const first = list.first();
      expect(first.isSome).toBe(true);
      if (first.isSome) {
        // Records expose $raw for direct inspection
        const raw = first.value.$raw as Record<string, unknown>;

        // snake_case DB columns must arrive as camelCase
        expect(raw["id"]).toBe("u1");
        expect(raw["email"]).toBe("alice@example.com");
        expect(raw["name"]).toBe("Alice");
        expect(raw["role"]).toBe("admin");
        expect(raw["age"]).toBe(30);
        expect(raw["createdAt"]).toBe("2026-01-01");
        expect(raw["updatedAt"]).toBe("2026-01-01");
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 3. findOne returns None for an empty result
// ---------------------------------------------------------------------------

describe("integration: findOne returns None for empty result", () => {
  it("returns Ok(None) when the mock driver returns no rows", async () => {
    const db = createMockDb([]);
    const query = where(eq("role", "admin"))(from(User));
    const result = await findOne(db)(query).run();

    expect(result.isOk).toBe(true);
    if (result.isOk) {
      expect(result.value.isNone).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Soft-delete model compile: deleted_at IS NULL always injected
// ---------------------------------------------------------------------------

describe("integration: soft-delete model injects deleted_at filter", () => {
  it("includes deleted_at IS NULL in WHERE for a soft-delete model", () => {
    const { sql } = compile(from(User));
    expect(sql.includes('"deleted_at" IS NULL')).toBeTruthy();
  });

  it("places deleted_at IS NULL alongside user-supplied conditions", () => {
    const query = where(eq("role", "admin"))(from(User));
    const { sql, params } = compile(query);

    expect(sql.includes('"role" = $1')).toBeTruthy();
    expect(sql.includes('"deleted_at" IS NULL')).toBeTruthy();
    expect(params[0]).toBe("admin");
  });
});

// ---------------------------------------------------------------------------
// 5. All public exports are accessible
// ---------------------------------------------------------------------------

describe("integration: all public exports from src/index.ts are defined", () => {
  it("model layer exports are defined", () => {
    expect(Model !== undefined).toBeTruthy();
    expect(Field !== undefined).toBeTruthy();
  });

  it("query builder exports are defined", () => {
    expect(from !== undefined).toBeTruthy();
    expect(select !== undefined).toBeTruthy();
    expect(where !== undefined).toBeTruthy();
    expect(orderBy !== undefined).toBeTruthy();
    expect(limit !== undefined).toBeTruthy();
    expect(offset !== undefined).toBeTruthy();
  });

  it("condition function exports are defined", () => {
    expect(eq !== undefined).toBeTruthy();
    expect(ne !== undefined).toBeTruthy();
    expect(gt !== undefined).toBeTruthy();
    expect(gte !== undefined).toBeTruthy();
    expect(lt !== undefined).toBeTruthy();
    expect(lte !== undefined).toBeTruthy();
    expect(like !== undefined).toBeTruthy();
    expect(ilike !== undefined).toBeTruthy();
    expect(isNull !== undefined).toBeTruthy();
    expect(isNotNull !== undefined).toBeTruthy();
    expect(inArray !== undefined).toBeTruthy();
    expect(between !== undefined).toBeTruthy();
    expect(not !== undefined).toBeTruthy();
    expect(and !== undefined).toBeTruthy();
    expect(or !== undefined).toBeTruthy();
  });

  it("dialect exports are defined", () => {
    expect(createPostgresDialect !== undefined).toBeTruthy();
    expect(registerDialect !== undefined).toBeTruthy();
    expect(resolveDialect !== undefined).toBeTruthy();
  });

  it("logging exports are defined", () => {
    expect(createConsoleLogger !== undefined).toBeTruthy();
    expect(createNoopLogger !== undefined).toBeTruthy();
    expect(dispatchHook !== undefined).toBeTruthy();
    expect(startTimer !== undefined).toBeTruthy();
  });

  it("execution exports are defined", () => {
    expect(compile !== undefined).toBeTruthy();
    expect(execute !== undefined).toBeTruthy();
    expect(findOne !== undefined).toBeTruthy();
    expect(mapRows !== undefined).toBeTruthy();
    expect(snakeToCamel !== undefined).toBeTruthy();
  });

  it("connection exports are defined", () => {
    expect(createPool !== undefined).toBeTruthy();
    expect(createLambdaPool !== undefined).toBeTruthy();
    expect(Database !== undefined).toBeTruthy();
  });

  it("createSqliteDialect export is defined", () => {
    expect(createSqliteDialect !== undefined).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 6. Cross-dialect comparison: PostgreSQL vs SQLite
// ---------------------------------------------------------------------------

describe("integration: cross-dialect query compilation", () => {
  // Shared model for this test group.
  const Product = Model("products", {
    fields: {
      id: Field(Schema.string, { primaryKey: true }),
      name: Field(Schema.string),
      category: Field(Schema.string),
    },
    options: {},
  });

  const toRef = (model: typeof Product) => ({
    name: model.$name,
    columns: model.$columns,
    options: model.$options,
  });

  const makeProductSelect = (
    overrides: Partial<{
      conditions: ReturnType<typeof eq>[];
      limit: number | null;
      offset: number | null;
    }> = {},
  ) =>
    Object.freeze({
      tag: "Select" as const,
      model: toRef(Product),
      columns: "*" as const,
      conditions: overrides.conditions ?? [],
      joins: [],
      ctes: [],
      groupBy: [],
      having: [],
      orderBy: [],
      limit: overrides.limit ?? null,
      offset: overrides.offset ?? null,
      softDeleteFilter: false,
    });

  it("PostgreSQL uses $N placeholders while SQLite uses ?", () => {
    const pgDialect = createPostgresDialect();
    const sqliteDialect = createSqliteDialect();

    const node = makeProductSelect({
      conditions: [eq("name", "Widget"), eq("category", "Gadgets")],
    });

    const pgResult = pgDialect.compileSelect(node);
    const sqliteResult = sqliteDialect.compileSelect(node);

    // PostgreSQL: positional numbered params
    expect(pgResult.sql.includes("$1")).toBeTruthy();
    expect(pgResult.sql.includes("$2")).toBeTruthy();
    expect(!pgResult.sql.includes("?")).toBeTruthy();

    // SQLite: anonymous ? placeholders
    expect(sqliteResult.sql.includes("?")).toBeTruthy();
    expect(!sqliteResult.sql.includes("$")).toBeTruthy();

    // Both produce the same params array (same values, same order).
    expect(pgResult.params).toEqual(["Widget", "Gadgets"]);
    expect(sqliteResult.params).toEqual(["Widget", "Gadgets"]);
  });

  it("PostgreSQL uses ILIKE while SQLite compiles the same ilike() call as LIKE", () => {
    const pgDialect = createPostgresDialect();
    const sqliteDialect = createSqliteDialect();

    const node = makeProductSelect({ conditions: [ilike("name", "%widget%")] });

    const pgResult = pgDialect.compileSelect(node);
    const sqliteResult = sqliteDialect.compileSelect(node);

    // PG preserves ILIKE.
    expect(pgResult.sql.includes("ILIKE")).toBeTruthy();

    // SQLite downgrades to LIKE.
    expect(sqliteResult.sql.includes("LIKE")).toBeTruthy();
    expect(!sqliteResult.sql.includes("ILIKE")).toBeTruthy();

    // Both carry the same pattern value.
    expect(pgResult.params).toEqual(["%widget%"]);
    expect(sqliteResult.params).toEqual(["%widget%"]);
  });
});

// ---------------------------------------------------------------------------
// Phase 2 integration tests
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 7. Insert + compile pipeline
// ---------------------------------------------------------------------------

describe("integration: insert compile pipeline", () => {
  it("compiles an insert with RETURNING into correct SQL", () => {
    // Compose without pipe to avoid importing it — demonstrates the same
    // shape that pipe() would produce.
    const query = returning(
      "id",
      "email",
    )(insert(User, { email: "alice@test.com", name: "Alice" }));
    const { sql, params } = compile(query);

    expect(sql.includes("INSERT INTO")).toBeTruthy();
    expect(sql.includes('"users"')).toBeTruthy();
    expect(sql.includes("VALUES")).toBeTruthy();
    expect(sql.includes("RETURNING")).toBeTruthy();
    expect(sql.includes('"email"')).toBeTruthy();
    expect(sql.includes('"id"')).toBeTruthy();

    // Two values: email and name.
    expect(params.length).toBe(2);
    expect(params.includes("alice@test.com")).toBeTruthy();
    expect(params.includes("Alice")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 8. Insert + execute with mock: RETURNING rows are camelCased
// ---------------------------------------------------------------------------

describe("integration: insert execute with mock driver", () => {
  it("executes an insert with RETURNING and maps snake_case columns to camelCase", async () => {
    const mockRows = [{ id: "u2", email: "alice@test.com" }];
    const db = createMockDb(mockRows);

    const query = returning(
      "id",
      "email",
    )(insert(User, { email: "alice@test.com", name: "Alice" }));
    const result = await execute(db)(query).run();

    expect(result.isOk).toBe(true);
    if (result.isOk) {
      const list = result.value;
      expect(list.length).toBe(1);

      const first = list.first();
      expect(first.isSome).toBe(true);
      if (first.isSome) {
        const raw = first.value.$raw as Record<string, unknown>;
        expect(raw["id"]).toBe("u2");
        expect(raw["email"]).toBe("alice@test.com");
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 9. Update + where + returning compile
// ---------------------------------------------------------------------------

describe("integration: update compile pipeline", () => {
  it("compiles an update with WHERE and RETURNING into correct SQL", () => {
    const query = returning("*")(
      where(eq("email", "alice@test.com"))(update(User, { role: "admin" })),
    );
    const { sql, params } = compile(query);

    expect(sql.includes("UPDATE")).toBeTruthy();
    expect(sql.includes('"users"')).toBeTruthy();
    expect(sql.includes("SET")).toBeTruthy();
    expect(sql.includes("WHERE")).toBeTruthy();
    expect(sql.includes('"email"')).toBeTruthy();
    expect(sql.includes("RETURNING")).toBeTruthy();

    // params: role value ("admin") + email value ("alice@test.com")
    // Note: softDeleteFilter on update scopes to non-deleted rows, so
    // deleted_at IS NULL is added to WHERE but produces no extra param.
    expect(params.includes("admin")).toBeTruthy();
    expect(params.includes("alice@test.com")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 10. Soft delete compile
// ---------------------------------------------------------------------------

describe("integration: soft delete compile", () => {
  it("compiles remove() as UPDATE SET deleted_at = NOW(), not DELETE FROM", () => {
    const query = where(eq("id", "u1"))(remove(User));
    const { sql } = compile(query);

    expect(sql.includes("UPDATE")).toBeTruthy();
    expect(sql.includes('"deleted_at"')).toBeTruthy();
    expect(sql.includes("NOW()")).toBeTruthy();
    expect(!sql.startsWith("DELETE")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 11. Hard delete compile
// ---------------------------------------------------------------------------

describe("integration: hard delete compile", () => {
  it("compiles hardRemove() as DELETE FROM, not UPDATE", () => {
    const query = where(eq("id", "u1"))(hardRemove(User));
    const { sql } = compile(query);

    expect(sql.includes("DELETE FROM")).toBeTruthy();
    expect(sql.includes('"users"')).toBeTruthy();
    expect(!sql.includes("UPDATE")).toBeTruthy();
    expect(!sql.includes("deleted_at")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 12. Upsert compile (onConflict DO UPDATE SET)
// ---------------------------------------------------------------------------

describe("integration: upsert compile pipeline", () => {
  it("compiles insert + onConflict with DO UPDATE SET clause", () => {
    const query = returning("*")(
      onConflict("email", { update: ["name"] })(
        insert(User, { email: "alice@test.com", name: "Alice" }),
      ),
    );
    const { sql } = compile(query);

    expect(sql.includes("INSERT INTO")).toBeTruthy();
    expect(sql.includes("ON CONFLICT")).toBeTruthy();
    expect(sql.includes("DO UPDATE SET")).toBeTruthy();
    expect(sql.includes("EXCLUDED")).toBeTruthy();
    expect(sql.includes("RETURNING")).toBeTruthy();
  });

  it("compiles insert + onConflict DO NOTHING", () => {
    const query = onConflict(
      "email",
      "nothing",
    )(insert(User, { email: "alice@test.com", name: "Alice" }));
    const { sql } = compile(query);

    expect(sql.includes("ON CONFLICT")).toBeTruthy();
    expect(sql.includes("DO NOTHING")).toBeTruthy();
    expect(!sql.includes("DO UPDATE")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 13. Transaction with mock driver
// ---------------------------------------------------------------------------

describe("integration: transaction with mock driver", () => {
  it("executes BEGIN and COMMIT and returns Ok with the callback result", async () => {
    const executedSql: string[] = [];

    const mockConn: RawConnection = {
      query: async (sql: string) => {
        executedSql.push(sql);
        return { rows: [], rowCount: 0 };
      },
      release: async () => undefined,
      end: async () => undefined,
    };

    const db: DatabaseClient = {
      dialect: createPostgresDialect(),
      pool: {
        acquire: () => Task.of(mockConn),
        release: () => Task.of<void>(undefined),
        end: () => Task.of<void>(undefined),
        mode: "pool" as const,
      },
      logger: createNoopLogger(),
      hooks: {},
    };

    const result = await transaction(db, async _tx => "done").run();

    expect(result.isOk).toBe(true);
    if (result.isOk) {
      expect(result.value).toBe("done");
    }

    // BEGIN must be first and COMMIT must follow.
    expect(executedSql.some(s => s.startsWith("BEGIN"))).toBeTruthy();
    expect(executedSql.includes("COMMIT")).toBeTruthy();
  });

  it("executes ROLLBACK when the callback throws", async () => {
    const executedSql: string[] = [];

    const mockConn: RawConnection = {
      query: async (sql: string) => {
        executedSql.push(sql);
        return { rows: [], rowCount: 0 };
      },
      release: async () => undefined,
      end: async () => undefined,
    };

    const db: DatabaseClient = {
      dialect: createPostgresDialect(),
      pool: {
        acquire: () => Task.of(mockConn),
        release: () => Task.of<void>(undefined),
        end: () => Task.of<void>(undefined),
        mode: "pool" as const,
      },
      logger: createNoopLogger(),
      hooks: {},
    };

    const result = await transaction(db, async _tx => {
      throw new Error("boom");
    }).run();

    expect(result.isErr).toBe(true);
    expect(executedSql.includes("ROLLBACK")).toBeTruthy();
    expect(!executedSql.includes("COMMIT")).toBeTruthy();
  });

  it("isTransactionClient returns false for a plain DatabaseClient", () => {
    const db = createMockDb([]);
    expect(isTransactionClient(db)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 14. All Phase 2 exports are accessible
// ---------------------------------------------------------------------------

describe("integration: all Phase 2 public exports from src/index.ts are defined", () => {
  it("mutation builder exports are defined", () => {
    expect(insert !== undefined).toBeTruthy();
    expect(insertMany !== undefined).toBeTruthy();
    expect(update !== undefined).toBeTruthy();
    expect(remove !== undefined).toBeTruthy();
    expect(hardRemove !== undefined).toBeTruthy();
    expect(returning !== undefined).toBeTruthy();
    expect(onConflict !== undefined).toBeTruthy();
  });

  it("transaction exports are defined", () => {
    expect(transaction !== undefined).toBeTruthy();
    expect(isTransactionClient !== undefined).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 15. Cross-dialect mutation comparison: PG vs SQLite param style
// ---------------------------------------------------------------------------

describe("integration: cross-dialect mutation compilation", () => {
  it("PG insert uses $N placeholders while SQLite insert uses ?", () => {
    const pgDialect = createPostgresDialect();
    const sqliteDialect = createSqliteDialect();

    const node = insert(User, { email: "bob@test.com", name: "Bob" });

    const pgResult = pgDialect.compileInsert(node);
    const sqliteResult = sqliteDialect.compileInsert(node);

    // PostgreSQL: positional $1, $2
    expect(pgResult.sql.includes("$1")).toBeTruthy();
    expect(!pgResult.sql.includes("?")).toBeTruthy();

    // SQLite: anonymous ?
    expect(sqliteResult.sql.includes("?")).toBeTruthy();
    expect(!sqliteResult.sql.includes("$")).toBeTruthy();

    // Both share the same param values.
    expect([...pgResult.params].sort()).toEqual([...sqliteResult.params].sort());
  });
});
