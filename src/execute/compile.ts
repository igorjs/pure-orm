/**
 * Query compilation: converts a QueryNode AST into SQL + parameters.
 *
 * compile() is the single entry point for translating a query AST into a
 * concrete SQL string ready to send to the database. It delegates all
 * SQL generation to the dialect layer, keeping the core free of database-
 * specific concerns.
 *
 * All QueryNode types are supported: Select, Insert, Update, Delete, and Raw.
 * Raw nodes are passed through as-is — their sql and params fields are already
 * concrete SQL.
 */

import { resolveDialect } from "../dialect/registry.ts";
import type { CompiledQuery, QueryNode } from "../query/types.ts";

/**
 * Compile a QueryNode into a SQL string and parameter list.
 *
 * Throws if the requested dialect is not registered — this is a programmer
 * error (wrong config) rather than a runtime failure, so throwing is the
 * correct signal.
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

  switch (node.tag) {
    case "Select":
      return dialect.compileSelect(node);
    case "Insert":
      return dialect.compileInsert(node);
    case "Update":
      return dialect.compileUpdate(node);
    case "Delete":
      return dialect.compileDelete(node);
    case "Raw":
      return { sql: node.sql, params: node.params };
  }
};

export { compile };
