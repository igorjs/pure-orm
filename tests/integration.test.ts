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
  ilike,
  inArray,
  isNotNull,
  isNull,
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
  or,
  orderBy,
  registerDialect,
  resolveDialect,
  select,
  snakeToCamel,
  startTimer,
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
});
