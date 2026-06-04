// Copyright 2026 igorjs. SPDX-License-Identifier: Apache-2.0

/**
 * Migration executor (orchestrator).
 *
 * Coordinates the full migration lifecycle: lock acquisition, state
 * table setup, checksum validation, and migration application with
 * transaction or concurrent execution modes.
 */

import { transaction } from "@/connection/transaction";
import type { DatabaseClient } from "@/connection/types";
import type { DbError } from "@/errors/errors";
import { migrationError } from "@/errors/errors";
import type { Result } from "@/fx";
import { Err, Ok, Task } from "@/fx";
import { startTimer } from "@/logging/timing";
import { validateChecksums } from "./checksum.ts";
import type { LockHandle } from "./locking.ts";
import { acquireLock } from "./locking.ts";
import {
  applyMigration,
  ensureMigrationTable,
  execRaw,
  getAppliedNames,
  getMigrationStatus,
  getNextBatch,
  recordInProgress,
  rollbackMigration,
  updateMigrationStatus,
} from "./runner.ts";
import type {
  BatchResult,
  ChecksumMismatch,
  ExecutorOptions,
  MigrationFile,
  MigrationHookContext,
  MigrationHooks,
  MigrationResult,
} from "./types.ts";

// ---- Hook dispatch ----

const dispatchMigrationHook = <K extends keyof MigrationHooks>(
  hooks: Partial<MigrationHooks> | null | undefined,
  event: K,
  ...args: Parameters<MigrationHooks[K]>
): void => {
  if (hooks === null || hooks === undefined) return;
  const fn = hooks[event];
  if (fn === undefined) return;
  try {
    (fn as (...a: unknown[]) => void)(...args);
  } catch {
    // Hooks must not break the migration pipeline
  }
};

// ---- Single migration execution ----

const executeSingleMigration = (
  db: DatabaseClient,
  file: MigrationFile,
  batch: number,
  hooks: Partial<MigrationHooks> | null | undefined,
): Task<MigrationResult, DbError> => {
  const hookCtx: MigrationHookContext = Object.freeze({
    name: file.name,
    direction: "up" as const,
  });

  if (file.migration.transaction) {
    return executeTransactional(db, file, batch, hooks, hookCtx);
  }
  return executeConcurrent(db, file, batch, hooks, hookCtx);
};

const executeTransactional = (
  db: DatabaseClient,
  file: MigrationFile,
  batch: number,
  hooks: Partial<MigrationHooks> | null | undefined,
  hookCtx: MigrationHookContext,
): Task<MigrationResult, DbError> => {
  const timer = startTimer();
  dispatchMigrationHook(hooks, "beforeMigrate", hookCtx);

  return transaction(db, async tx => {
    await applyMigration(tx, {
      name: file.name,
      upSql: file.migration.up,
      checksum: file.checksum,
      batch,
      transaction: true,
    }).run();
  })
    .map(() => {
      const durationMs = Math.round(timer());
      dispatchMigrationHook(hooks, "afterMigrate", { ...hookCtx, durationMs });
      return Object.freeze({
        name: file.name,
        status: "applied" as const,
        durationMs,
        sql: file.migration.up,
      });
    })
    .mapErr(err => {
      dispatchMigrationHook(hooks, "onMigrationError", hookCtx, err);
      return err;
    });
};

const executeConcurrent = (
  db: DatabaseClient,
  file: MigrationFile,
  batch: number,
  hooks: Partial<MigrationHooks> | null | undefined,
  hookCtx: MigrationHookContext,
): Task<MigrationResult, DbError> => {
  // Dialects without server-side concurrent-DDL support (e.g. SQLite) fall
  // back to transactional mode. Captured by the lock-strategy capability:
  // advisory-lock dialects support concurrent DDL; lock-table dialects do not.
  if (db.dialect.capabilities.lockStrategy === "lockTable") {
    db.logger.debug("Dialect lacks concurrent DDL support, using transaction mode");
    return executeTransactional(db, file, batch, hooks, hookCtx);
  }

  const timer = startTimer();
  dispatchMigrationHook(hooks, "beforeMigrate", hookCtx);

  // Record in_progress first, then execute DDL without transaction
  return recordInProgress(db, file.name, file.checksum, batch)
    .flatMap(() => execRaw(db, file.migration.up))
    .flatMap(() => {
      const durationMs = Math.round(timer());
      return updateMigrationStatus(db, file.name, "applied", durationMs).map(() => {
        dispatchMigrationHook(hooks, "afterMigrate", { ...hookCtx, durationMs });
        return Object.freeze({
          name: file.name,
          status: "applied" as const,
          durationMs,
          sql: file.migration.up,
        });
      });
    })
    .mapErr(err => {
      // Mark as failed (best-effort, ignore errors from the update itself)
      updateMigrationStatus(db, file.name, "failed", Math.round(timer())).run();
      dispatchMigrationHook(hooks, "onMigrationError", hookCtx, err);
      return err;
    });
};

// ---- Batch execution ----

/**
 * Executes a batch of pending migrations.
 *
 * Flow: lock -> ensure table -> validate checksums -> filter pending ->
 * apply each -> release lock -> return results.
 */
const executeBatch = (
  db: DatabaseClient,
  migrations: readonly MigrationFile[],
  options?: Partial<ExecutorOptions>,
): Task<BatchResult, DbError> => {
  const dryRun = options?.dryRun ?? false;
  const force = options?.force ?? false;
  const hooks = options?.hooks ?? null;

  if (dryRun) {
    return executeDryRun(db, migrations, force);
  }

  return acquireLock(db).flatMap(handle => runBatchWithLock(db, migrations, force, hooks, handle));
};

const verifyChecksums = async (
  db: DatabaseClient,
  migrations: readonly MigrationFile[],
): Promise<Result<void, DbError>> => {
  const checksumResult = await validateChecksums(db, migrations).run();
  if (checksumResult.isErr) return Err(checksumResult.error);
  const mismatches = checksumResult.value;
  if (mismatches.length > 0) {
    const names = mismatches.map(m => m.name).join(", ");
    return Err(
      migrationError(
        `Checksum mismatch: ${names}. Migration files modified after being applied.`,
        mismatches[0]?.name ?? "_checksum_",
      ),
    );
  }
  return Ok(undefined);
};

const checkInterruptedMigrations = async (db: DatabaseClient): Promise<Result<void, DbError>> => {
  const statusResult = await getMigrationStatus(db).run();
  if (statusResult.isErr) return Err(statusResult.error);
  const inProgress = statusResult.value.filter(r => r["status"] === "in_progress");
  if (inProgress.length > 0) {
    const names = inProgress.map(r => r["name"]).join(", ");
    return Err(
      migrationError(
        `Interrupted migration(s) detected: ${names}. Run migrate:status to inspect.`,
        String(inProgress[0]?.["name"] ?? "_recovery_"),
      ),
    );
  }
  return Ok(undefined);
};

const applyPendingMigrations = async (
  db: DatabaseClient,
  pending: readonly MigrationFile[],
  batch: number,
  hooks: Partial<MigrationHooks> | null,
): Promise<Result<readonly MigrationResult[], DbError>> => {
  const results: MigrationResult[] = [];
  for (const file of pending) {
    const applyResult = await executeSingleMigration(db, file, batch, hooks).run();
    if (applyResult.isErr) {
      results.push(
        Object.freeze({
          name: file.name,
          status: "failed" as const,
          durationMs: 0,
          sql: file.migration.up,
        }),
      );
      return Err(migrationError(`Migration "${file.name}" failed`, file.name, applyResult.error));
    }
    results.push(applyResult.value);
  }
  return Ok(Object.freeze(results));
};

const runPreflightChecks = async (
  db: DatabaseClient,
  migrations: readonly MigrationFile[],
  force: boolean,
): Promise<Result<ReadonlySet<string>, DbError>> => {
  const ensureResult = await ensureMigrationTable(db).run();
  if (ensureResult.isErr) return Err(ensureResult.error);

  if (!force) {
    const checkResult = await verifyChecksums(db, migrations);
    if (!checkResult.isOk) return checkResult as Result<never, DbError>;
  }

  const interruptedResult = await checkInterruptedMigrations(db);
  if (!interruptedResult.isOk) return interruptedResult as Result<never, DbError>;

  return getAppliedNames(db).run();
};

const runBatchWithLock = (
  db: DatabaseClient,
  migrations: readonly MigrationFile[],
  force: boolean,
  hooks: Partial<MigrationHooks> | null,
  handle: LockHandle,
): Task<BatchResult, DbError> =>
  Task<BatchResult, DbError>(async (): Promise<Result<BatchResult, DbError>> => {
    try {
      const preflightResult = await runPreflightChecks(db, migrations, force);
      if (!preflightResult.isOk) return preflightResult as Result<never, DbError>;
      const appliedNames = preflightResult.value;

      const pending = migrations.filter(m => !appliedNames.has(m.name));
      if (pending.length === 0) {
        return Ok(
          Object.freeze({
            batch: 0,
            results: Object.freeze([]) as readonly MigrationResult[],
            dryRun: false,
          }),
        );
      }

      const batchResult = await getNextBatch(db).run();
      if (batchResult.isErr) return Err(batchResult.error);

      const migrationResults = await applyPendingMigrations(db, pending, batchResult.value, hooks);
      if (!migrationResults.isOk) return migrationResults as Result<never, DbError>;

      return Ok(
        Object.freeze({ batch: batchResult.value, results: migrationResults.value, dryRun: false }),
      );
    } finally {
      await handle.release().run();
    }
  });

const executeDryRun = (
  db: DatabaseClient,
  migrations: readonly MigrationFile[],
  force: boolean,
): Task<BatchResult, DbError> =>
  ensureMigrationTable(db)
    .flatMap(() => {
      if (force) {
        return Task.of([] as readonly ChecksumMismatch[]);
      }
      return validateChecksums(db, migrations);
    })
    .flatMap(mismatches => {
      if (mismatches.length > 0) {
        const names = mismatches.map(m => m.name).join(", ");
        return Task.fromResult<ReadonlySet<string>, DbError>(
          Err(
            migrationError(
              `Checksum mismatch: ${names}. Migration files modified after being applied.`,
              mismatches[0]?.name ?? "_checksum_",
            ),
          ),
        );
      }
      return getAppliedNames(db);
    })
    .map(appliedNames => {
      const pending = migrations.filter(m => !appliedNames.has(m.name));
      const results: MigrationResult[] = pending.map(file =>
        Object.freeze({
          name: file.name,
          status: "skipped" as const,
          durationMs: 0,
          sql: file.migration.up,
        }),
      );
      return Object.freeze({
        batch: 0,
        results: Object.freeze(results),
        dryRun: true,
      });
    });

// ---- Batch rollback ----

type RollbackTarget = {
  readonly name: string;
  readonly downSql: string;
  readonly transaction: boolean;
};

/**
 * Rolls back a list of migrations in order (caller provides them
 * already in reverse-application order).
 */
const rollbackBatch = (
  db: DatabaseClient,
  migrations: readonly RollbackTarget[],
  options?: Partial<ExecutorOptions>,
): Task<BatchResult, DbError> => {
  const dryRun = options?.dryRun ?? false;
  const hooks = options?.hooks ?? null;

  if (dryRun) {
    const results: MigrationResult[] = migrations.map(m =>
      Object.freeze({
        name: m.name,
        status: "skipped" as const,
        durationMs: 0,
        sql: m.downSql,
      }),
    );
    return Task.of(Object.freeze({ batch: 0, results: Object.freeze(results), dryRun: true }));
  }

  return acquireLock(db).flatMap(handle =>
    Task<BatchResult, DbError>(async (): Promise<Result<BatchResult, DbError>> => {
      try {
        const results: MigrationResult[] = [];
        for (const migration of migrations) {
          const hookCtx: MigrationHookContext = Object.freeze({
            name: migration.name,
            direction: "down" as const,
          });
          dispatchMigrationHook(hooks, "beforeMigrate", hookCtx);

          const timer = startTimer();
          const rollbackResult = await rollbackMigration(db, {
            name: migration.name,
            downSql: migration.downSql,
            transaction: migration.transaction,
          }).run();

          if (rollbackResult.isErr) {
            dispatchMigrationHook(hooks, "onMigrationError", hookCtx, rollbackResult.error);
            return Err(rollbackResult.error);
          }

          const durationMs = Math.round(timer());
          dispatchMigrationHook(hooks, "afterMigrate", { ...hookCtx, durationMs });
          results.push(
            Object.freeze({
              name: migration.name,
              status: "applied" as const,
              durationMs,
              sql: migration.downSql,
            }),
          );
        }

        return Ok(
          Object.freeze({
            batch: 0,
            results: Object.freeze(results),
            dryRun: false,
          }),
        );
      } finally {
        await handle.release().run();
      }
    }),
  );
};

export type { RollbackTarget };
export { executeBatch, rollbackBatch };
