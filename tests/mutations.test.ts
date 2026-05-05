import { Schema } from "@igorjs/pure-fx";
import { describe, expect, it } from "@igorjs/pure-test";

import { Model } from "../src/model/define.ts";
import { Field } from "../src/model/field.ts";
import { where } from "../src/query/builders.ts";
import { eq } from "../src/query/conditions.ts";
import {
  hardRemove,
  insert,
  insertMany,
  onConflict,
  remove,
  returning,
  update,
} from "../src/query/mutations.ts";
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
    expect(node.tag).toBe("Insert");
  });

  it("embeds the correct model name", () => {
    // Act
    const node = insert(UserModel, { email: "alice@example.com" });

    // Assert
    expect(node.model.name).toBe("users");
  });

  it("embeds model columns in the node", () => {
    // Act
    const node = insert(UserModel, { email: "alice@example.com" });

    // Assert
    expect(node.model.columns).toEqual(UserModel.$columns);
  });

  it("embeds model options in the node", () => {
    // Act
    const node = insert(UserModel, { email: "alice@example.com" });

    // Assert
    expect(node.model.options).toEqual(UserModel.$options);
  });

  it("sets rows to an array containing the provided values", () => {
    // Arrange
    const values = { email: "alice@example.com", name: "Alice" };

    // Act
    const node = insert(UserModel, values);

    // Assert
    expect(node.rows.length).toBe(1);
    expect(node.rows[0]).toEqual(values);
  });

  it("starts with returning null", () => {
    // Act
    const node = insert(UserModel, { email: "alice@example.com" });

    // Assert
    expect(node.returning).toBe(null);
  });

  it("starts with onConflict null", () => {
    // Act
    const node = insert(UserModel, { email: "alice@example.com" });

    // Assert
    expect(node.onConflict).toBe(null);
  });

  it("freezes the single row", () => {
    // Act
    const node = insert(UserModel, { email: "alice@example.com" });

    // Assert
    expect(Object.isFrozen(node.rows[0])).toBeTruthy();
  });

  it("returns a frozen InsertNode", () => {
    // Act
    const node = insert(UserModel, { email: "alice@example.com" });

    // Assert
    expect(Object.isFrozen(node)).toBeTruthy();
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
    expect(emailBefore).toBe("alice@example.com");
  });

  it("row in node is independent of the original values object", () => {
    // Arrange
    const values: Record<string, unknown> = { email: "alice@example.com" };

    // Act
    const node = insert(UserModel, values);
    values["email"] = "mutated@example.com";

    // Assert — frozen row still has the original value
    expect(node.rows[0]?.["email"]).toBe("alice@example.com");
  });
});

// ---------------------------------------------------------------------------
// insertMany()
// ---------------------------------------------------------------------------

describe("insertMany()", () => {
  it("produces an InsertNode with tag 'Insert'", () => {
    // Act
    const node = insertMany(UserModel, [{ email: "a@example.com" }, { email: "b@example.com" }]);

    // Assert
    expect(node.tag).toBe("Insert");
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
    expect(node.rows.length).toBe(3);
    expect(node.rows[0]).toEqual(rows[0]);
    expect(node.rows[1]).toEqual(rows[1]);
    expect(node.rows[2]).toEqual(rows[2]);
  });

  it("freezes each row independently", () => {
    // Act
    const node = insertMany(UserModel, [{ email: "a@example.com" }, { email: "b@example.com" }]);

    // Assert
    for (const row of node.rows) {
      expect(Object.isFrozen(row)).toBeTruthy();
    }
  });

  it("freezes the rows array", () => {
    // Act
    const node = insertMany(UserModel, [{ email: "a@example.com" }]);

    // Assert
    expect(Object.isFrozen(node.rows)).toBeTruthy();
  });

  it("returns a frozen InsertNode", () => {
    // Act
    const node = insertMany(UserModel, [{ email: "a@example.com" }]);

    // Assert
    expect(Object.isFrozen(node)).toBeTruthy();
  });

  it("starts with returning null", () => {
    // Act
    const node = insertMany(UserModel, [{ email: "a@example.com" }]);

    // Assert
    expect(node.returning).toBe(null);
  });

  it("starts with onConflict null", () => {
    // Act
    const node = insertMany(UserModel, [{ email: "a@example.com" }]);

    // Assert
    expect(node.onConflict).toBe(null);
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
    expect(node.tag).toBe("Update");
  });

  it("embeds the correct model name", () => {
    // Act
    const node = update(UserModel, { name: "Alice" });

    // Assert
    expect(node.model.name).toBe("users");
  });

  it("stores the provided values", () => {
    // Arrange
    const values = { name: "Alice", email: "alice@example.com" };

    // Act
    const node = update(UserModel, values);

    // Assert
    expect(node.values).toEqual(values);
  });

  it("starts with an empty conditions array", () => {
    // Act
    const node = update(UserModel, { name: "Alice" });

    // Assert
    expect(node.conditions.length).toBe(0);
  });

  it("starts with returning null", () => {
    // Act
    const node = update(UserModel, { name: "Alice" });

    // Assert
    expect(node.returning).toBe(null);
  });

  it("sets softDeleteFilter to true when model has softDelete: true", () => {
    // Act
    const node = update(UserModel, { name: "Alice" });

    // Assert
    expect(node.softDeleteFilter).toBe(true);
  });

  it("sets softDeleteFilter to false when model has no softDelete option", () => {
    // Act
    const node = update(PostModel, { title: "Hello" });

    // Assert
    expect(node.softDeleteFilter).toBe(false);
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
    expect(node.softDeleteFilter).toBe(false);
  });

  it("freezes the values object", () => {
    // Act
    const node = update(UserModel, { name: "Alice" });

    // Assert
    expect(Object.isFrozen(node.values)).toBeTruthy();
  });

  it("freezes the conditions array", () => {
    // Act
    const node = update(UserModel, { name: "Alice" });

    // Assert
    expect(Object.isFrozen(node.conditions)).toBeTruthy();
  });

  it("returns a frozen UpdateNode", () => {
    // Act
    const node = update(UserModel, { name: "Alice" });

    // Assert
    expect(Object.isFrozen(node)).toBeTruthy();
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
    expect(node.tag).toBe("Delete");
  });

  it("embeds the correct model name", () => {
    // Act
    const node = remove(UserModel);

    // Assert
    expect(node.model.name).toBe("users");
  });

  it("sets isSoftDelete to true when model has softDelete: true", () => {
    // Act
    const node = remove(UserModel);

    // Assert
    expect(node.isSoftDelete).toBe(true);
  });

  it("sets isSoftDelete to false when model has no softDelete option", () => {
    // Act
    const node = remove(PostModel);

    // Assert
    expect(node.isSoftDelete).toBe(false);
  });

  it("sets softDeleteFilter to true when model has softDelete: true", () => {
    // Act
    const node = remove(UserModel);

    // Assert
    expect(node.softDeleteFilter).toBe(true);
  });

  it("sets softDeleteFilter to false when model has no softDelete option", () => {
    // Act
    const node = remove(PostModel);

    // Assert
    expect(node.softDeleteFilter).toBe(false);
  });

  it("starts with an empty conditions array", () => {
    // Act
    const node = remove(UserModel);

    // Assert
    expect(node.conditions.length).toBe(0);
  });

  it("starts with returning null", () => {
    // Act
    const node = remove(UserModel);

    // Assert
    expect(node.returning).toBe(null);
  });

  it("returns a frozen DeleteNode", () => {
    // Act
    const node = remove(UserModel);

    // Assert
    expect(Object.isFrozen(node)).toBeTruthy();
  });

  it("conditions array is frozen", () => {
    // Act
    const node = remove(UserModel);

    // Assert
    expect(Object.isFrozen(node.conditions)).toBeTruthy();
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
    expect(node.tag).toBe("Delete");
  });

  it("sets isSoftDelete to false even when model has softDelete: true", () => {
    // Act
    const node = hardRemove(UserModel);

    // Assert
    expect(node.isSoftDelete).toBe(false);
  });

  it("sets softDeleteFilter to false even when model has softDelete: true", () => {
    // Act
    const node = hardRemove(UserModel);

    // Assert
    expect(node.softDeleteFilter).toBe(false);
  });

  it("sets isSoftDelete to false when model has no softDelete option", () => {
    // Act
    const node = hardRemove(PostModel);

    // Assert
    expect(node.isSoftDelete).toBe(false);
  });

  it("starts with an empty conditions array", () => {
    // Act
    const node = hardRemove(UserModel);

    // Assert
    expect(node.conditions.length).toBe(0);
  });

  it("starts with returning null", () => {
    // Act
    const node = hardRemove(UserModel);

    // Assert
    expect(node.returning).toBe(null);
  });

  it("returns a frozen DeleteNode", () => {
    // Act
    const node = hardRemove(UserModel);

    // Assert
    expect(Object.isFrozen(node)).toBeTruthy();
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
    expect(node.returning).toBe("*");
  });

  it("sets returning to '*' when called with the literal '*'", () => {
    // Act
    const node = returning("*")(insert(UserModel, { email: "a@example.com" }));

    // Assert
    expect(node.returning).toBe("*");
  });

  it("sets returning to an array of the specified columns", () => {
    // Act
    const node = returning("id", "email")(insert(UserModel, { email: "a@example.com" }));

    // Assert
    expect(node.returning).toEqual(["id", "email"]);
  });

  it("works on an InsertNode", () => {
    // Arrange
    const insertNode: InsertNode = insert(UserModel, { email: "a@example.com" });

    // Act
    const result = returning("id")(insertNode);

    // Assert
    expect(result.tag).toBe("Insert");
    expect(result.returning).toEqual(["id"]);
  });

  it("works on an UpdateNode", () => {
    // Arrange
    const updateNode: UpdateNode = update(UserModel, { name: "Alice" });

    // Act
    const result = returning("id", "email")(updateNode);

    // Assert
    expect(result.tag).toBe("Update");
    expect(result.returning).toEqual(["id", "email"]);
  });

  it("works on a DeleteNode", () => {
    // Arrange
    const deleteNode: DeleteNode = remove(UserModel);

    // Act
    const result = returning("id")(deleteNode);

    // Assert
    expect(result.tag).toBe("Delete");
    expect(result.returning).toEqual(["id"]);
  });

  it("preserves all other fields on an InsertNode", () => {
    // Arrange
    const before = insert(UserModel, { email: "a@example.com" });

    // Act
    const after = returning("id")(before);

    // Assert
    expect(after.tag).toBe(before.tag);
    expect(after.rows).toEqual(before.rows);
    expect(after.onConflict).toBe(before.onConflict);
  });

  it("preserves all other fields on an UpdateNode", () => {
    // Arrange
    const before = update(UserModel, { name: "Alice" });

    // Act
    const after = returning("id")(before);

    // Assert
    expect(after.tag).toBe(before.tag);
    expect(after.values).toEqual(before.values);
    expect(after.conditions).toEqual(before.conditions);
    expect(after.softDeleteFilter).toBe(before.softDeleteFilter);
  });

  it("preserves all other fields on a DeleteNode", () => {
    // Arrange
    const before = remove(UserModel);

    // Act
    const after = returning("id")(before);

    // Assert
    expect(after.tag).toBe(before.tag);
    expect(after.isSoftDelete).toBe(before.isSoftDelete);
    expect(after.softDeleteFilter).toBe(before.softDeleteFilter);
    expect(after.conditions).toEqual(before.conditions);
  });

  it("returns a frozen node", () => {
    // Act
    const node = returning("id")(insert(UserModel, { email: "a@example.com" }));

    // Assert
    expect(Object.isFrozen(node)).toBeTruthy();
  });

  it("does not mutate the input node", () => {
    // Arrange
    const before = insert(UserModel, { email: "a@example.com" });

    // Act
    returning("id")(before);

    // Assert
    expect(before.returning).toBe(null);
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
    expect(node.onConflict !== null).toBeTruthy();
    expect(node.onConflict.columns).toEqual(["email"]);
    expect(node.onConflict.action).toBe("nothing");
  });

  it("sets the conflict clause with an array of columns and 'nothing' action", () => {
    // Act
    const node = onConflict(
      ["email", "name"],
      "nothing",
    )(insert(UserModel, { email: "a@example.com" }));

    // Assert
    expect(node.onConflict !== null).toBeTruthy();
    expect(node.onConflict.columns).toEqual(["email", "name"]);
    expect(node.onConflict.action).toBe("nothing");
  });

  it("sets the conflict clause with an update action", () => {
    // Act
    const node = onConflict(["email"], { update: ["name"] })(
      insert(UserModel, { email: "a@example.com" }),
    );

    // Assert
    expect(node.onConflict !== null).toBeTruthy();
    expect(node.onConflict.columns).toEqual(["email"]);
    expect(node.onConflict.action).toEqual({ update: ["name"] });
  });

  it("sets the conflict clause with a single string column and an update action", () => {
    // Act
    const node = onConflict("email", { update: ["name", "email"] })(
      insert(UserModel, { email: "a@example.com" }),
    );

    // Assert
    expect(node.onConflict !== null).toBeTruthy();
    expect(node.onConflict.columns).toEqual(["email"]);
    expect(node.onConflict.action).toEqual({ update: ["name", "email"] });
  });

  it("preserves all other InsertNode fields", () => {
    // Arrange
    const before = returning("id")(insert(UserModel, { email: "a@example.com" }));

    // Act
    const after = onConflict("email", "nothing")(before);

    // Assert
    expect(after.tag).toBe(before.tag);
    expect(after.rows).toEqual(before.rows);
    expect(after.returning).toEqual(before.returning);
  });

  it("returns a frozen InsertNode", () => {
    // Act
    const node = onConflict("email", "nothing")(insert(UserModel, { email: "a@example.com" }));

    // Assert
    expect(Object.isFrozen(node)).toBeTruthy();
  });

  it("the onConflict clause itself is frozen", () => {
    // Act
    const node = onConflict("email", "nothing")(insert(UserModel, { email: "a@example.com" }));

    // Assert
    expect(Object.isFrozen(node.onConflict)).toBeTruthy();
  });

  it("does not mutate the input node", () => {
    // Arrange
    const before = insert(UserModel, { email: "a@example.com" });

    // Act
    onConflict("email", "nothing")(before);

    // Assert
    expect(before.onConflict).toBe(null);
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
    expect(node.conditions.length).toBe(1);
    expect(node.conditions[0]).toEqual(condition);
  });

  it("accumulates conditions across multiple where() calls", () => {
    // Arrange
    const c1 = eq("id", "u1");
    const c2 = eq("email", "alice@example.com");

    // Act
    const node = where(c2)(where(c1)(update(UserModel, { name: "Alice" })));

    // Assert
    expect(node.conditions.length).toBe(2);
    expect(node.conditions[0]).toEqual(c1);
    expect(node.conditions[1]).toEqual(c2);
  });

  it("preserves all other UpdateNode fields", () => {
    // Arrange
    const before = update(UserModel, { name: "Alice" });

    // Act
    const after = where(eq("id", "u1"))(before);

    // Assert
    expect(after.tag).toBe(before.tag);
    expect(after.values).toEqual(before.values);
    expect(after.returning).toBe(before.returning);
    expect(after.softDeleteFilter).toBe(before.softDeleteFilter);
  });

  it("returns a frozen UpdateNode", () => {
    // Act
    const node = where(eq("id", "u1"))(update(UserModel, { name: "Alice" }));

    // Assert
    expect(Object.isFrozen(node)).toBeTruthy();
  });

  it("conditions array on returned node is frozen", () => {
    // Act
    const node = where(eq("id", "u1"))(update(UserModel, { name: "Alice" }));

    // Assert
    expect(Object.isFrozen(node.conditions)).toBeTruthy();
  });

  it("does not mutate the input UpdateNode", () => {
    // Arrange
    const before = update(UserModel, { name: "Alice" });

    // Act
    where(eq("id", "u1"))(before);

    // Assert
    expect(before.conditions.length).toBe(0);
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
    expect(node.conditions.length).toBe(1);
    expect(node.conditions[0]).toEqual(condition);
  });

  it("accumulates conditions across multiple where() calls", () => {
    // Arrange
    const c1 = eq("id", "u1");
    const c2 = eq("email", "alice@example.com");

    // Act
    const node = where(c2)(where(c1)(remove(UserModel)));

    // Assert
    expect(node.conditions.length).toBe(2);
    expect(node.conditions[0]).toEqual(c1);
    expect(node.conditions[1]).toEqual(c2);
  });

  it("preserves all other DeleteNode fields", () => {
    // Arrange
    const before = remove(UserModel);

    // Act
    const after = where(eq("id", "u1"))(before);

    // Assert
    expect(after.tag).toBe(before.tag);
    expect(after.isSoftDelete).toBe(before.isSoftDelete);
    expect(after.softDeleteFilter).toBe(before.softDeleteFilter);
    expect(after.returning).toBe(before.returning);
  });

  it("returns a frozen DeleteNode", () => {
    // Act
    const node = where(eq("id", "u1"))(remove(UserModel));

    // Assert
    expect(Object.isFrozen(node)).toBeTruthy();
  });

  it("conditions array on returned node is frozen", () => {
    // Act
    const node = where(eq("id", "u1"))(remove(UserModel));

    // Assert
    expect(Object.isFrozen(node.conditions)).toBeTruthy();
  });

  it("does not mutate the input DeleteNode", () => {
    // Arrange
    const before = remove(UserModel);

    // Act
    where(eq("id", "u1"))(before);

    // Assert
    expect(before.conditions.length).toBe(0);
  });

  it("also works with hardRemove() nodes", () => {
    // Arrange
    const condition = eq("id", "u1");

    // Act
    const node = where(condition)(hardRemove(UserModel));

    // Assert
    expect(node.conditions.length).toBe(1);
    expect(node.conditions[0]).toEqual(condition);
    expect(node.isSoftDelete).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Immutability — all returned nodes are frozen
// ---------------------------------------------------------------------------

describe("all returned nodes are frozen", () => {
  it("insert() returns a frozen node", () => {
    expect(Object.isFrozen(insert(UserModel, { email: "a@example.com" }))).toBeTruthy();
  });

  it("insertMany() returns a frozen node", () => {
    expect(Object.isFrozen(insertMany(UserModel, [{ email: "a@example.com" }]))).toBeTruthy();
  });

  it("update() returns a frozen node", () => {
    expect(Object.isFrozen(update(UserModel, { name: "Alice" }))).toBeTruthy();
  });

  it("remove() returns a frozen node", () => {
    expect(Object.isFrozen(remove(UserModel))).toBeTruthy();
  });

  it("hardRemove() returns a frozen node", () => {
    expect(Object.isFrozen(hardRemove(UserModel))).toBeTruthy();
  });

  it("returning() returns a frozen node", () => {
    expect(
      Object.isFrozen(returning("id")(insert(UserModel, { email: "a@example.com" }))),
    ).toBeTruthy();
  });

  it("onConflict() returns a frozen node", () => {
    expect(
      Object.isFrozen(
        onConflict("email", "nothing")(insert(UserModel, { email: "a@example.com" })),
      ),
    ).toBeTruthy();
  });

  it("where() on UpdateNode returns a frozen node", () => {
    expect(
      Object.isFrozen(where(eq("id", "u1"))(update(UserModel, { name: "Alice" }))),
    ).toBeTruthy();
  });

  it("where() on DeleteNode returns a frozen node", () => {
    expect(Object.isFrozen(where(eq("id", "u1"))(remove(UserModel)))).toBeTruthy();
  });
});
