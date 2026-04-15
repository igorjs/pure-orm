/**
 * Connection layer tests.
 *
 * Uses mock drivers to verify pool and lambda strategies without a real
 * database, and exercises the Database() factory assembles a correct
 * DatabaseClient.
 */

import { strict as assert } from "node:assert";
import { beforeEach, describe, it } from "node:test";

import { Database } from "../src/connection/database.ts";
import { createLambdaPool, resetLambdaConnection } from "../src/connection/lambda.ts";
import { createPool } from "../src/connection/pool.ts";
import type { ConnectionConfig, DatabaseDriver, PoolConfig, RawConnection } from "../src/connection/types.ts";
import { createNoopLogger } from "../src/logging/logger.ts";

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

/**
 * Builds a DatabaseDriver whose connect() returns a fresh RawConnection each
 * time.  Pass overrides to control specific behaviour (e.g. a custom end()).
 */
const createMockDriver = (overrides?: Partial<RawConnection>): DatabaseDriver => ({
  connect: async () => ({
    query: async () => ({ rows: [], rowCount: 0 }),
    release: async () => {},
    end: async () => {},
    ...overrides,
  }),
});

const DUMMY_CONFIG: ConnectionConfig = {
  host: "localhost",
  port: 5432,
  database: "test",
  user: "user",
  password: "pass",
};

const EMPTY_POOL_CONFIG: PoolConfig = {};

const noop = createNoopLogger();

// ---------------------------------------------------------------------------
// createPool
// ---------------------------------------------------------------------------

describe("createPool", () => {
  it("acquire returns a connection via Ok", async () => {
    // Arrange
    const pool = createPool(createMockDriver(), DUMMY_CONFIG, EMPTY_POOL_CONFIG, noop);

    // Act
    const result = await pool.acquire().run();

    // Assert
    assert.equal(result.tag, "Ok");
  });

  it("release returns connection to idle", async () => {
    // Arrange
    const pool = createPool(createMockDriver(), DUMMY_CONFIG, EMPTY_POOL_CONFIG, noop);
    const acquireResult = await pool.acquire().run();
    assert.equal(acquireResult.tag, "Ok");
    const conn = acquireResult.value;

    // Act
    const releaseResult = await pool.release(conn).run();

    // Assert
    assert.equal(releaseResult.tag, "Ok");
  });

  it("acquire after release reuses the same connection", async () => {
    // Arrange
    const pool = createPool(createMockDriver(), DUMMY_CONFIG, EMPTY_POOL_CONFIG, noop);

    // Acquire then release to park the connection.
    const first = await pool.acquire().run();
    assert.equal(first.tag, "Ok");
    await pool.release(first.value).run();

    // Act — second acquire should get the same object back.
    const second = await pool.acquire().run();

    // Assert
    assert.equal(second.tag, "Ok");
    assert.strictEqual(second.value, first.value);
  });

  it("allows acquiring up to max connections", async () => {
    // Arrange — max of 2.
    const pool = createPool(createMockDriver(), DUMMY_CONFIG, { max: 2 }, noop);

    // Act
    const r1 = await pool.acquire().run();
    const r2 = await pool.acquire().run();

    // Assert — both succeed.
    assert.equal(r1.tag, "Ok");
    assert.equal(r2.tag, "Ok");
  });

  it("third acquire times out when max is 2 and no connections released", async () => {
    // Arrange — very short timeout to keep the test fast.
    const pool = createPool(
      createMockDriver(),
      DUMMY_CONFIG,
      { max: 2, acquireTimeoutMs: 50 },
      noop,
    );

    // Consume both slots.
    await pool.acquire().run();
    await pool.acquire().run();

    // Act — third acquire should time out.
    const result = await pool.acquire().run();

    // Assert
    assert.equal(result.tag, "Err");
    assert.equal(result.error.tag, "ConnectionError");
  });

  it("end() closes all idle connections", async () => {
    // Arrange — track how many end() calls are made on raw connections.
    let closedCount = 0;
    const driver = createMockDriver({
      end: async () => {
        closedCount += 1;
      },
    });
    const pool = createPool(driver, DUMMY_CONFIG, EMPTY_POOL_CONFIG, noop);

    // Acquire then release two connections so they sit in the idle list.
    const r1 = await pool.acquire().run();
    const r2 = await pool.acquire().run();
    assert.equal(r1.tag, "Ok");
    assert.equal(r2.tag, "Ok");
    await pool.release(r1.value).run();
    await pool.release(r2.value).run();

    // Act
    const endResult = await pool.end().run();

    // Assert
    assert.equal(endResult.tag, "Ok");
    assert.equal(closedCount, 2);
  });

  it("pool mode is 'pool'", () => {
    // Arrange / Act
    const pool = createPool(createMockDriver(), DUMMY_CONFIG, EMPTY_POOL_CONFIG, noop);

    // Assert
    assert.equal(pool.mode, "pool");
  });
});

// ---------------------------------------------------------------------------
// createLambdaPool
// ---------------------------------------------------------------------------

describe("createLambdaPool", () => {
  // Reset the module-level singleton before every test so tests are isolated.
  beforeEach(() => {
    resetLambdaConnection();
  });

  it("acquire returns a connection via Ok", async () => {
    // Arrange
    const pool = createLambdaPool(createMockDriver(), DUMMY_CONFIG, EMPTY_POOL_CONFIG, noop);

    // Act
    const result = await pool.acquire().run();

    // Assert
    assert.equal(result.tag, "Ok");
  });

  it("reuses the same connection across multiple acquire() calls", async () => {
    // Arrange
    const pool = createLambdaPool(createMockDriver(), DUMMY_CONFIG, EMPTY_POOL_CONFIG, noop);

    // Act
    const r1 = await pool.acquire().run();
    const r2 = await pool.acquire().run();

    // Assert
    assert.equal(r1.tag, "Ok");
    assert.equal(r2.tag, "Ok");
    // Same object reference means driver.connect() was called only once.
    assert.strictEqual(r1.value, r2.value);
  });

  it("release is a no-op — connection remains open", async () => {
    // Arrange
    let endCalled = false;
    const pool = createLambdaPool(
      createMockDriver({
        end: async () => {
          endCalled = true;
        },
      }),
      DUMMY_CONFIG,
      EMPTY_POOL_CONFIG,
      noop,
    );
    const r = await pool.acquire().run();
    assert.equal(r.tag, "Ok");

    // Act
    const releaseResult = await pool.release(r.value).run();

    // Assert — release succeeds without closing the connection.
    assert.equal(releaseResult.tag, "Ok");
    assert.equal(endCalled, false);
  });

  it("acquire after release reuses the same connection (no-op release)", async () => {
    // Arrange
    const pool = createLambdaPool(createMockDriver(), DUMMY_CONFIG, EMPTY_POOL_CONFIG, noop);
    const r1 = await pool.acquire().run();
    assert.equal(r1.tag, "Ok");
    await pool.release(r1.value).run();

    // Act
    const r2 = await pool.acquire().run();

    // Assert — still the same connection because release was a no-op.
    assert.equal(r2.tag, "Ok");
    assert.strictEqual(r2.value, r1.value);
  });

  it("end() closes the connection and sets it to null", async () => {
    // Arrange
    let endCalled = false;
    const pool = createLambdaPool(
      createMockDriver({
        end: async () => {
          endCalled = true;
        },
      }),
      DUMMY_CONFIG,
      EMPTY_POOL_CONFIG,
      noop,
    );
    await pool.acquire().run();

    // Act
    const endResult = await pool.end().run();

    // Assert
    assert.equal(endResult.tag, "Ok");
    assert.equal(endCalled, true);
  });

  it("end() on an already-ended pool is a no-op", async () => {
    // Arrange
    let endCallCount = 0;
    const pool = createLambdaPool(
      createMockDriver({
        end: async () => {
          endCallCount += 1;
        },
      }),
      DUMMY_CONFIG,
      EMPTY_POOL_CONFIG,
      noop,
    );
    await pool.acquire().run();
    await pool.end().run();

    // Act — call end() again.
    const result = await pool.end().run();

    // Assert
    assert.equal(result.tag, "Ok");
    assert.equal(endCallCount, 1);
  });

  it("pool mode is 'lambda'", () => {
    // Arrange / Act
    const pool = createLambdaPool(createMockDriver(), DUMMY_CONFIG, EMPTY_POOL_CONFIG, noop);

    // Assert
    assert.equal(pool.mode, "lambda");
  });
});

// ---------------------------------------------------------------------------
// Database() factory
// ---------------------------------------------------------------------------

describe("Database()", () => {
  beforeEach(() => {
    // Ensure the lambda singleton is clean between test runs.
    resetLambdaConnection();
  });

  it("assembles a DatabaseClient with dialect, pool, logger, and hooks", () => {
    // Arrange / Act
    const client = Database({
      dialect: "postgresql",
      driver: createMockDriver(),
      connection: DUMMY_CONFIG,
    });

    // Assert
    assert.ok(client.dialect !== undefined);
    assert.equal(client.dialect.name, "postgresql");
    assert.ok(client.pool !== undefined);
    assert.ok(client.logger !== undefined);
    assert.ok(client.hooks !== undefined);
  });

  it("returns a frozen DatabaseClient", () => {
    // Arrange / Act
    const client = Database({
      dialect: "postgresql",
      driver: createMockDriver(),
      connection: DUMMY_CONFIG,
    });

    // Assert
    assert.ok(Object.isFrozen(client));
  });

  it("uses pool mode by default", () => {
    // Arrange / Act
    const client = Database({
      dialect: "postgresql",
      driver: createMockDriver(),
      connection: DUMMY_CONFIG,
    });

    // Assert
    assert.equal(client.pool.mode, "pool");
  });

  it("uses lambda pool when mode is 'lambda'", () => {
    // Arrange / Act
    const client = Database({
      dialect: "postgresql",
      driver: createMockDriver(),
      connection: DUMMY_CONFIG,
      pool: { mode: "lambda" },
    });

    // Assert
    assert.equal(client.pool.mode, "lambda");
  });

  it("merges supplied hooks into the client", () => {
    // Arrange
    const calls: number[] = [];
    const hooks = {
      onConnectionAcquire: (ms: number) => {
        calls.push(ms);
      },
    };

    // Act
    const client = Database({
      dialect: "postgresql",
      driver: createMockDriver(),
      connection: DUMMY_CONFIG,
      hooks,
    });

    // Assert
    assert.strictEqual(client.hooks.onConnectionAcquire, hooks.onConnectionAcquire);
  });

  it("defaults to empty hooks when none supplied", () => {
    // Arrange / Act
    const client = Database({
      dialect: "postgresql",
      driver: createMockDriver(),
      connection: DUMMY_CONFIG,
    });

    // Assert
    assert.deepEqual(client.hooks, {});
  });

  it("throws when an unknown dialect is requested", () => {
    // Arrange / Act / Assert
    assert.throws(
      () =>
        Database({
          dialect: "mysql",
          driver: createMockDriver(),
          connection: DUMMY_CONFIG,
        }),
      (err: unknown) => {
        // The thrown value is a DbError (plain object), not an Error instance.
        assert.ok(err !== null && typeof err === "object");
        assert.equal((err as { tag: string }).tag, "ValidationError");
        return true;
      },
    );
  });

  it("uses the provided custom logger when supplied", () => {
    // Arrange
    const debugMessages: string[] = [];
    const customLogger = {
      debug: (msg: string) => {
        debugMessages.push(msg);
      },
      info: () => {},
      warn: () => {},
      error: () => {},
    };

    // Act
    const client = Database({
      dialect: "postgresql",
      driver: createMockDriver(),
      connection: DUMMY_CONFIG,
      logging: { logger: customLogger },
    });

    // Assert — the logger on the client is the custom one we passed in.
    assert.strictEqual(client.logger, customLogger);
  });
});
