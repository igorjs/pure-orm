/**
 * Query compilation: converts a QueryNode AST into SQL + parameters.
 *
 * compile() is the single entry point for translating a query AST into a
 * concrete SQL string ready to send to the database. It delegates all
 * SQL generation to the dialect layer, keeping the core free of database-
 * specific concerns.
 *
 * Unsupported node types (Insert, Update, Delete, Raw) throw immediately
 * because they represent programmer errors in Phase 1, not runtime failures.
 */

import { resolveDialect } from "../dialect/registry.ts";
import type { CompiledQuery, QueryNode } from "../query/types.ts";

/**
 * Compile a QueryNode into a SQL string and parameter list.
 *
 * Throws if the requested dialect is not registered, or if the node type
 * is not supported in the current phase. Both cases are programmer errors
 * (wrong config / calling mutation APIs too early) rather than runtime
 * failures, so throwing is the correct signal.
 */
const compile = (node: QueryNode, dialectName = "postgresql"): CompiledQuery => {
  const result = resolveDialect(dialectName);

  if (result.tag === "Err") {
    // Dialect resolution failures are programmer errors (misconfigured dialect
    // name), so we surface them immediately as thrown errors rather than
    // hiding them in a Result or Task.
    throw result.error;
  }

  const dialect = result.value;

  if (node.tag === "Select") {
    return dialect.compileSelect(node);
  }

  // Phase 1 only supports SELECT. Insert/Update/Delete/Raw will be added in
  // Phase 2. Throwing here surfaces the error at call time, not at execution.
  throw new Error(`compile: node type "${node.tag}" is not implemented in Phase 1`);
};

export { compile };
