// Copyright 2026 igorjs. SPDX-License-Identifier: Apache-2.0

/**
 * Foreign key-aware operation ordering.
 *
 * Reorders CreateTable and DropTable operations based on FK dependencies
 * so that referenced tables are created before referencing tables, and
 * dropped in reverse order. Uses Kahn's algorithm for topological sort.
 */

import type { Model } from "../model/define.ts";
import type { ChangeOperation, CreateTable, DropTable } from "./types.ts";

// ---- Dependency graph ----

/**
 * Builds a dependency graph from Model[] FK references.
 * Returns a Map where each key depends on the values.
 *
 * Example: Post depends on User and Category (via author_id, category_id)
 *   "posts" -> ["users", "categories"]
 */
const buildDependencyGraph = (models: readonly Model[]): ReadonlyMap<string, readonly string[]> => {
  const graph = new Map<string, string[]>();

  for (const model of models) {
    const deps: string[] = [];
    for (const col of model.$columns) {
      if (col.config.references !== undefined) {
        const ref = col.config.references();
        const referencedModel = ref[0] as Model;
        const refName = referencedModel.$name;
        if (refName !== model.$name) {
          deps.push(refName);
        }
      }
    }
    graph.set(model.$name, deps);
  }

  return graph;
};

// ---- Topological sort (Kahn's algorithm) ----

const ensureNode = (
  inDegree: Map<string, number>,
  adjacency: Map<string, string[]>,
  name: string,
): void => {
  if (!inDegree.has(name)) inDegree.set(name, 0);
  if (!adjacency.has(name)) adjacency.set(name, []);
};

const buildGraphMaps = (
  graph: ReadonlyMap<string, readonly string[]>,
): { inDegree: Map<string, number>; adjacency: Map<string, string[]> } => {
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const [node, deps] of graph) {
    ensureNode(inDegree, adjacency, node);
    for (const dep of deps) {
      ensureNode(inDegree, adjacency, dep);
      adjacency.get(dep)?.push(node);
      inDegree.set(node, (inDegree.get(node) ?? 0) + 1);
    }
  }

  return { inDegree, adjacency };
};

const drainQueue = (
  inDegree: Map<string, number>,
  adjacency: Map<string, string[]>,
): readonly string[] => {
  const queue: string[] = [];
  for (const [node, degree] of inDegree) {
    if (degree === 0) queue.push(node);
  }
  queue.sort((a, b) => a.localeCompare(b));

  const sorted: string[] = [];
  while (queue.length > 0) {
    const node = queue.shift();
    if (node === undefined) break;
    sorted.push(node);

    const dependents = adjacency.get(node);
    if (dependents === undefined) continue;
    for (const dependent of dependents) {
      const newDegree = (inDegree.get(dependent) ?? 1) - 1;
      inDegree.set(dependent, newDegree);
      if (newDegree === 0) queue.push(dependent);
    }
    queue.sort((a, b) => a.localeCompare(b));
  }

  return sorted;
};

/**
 * Returns table names in topological order (referenced tables first).
 * Throws if a cycle is detected.
 */
const topologicalSort = (graph: ReadonlyMap<string, readonly string[]>): readonly string[] => {
  const { inDegree, adjacency } = buildGraphMaps(graph);
  const sorted = drainQueue(inDegree, adjacency);

  if (sorted.length !== inDegree.size) {
    const remaining = [...inDegree.entries()]
      .filter(([_, degree]) => degree > 0)
      .map(([name]) => name);
    throw new Error(
      `Circular foreign key dependency detected among tables: ${remaining.join(", ")}. ` +
        "Break the cycle by making one FK nullable and adding it via ALTER TABLE after both tables are created.",
    );
  }

  return Object.freeze(sorted);
};

// ---- Public API ----

/**
 * Reorders ChangeOperations based on FK dependencies.
 *
 * - CreateTable: referenced tables first (topological order)
 * - DropTable: dependent tables first (reverse topological order)
 * - Column/index ops: preserve original relative order
 *
 * If models are not provided, returns operations unchanged.
 */
const orderOperations = (
  ops: readonly ChangeOperation[],
  models?: readonly Model[],
): readonly ChangeOperation[] => {
  if (models === undefined || models.length === 0) {
    return ops;
  }

  const graph = buildDependencyGraph(models);
  const sorted = topologicalSort(graph);
  const orderMap = new Map(sorted.map((name, idx) => [name, idx]));

  const createOps: CreateTable[] = [];
  const dropOps: DropTable[] = [];
  const otherOps: ChangeOperation[] = [];

  for (const op of ops) {
    if (op.tag === "CreateTable") {
      createOps.push(op);
    } else if (op.tag === "DropTable") {
      dropOps.push(op);
    } else {
      otherOps.push(op);
    }
  }

  // CreateTable: sorted by topological order (referenced tables first)
  createOps.sort((a, b) => (orderMap.get(a.table) ?? 0) - (orderMap.get(b.table) ?? 0));

  // DropTable: reverse topological order (dependent tables first)
  dropOps.sort((a, b) => (orderMap.get(b.table) ?? 0) - (orderMap.get(a.table) ?? 0));

  return Object.freeze([...dropOps, ...otherOps, ...createOps]);
};

export { buildDependencyGraph, orderOperations, topologicalSort };
