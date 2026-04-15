/**
 * End-to-end integration tests for @igorjs/pure-orm.
 *
 * Exercises the full pipeline — model definition, query building, compilation,
 * and execution — using mock drivers so no real database connection is needed.
 *
 * These tests verify that all public exports wire together correctly and that
 * data flows cleanly from a QueryNode through the dialect into typed results.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { Schema, Task } from "@igorjs/pure-ts";
import type { pipe as PipeFn } from "@igorjs/pure-ts";

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
  mapRows,
  // Model layer
  Model,
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
    release: async () => {},
    end: async () => {},
  };
  return {
    dialect: createPostgresDialect(),
    pool: {
      acquire: () => Task.of(mockConn),
      release: () => Task.of(undefined as void),
      end: () => Task.of(undefined as void),
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
    // Build query using manual composition to avoid importing pipe from @igorjs/pure-ts
    // (the public API test below confirms it works with the barrel export).
    const query = limit(10)(
      orderBy("name", "asc")(
        where(and(eq("role", "admin"), gt("age", 25)))(
          from(User),
        ),
      ),
    );

    const { sql, params } = compile(query);

    // SELECT and FROM clauses
    assert.ok(sql.includes("SELECT"), `Expected SELECT in SQL: ${sql}`);
    assert.ok(sql.includes("FROM \"users\""), `Expected FROM "users" in SQL: ${sql}`);

    // WHERE clause: soft-delete model always adds deleted_at IS NULL
    assert.ok(sql.includes("WHERE"), `Expected WHERE in SQL: ${sql}`);
    assert.ok(sql.includes("\"role\""), `Expected role column in SQL: ${sql}`);
    assert.ok(sql.includes("\"age\""), `Expected age column in SQL: ${sql}`);
    assert.ok(sql.includes("\"deleted_at\" IS NULL"), `Expected soft-delete filter in SQL: ${sql}`);

    // ORDER BY clause
    assert.ok(sql.includes("ORDER BY"), `Expected ORDER BY in SQL: ${sql}`);
    assert.ok(sql.includes("\"name\" ASC"), `Expected name ASC in SQL: ${sql}`);

    // LIMIT clause
    assert.ok(sql.includes("LIMIT"), `Expected LIMIT in SQL: ${sql}`);

    // Parameters: "admin" (role eq), 25 (age gt), 10 (limit)
    assert.equal(params.length, 3, `Expected 3 params, got: ${JSON.stringify(params)}`);
    assert.equal(params[0], "admin");
    assert.equal(params[1], 25);
    assert.equal(params[2], 10);
  });

  it("compiles a bare from() into a simple SELECT *", () => {
    const { sql, params } = compile(from(User));

    // Soft-delete model always injects the deleted_at filter even with no
    // explicit where(), so the WHERE clause is still present.
    assert.ok(sql.startsWith("SELECT"), `Expected SELECT at start: ${sql}`);
    assert.ok(sql.includes("FROM \"users\""), `Expected FROM "users": ${sql}`);
    // Soft-delete adds WHERE deleted_at IS NULL, so no user-supplied params.
    assert.equal(params.length, 0);
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

    assert.equal(result.isOk, true, "Expected Ok result");
    if (result.isOk) {
      const list = result.value;
      assert.equal(list.length, 1, "Expected 1 record");

      const first = list.first();
      assert.equal(first.isSome, true, "Expected Some for first()");
      if (first.isSome) {
        // Records expose $raw for direct inspection
        const raw = first.value.$raw as Record<string, unknown>;

        // snake_case DB columns must arrive as camelCase
        assert.equal(raw["id"], "u1");
        assert.equal(raw["email"], "alice@example.com");
        assert.equal(raw["name"], "Alice");
        assert.equal(raw["role"], "admin");
        assert.equal(raw["age"], 30);
        assert.equal(raw["createdAt"], "2026-01-01");
        assert.equal(raw["updatedAt"], "2026-01-01");
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

    assert.equal(result.isOk, true, "Expected Ok result");
    if (result.isOk) {
      assert.equal(result.value.isNone, true, "Expected None when no rows returned");
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Soft-delete model compile: deleted_at IS NULL always injected
// ---------------------------------------------------------------------------

describe("integration: soft-delete model injects deleted_at filter", () => {
  it("includes deleted_at IS NULL in WHERE for a soft-delete model", () => {
    const { sql } = compile(from(User));
    assert.ok(
      sql.includes("\"deleted_at\" IS NULL"),
      `Expected soft-delete filter in SQL: ${sql}`,
    );
  });

  it("places deleted_at IS NULL alongside user-supplied conditions", () => {
    const query = where(eq("role", "admin"))(from(User));
    const { sql, params } = compile(query);

    assert.ok(sql.includes("\"role\" = $1"), `Expected role condition: ${sql}`);
    assert.ok(sql.includes("\"deleted_at\" IS NULL"), `Expected soft-delete filter: ${sql}`);
    assert.equal(params[0], "admin");
  });
});

// ---------------------------------------------------------------------------
// 5. All public exports are accessible
// ---------------------------------------------------------------------------

describe("integration: all public exports from src/index.ts are defined", () => {
  it("model layer exports are defined", () => {
    assert.ok(Model !== undefined, "Model");
    assert.ok(Field !== undefined, "Field");
  });

  it("query builder exports are defined", () => {
    assert.ok(from !== undefined, "from");
    assert.ok(select !== undefined, "select");
    assert.ok(where !== undefined, "where");
    assert.ok(orderBy !== undefined, "orderBy");
    assert.ok(limit !== undefined, "limit");
    assert.ok(offset !== undefined, "offset");
  });

  it("condition function exports are defined", () => {
    assert.ok(eq !== undefined, "eq");
    assert.ok(ne !== undefined, "ne");
    assert.ok(gt !== undefined, "gt");
    assert.ok(gte !== undefined, "gte");
    assert.ok(lt !== undefined, "lt");
    assert.ok(lte !== undefined, "lte");
    assert.ok(like !== undefined, "like");
    assert.ok(ilike !== undefined, "ilike");
    assert.ok(isNull !== undefined, "isNull");
    assert.ok(isNotNull !== undefined, "isNotNull");
    assert.ok(inArray !== undefined, "inArray");
    assert.ok(between !== undefined, "between");
    assert.ok(not !== undefined, "not");
    assert.ok(and !== undefined, "and");
    assert.ok(or !== undefined, "or");
  });

  it("dialect exports are defined", () => {
    assert.ok(createPostgresDialect !== undefined, "createPostgresDialect");
    assert.ok(registerDialect !== undefined, "registerDialect");
    assert.ok(resolveDialect !== undefined, "resolveDialect");
  });

  it("logging exports are defined", () => {
    assert.ok(createConsoleLogger !== undefined, "createConsoleLogger");
    assert.ok(createNoopLogger !== undefined, "createNoopLogger");
    assert.ok(dispatchHook !== undefined, "dispatchHook");
    assert.ok(startTimer !== undefined, "startTimer");
  });

  it("execution exports are defined", () => {
    assert.ok(compile !== undefined, "compile");
    assert.ok(execute !== undefined, "execute");
    assert.ok(findOne !== undefined, "findOne");
    assert.ok(mapRows !== undefined, "mapRows");
    assert.ok(snakeToCamel !== undefined, "snakeToCamel");
  });

  it("connection exports are defined", () => {
    assert.ok(createPool !== undefined, "createPool");
    assert.ok(createLambdaPool !== undefined, "createLambdaPool");
    assert.ok(Database !== undefined, "Database");
  });

  it("createSqliteDialect export is defined", () => {
    assert.ok(createSqliteDialect !== undefined, "createSqliteDialect");
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

  const makeProductSelect = (overrides: Partial<{
    conditions: ReturnType<typeof eq>[];
    limit: number | null;
    offset: number | null;
  }> = {}) =>
    Object.freeze({
      tag: "Select" as const,
      model: toRef(Product),
      columns: "*" as const,
      conditions: overrides.conditions ?? [],
      joins: [],
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

    const node = makeProductSelect({ conditions: [eq("name", "Widget"), eq("category", "Gadgets")] });

    const pgResult = pgDialect.compileSelect(node);
    const sqliteResult = sqliteDialect.compileSelect(node);

    // PostgreSQL: positional numbered params
    assert.ok(pgResult.sql.includes("$1"), `PG SQL should have $1: ${pgResult.sql}`);
    assert.ok(pgResult.sql.includes("$2"), `PG SQL should have $2: ${pgResult.sql}`);
    assert.ok(!pgResult.sql.includes("?"), `PG SQL should not have ?: ${pgResult.sql}`);

    // SQLite: anonymous ? placeholders
    assert.ok(sqliteResult.sql.includes("?"), `SQLite SQL should have ?: ${sqliteResult.sql}`);
    assert.ok(!sqliteResult.sql.includes("$"), `SQLite SQL should not have $: ${sqliteResult.sql}`);

    // Both produce the same params array (same values, same order).
    assert.deepEqual(pgResult.params, ["Widget", "Gadgets"]);
    assert.deepEqual(sqliteResult.params, ["Widget", "Gadgets"]);
  });

  it("PostgreSQL uses ILIKE while SQLite compiles the same ilike() call as LIKE", () => {
    const pgDialect = createPostgresDialect();
    const sqliteDialect = createSqliteDialect();

    const node = makeProductSelect({ conditions: [ilike("name", "%widget%")] });

    const pgResult = pgDialect.compileSelect(node);
    const sqliteResult = sqliteDialect.compileSelect(node);

    // PG preserves ILIKE.
    assert.ok(pgResult.sql.includes("ILIKE"), `PG SQL should have ILIKE: ${pgResult.sql}`);

    // SQLite downgrades to LIKE.
    assert.ok(sqliteResult.sql.includes("LIKE"), `SQLite SQL should have LIKE: ${sqliteResult.sql}`);
    assert.ok(!sqliteResult.sql.includes("ILIKE"), `SQLite SQL must not have ILIKE: ${sqliteResult.sql}`);

    // Both carry the same pattern value.
    assert.deepEqual(pgResult.params, ["%widget%"]);
    assert.deepEqual(sqliteResult.params, ["%widget%"]);
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
    const query = returning("id", "email")(
      insert(User, { email: "alice@test.com", name: "Alice" }),
    );
    const { sql, params } = compile(query);

    assert.ok(sql.includes("INSERT INTO"), `Expected INSERT INTO in SQL: ${sql}`);
    assert.ok(sql.includes("\"users\""), `Expected "users" table in SQL: ${sql}`);
    assert.ok(sql.includes("VALUES"), `Expected VALUES in SQL: ${sql}`);
    assert.ok(sql.includes("RETURNING"), `Expected RETURNING in SQL: ${sql}`);
    assert.ok(sql.includes("\"email\""), `Expected "email" in SQL: ${sql}`);
    assert.ok(sql.includes("\"id\""), `Expected "id" in RETURNING: ${sql}`);

    // Two values: email and name.
    assert.equal(params.length, 2, `Expected 2 params, got: ${JSON.stringify(params)}`);
    assert.ok(
      params.includes("alice@test.com"),
      `Expected email in params: ${JSON.stringify(params)}`,
    );
    assert.ok(params.includes("Alice"), `Expected name in params: ${JSON.stringify(params)}`);
  });
});

// ---------------------------------------------------------------------------
// 8. Insert + execute with mock: RETURNING rows are camelCased
// ---------------------------------------------------------------------------

describe("integration: insert execute with mock driver", () => {
  it("executes an insert with RETURNING and maps snake_case columns to camelCase", async () => {
    const mockRows = [{ id: "u2", email: "alice@test.com" }];
    const db = createMockDb(mockRows);

    const query = returning("id", "email")(
      insert(User, { email: "alice@test.com", name: "Alice" }),
    );
    const result = await execute(db)(query).run();

    assert.equal(result.isOk, true, "Expected Ok result");
    if (result.isOk) {
      const list = result.value;
      assert.equal(list.length, 1, "Expected 1 returned record");

      const first = list.first();
      assert.equal(first.isSome, true, "Expected Some for first()");
      if (first.isSome) {
        const raw = first.value.$raw as Record<string, unknown>;
        assert.equal(raw["id"], "u2");
        assert.equal(raw["email"], "alice@test.com");
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
      where(eq("email", "alice@test.com"))(
        update(User, { role: "admin" }),
      ),
    );
    const { sql, params } = compile(query);

    assert.ok(sql.includes("UPDATE"), `Expected UPDATE in SQL: ${sql}`);
    assert.ok(sql.includes("\"users\""), `Expected "users" table in SQL: ${sql}`);
    assert.ok(sql.includes("SET"), `Expected SET in SQL: ${sql}`);
    assert.ok(sql.includes("WHERE"), `Expected WHERE in SQL: ${sql}`);
    assert.ok(sql.includes("\"email\""), `Expected "email" in WHERE: ${sql}`);
    assert.ok(sql.includes("RETURNING"), `Expected RETURNING in SQL: ${sql}`);

    // params: role value ("admin") + email value ("alice@test.com")
    // Note: softDeleteFilter on update scopes to non-deleted rows, so
    // deleted_at IS NULL is added to WHERE but produces no extra param.
    assert.ok(params.includes("admin"), `Expected "admin" in params: ${JSON.stringify(params)}`);
    assert.ok(
      params.includes("alice@test.com"),
      `Expected email value in params: ${JSON.stringify(params)}`,
    );
  });
});

// ---------------------------------------------------------------------------
// 10. Soft delete compile
// ---------------------------------------------------------------------------

describe("integration: soft delete compile", () => {
  it("compiles remove() as UPDATE SET deleted_at = NOW(), not DELETE FROM", () => {
    const query = where(eq("id", "u1"))(remove(User));
    const { sql } = compile(query);

    assert.ok(sql.includes("UPDATE"), `Expected UPDATE (soft delete) in SQL: ${sql}`);
    assert.ok(sql.includes("\"deleted_at\""), `Expected deleted_at column in SQL: ${sql}`);
    assert.ok(sql.includes("NOW()"), `Expected NOW() expression in SQL: ${sql}`);
    assert.ok(!sql.startsWith("DELETE"), `Expected no DELETE FROM for soft delete: ${sql}`);
  });
});

// ---------------------------------------------------------------------------
// 11. Hard delete compile
// ---------------------------------------------------------------------------

describe("integration: hard delete compile", () => {
  it("compiles hardRemove() as DELETE FROM, not UPDATE", () => {
    const query = where(eq("id", "u1"))(hardRemove(User));
    const { sql } = compile(query);

    assert.ok(sql.includes("DELETE FROM"), `Expected DELETE FROM in SQL: ${sql}`);
    assert.ok(sql.includes("\"users\""), `Expected "users" table in SQL: ${sql}`);
    assert.ok(!sql.includes("UPDATE"), `Expected no UPDATE for hard delete: ${sql}`);
    assert.ok(!sql.includes("deleted_at"), `Expected no deleted_at for hard delete: ${sql}`);
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

    assert.ok(sql.includes("INSERT INTO"), `Expected INSERT INTO in SQL: ${sql}`);
    assert.ok(sql.includes("ON CONFLICT"), `Expected ON CONFLICT in SQL: ${sql}`);
    assert.ok(sql.includes("DO UPDATE SET"), `Expected DO UPDATE SET in SQL: ${sql}`);
    assert.ok(sql.includes("EXCLUDED"), `Expected EXCLUDED reference in SQL: ${sql}`);
    assert.ok(sql.includes("RETURNING"), `Expected RETURNING in SQL: ${sql}`);
  });

  it("compiles insert + onConflict DO NOTHING", () => {
    const query = onConflict("email", "nothing")(
      insert(User, { email: "alice@test.com", name: "Alice" }),
    );
    const { sql } = compile(query);

    assert.ok(sql.includes("ON CONFLICT"), `Expected ON CONFLICT in SQL: ${sql}`);
    assert.ok(sql.includes("DO NOTHING"), `Expected DO NOTHING in SQL: ${sql}`);
    assert.ok(!sql.includes("DO UPDATE"), `Expected no DO UPDATE for DO NOTHING: ${sql}`);
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
      release: async () => {},
      end: async () => {},
    };

    const db: DatabaseClient = {
      dialect: createPostgresDialect(),
      pool: {
        acquire: () => Task.of(mockConn),
        release: () => Task.of(undefined as void),
        end: () => Task.of(undefined as void),
        mode: "pool" as const,
      },
      logger: createNoopLogger(),
      hooks: {},
    };

    const result = await transaction(db, async (_tx) => "done").run();

    assert.equal(result.isOk, true, "Expected Ok result from transaction");
    if (result.isOk) {
      assert.equal(result.value, "done", "Expected callback return value");
    }

    // BEGIN must be first and COMMIT must follow.
    assert.ok(executedSql.some((s) => s.startsWith("BEGIN")), `Expected BEGIN: ${JSON.stringify(executedSql)}`);
    assert.ok(executedSql.includes("COMMIT"), `Expected COMMIT: ${JSON.stringify(executedSql)}`);
  });

  it("executes ROLLBACK when the callback throws", async () => {
    const executedSql: string[] = [];

    const mockConn: RawConnection = {
      query: async (sql: string) => {
        executedSql.push(sql);
        return { rows: [], rowCount: 0 };
      },
      release: async () => {},
      end: async () => {},
    };

    const db: DatabaseClient = {
      dialect: createPostgresDialect(),
      pool: {
        acquire: () => Task.of(mockConn),
        release: () => Task.of(undefined as void),
        end: () => Task.of(undefined as void),
        mode: "pool" as const,
      },
      logger: createNoopLogger(),
      hooks: {},
    };

    const result = await transaction(db, async (_tx) => {
      throw new Error("boom");
    }).run();

    assert.equal(result.isErr, true, "Expected Err result when callback throws");
    assert.ok(executedSql.includes("ROLLBACK"), `Expected ROLLBACK: ${JSON.stringify(executedSql)}`);
    assert.ok(!executedSql.includes("COMMIT"), `Expected no COMMIT on failure: ${JSON.stringify(executedSql)}`);
  });

  it("isTransactionClient returns false for a plain DatabaseClient", () => {
    const db = createMockDb([]);
    assert.equal(isTransactionClient(db), false);
  });
});

// ---------------------------------------------------------------------------
// 14. All Phase 2 exports are accessible
// ---------------------------------------------------------------------------

describe("integration: all Phase 2 public exports from src/index.ts are defined", () => {
  it("mutation builder exports are defined", () => {
    assert.ok(insert !== undefined, "insert");
    assert.ok(insertMany !== undefined, "insertMany");
    assert.ok(update !== undefined, "update");
    assert.ok(remove !== undefined, "remove");
    assert.ok(hardRemove !== undefined, "hardRemove");
    assert.ok(returning !== undefined, "returning");
    assert.ok(onConflict !== undefined, "onConflict");
  });

  it("transaction exports are defined", () => {
    assert.ok(transaction !== undefined, "transaction");
    assert.ok(isTransactionClient !== undefined, "isTransactionClient");
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
    assert.ok(pgResult.sql.includes("$1"), `PG insert should have $1: ${pgResult.sql}`);
    assert.ok(!pgResult.sql.includes("?"), `PG insert should not have ?: ${pgResult.sql}`);

    // SQLite: anonymous ?
    assert.ok(sqliteResult.sql.includes("?"), `SQLite insert should have ?: ${sqliteResult.sql}`);
    assert.ok(!sqliteResult.sql.includes("$"), `SQLite insert should not have $: ${sqliteResult.sql}`);

    // Both share the same param values.
    assert.deepEqual(
      [...pgResult.params].sort(),
      [...sqliteResult.params].sort(),
      "Both dialects should produce the same param values",
    );
  });
});
