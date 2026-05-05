// Copyright 2026 igorjs. SPDX-License-Identifier: Apache-2.0

import { Schema } from "@igorjs/pure-fx";
import { describe, expect, it } from "@igorjs/pure-test";
import {
  buildDependencyGraph,
  orderOperations,
  topologicalSort,
} from "../src/migration/ordering.ts";
import type { ChangeOperation } from "../src/migration/types.ts";
import { Model } from "../src/model/define.ts";
import { Field } from "../src/model/field.ts";

// ── Test models ──

const Category = Model("categories", {
  fields: {
    id: Field(Schema.number, { primaryKey: true, default: "autoincrement" }),
    name: Field(Schema.string),
  },
});

const User = Model("users", {
  fields: {
    id: Field(Schema.number, { primaryKey: true, default: "autoincrement" }),
    name: Field(Schema.string),
  },
});

const Post = Model("posts", {
  fields: {
    id: Field(Schema.number, { primaryKey: true, default: "autoincrement" }),
    title: Field(Schema.string),
    authorId: Field(Schema.number, { references: () => [User, "id"] as const }),
    categoryId: Field(Schema.number, { references: () => [Category, "id"] as const }),
  },
});

const Comment = Model("comments", {
  fields: {
    id: Field(Schema.number, { primaryKey: true, default: "autoincrement" }),
    body: Field(Schema.string),
    postId: Field(Schema.number, { references: () => [Post, "id"] as const }),
  },
});

// ── Tests ──

describe("buildDependencyGraph", () => {
  it("builds a graph from models with FK references", () => {
    const graph = buildDependencyGraph([Category, User, Post, Comment]);
    expect(graph.get("posts")).toEqual(["users", "categories"]);
    expect(graph.get("comments")).toEqual(["posts"]);
    expect(graph.get("users")).toEqual([]);
    expect(graph.get("categories")).toEqual([]);
  });

  it("returns empty deps for models without FKs", () => {
    const graph = buildDependencyGraph([User, Category]);
    expect(graph.get("users")).toEqual([]);
    expect(graph.get("categories")).toEqual([]);
  });

  it("excludes self-references", () => {
    const SelfRef = Model("nodes", {
      fields: {
        id: Field(Schema.number, { primaryKey: true, default: "autoincrement" }),
        parentId: Field(Schema.number, { references: () => [SelfRef, "id"] as const }),
      },
    });
    const graph = buildDependencyGraph([SelfRef]);
    expect(graph.get("nodes")).toEqual([]);
  });
});

describe("topologicalSort", () => {
  it("sorts tables in dependency order", () => {
    const graph = new Map([
      ["posts", ["users", "categories"]],
      ["comments", ["posts"]],
      ["users", []],
      ["categories", []],
    ]);
    const sorted = topologicalSort(graph);
    const usersIdx = sorted.indexOf("users");
    const catsIdx = sorted.indexOf("categories");
    const postsIdx = sorted.indexOf("posts");
    const commentsIdx = sorted.indexOf("comments");

    expect(usersIdx < postsIdx).toBeTruthy();
    expect(catsIdx < postsIdx).toBeTruthy();
    expect(postsIdx < commentsIdx).toBeTruthy();
  });

  it("handles independent tables", () => {
    const graph = new Map([
      ["a", []],
      ["b", []],
      ["c", []],
    ]);
    const sorted = topologicalSort(graph);
    expect(sorted.length).toBe(3);
  });

  it("throws on circular dependency", () => {
    const graph = new Map([
      ["a", ["b"]],
      ["b", ["a"]],
    ]);
    expect(() => topologicalSort(graph)).toThrow();
  });

  it("error message mentions the cycle tables", () => {
    const graph = new Map([
      ["orders", ["customers"]],
      ["customers", ["orders"]],
    ]);
    try {
      topologicalSort(graph);
      expect(false).toBeTruthy();
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg.includes("orders")).toBeTruthy();
      expect(msg.includes("customers")).toBeTruthy();
      expect(msg.includes("Circular")).toBeTruthy();
    }
  });
});

describe("orderOperations", () => {
  const createOp = (table: string): ChangeOperation =>
    Object.freeze({
      tag: "CreateTable" as const,
      table,
      snapshot: { columns: {}, indexes: [], foreignKeys: [] },
    });

  const dropOp = (table: string): ChangeOperation =>
    Object.freeze({
      tag: "DropTable" as const,
      table,
      snapshot: { columns: {}, indexes: [], foreignKeys: [] },
    });

  const addColOp = (table: string): ChangeOperation =>
    Object.freeze({
      tag: "AddColumn" as const,
      table,
      column: "test",
      snapshot: {
        type: "string",
        primaryKey: false,
        nullable: false,
        unique: false,
        default: null,
        index: false,
      },
    });

  it("orders CreateTable by FK dependencies (referenced first)", () => {
    const ops = [
      createOp("comments"),
      createOp("posts"),
      createOp("users"),
      createOp("categories"),
    ];
    const ordered = orderOperations(ops, [Category, User, Post, Comment]);

    const names = ordered.map(o => o.table);
    expect(names.indexOf("users") < names.indexOf("posts")).toBeTruthy();
    expect(names.indexOf("categories") < names.indexOf("posts")).toBeTruthy();
    expect(names.indexOf("posts") < names.indexOf("comments")).toBeTruthy();
  });

  it("orders DropTable in reverse FK order (dependents first)", () => {
    const ops = [dropOp("users"), dropOp("categories"), dropOp("posts"), dropOp("comments")];
    const ordered = orderOperations(ops, [Category, User, Post, Comment]);

    const names = ordered.map(o => o.table);
    expect(names.indexOf("comments") < names.indexOf("posts")).toBeTruthy();
    expect(names.indexOf("posts") < names.indexOf("users")).toBeTruthy();
  });

  it("places DropTable before AddColumn before CreateTable", () => {
    const ops = [createOp("new_table"), addColOp("existing"), dropOp("old_table")];
    const ordered = orderOperations(ops, [User]);

    expect(ordered[0]?.tag).toBe("DropTable");
    expect(ordered[1]?.tag).toBe("AddColumn");
    expect(ordered[2]?.tag).toBe("CreateTable");
  });

  it("returns ops unchanged when no models provided", () => {
    const ops = [createOp("b"), createOp("a")];
    const ordered = orderOperations(ops);
    expect(ordered).toEqual(ops);
  });
});
