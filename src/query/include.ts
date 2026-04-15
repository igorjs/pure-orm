/**
 * Eager loading via include().
 *
 * Converts a named relation into a LEFT JOIN on the SelectNode. Works
 * with hasOne and belongsTo relations (which produce a single joined row).
 *
 * HasMany relations are not yet supported by include(): they cause row
 * multiplication with a simple JOIN. Use lazy() or manual sub-queries
 * for one-to-many loading.
 *
 * Usage:
 *   pipe(
 *     from(Post),
 *     include(Post, "author"),   // LEFT JOIN users ON posts.author_id = users.id
 *     execute(db),
 *   )
 */

import type { Model } from "../model/define.ts";
import type { JoinClause, SelectNode } from "./types.ts";

/**
 * Adds a LEFT JOIN for a named relation, eagerly loading the related model.
 *
 * The model argument is the SOURCE model (the one in from()). The
 * relationName is looked up from model.$relations(). For hasOne and
 * belongsTo, a LEFT JOIN is generated using the relation's key mapping.
 *
 * Throws at build time if the relation is not found or is a hasMany/manyToMany
 * (which require different loading strategies).
 */
const include = (model: Model, relationName: string) => (node: SelectNode): SelectNode => {
  const relations = model.$relations();
  const rel = relations[relationName];

  if (rel === undefined) {
    throw new Error(`Relation "${relationName}" not found on model "${model.$name}"`);
  }

  if (rel.tag === "HasMany" || rel.tag === "ManyToMany") {
    throw new Error(
      `include() does not support "${rel.tag}" relations (causes row multiplication). `
        + `Use a separate query for "${relationName}" instead.`,
    );
  }

  const target = rel.target();

  // Determine the ON condition based on relation type.
  let leftColumn: string;
  let rightColumn: string;

  if (rel.tag === "BelongsTo") {
    // Foreign key is on the SOURCE table, local key is on the TARGET.
    // e.g., Post.authorId -> User.id
    leftColumn = rel.foreignKey;
    rightColumn = rel.localKey;
  } else {
    // HasOne: foreign key is on the TARGET table, local key is on the SOURCE.
    // e.g., User.id -> Profile.userId
    leftColumn = rel.localKey;
    rightColumn = rel.foreignKey;
  }

  const joinClause: JoinClause = Object.freeze({
    model: Object.freeze({
      name: target.$name,
      columns: target.$columns,
      options: target.$options,
    }),
    joinType: "left",
    condition: Object.freeze({ leftColumn, rightColumn }),
  });

  return Object.freeze({
    ...node,
    joins: Object.freeze([...node.joins, joinClause]),
  });
};

export { include };
