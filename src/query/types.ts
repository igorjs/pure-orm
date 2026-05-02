// Copyright 2026 igorjs. SPDX-License-Identifier: Apache-2.0

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
  | OrNode
  | ExistsNode
  | NotExistsNode;

// ---- Order by ----

type SortDirection = "asc" | "desc";

type OrderByClause = {
  readonly column: string;
  readonly direction: SortDirection;
};

// ---- Join ----

type JoinType = "inner" | "left" | "right" | "full";

/**
 * A column-to-column equality condition for JOIN ... ON clauses.
 *
 * leftColumn is resolved from the source table (the one in `from()`) by
 * default, or from a specific table when qualified as "TableName.field".
 * rightColumn is always resolved from the joined table's model.
 */
type JoinCondition = {
  readonly leftColumn: string;
  readonly rightColumn: string;
};

type JoinClause = {
  readonly model: ModelRef;
  readonly joinType: JoinType;
  readonly condition: JoinCondition;
};

// ---- Aggregate expressions ----

type AggregateFn = "COUNT" | "SUM" | "AVG" | "MIN" | "MAX";

type AggregateExpr = {
  readonly tag: "Aggregate";
  readonly fn: AggregateFn;
  readonly column: string;
  readonly alias: string | null;
};

// ---- Window expressions ----

type WindowFn =
  | "ROW_NUMBER"
  | "RANK"
  | "DENSE_RANK"
  | "LAG"
  | "LEAD"
  | "FIRST_VALUE"
  | "LAST_VALUE";

type WindowExpr = {
  readonly tag: "Window";
  readonly fn: WindowFn;
  readonly partitions: readonly string[];
  readonly orders: readonly OrderByClause[];
  readonly alias: string | null;
};

/** A select column: plain field name, aggregate, or window expression. */
type SelectColumn = string | AggregateExpr | WindowExpr;

// ---- CTE (Common Table Expression) ----

type CteClause = {
  readonly name: string;
  readonly query: SelectNode;
};

// ---- Subquery conditions ----

type ExistsNode = { readonly tag: "Exists"; readonly query: SelectNode };
type NotExistsNode = { readonly tag: "NotExists"; readonly query: SelectNode };

// ---- Query nodes ----

type SelectNode = {
  readonly tag: "Select";
  readonly model: ModelRef;
  readonly columns: readonly SelectColumn[] | "*";
  readonly conditions: readonly ConditionNode[];
  readonly joins: readonly JoinClause[];
  readonly ctes: readonly CteClause[];
  readonly groupBy: readonly string[];
  readonly having: readonly ConditionNode[];
  readonly orderBy: readonly OrderByClause[];
  readonly limit: number | null;
  readonly offset: number | null;
  readonly softDeleteFilter: boolean;
};

// ---- Returning clause ----

/**
 * Columns to return after a mutation. null means no RETURNING clause,
 * "*" returns all columns, string[] returns specific columns.
 */
type ReturningClause = readonly string[] | "*" | null;

// ---- On conflict (upsert) ----

type OnConflictClause = {
  readonly columns: readonly string[];
  readonly action: "nothing" | { readonly update: readonly string[] };
};

// ---- Mutation nodes ----

type InsertNode = {
  readonly tag: "Insert";
  readonly model: ModelRef;
  readonly rows: readonly Readonly<Record<string, unknown>>[];
  readonly returning: ReturningClause;
  readonly onConflict: OnConflictClause | null;
};

type UpdateNode = {
  readonly tag: "Update";
  readonly model: ModelRef;
  readonly values: Readonly<Record<string, unknown>>;
  readonly conditions: readonly ConditionNode[];
  readonly returning: ReturningClause;
  readonly softDeleteFilter: boolean;
};

type DeleteNode = {
  readonly tag: "Delete";
  readonly model: ModelRef;
  readonly conditions: readonly ConditionNode[];
  readonly returning: ReturningClause;
  readonly isSoftDelete: boolean;
  readonly softDeleteFilter: boolean;
};

type RawNode = { readonly tag: "Raw"; readonly sql: string; readonly params: readonly unknown[] };

type QueryNode = SelectNode | InsertNode | UpdateNode | DeleteNode | RawNode;

// ---- Compiled output ----

type CompiledQuery = {
  readonly sql: string;
  readonly params: readonly unknown[];
};

export type {
  AggregateExpr,
  AggregateFn,
  AndNode,
  BetweenNode,
  CompiledQuery,
  ConditionNode,
  CteClause,
  DeleteNode,
  EqNode,
  ExistsNode,
  GteNode,
  GtNode,
  ILikeNode,
  InArrayNode,
  InsertNode,
  IsNotNullNode,
  IsNullNode,
  JoinClause,
  JoinCondition,
  JoinType,
  LikeNode,
  LteNode,
  LtNode,
  NeNode,
  NotExistsNode,
  NotNode,
  OnConflictClause,
  OrderByClause,
  OrNode,
  QueryNode,
  RawNode,
  ReturningClause,
  SelectColumn,
  SelectNode,
  SortDirection,
  UpdateNode,
  WindowExpr,
  WindowFn,
};
