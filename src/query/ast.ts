// Copyright 2026 igorjs. SPDX-License-Identifier: Apache-2.0

/**
 * AST node factory helpers.
 *
 * These are low-level constructors used by the public condition functions.
 * Each factory freezes its output so callers never receive mutable objects.
 */

import type {
  AndNode,
  BetweenNode,
  ConditionNode,
  EqNode,
  GteNode,
  GtNode,
  ILikeNode,
  InArrayNode,
  IsNotNullNode,
  IsNullNode,
  LikeNode,
  LteNode,
  LtNode,
  NeNode,
  NotNode,
  OrNode,
} from "./types.ts";

const makeEq = (column: string, value: unknown): EqNode =>
  Object.freeze({ tag: "Eq", column, value });

const makeNe = (column: string, value: unknown): NeNode =>
  Object.freeze({ tag: "Ne", column, value });

const makeGt = (column: string, value: unknown): GtNode =>
  Object.freeze({ tag: "Gt", column, value });

const makeGte = (column: string, value: unknown): GteNode =>
  Object.freeze({ tag: "Gte", column, value });

const makeLt = (column: string, value: unknown): LtNode =>
  Object.freeze({ tag: "Lt", column, value });

const makeLte = (column: string, value: unknown): LteNode =>
  Object.freeze({ tag: "Lte", column, value });

const makeLike = (column: string, pattern: string): LikeNode =>
  Object.freeze({ tag: "Like", column, pattern });

const makeILike = (column: string, pattern: string): ILikeNode =>
  Object.freeze({ tag: "ILike", column, pattern });

const makeIsNull = (column: string): IsNullNode => Object.freeze({ tag: "IsNull", column });

const makeIsNotNull = (column: string): IsNotNullNode =>
  Object.freeze({ tag: "IsNotNull", column });

const makeInArray = (column: string, values: readonly unknown[]): InArrayNode =>
  Object.freeze({ tag: "InArray", column, values: Object.freeze([...values]) });

const makeBetween = (column: string, low: unknown, high: unknown): BetweenNode =>
  Object.freeze({ tag: "Between", column, low, high });

const makeNot = (condition: ConditionNode): NotNode => Object.freeze({ tag: "Not", condition });

const makeAnd = (conditions: readonly ConditionNode[]): AndNode =>
  Object.freeze({ tag: "And", conditions: Object.freeze([...conditions]) });

const makeOr = (conditions: readonly ConditionNode[]): OrNode =>
  Object.freeze({ tag: "Or", conditions: Object.freeze([...conditions]) });

export {
  makeAnd,
  makeBetween,
  makeEq,
  makeGt,
  makeGte,
  makeILike,
  makeInArray,
  makeIsNotNull,
  makeIsNull,
  makeLike,
  makeLt,
  makeLte,
  makeNe,
  makeNot,
  makeOr,
};
