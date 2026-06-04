// Copyright 2026 igorjs. SPDX-License-Identifier: Apache-2.0

/**
 * Audit query helper.
 *
 * auditLog(Model) creates a SelectNode for the _pure_orm_audit table,
 * pre-filtered to the given model's table name. Compose with where(),
 * orderBy(), limit() to refine the query:
 *
 *   pipe(
 *     auditLog(User),
 *     where(eq("rowId", userId)),
 *     orderBy("createdAt", "desc"),
 *     limit(50),
 *     execute(db),
 *   )
 */

import type { Model } from "@/model/define";
import { from, where } from "@/query/builders";
import { eq } from "@/query/conditions";
import type { SelectNode } from "@/query/types";
import { AuditModel } from "./table.ts";

/**
 * Creates a SelectNode for the _pure_orm_audit table, pre-filtered
 * to entries matching the given model's table name.
 */
const auditLog = (model: Model): SelectNode =>
  where(eq("tableName", model.$name))(from(AuditModel));

export { auditLog };
