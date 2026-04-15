/**
 * Query AST node types.
 *
 * Every query operation produces immutable AST nodes rather than SQL strings.
 * The AST is compiled to SQL only at execution time, via the dialect layer.
 * This separation keeps query building pure and enables inspection/debugging.
 */

import type { ModelRef } from "../model/types.ts";

// ---- Condition nodes ----

type EqNode = { readonly tag: "Eq"; readonly column: string; readonly value: unknown };
type NeNode = { readonly tag: "Ne"; readonly column: string; readonly value: unknown };
type GtNode = { readonly tag: "Gt"; readonly column: string; readonly value: unknown };
type GteNode = { readonly tag: "Gte"; readonly column: string; readonly value: unknown };
type LtNode = { readonly tag: "Lt"; readonly column: string; readonly value: unknown };
type LteNode = { readonly tag: "Lte"; readonly column: string; readonly value: unknown };
type LikeNode = { readonly tag: "Like"; readonly column: string; readonly pattern: string };
type ILikeNode = { readonly tag: "ILike"; readonly column: string; readonly pattern: string };
type IsNullNode = { readonly tag: "IsNull"; readonly column: string };
type IsNotNullNode = { readonly tag: "IsNotNull"; readonly column: string };
type InArrayNode = {
  readonly tag: "InArray";
  readonly column: string;
  readonly values: readonly unknown[];
};
type BetweenNode = {
  readonly tag: "Between";
  readonly column: string;
  readonly low: unknown;
  readonly high: unknown;
};
type NotNode = { readonly tag: "Not"; readonly condition: ConditionNode };
type AndNode = { readonly tag: "And"; readonly conditions: readonly ConditionNode[] };
type OrNode = { readonly tag: "Or"; readonly conditions: readonly ConditionNode[] };

type ConditionNode =
  | EqNode
  | NeNode
  | GtNode
  | GteNode
  | LtNode
  | LteNode
  | LikeNode
  | ILikeNode
  | IsNullNode
  | IsNotNullNode
  | InArrayNode
  | BetweenNode
  | NotNode
  | AndNode
  | OrNode;

// ---- Order by ----

type SortDirection = "asc" | "desc";

type OrderByClause = {
  readonly column: string;
  readonly direction: SortDirection;
};

// ---- Query nodes ----

type SelectNode = {
  readonly tag: "Select";
  readonly model: ModelRef;
  readonly columns: readonly string[] | "*";
  readonly conditions: readonly ConditionNode[];
  readonly orderBy: readonly OrderByClause[];
  readonly limit: number | undefined;
  readonly offset: number | undefined;
  readonly softDeleteFilter: boolean;
};

/** Placeholder for Phase 2 mutation nodes. */
type InsertNode = { readonly tag: "Insert" };
type UpdateNode = { readonly tag: "Update" };
type DeleteNode = { readonly tag: "Delete" };
type RawNode = { readonly tag: "Raw"; readonly sql: string; readonly params: readonly unknown[] };

type QueryNode = SelectNode | InsertNode | UpdateNode | DeleteNode | RawNode;

// ---- Compiled output ----

type CompiledQuery = {
  readonly sql: string;
  readonly params: readonly unknown[];
};

export type {
  AndNode,
  BetweenNode,
  CompiledQuery,
  ConditionNode,
  DeleteNode,
  EqNode,
  GteNode,
  GtNode,
  ILikeNode,
  InArrayNode,
  InsertNode,
  IsNotNullNode,
  IsNullNode,
  LikeNode,
  LteNode,
  LtNode,
  NeNode,
  NotNode,
  OrderByClause,
  OrNode,
  QueryNode,
  RawNode,
  SelectNode,
  SortDirection,
  UpdateNode,
};
