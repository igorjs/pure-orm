/**
 * Lazy (on-demand) relation loading.
 *
 * Given a result record and a relation name, lazy() builds and returns
 * the appropriate query node for loading the related data. The caller
 * pipes it to execute(db) or findOne(db) to fetch.
 *
 * Usage:
 *   const userRecord = { id: "u-1", name: "Alice" };
 *   const postsQuery = lazy(User, userRecord, "posts");
 *   const posts = await execute(db)(postsQuery).run();
 */

import type { Model } from "../model/define.ts";
import { from, where } from "./builders.ts";
import { eq } from "./conditions.ts";
import type { SelectNode } from "./types.ts";

/**
 * Builds a SelectNode to load related records for a given relation.
 *
 * For hasOne/hasMany: queries the target table WHERE foreignKey = record[localKey]
 * For belongsTo: queries the target table WHERE localKey = record[foreignKey]
 * For manyToMany: not yet supported (requires junction table join)
 *
 * The returned SelectNode can be piped to execute(db) for a list or
 * findOne(db) for a single record.
 */
const lazy = (
  model: Model,
  record: Readonly<Record<string, unknown>>,
  relationName: string,
): SelectNode => {
  const relations = model.$relations();
  const rel = relations[relationName];

  if (rel === undefined) {
    throw new Error(`Relation "${relationName}" not found on model "${model.$name}"`);
  }

  const target = rel.target();

  switch (rel.tag) {
    case "HasOne":
    case "HasMany": {
      // Target table WHERE foreignKey = record[localKey]
      const keyValue = record[rel.localKey];
      return where(eq(rel.foreignKey, keyValue))(from(target));
    }

    case "BelongsTo": {
      // Target table WHERE localKey = record[foreignKey]
      const keyValue = record[rel.foreignKey];
      return where(eq(rel.localKey, keyValue))(from(target));
    }

    case "ManyToMany":
      throw new Error(
        `lazy() does not yet support ManyToMany relations. `
          + `Use a raw query with the junction table "${rel.through}" instead.`,
      );
  }
};

export { lazy };
