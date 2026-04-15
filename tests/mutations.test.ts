import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { Schema } from "@igorjs/pure-ts";

import { Model } from "../src/model/define.ts";
import { Field } from "../src/model/field.ts";
import { where } from "../src/query/builders.ts";
import { eq } from "../src/query/conditions.ts";
import { hardRemove, insert, insertMany, onConflict, remove, returning, update } from "../src/query/mutations.ts";
import type { DeleteNode, InsertNode, UpdateNode } from "../src/query/types.ts";

// ---------------------------------------------------------------------------
// Shared test models
// ---------------------------------------------------------------------------

const UserModel = Model("users", {
  fields: {
    id: Field(Schema.string, { primaryKey: true, default: "uuid" }),
    email: Field(Schema.string, { unique: true }),
    name: Field(Schema.string),
  },
  options: { softDelete: true },
});

const PostModel = Model("posts", {
  fields: {
    id: Field(Schema.string, { primaryKey: true, default: "uuid" }),
    title: Field(Schema.string),
    authorId: Field(Schema.string),
  },
  // No softDelete — tests the false-default path.
});

// ---------------------------------------------------------------------------
// insert()
// ---------------------------------------------------------------------------

describe("insert()", () => {
  it("produces an InsertNode with tag 'Insert'", () => {
    // Act
    const node = insert(UserModel, { email: "alice@example.com", name: "Alice" });

    // Assert
    assert.equal(node.tag, "Insert");
  });

  it("embeds the correct model name", () => {
    // Act
    const node = insert(UserModel, { email: "alice@example.com" });

    // Assert
    assert.equal(node.model.name, "users");
  });

  it("embeds model columns in the node", () => {
    // Act
    const node = insert(UserModel, { email: "alice@example.com" });

    // Assert
    assert.deepEqual(node.model.columns, UserModel.$columns);
  });

  it("embeds model options in the node", () => {
    // Act
    const node = insert(UserModel, { email: "alice@example.com" });

    // Assert
    assert.deepEqual(node.model.options, UserModel.$options);
  });

  it("sets rows to an array containing the provided values", () => {
    // Arrange
    const values = { email: "alice@example.com", name: "Alice" };

    // Act
    const node = insert(UserModel, values);

    // Assert
    assert.equal(node.rows.length, 1);
    assert.deepEqual(node.rows[0], values);
  });

  it("starts with returning null", () => {
    // Act
    const node = insert(UserModel, { email: "alice@example.com" });

    // Assert
    assert.equal(node.returning, null);
  });

  it("starts with onConflict null", () => {
    // Act
    const node = insert(UserModel, { email: "alice@example.com" });

    // Assert
    assert.equal(node.onConflict, null);
  });

  it("freezes the single row", () => {
    // Act
    const node = insert(UserModel, { email: "alice@example.com" });

    // Assert
    assert.ok(Object.isFrozen(node.rows[0]));
  });

  it("returns a frozen InsertNode", () => {
    // Act
    const node = insert(UserModel, { email: "alice@example.com" });

    // Assert
    assert.ok(Object.isFrozen(node));
  });

  it("does not mutate the input values object", () => {
    // Arrange
    const values: Record<string, unknown> = { email: "alice@example.com", name: "Alice" };
    const emailBefore = values["email"];

    // Act
    insert(UserModel, values);
    // Mutating the original after the call should not affect the node.
    values["email"] = "changed@example.com";

    // Assert — original key still held its value before our mutation
    assert.equal(emailBefore, "alice@example.com");
  });

  it("row in node is independent of the original values object", () => {
    // Arrange
    const values: Record<string, unknown> = { email: "alice@example.com" };

    // Act
    const node = insert(UserModel, values);
    values["email"] = "mutated@example.com";

    // Assert — frozen row still has the original value
    assert.equal(node.rows[0]?.["email"], "alice@example.com");
  });
});

// ---------------------------------------------------------------------------
// insertMany()
// ---------------------------------------------------------------------------

describe("insertMany()", () => {
  it("produces an InsertNode with tag 'Insert'", () => {
    // Act
    const node = insertMany(UserModel, [
      { email: "a@example.com" },
      { email: "b@example.com" },
    ]);

    // Assert
    assert.equal(node.tag, "Insert");
  });

  it("creates an InsertNode with multiple rows", () => {
    // Arrange
    const rows = [
      { email: "a@example.com", name: "Alice" },
      { email: "b@example.com", name: "Bob" },
      { email: "c@example.com", name: "Carol" },
    ];

    // Act
    const node = insertMany(UserModel, rows);

    // Assert
    assert.equal(node.rows.length, 3);
    assert.deepEqual(node.rows[0], rows[0]);
    assert.deepEqual(node.rows[1], rows[1]);
    assert.deepEqual(node.rows[2], rows[2]);
  });

  it("freezes each row independently", () => {
    // Act
    const node = insertMany(UserModel, [
      { email: "a@example.com" },
      { email: "b@example.com" },
    ]);

    // Assert
    for (const row of node.rows) {
      assert.ok(Object.isFrozen(row));
    }
  });

  it("freezes the rows array", () => {
    // Act
    const node = insertMany(UserModel, [{ email: "a@example.com" }]);

    // Assert
    assert.ok(Object.isFrozen(node.rows));
  });

  it("returns a frozen InsertNode", () => {
    // Act
    const node = insertMany(UserModel, [{ email: "a@example.com" }]);

    // Assert
    assert.ok(Object.isFrozen(node));
  });

  it("starts with returning null", () => {
    // Act
    const node = insertMany(UserModel, [{ email: "a@example.com" }]);

    // Assert
    assert.equal(node.returning, null);
  });

  it("starts with onConflict null", () => {
    // Act
    const node = insertMany(UserModel, [{ email: "a@example.com" }]);

    // Assert
    assert.equal(node.onConflict, null);
  });
});

// ---------------------------------------------------------------------------
// update()
// ---------------------------------------------------------------------------

describe("update()", () => {
  it("produces an UpdateNode with tag 'Update'", () => {
    // Act
    const node = update(UserModel, { name: "Alice" });

    // Assert
    assert.equal(node.tag, "Update");
  });

  it("embeds the correct model name", () => {
    // Act
    const node = update(UserModel, { name: "Alice" });

    // Assert
    assert.equal(node.model.name, "users");
  });

  it("stores the provided values", () => {
    // Arrange
    const values = { name: "Alice", email: "alice@example.com" };

    // Act
    const node = update(UserModel, values);

    // Assert
    assert.deepEqual(node.values, values);
  });

  it("starts with an empty conditions array", () => {
    // Act
    const node = update(UserModel, { name: "Alice" });

    // Assert
    assert.equal(node.conditions.length, 0);
  });

  it("starts with returning null", () => {
    // Act
    const node = update(UserModel, { name: "Alice" });

    // Assert
    assert.equal(node.returning, null);
  });

  it("sets softDeleteFilter to true when model has softDelete: true", () => {
    // Act
    const node = update(UserModel, { name: "Alice" });

    // Assert
    assert.equal(node.softDeleteFilter, true);
  });

  it("sets softDeleteFilter to false when model has no softDelete option", () => {
    // Act
    const node = update(PostModel, { title: "Hello" });

    // Assert
    assert.equal(node.softDeleteFilter, false);
  });

  it("sets softDeleteFilter to false when model has softDelete: false", () => {
    // Arrange
    const ThingModel = Model("things", {
      fields: { id: Field(Schema.string) },
      options: { softDelete: false },
    });

    // Act
    const node = update(ThingModel, { id: "x" });

    // Assert
    assert.equal(node.softDeleteFilter, false);
  });

  it("freezes the values object", () => {
    // Act
    const node = update(UserModel, { name: "Alice" });

    // Assert
    assert.ok(Object.isFrozen(node.values));
  });

  it("freezes the conditions array", () => {
    // Act
    const node = update(UserModel, { name: "Alice" });

    // Assert
    assert.ok(Object.isFrozen(node.conditions));
  });

  it("returns a frozen UpdateNode", () => {
    // Act
    const node = update(UserModel, { name: "Alice" });

    // Assert
    assert.ok(Object.isFrozen(node));
  });
});

// ---------------------------------------------------------------------------
// remove()
// ---------------------------------------------------------------------------

describe("remove()", () => {
  it("produces a DeleteNode with tag 'Delete'", () => {
    // Act
    const node = remove(UserModel);

    // Assert
    assert.equal(node.tag, "Delete");
  });

  it("embeds the correct model name", () => {
    // Act
    const node = remove(UserModel);

    // Assert
    assert.equal(node.model.name, "users");
  });

  it("sets isSoftDelete to true when model has softDelete: true", () => {
    // Act
    const node = remove(UserModel);

    // Assert
    assert.equal(node.isSoftDelete, true);
  });

  it("sets isSoftDelete to false when model has no softDelete option", () => {
    // Act
    const node = remove(PostModel);

    // Assert
    assert.equal(node.isSoftDelete, false);
  });

  it("sets softDeleteFilter to true when model has softDelete: true", () => {
    // Act
    const node = remove(UserModel);

    // Assert
    assert.equal(node.softDeleteFilter, true);
  });

  it("sets softDeleteFilter to false when model has no softDelete option", () => {
    // Act
    const node = remove(PostModel);

    // Assert
    assert.equal(node.softDeleteFilter, false);
  });

  it("starts with an empty conditions array", () => {
    // Act
    const node = remove(UserModel);

    // Assert
    assert.equal(node.conditions.length, 0);
  });

  it("starts with returning null", () => {
    // Act
    const node = remove(UserModel);

    // Assert
    assert.equal(node.returning, null);
  });

  it("returns a frozen DeleteNode", () => {
    // Act
    const node = remove(UserModel);

    // Assert
    assert.ok(Object.isFrozen(node));
  });

  it("conditions array is frozen", () => {
    // Act
    const node = remove(UserModel);

    // Assert
    assert.ok(Object.isFrozen(node.conditions));
  });
});

// ---------------------------------------------------------------------------
// hardRemove()
// ---------------------------------------------------------------------------

describe("hardRemove()", () => {
  it("produces a DeleteNode with tag 'Delete'", () => {
    // Act
    const node = hardRemove(UserModel);

    // Assert
    assert.equal(node.tag, "Delete");
  });

  it("sets isSoftDelete to false even when model has softDelete: true", () => {
    // Act
    const node = hardRemove(UserModel);

    // Assert
    assert.equal(node.isSoftDelete, false);
  });

  it("sets softDeleteFilter to false even when model has softDelete: true", () => {
    // Act
    const node = hardRemove(UserModel);

    // Assert
    assert.equal(node.softDeleteFilter, false);
  });

  it("sets isSoftDelete to false when model has no softDelete option", () => {
    // Act
    const node = hardRemove(PostModel);

    // Assert
    assert.equal(node.isSoftDelete, false);
  });

  it("starts with an empty conditions array", () => {
    // Act
    const node = hardRemove(UserModel);

    // Assert
    assert.equal(node.conditions.length, 0);
  });

  it("starts with returning null", () => {
    // Act
    const node = hardRemove(UserModel);

    // Assert
    assert.equal(node.returning, null);
  });

  it("returns a frozen DeleteNode", () => {
    // Act
    const node = hardRemove(UserModel);

    // Assert
    assert.ok(Object.isFrozen(node));
  });
});

// ---------------------------------------------------------------------------
// returning()
// ---------------------------------------------------------------------------

describe("returning()", () => {
  it("sets returning to '*' when called with no arguments", () => {
    // Act
    const node = returning()(insert(UserModel, { email: "a@example.com" }));

    // Assert
    assert.equal(node.returning, "*");
  });

  it("sets returning to '*' when called with the literal '*'", () => {
    // Act
    const node = returning("*")(insert(UserModel, { email: "a@example.com" }));

    // Assert
    assert.equal(node.returning, "*");
  });

  it("sets returning to an array of the specified columns", () => {
    // Act
    const node = returning("id", "email")(insert(UserModel, { email: "a@example.com" }));

    // Assert
    assert.deepEqual(node.returning, ["id", "email"]);
  });

  it("works on an InsertNode", () => {
    // Arrange
    const insertNode: InsertNode = insert(UserModel, { email: "a@example.com" });

    // Act
    const result = returning("id")(insertNode);

    // Assert
    assert.equal(result.tag, "Insert");
    assert.deepEqual(result.returning, ["id"]);
  });

  it("works on an UpdateNode", () => {
    // Arrange
    const updateNode: UpdateNode = update(UserModel, { name: "Alice" });

    // Act
    const result = returning("id", "email")(updateNode);

    // Assert
    assert.equal(result.tag, "Update");
    assert.deepEqual(result.returning, ["id", "email"]);
  });

  it("works on a DeleteNode", () => {
    // Arrange
    const deleteNode: DeleteNode = remove(UserModel);

    // Act
    const result = returning("id")(deleteNode);

    // Assert
    assert.equal(result.tag, "Delete");
    assert.deepEqual(result.returning, ["id"]);
  });

  it("preserves all other fields on an InsertNode", () => {
    // Arrange
    const before = insert(UserModel, { email: "a@example.com" });

    // Act
    const after = returning("id")(before);

    // Assert
    assert.equal(after.tag, before.tag);
    assert.deepEqual(after.rows, before.rows);
    assert.equal(after.onConflict, before.onConflict);
  });

  it("preserves all other fields on an UpdateNode", () => {
    // Arrange
    const before = update(UserModel, { name: "Alice" });

    // Act
    const after = returning("id")(before);

    // Assert
    assert.equal(after.tag, before.tag);
    assert.deepEqual(after.values, before.values);
    assert.deepEqual(after.conditions, before.conditions);
    assert.equal(after.softDeleteFilter, before.softDeleteFilter);
  });

  it("preserves all other fields on a DeleteNode", () => {
    // Arrange
    const before = remove(UserModel);

    // Act
    const after = returning("id")(before);

    // Assert
    assert.equal(after.tag, before.tag);
    assert.equal(after.isSoftDelete, before.isSoftDelete);
    assert.equal(after.softDeleteFilter, before.softDeleteFilter);
    assert.deepEqual(after.conditions, before.conditions);
  });

  it("returns a frozen node", () => {
    // Act
    const node = returning("id")(insert(UserModel, { email: "a@example.com" }));

    // Assert
    assert.ok(Object.isFrozen(node));
  });

  it("does not mutate the input node", () => {
    // Arrange
    const before = insert(UserModel, { email: "a@example.com" });

    // Act
    returning("id")(before);

    // Assert
    assert.equal(before.returning, null);
  });
});

// ---------------------------------------------------------------------------
// onConflict()
// ---------------------------------------------------------------------------

describe("onConflict()", () => {
  it("sets the conflict clause with a single column string and 'nothing' action", () => {
    // Act
    const node = onConflict("email", "nothing")(insert(UserModel, { email: "a@example.com" }));

    // Assert
    assert.ok(node.onConflict !== null);
    assert.deepEqual(node.onConflict.columns, ["email"]);
    assert.equal(node.onConflict.action, "nothing");
  });

  it("sets the conflict clause with an array of columns and 'nothing' action", () => {
    // Act
    const node = onConflict(["email", "name"], "nothing")(
      insert(UserModel, { email: "a@example.com" }),
    );

    // Assert
    assert.ok(node.onConflict !== null);
    assert.deepEqual(node.onConflict.columns, ["email", "name"]);
    assert.equal(node.onConflict.action, "nothing");
  });

  it("sets the conflict clause with an update action", () => {
    // Act
    const node = onConflict(["email"], { update: ["name"] })(
      insert(UserModel, { email: "a@example.com" }),
    );

    // Assert
    assert.ok(node.onConflict !== null);
    assert.deepEqual(node.onConflict.columns, ["email"]);
    assert.deepEqual(node.onConflict.action, { update: ["name"] });
  });

  it("sets the conflict clause with a single string column and an update action", () => {
    // Act
    const node = onConflict("email", { update: ["name", "email"] })(
      insert(UserModel, { email: "a@example.com" }),
    );

    // Assert
    assert.ok(node.onConflict !== null);
    assert.deepEqual(node.onConflict.columns, ["email"]);
    assert.deepEqual(node.onConflict.action, { update: ["name", "email"] });
  });

  it("preserves all other InsertNode fields", () => {
    // Arrange
    const before = returning("id")(insert(UserModel, { email: "a@example.com" }));

    // Act
    const after = onConflict("email", "nothing")(before);

    // Assert
    assert.equal(after.tag, before.tag);
    assert.deepEqual(after.rows, before.rows);
    assert.deepEqual(after.returning, before.returning);
  });

  it("returns a frozen InsertNode", () => {
    // Act
    const node = onConflict("email", "nothing")(insert(UserModel, { email: "a@example.com" }));

    // Assert
    assert.ok(Object.isFrozen(node));
  });

  it("the onConflict clause itself is frozen", () => {
    // Act
    const node = onConflict("email", "nothing")(insert(UserModel, { email: "a@example.com" }));

    // Assert
    assert.ok(Object.isFrozen(node.onConflict));
  });

  it("does not mutate the input node", () => {
    // Arrange
    const before = insert(UserModel, { email: "a@example.com" });

    // Act
    onConflict("email", "nothing")(before);

    // Assert
    assert.equal(before.onConflict, null);
  });
});

// ---------------------------------------------------------------------------
// where() on UpdateNode
// ---------------------------------------------------------------------------

describe("where() on UpdateNode", () => {
  it("appends a condition to the conditions array", () => {
    // Arrange
    const condition = eq("id", "u1");

    // Act
    const node = where(condition)(update(UserModel, { name: "Alice" }));

    // Assert
    assert.equal(node.conditions.length, 1);
    assert.deepEqual(node.conditions[0], condition);
  });

  it("accumulates conditions across multiple where() calls", () => {
    // Arrange
    const c1 = eq("id", "u1");
    const c2 = eq("email", "alice@example.com");

    // Act
    const node = where(c2)(where(c1)(update(UserModel, { name: "Alice" })));

    // Assert
    assert.equal(node.conditions.length, 2);
    assert.deepEqual(node.conditions[0], c1);
    assert.deepEqual(node.conditions[1], c2);
  });

  it("preserves all other UpdateNode fields", () => {
    // Arrange
    const before = update(UserModel, { name: "Alice" });

    // Act
    const after = where(eq("id", "u1"))(before);

    // Assert
    assert.equal(after.tag, before.tag);
    assert.deepEqual(after.values, before.values);
    assert.equal(after.returning, before.returning);
    assert.equal(after.softDeleteFilter, before.softDeleteFilter);
  });

  it("returns a frozen UpdateNode", () => {
    // Act
    const node = where(eq("id", "u1"))(update(UserModel, { name: "Alice" }));

    // Assert
    assert.ok(Object.isFrozen(node));
  });

  it("conditions array on returned node is frozen", () => {
    // Act
    const node = where(eq("id", "u1"))(update(UserModel, { name: "Alice" }));

    // Assert
    assert.ok(Object.isFrozen(node.conditions));
  });

  it("does not mutate the input UpdateNode", () => {
    // Arrange
    const before = update(UserModel, { name: "Alice" });

    // Act
    where(eq("id", "u1"))(before);

    // Assert
    assert.equal(before.conditions.length, 0);
  });
});

// ---------------------------------------------------------------------------
// where() on DeleteNode
// ---------------------------------------------------------------------------

describe("where() on DeleteNode", () => {
  it("appends a condition to the conditions array", () => {
    // Arrange
    const condition = eq("id", "u1");

    // Act
    const node = where(condition)(remove(UserModel));

    // Assert
    assert.equal(node.conditions.length, 1);
    assert.deepEqual(node.conditions[0], condition);
  });

  it("accumulates conditions across multiple where() calls", () => {
    // Arrange
    const c1 = eq("id", "u1");
    const c2 = eq("email", "alice@example.com");

    // Act
    const node = where(c2)(where(c1)(remove(UserModel)));

    // Assert
    assert.equal(node.conditions.length, 2);
    assert.deepEqual(node.conditions[0], c1);
    assert.deepEqual(node.conditions[1], c2);
  });

  it("preserves all other DeleteNode fields", () => {
    // Arrange
    const before = remove(UserModel);

    // Act
    const after = where(eq("id", "u1"))(before);

    // Assert
    assert.equal(after.tag, before.tag);
    assert.equal(after.isSoftDelete, before.isSoftDelete);
    assert.equal(after.softDeleteFilter, before.softDeleteFilter);
    assert.equal(after.returning, before.returning);
  });

  it("returns a frozen DeleteNode", () => {
    // Act
    const node = where(eq("id", "u1"))(remove(UserModel));

    // Assert
    assert.ok(Object.isFrozen(node));
  });

  it("conditions array on returned node is frozen", () => {
    // Act
    const node = where(eq("id", "u1"))(remove(UserModel));

    // Assert
    assert.ok(Object.isFrozen(node.conditions));
  });

  it("does not mutate the input DeleteNode", () => {
    // Arrange
    const before = remove(UserModel);

    // Act
    where(eq("id", "u1"))(before);

    // Assert
    assert.equal(before.conditions.length, 0);
  });

  it("also works with hardRemove() nodes", () => {
    // Arrange
    const condition = eq("id", "u1");

    // Act
    const node = where(condition)(hardRemove(UserModel));

    // Assert
    assert.equal(node.conditions.length, 1);
    assert.deepEqual(node.conditions[0], condition);
    assert.equal(node.isSoftDelete, false);
  });
});

// ---------------------------------------------------------------------------
// Immutability — all returned nodes are frozen
// ---------------------------------------------------------------------------

describe("all returned nodes are frozen", () => {
  it("insert() returns a frozen node", () => {
    assert.ok(Object.isFrozen(insert(UserModel, { email: "a@example.com" })));
  });

  it("insertMany() returns a frozen node", () => {
    assert.ok(Object.isFrozen(insertMany(UserModel, [{ email: "a@example.com" }])));
  });

  it("update() returns a frozen node", () => {
    assert.ok(Object.isFrozen(update(UserModel, { name: "Alice" })));
  });

  it("remove() returns a frozen node", () => {
    assert.ok(Object.isFrozen(remove(UserModel)));
  });

  it("hardRemove() returns a frozen node", () => {
    assert.ok(Object.isFrozen(hardRemove(UserModel)));
  });

  it("returning() returns a frozen node", () => {
    assert.ok(Object.isFrozen(returning("id")(insert(UserModel, { email: "a@example.com" }))));
  });

  it("onConflict() returns a frozen node", () => {
    assert.ok(Object.isFrozen(onConflict("email", "nothing")(insert(UserModel, { email: "a@example.com" }))));
  });

  it("where() on UpdateNode returns a frozen node", () => {
    assert.ok(Object.isFrozen(where(eq("id", "u1"))(update(UserModel, { name: "Alice" }))));
  });

  it("where() on DeleteNode returns a frozen node", () => {
    assert.ok(Object.isFrozen(where(eq("id", "u1"))(remove(UserModel))));
  });
});
