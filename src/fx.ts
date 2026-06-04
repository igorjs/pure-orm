// Copyright 2026 igorjs. SPDX-License-Identifier: Apache-2.0

/**
 * Internal chokepoint for the pure-fx surface this codebase relies on.
 *
 * Every internal module imports its pure-fx primitives from here rather than
 * from `@igorjs/pure-fx/*` directly. The goal is purely operational: when
 * pure-fx (currently pre-1.0, per ADR-0012) makes a breaking change, we fix
 * one file instead of two dozen.
 *
 * Public re-exports remain in `index.ts` — consumers continue to install
 * `@igorjs/pure-fx` themselves and import `pipe`/`flow` from the package root.
 *
 * Surface (15 symbols):
 *   /core   Err, Ok, Match, None, flow, pipe + types Option, Result
 *   /async  Task (value + type)
 *   /data   Schema, List, Record + types SchemaType, ImmutableList, ImmutableRecord
 */

export { Task } from "@igorjs/pure-fx/async";
export type { Option, Result } from "@igorjs/pure-fx/core";
export { Err, flow, Match, None, Ok, pipe } from "@igorjs/pure-fx/core";
export type { ImmutableList, ImmutableRecord, SchemaType } from "@igorjs/pure-fx/data";
export { List, Record, Schema } from "@igorjs/pure-fx/data";
