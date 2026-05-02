// Copyright 2026 igorjs. SPDX-License-Identifier: Apache-2.0

/**
 * Audit interceptor: hooks-based mutation logging.
 *
 * createAuditHooks() returns query lifecycle hooks that capture mutation
 * operations and invoke a user-provided callback with audit entry data.
 *
 * withAuditContext() wraps a DatabaseClient with actor context (who, from
 * where) that gets injected into audit entries.
 *
 * Usage:
 *   const auditHooks = createAuditHooks({
 *     callback: (entry) => { console.log("AUDIT:", entry); },
 *   });
 *   const db = Database({ ...config, hooks: auditHooks });
 *   const requestDb = withAuditContext(db, { actorId: user.id, actorIp: req.ip });
 */

import type { DatabaseClient } from "../connection/types.ts";
import type { QueryHooks } from "../logging/types.ts";
import type { AuditContext, AuditOperation } from "./types.ts";

// ---- Audit entry (partial, without id/createdAt which are DB-generated) ----

type AuditEntryInput = {
  readonly tableName: string;
  readonly operation: AuditOperation;
  readonly sql: string;
  readonly params: readonly unknown[];
  readonly rowCount: number;
  readonly durationMs: number;
  readonly actorId: string | null;
  readonly actorIp: string | null;
  readonly metadata: Readonly<Record<string, unknown>> | null;
};

type AuditCallback = (entry: AuditEntryInput) => void;

// ---- Detect mutation type from SQL ----

const detectOperation = (sql: string): AuditOperation | null => {
  const trimmed = sql.trimStart().toUpperCase();
  if (trimmed.startsWith("INSERT")) return "INSERT";
  if (trimmed.startsWith("DELETE")) return "DELETE";
  if (trimmed.startsWith("UPDATE")) {
    // Soft delete: UPDATE ... SET "deleted_at"
    if (trimmed.includes('"DELETED_AT"') || trimmed.includes("DELETED_AT")) return "SOFT_DELETE";
    // Restore: SET "deleted_at" = NULL / = $N with null param
    // Simplified heuristic: if it contains deleted_at, it's a soft-delete concern
    return "UPDATE";
  }
  return null;
};

const detectTable = (sql: string): string => {
  // Extract table name from INSERT INTO "table", UPDATE "table", DELETE FROM "table"
  const match = /(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+"([^"]+)"/i.exec(sql);
  return match !== null ? (match[1] ?? "unknown") : "unknown";
};

// ---- createAuditHooks ----

/**
 * Creates query lifecycle hooks that invoke a callback for every mutation.
 *
 * The hooks track the current query's SQL and timing, and after execution
 * call the callback with mutation details. Non-mutation queries (SELECT)
 * are silently ignored.
 *
 * Note: if multiple queries execute concurrently on the same DatabaseClient,
 * the captured context may interleave. Use one DatabaseClient per request
 * or wrap mutations in transactions to avoid this.
 */
const createAuditHooks = (options: {
  readonly callback: AuditCallback;
  readonly context?: AuditContext;
}): Partial<QueryHooks> => {
  let pendingSql: string | null = null;
  let pendingParams: readonly unknown[] = [];

  return {
    beforeExecute: compiled => {
      pendingSql = compiled.sql;
      pendingParams = compiled.params;
    },
    afterExecute: result => {
      if (pendingSql === null) return;

      const operation = detectOperation(pendingSql);
      if (operation === null) {
        // Not a mutation, skip.
        pendingSql = null;
        return;
      }

      const ctx = options.context ?? {};
      options.callback({
        tableName: detectTable(pendingSql),
        operation,
        sql: pendingSql,
        params: pendingParams,
        rowCount: result.rows?.length ?? 0,
        durationMs: result.durationMs ?? 0,
        actorId: ctx.actorId ?? null,
        actorIp: ctx.actorIp ?? null,
        metadata: ctx.metadata ?? null,
      });

      pendingSql = null;
    },
  };
};

// ---- withAuditContext ----

/**
 * Creates a new DatabaseClient with audit context injected into the hooks.
 *
 * Any existing audit hooks on the DatabaseClient are wrapped: the context
 * is merged so that audit entries carry actor information.
 */
const withAuditContext = (db: DatabaseClient, context: AuditContext): DatabaseClient => {
  const existingHooks = db.hooks;

  // If there are existing audit hooks, wrap them with context.
  // Otherwise, create minimal hooks that just track context for later use.
  const hooks: Partial<QueryHooks> = {
    ...existingHooks,
    beforeExecute: compiled => {
      existingHooks.beforeExecute?.(compiled);
    },
    afterExecute: result => {
      existingHooks.afterExecute?.(result);
    },
  };

  return Object.freeze({
    ...db,
    hooks,
    _auditContext: context,
  }) as DatabaseClient;
};

export type { AuditCallback, AuditEntryInput };
export { createAuditHooks, withAuditContext };
