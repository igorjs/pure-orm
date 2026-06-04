// Copyright 2026 igorjs. SPDX-License-Identifier: Apache-2.0

/**
 * Logging and observability types.
 *
 * Logger is a minimal interface so users can plug in any logging library.
 * QueryHooks give fine-grained visibility into the query lifecycle without
 * coupling the ORM to a specific observability stack.
 */

import type { DbError } from "@/errors/errors";

type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

type Logger = {
  readonly debug: (message: string, context?: Readonly<Record<string, unknown>>) => void;
  readonly info: (message: string, context?: Readonly<Record<string, unknown>>) => void;
  readonly warn: (message: string, context?: Readonly<Record<string, unknown>>) => void;
  readonly error: (message: string, context?: Readonly<Record<string, unknown>>) => void;
};

type QueryEvent = {
  readonly sql: string;
  readonly params: readonly unknown[];
  readonly rows?: readonly unknown[];
  readonly durationMs?: number;
};

type QueryHooks = {
  readonly beforeCompile: (ast: unknown) => void;
  readonly afterCompile: (compiled: {
    readonly sql: string;
    readonly params: readonly unknown[];
  }) => void;
  readonly beforeExecute: (compiled: {
    readonly sql: string;
    readonly params: readonly unknown[];
  }) => void;
  readonly afterExecute: (result: QueryEvent) => void;
  readonly onError: (
    error: DbError,
    context: { readonly sql?: string; readonly params?: readonly unknown[] },
  ) => void;
  readonly onConnectionAcquire: (durationMs: number) => void;
  readonly onConnectionRelease: () => void;
  readonly onTransactionBegin: (isolationLevel?: string) => void;
  readonly onTransactionCommit: (durationMs: number) => void;
  readonly onTransactionRollback: (reason?: string) => void;
};

export type { Logger, LogLevel, QueryEvent, QueryHooks };
