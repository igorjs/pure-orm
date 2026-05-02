// Copyright 2026 igorjs. SPDX-License-Identifier: Apache-2.0

/**
 * Public condition builder functions.
 *
 * Each function is a pure factory that returns a frozen ConditionNode.
 * No side effects, no mutable state — safe to call and compose anywhere.
 */

import {
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
} from "./ast.ts";
import type { ConditionNode } from "./types.ts";

const eq = (column: string, value: unknown): ConditionNode => makeEq(column, value);

const ne = (column: string, value: unknown): ConditionNode => makeNe(column, value);

const gt = (column: string, value: unknown): ConditionNode => makeGt(column, value);

const gte = (column: string, value: unknown): ConditionNode => makeGte(column, value);

const lt = (column: string, value: unknown): ConditionNode => makeLt(column, value);

const lte = (column: string, value: unknown): ConditionNode => makeLte(column, value);

const like = (column: string, pattern: string): ConditionNode => makeLike(column, pattern);

const ilike = (column: string, pattern: string): ConditionNode => makeILike(column, pattern);

const isNull = (column: string): ConditionNode => makeIsNull(column);

const isNotNull = (column: string): ConditionNode => makeIsNotNull(column);

const inArray = (column: string, values: readonly unknown[]): ConditionNode =>
  makeInArray(column, values);

const between = (column: string, low: unknown, high: unknown): ConditionNode =>
  makeBetween(column, low, high);

const not = (condition: ConditionNode): ConditionNode => makeNot(condition);

const and = (...conditions: ConditionNode[]): ConditionNode => makeAnd(conditions);

const or = (...conditions: ConditionNode[]): ConditionNode => makeOr(conditions);

export { and, between, eq, gt, gte, ilike, inArray, isNotNull, isNull, like, lt, lte, ne, not, or };
