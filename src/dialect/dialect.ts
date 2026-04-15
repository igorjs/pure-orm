/**
 * Dialect interface.
 *
 * Abstracts SQL generation so the core ORM is database-agnostic.
 * Each dialect knows how to compile AST nodes into its SQL flavour,
 * handle parameterisation, and quote identifiers correctly.
 */

import type { FieldConfig } from "../model/types.ts";
import type { CompiledQuery, SelectNode } from "../query/types.ts";

type Dialect = {
  readonly name: string;
  readonly compileSelect: (node: SelectNode) => CompiledQuery;
  readonly param: (index: number) => string;
  readonly quote: (identifier: string) => string;
  readonly mapFieldType: (schemaType: string, config: Readonly<FieldConfig>) => string;
};

export type { Dialect };
