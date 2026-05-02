// Copyright 2026 igorjs. SPDX-License-Identifier: Apache-2.0

/**
 * Audit system types.
 *
 * These types model the _pure_orm_audit table and the context that
 * is attached to each audit entry. The audit system records every
 * INSERT, UPDATE, DELETE, SOFT_DELETE, and RESTORE on audited models.
 */

// ---- Audit operation ----

type AuditOperation = "INSERT" | "UPDATE" | "DELETE" | "SOFT_DELETE" | "RESTORE";

// ---- Audit context ----

/**
 * Optional context attached to audit entries, typically set per-request
 * via withAuditContext(). Captures who performed the operation and why.
 */
type AuditContext = {
  readonly actorId?: string;
  readonly actorIp?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
};

// ---- Audit entry ----

/**
 * Represents a single row in the _pure_orm_audit table.
 *
 * oldData/newData are JSONB snapshots of the affected row. For INSERT,
 * oldData is null. For DELETE, newData is null. For UPDATE, both are
 * present, and changedFields lists only the columns that changed.
 */
type AuditEntry = {
  readonly id: string;
  readonly tableName: string;
  readonly operation: AuditOperation;
  readonly rowId: string;
  readonly oldData: Readonly<Record<string, unknown>> | null;
  readonly newData: Readonly<Record<string, unknown>> | null;
  readonly changedFields: readonly string[] | null;
  readonly actorId: string | null;
  readonly actorIp: string | null;
  readonly metadata: Readonly<Record<string, unknown>> | null;
  readonly createdAt: string;
};

export type { AuditContext, AuditEntry, AuditOperation };
