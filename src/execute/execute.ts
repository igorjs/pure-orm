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
import type { ModelRef } from "../model/types.ts";
import type { QueryNode, SelectNode } from "../query/types.ts";
import { mapRows } from "./result-mapper.ts";

// ---- Helpers ----

/**
 * Compile any QueryNode to SQL + params using the dialect on the DatabaseClient.
 *
 * Using db.dialect directly (rather than the compile() registry helper) lets
 * test doubles swap the dialect without touching the global registry.
 */
const compileNode = (
  db: DatabaseClient,
  node: QueryNode,
): { readonly sql: string; readonly params: readonly unknown[] } => {
  switch (node.tag) {
    case "Select":
      return db.dialect.compileSelect(node);
    case "Insert":
      return db.dialect.compileInsert(node);
    case "Update":
      return db.dialect.compileUpdate(node);
    case "Delete":
      return db.dialect.compileDelete(node);
    case "Raw":
      return { sql: node.sql, params: node.params };
  }
};

/**
 * Extract the ModelRef from a QueryNode for result mapping.
 *
 * Returns null for RawNode — column name remapping is skipped and
 * snakeToCamel() is used as the sole mapping strategy instead.
 */
const getModelRef = (node: QueryNode): ModelRef | null => {
  switch (node.tag) {
    case "Select":
      return node.model;
    case "Insert":
      return node.model;
    case "Update":
      return node.model;
    case "Delete":
      return node.model;
    case "Raw":
      return null;
  }
};

// ---- execute ----

/**
 * Terminal pipe stage: executes any QueryNode and returns all matching rows.
 *
 * The returned Task is lazy — nothing happens until .run() is called.
 * Lifecycle hooks (beforeCompile, afterCompile, beforeExecute, afterExecute)
 * are fired in order around compilation and execution.
 *
 * The connection is acquired from the pool and always released in a
 * try/finally block, even when the query throws.
 *
 * For InsertNode/UpdateNode/DeleteNode, returned rows (from RETURNING clauses)
 * are mapped through the model's column metadata exactly as for SelectNode.
 * When the node has no RETURNING clause the database returns an empty rows
 * array; execute() wraps that in an empty List.
 */
const execute = <T>(
  db: DatabaseClient,
) =>
(node: QueryNode): Task<ImmutableList<ImmutableRecord<T>>, DbError> =>
  Task<ImmutableList<ImmutableRecord<T>>, DbError>(async () => {
    dispatchHook(db.hooks, "beforeCompile", node as SelectNode);

    const compiled = compileNode(db, node);

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

      const modelRef = getModelRef(node);
      const mappedResults = mapRows<T>(rows, modelRef);
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
 * Terminal pipe stage: executes a QueryNode and returns the first row.
 *
 * For SelectNode: injects LIMIT 1 when the node does not already have a
 * limit set, to avoid fetching more rows than necessary.
 * For InsertNode with RETURNING: returns the first returned row, which is
 * the canonical pattern for "insert and get back the created record".
 * For UpdateNode/DeleteNode with RETURNING: returns the first affected row.
 *
 * Returns Some(record) for a non-empty result, or None when the query
 * matches nothing or the mutation affected zero rows.
 */
const findOne = <T>(
  db: DatabaseClient,
) =>
(node: QueryNode): Task<Option<ImmutableRecord<T>>, DbError> =>
  Task<Option<ImmutableRecord<T>>, DbError>(async () => {
    // Apply LIMIT 1 only for SelectNode when the caller has not already set a
    // limit, so explicit pagination isn't silently overridden. Mutation nodes
    // do not support LIMIT — the first row is chosen from the returned rows.
    const effectiveNode: QueryNode = node.tag === "Select" && node.limit === null
      ? Object.freeze({ ...node, limit: 1 })
      : node;

    dispatchHook(db.hooks, "beforeCompile", effectiveNode as SelectNode);

    const compiled = compileNode(db, effectiveNode);

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

      const modelRef = getModelRef(effectiveNode);
      const mapped = mapRows<T>(rows, modelRef);
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
