/**
 * Terminal query execution stages.
 *
 * execute() and findOne() are the final pipe stages that take a QueryNode,
 * compile it, run it against the database, and return typed immutable results
 * wrapped in Task so the caller stays in a pure functional pipeline.
 *
 * The connection is always released in a try/finally block, so a failed query
 * does not leak connections back into the pool.
 */

import { Err, None, Ok, Task } from "@igorjs/pure-ts";
import type { Option } from "@igorjs/pure-ts";
import type { ImmutableList, ImmutableRecord } from "@igorjs/pure-ts";

import type { DatabaseClient } from "../connection/types.ts";
import type { DbError } from "../errors/errors.ts";
import { queryError } from "../errors/errors.ts";
import { dispatchHook } from "../logging/hooks.ts";
import { startTimer } from "../logging/timing.ts";
import type { QueryNode, SelectNode } from "../query/types.ts";
import { mapRows } from "./result-mapper.ts";

// ---- execute ----

/**
 * Terminal pipe stage: executes a SelectNode and returns all matching rows.
 *
 * The returned Task is lazy — nothing happens until .run() is called.
 * Lifecycle hooks (beforeCompile, afterCompile, beforeExecute, afterExecute)
 * are fired in order around compilation and execution.
 *
 * The connection is acquired from the pool and always released in a
 * try/finally block, even when the query throws.
 */
const execute = <T>(
  db: DatabaseClient,
) =>
(node: QueryNode): Task<ImmutableList<ImmutableRecord<T>>, DbError> =>
  Task<ImmutableList<ImmutableRecord<T>>, DbError>(async () => {
    // Phase 1: SelectNode only. The dialect lives on DatabaseClient so we
    // use it directly rather than going through the compile() helper, which
    // lets the test double swap the dialect without touching the registry.
    if (node.tag !== "Select") {
      return Err(
        queryError(
          `execute: node type "${node.tag}" is not supported in Phase 1`,
          "",
          [],
        ),
      );
    }

    const selectNode = node as SelectNode;

    dispatchHook(db.hooks, "beforeCompile", selectNode);

    const compiled = db.dialect.compileSelect(selectNode);

    dispatchHook(db.hooks, "afterCompile", compiled);
    dispatchHook(db.hooks, "beforeExecute", compiled);

    const timer = startTimer();

    // Acquire a connection from the pool.
    const acquireResult = await db.pool.acquire().run();
    if (acquireResult.isErr) {
      return Err(acquireResult.error);
    }

    const conn = acquireResult.value;

    try {
      const { rows } = await conn.query(compiled.sql, compiled.params);
      const durationMs = timer();

      dispatchHook(db.hooks, "afterExecute", {
        sql: compiled.sql,
        params: compiled.params,
        rows,
        durationMs,
      });

      const mappedResults = mapRows<T>(rows, selectNode.model);
      return Ok(mappedResults);
    } catch (cause: unknown) {
      const durationMs = timer();
      const err = queryError(
        "Query execution failed",
        compiled.sql,
        compiled.params,
        cause,
      );

      dispatchHook(db.hooks, "onError", err, {
        sql: compiled.sql,
        params: compiled.params,
      });

      dispatchHook(db.hooks, "afterExecute", {
        sql: compiled.sql,
        params: compiled.params,
        rows: [],
        durationMs,
      });

      return Err(err);
    } finally {
      await conn.release();
    }
  });

// ---- findOne ----

/**
 * Terminal pipe stage: executes a SelectNode and returns the first row.
 *
 * Injects LIMIT 1 if the node does not already have a limit set, to avoid
 * fetching more rows than necessary. Returns Some(record) for a non-empty
 * result, or None when the query matches nothing.
 */
const findOne = <T>(
  db: DatabaseClient,
) =>
(node: QueryNode): Task<Option<ImmutableRecord<T>>, DbError> =>
  Task<Option<ImmutableRecord<T>>, DbError>(async () => {
    if (node.tag !== "Select") {
      return Err(
        queryError(
          `findOne: node type "${node.tag}" is not supported in Phase 1`,
          "",
          [],
        ),
      );
    }

    // Apply LIMIT 1 only when the caller has not already set a limit,
    // so explicit pagination isn't silently overridden.
    const selectNode: SelectNode = node.limit === null
      ? Object.freeze({ ...node, limit: 1 })
      : node;

    dispatchHook(db.hooks, "beforeCompile", selectNode);

    const compiled = db.dialect.compileSelect(selectNode);

    dispatchHook(db.hooks, "afterCompile", compiled);
    dispatchHook(db.hooks, "beforeExecute", compiled);

    const timer = startTimer();

    const acquireResult = await db.pool.acquire().run();
    if (acquireResult.isErr) {
      return Err(acquireResult.error);
    }

    const conn = acquireResult.value;

    try {
      const { rows } = await conn.query(compiled.sql, compiled.params);
      const durationMs = timer();

      dispatchHook(db.hooks, "afterExecute", {
        sql: compiled.sql,
        params: compiled.params,
        rows,
        durationMs,
      });

      if (rows.length === 0) {
        return Ok(None as Option<ImmutableRecord<T>>);
      }

      const mapped = mapRows<T>(rows, selectNode.model);
      const first = mapped.first();

      // first() returns Option<ImmutableRecord<T>>; the list is non-empty so
      // this is always Some, but we propagate the Option to stay type-correct.
      return Ok(first as Option<ImmutableRecord<T>>);
    } catch (cause: unknown) {
      const durationMs = timer();
      const err = queryError(
        "Query execution failed",
        compiled.sql,
        compiled.params,
        cause,
      );

      dispatchHook(db.hooks, "onError", err, {
        sql: compiled.sql,
        params: compiled.params,
      });

      dispatchHook(db.hooks, "afterExecute", {
        sql: compiled.sql,
        params: compiled.params,
        rows: [],
        durationMs,
      });

      return Err(err);
    } finally {
      await conn.release();
    }
  });

export { execute, findOne };
