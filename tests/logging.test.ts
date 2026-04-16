import { strict as assert } from "node:assert";
import { afterEach, beforeEach, describe, it } from "node:test";

import { dispatchHook } from "../src/logging/hooks.ts";
import { createConsoleLogger, createNoopLogger } from "../src/logging/logger.ts";
import { startTimer } from "../src/logging/timing.ts";
import type { QueryHooks } from "../src/logging/types.ts";

// ---------------------------------------------------------------------------
// Console capture helpers
// ---------------------------------------------------------------------------

type ConsoleSpy = {
  readonly calls: string[][];
  restore: () => void;
};

const spyOn = (method: "info" | "warn" | "error"): ConsoleSpy => {
  const original = console[method];
  const calls: string[][] = [];

  console[method] = (...args: unknown[]): void => {
    calls.push(args.map(String));
  };

  return {
    calls,
    restore: (): void => {
      console[method] = original;
    },
  };
};

// ---------------------------------------------------------------------------
// createConsoleLogger
// ---------------------------------------------------------------------------

describe("createConsoleLogger", () => {
  describe("log level filtering", () => {
    it("does not log debug messages when level is warn", () => {
      // Arrange
      const logger = createConsoleLogger("warn");
      const spy = spyOn("info");

      // Act
      logger.debug("should be suppressed");

      // Assert
      spy.restore();
      assert.equal(spy.calls.length, 0);
    });

    it("does not log info messages when level is warn", () => {
      // Arrange
      const logger = createConsoleLogger("warn");
      const spy = spyOn("info");

      // Act
      logger.info("should be suppressed");

      // Assert
      spy.restore();
      assert.equal(spy.calls.length, 0);
    });

    it("logs warn messages when level is warn", () => {
      // Arrange
      const logger = createConsoleLogger("warn");
      const spy = spyOn("warn");

      // Act
      logger.warn("this should appear");

      // Assert
      spy.restore();
      assert.equal(spy.calls.length, 1);
    });

    it("logs error messages when level is warn", () => {
      // Arrange
      const logger = createConsoleLogger("warn");
      const spy = spyOn("error");

      // Act
      logger.error("this should appear");

      // Assert
      spy.restore();
      assert.equal(spy.calls.length, 1);
    });

    it("logs debug messages when level is debug", () => {
      // Arrange
      const logger = createConsoleLogger("debug");
      const spy = spyOn("info");

      // Act
      logger.debug("verbose message");

      // Assert
      spy.restore();
      assert.equal(spy.calls.length, 1);
    });

    it("suppresses all output when level is silent", () => {
      // Arrange
      const logger = createConsoleLogger("silent");
      const infoSpy = spyOn("info");
      const warnSpy = spyOn("warn");
      const errorSpy = spyOn("error");

      // Act
      logger.debug("d");
      logger.info("i");
      logger.warn("w");
      logger.error("e");

      // Assert
      infoSpy.restore();
      warnSpy.restore();
      errorSpy.restore();
      assert.equal(infoSpy.calls.length, 0);
      assert.equal(warnSpy.calls.length, 0);
      assert.equal(errorSpy.calls.length, 0);
    });
  });

  describe("[pure-orm] prefix", () => {
    it("prefixes debug messages with [pure-orm]", () => {
      // Arrange
      const logger = createConsoleLogger("debug");
      const spy = spyOn("info");

      // Act
      logger.debug("startup");

      // Assert
      spy.restore();
      assert.ok(spy.calls[0]?.[0]?.startsWith("[pure-orm]"), "expected [pure-orm] prefix");
    });

    it("prefixes info messages with [pure-orm]", () => {
      // Arrange
      const logger = createConsoleLogger("info");
      const spy = spyOn("info");

      // Act
      logger.info("ready");

      // Assert
      spy.restore();
      assert.ok(spy.calls[0]?.[0]?.startsWith("[pure-orm]"));
    });

    it("prefixes warn messages with [pure-orm]", () => {
      // Arrange
      const logger = createConsoleLogger("warn");
      const spy = spyOn("warn");

      // Act
      logger.warn("slow query");

      // Assert
      spy.restore();
      assert.ok(spy.calls[0]?.[0]?.startsWith("[pure-orm]"));
    });

    it("prefixes error messages with [pure-orm]", () => {
      // Arrange
      const logger = createConsoleLogger("error");
      const spy = spyOn("error");

      // Act
      logger.error("fatal");

      // Assert
      spy.restore();
      assert.ok(spy.calls[0]?.[0]?.startsWith("[pure-orm]"));
    });

    it("includes the message text after the prefix", () => {
      // Arrange
      const logger = createConsoleLogger("info");
      const spy = spyOn("info");

      // Act
      logger.info("my message");

      // Assert
      spy.restore();
      assert.ok(spy.calls[0]?.[0]?.includes("my message"));
    });
  });

  describe("console method routing", () => {
    it("debug uses console.info", () => {
      // Arrange
      const logger = createConsoleLogger("debug");
      const infoSpy = spyOn("info");
      const warnSpy = spyOn("warn");
      const errorSpy = spyOn("error");

      // Act
      logger.debug("test");

      // Assert
      infoSpy.restore();
      warnSpy.restore();
      errorSpy.restore();
      assert.equal(infoSpy.calls.length, 1);
      assert.equal(warnSpy.calls.length, 0);
      assert.equal(errorSpy.calls.length, 0);
    });

    it("info uses console.info", () => {
      // Arrange
      const logger = createConsoleLogger("info");
      const infoSpy = spyOn("info");
      const warnSpy = spyOn("warn");

      // Act
      logger.info("test");

      // Assert
      infoSpy.restore();
      warnSpy.restore();
      assert.equal(infoSpy.calls.length, 1);
      assert.equal(warnSpy.calls.length, 0);
    });

    it("warn uses console.warn", () => {
      // Arrange
      const logger = createConsoleLogger("warn");
      const infoSpy = spyOn("info");
      const warnSpy = spyOn("warn");
      const errorSpy = spyOn("error");

      // Act
      logger.warn("test");

      // Assert
      infoSpy.restore();
      warnSpy.restore();
      errorSpy.restore();
      assert.equal(infoSpy.calls.length, 0);
      assert.equal(warnSpy.calls.length, 1);
      assert.equal(errorSpy.calls.length, 0);
    });

    it("error uses console.error", () => {
      // Arrange
      const logger = createConsoleLogger("error");
      const infoSpy = spyOn("info");
      const warnSpy = spyOn("warn");
      const errorSpy = spyOn("error");

      // Act
      logger.error("test");

      // Assert
      infoSpy.restore();
      warnSpy.restore();
      errorSpy.restore();
      assert.equal(infoSpy.calls.length, 0);
      assert.equal(warnSpy.calls.length, 0);
      assert.equal(errorSpy.calls.length, 1);
    });
  });
});

// ---------------------------------------------------------------------------
// createNoopLogger
// ---------------------------------------------------------------------------

describe("createNoopLogger", () => {
  let infoSpy: ConsoleSpy;
  let warnSpy: ConsoleSpy;
  let errorSpy: ConsoleSpy;

  beforeEach(() => {
    infoSpy = spyOn("info");
    warnSpy = spyOn("warn");
    errorSpy = spyOn("error");
  });

  afterEach(() => {
    infoSpy.restore();
    warnSpy.restore();
    errorSpy.restore();
  });

  it("produces no console output for any method", () => {
    // Arrange
    const logger = createNoopLogger();

    // Act
    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    logger.error("e");

    // Assert
    assert.equal(infoSpy.calls.length, 0);
    assert.equal(warnSpy.calls.length, 0);
    assert.equal(errorSpy.calls.length, 0);
  });

  it("returns undefined for all method calls", () => {
    // Arrange
    const logger = createNoopLogger();

    // Act / Assert — verify the methods are callable without throwing
    assert.doesNotThrow(() => {
      logger.debug("d");
      logger.info("i");
      logger.warn("w");
      logger.error("e");
    });
  });
});

// ---------------------------------------------------------------------------
// dispatchHook
// ---------------------------------------------------------------------------

describe("dispatchHook", () => {
  it("calls a defined hook with the provided arguments", () => {
    // Arrange
    const calls: number[] = [];
    const hooks: Partial<QueryHooks> = {
      onConnectionAcquire: (durationMs: number): void => {
        calls.push(durationMs);
      },
    };

    // Act
    dispatchHook(hooks, "onConnectionAcquire", 42);

    // Assert
    assert.deepEqual(calls, [42]);
  });

  it("does nothing when the hook is not defined", () => {
    // Arrange
    const hooks: Partial<QueryHooks> = {};

    // Act / Assert — must not throw
    assert.doesNotThrow(() => {
      dispatchHook(hooks, "onConnectionRelease");
    });
  });

  it("catches and does not rethrow errors thrown by a hook", () => {
    // Arrange
    const hooks: Partial<QueryHooks> = {
      onConnectionRelease: (): void => {
        throw new Error("hook exploded");
      },
    };
    const errorSpy = spyOn("error");

    // Act / Assert
    assert.doesNotThrow(() => {
      dispatchHook(hooks, "onConnectionRelease");
    });

    errorSpy.restore();
  });

  it("logs the error when a hook throws", () => {
    // Arrange
    const hooks: Partial<QueryHooks> = {
      onConnectionRelease: (): void => {
        throw new Error("hook exploded");
      },
    };
    const errorSpy = spyOn("error");

    // Act
    dispatchHook(hooks, "onConnectionRelease");

    // Assert
    errorSpy.restore();
    assert.equal(errorSpy.calls.length, 1);
  });

  it("calls afterExecute with a full QueryEvent", () => {
    // Arrange
    const received: { sql: string; durationMs: number | undefined }[] = [];
    const hooks: Partial<QueryHooks> = {
      afterExecute: (result): void => {
        received.push({ sql: result.sql, durationMs: result.durationMs });
      },
    };

    // Act
    dispatchHook(hooks, "afterExecute", { sql: "SELECT 1", params: [], durationMs: 5 });

    // Assert
    assert.equal(received.length, 1);
    assert.equal(received[0]?.sql, "SELECT 1");
    assert.equal(received[0]?.durationMs, 5);
  });
});

// ---------------------------------------------------------------------------
// startTimer
// ---------------------------------------------------------------------------

describe("startTimer", () => {
  it("returns a function", () => {
    // Arrange / Act
    const elapsed = startTimer();

    // Assert
    assert.equal(typeof elapsed, "function");
  });

  it("returns a non-negative number immediately", () => {
    // Arrange
    const elapsed = startTimer();

    // Act
    const ms = elapsed();

    // Assert
    assert.ok(ms >= 0, `expected >= 0, got ${ms}`);
  });

  it("measures elapsed time approximately", async () => {
    // Arrange
    const elapsed = startTimer();

    // Act — wait ~20 ms
    await new Promise<void>(resolve => setTimeout(resolve, 20));
    const ms = elapsed();

    // Assert — allow generous tolerance for CI jitter
    assert.ok(ms >= 10, `expected at least 10 ms, got ${ms}`);
    assert.ok(ms < 200, `expected less than 200 ms, got ${ms}`);
  });

  it("each call to the returned function returns increasing values", async () => {
    // Arrange
    const elapsed = startTimer();

    // Act
    const first = elapsed();
    await new Promise<void>(resolve => setTimeout(resolve, 5));
    const second = elapsed();

    // Assert
    assert.ok(second >= first, `expected second (${second}) >= first (${first})`);
  });
});
