import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { pipe, Schema } from "@igorjs/pure-ts";

import { Model } from "../src/model/define.ts";
import { Field } from "../src/model/field.ts";
import { from, limit, offset, orderBy, select, where } from "../src/query/builders.ts";
import { eq, gt } from "../src/query/conditions.ts";
import type { SelectNode } from "../src/query/types.ts";

// ---------------------------------------------------------------------------
// Shared test models
// ---------------------------------------------------------------------------

const TestUser = Model("users", {
  fields: {
    id: Field(Schema.string, { primaryKey: true, default: "uuid" }),
    email: Field(Schema.string, { unique: true }),
    name: Field(Schema.string),
  },
  options: { softDelete: true },
});

const TestPost = Model("posts", {
  fields: {
    id: Field(Schema.string, { primaryKey: true, default: "uuid" }),
    title: Field(Schema.string),
  },
  // No softDelete option — tests the false default path.
});

// ---------------------------------------------------------------------------
// from()
// ---------------------------------------------------------------------------

describe("from()", () => {
  it("produces a SelectNode with tag 'Select'", () => {
    // Act
    const node = from(TestUser);

    // Assert
    assert.equal(node.tag, "Select");
  });

  it("embeds model name in the node", () => {
    // Act
    const node = from(TestUser);

    // Assert
    assert.equal(node.model.name, "users");
  });

  it("embeds model columns in the node", () => {
    // Act
    const node = from(TestUser);

    // Assert
    assert.deepEqual(node.model.columns, TestUser.$columns);
  });

  it("embeds model options in the node", () => {
    // Act
    const node = from(TestUser);

    // Assert
    assert.deepEqual(node.model.options, TestUser.$options);
  });

  it("sets columns to '*' by default", () => {
    // Act
    const node = from(TestUser);

    // Assert
    assert.equal(node.columns, "*");
  });

  it("starts with an empty conditions array", () => {
    // Act
    const node = from(TestUser);

    // Assert
    assert.equal(node.conditions.length, 0);
  });

  it("starts with an empty orderBy array", () => {
    // Act
    const node = from(TestUser);

    // Assert
    assert.equal(node.orderBy.length, 0);
  });

  it("starts with limit undefined", () => {
    // Act
    const node = from(TestUser);

    // Assert
    assert.equal(node.limit, undefined);
  });

  it("starts with offset undefined", () => {
    // Act
    const node = from(TestUser);

    // Assert
    assert.equal(node.offset, undefined);
  });

  it("sets softDeleteFilter to true when model has softDelete: true", () => {
    // Act
    const node = from(TestUser);

    // Assert
    assert.equal(node.softDeleteFilter, true);
  });

  it("sets softDeleteFilter to false when model has no softDelete option", () => {
    // Act
    const node = from(TestPost);

    // Assert
    assert.equal(node.softDeleteFilter, false);
  });

  it("sets softDeleteFilter to false when model has softDelete: false", () => {
    // Arrange
    const Model2 = Model("things", {
      fields: { id: Field(Schema.string) },
      options: { softDelete: false },
    });

    // Act
    const node = from(Model2);

    // Assert
    assert.equal(node.softDeleteFilter, false);
  });

  it("returns a frozen SelectNode", () => {
    // Act
    const node = from(TestUser);

    // Assert
    assert.ok(Object.isFrozen(node));
  });

  it("conditions array on the returned node is frozen", () => {
    // Act
    const node = from(TestUser);

    // Assert
    assert.ok(Object.isFrozen(node.conditions));
  });

  it("orderBy array on the returned node is frozen", () => {
    // Act
    const node = from(TestUser);

    // Assert
    assert.ok(Object.isFrozen(node.orderBy));
  });

  it("model ref on the returned node is frozen", () => {
    // Act
    const node = from(TestUser);

    // Assert
    assert.ok(Object.isFrozen(node.model));
  });
});

// ---------------------------------------------------------------------------
// select()
// ---------------------------------------------------------------------------

describe("select()", () => {
  it("replaces the default '*' with the specified columns", () => {
    // Arrange
    const initial = from(TestUser);

    // Act
    const node = select("id", "email")(initial);

    // Assert
    assert.deepEqual(node.columns, ["id", "email"]);
  });

  it("replaces an earlier select() call (last write wins)", () => {
    // Arrange
    const after1 = select("id")(from(TestUser));

    // Act
    const after2 = select("email", "name")(after1);

    // Assert
    assert.deepEqual(after2.columns, ["email", "name"]);
  });

  it("preserves all other fields on the node", () => {
    // Arrange
    const initial = from(TestUser);

    // Act
    const node = select("id")(initial);

    // Assert
    assert.equal(node.tag, initial.tag);
    assert.deepEqual(node.conditions, initial.conditions);
    assert.deepEqual(node.orderBy, initial.orderBy);
    assert.equal(node.limit, initial.limit);
    assert.equal(node.offset, initial.offset);
    assert.equal(node.softDeleteFilter, initial.softDeleteFilter);
  });

  it("returns a frozen SelectNode", () => {
    // Act
    const node = select("id")(from(TestUser));

    // Assert
    assert.ok(Object.isFrozen(node));
  });

  it("does NOT mutate the input node", () => {
    // Arrange
    const initial = from(TestUser);
    const columnsBefore = initial.columns;

    // Act
    select("id", "email")(initial);

    // Assert
    assert.equal(initial.columns, columnsBefore);
  });
});

// ---------------------------------------------------------------------------
// where()
// ---------------------------------------------------------------------------

describe("where()", () => {
  it("appends a condition to the conditions array", () => {
    // Arrange
    const initial = from(TestUser);
    const condition = eq("email", "alice@example.com");

    // Act
    const node = where(condition)(initial);

    // Assert
    assert.equal(node.conditions.length, 1);
    assert.deepEqual(node.conditions[0], condition);
  });

  it("accumulates conditions across multiple where() calls (AND semantics)", () => {
    // Arrange
    const c1 = eq("email", "alice@example.com");
    const c2 = gt("age", 18);

    // Act
    const node = where(c2)(where(c1)(from(TestUser)));

    // Assert
    assert.equal(node.conditions.length, 2);
    assert.deepEqual(node.conditions[0], c1);
    assert.deepEqual(node.conditions[1], c2);
  });

  it("preserves all other fields on the node", () => {
    // Arrange
    const initial = from(TestUser);

    // Act
    const node = where(eq("id", "x"))(initial);

    // Assert
    assert.equal(node.tag, initial.tag);
    assert.equal(node.columns, initial.columns);
    assert.deepEqual(node.orderBy, initial.orderBy);
    assert.equal(node.limit, initial.limit);
    assert.equal(node.offset, initial.offset);
  });

  it("returns a frozen SelectNode", () => {
    // Act
    const node = where(eq("id", "x"))(from(TestUser));

    // Assert
    assert.ok(Object.isFrozen(node));
  });

  it("conditions array on returned node is frozen", () => {
    // Act
    const node = where(eq("id", "x"))(from(TestUser));

    // Assert
    assert.ok(Object.isFrozen(node.conditions));
  });

  it("does NOT mutate the input node", () => {
    // Arrange
    const initial = from(TestUser);
    const conditionsBefore = initial.conditions.length;

    // Act
    where(eq("id", "x"))(initial);

    // Assert
    assert.equal(initial.conditions.length, conditionsBefore);
  });
});

// ---------------------------------------------------------------------------
// orderBy()
// ---------------------------------------------------------------------------

describe("orderBy()", () => {
  it("appends an ORDER BY clause", () => {
    // Arrange
    const initial = from(TestUser);

    // Act
    const node = orderBy("name", "asc")(initial);

    // Assert
    assert.equal(node.orderBy.length, 1);
    assert.equal(node.orderBy[0]?.column, "name");
    assert.equal(node.orderBy[0]?.direction, "asc");
  });

  it("accumulates clauses across multiple orderBy() calls", () => {
    // Act
    const node = orderBy("email", "desc")(orderBy("name", "asc")(from(TestUser)));

    // Assert
    assert.equal(node.orderBy.length, 2);
    assert.equal(node.orderBy[0]?.column, "name");
    assert.equal(node.orderBy[0]?.direction, "asc");
    assert.equal(node.orderBy[1]?.column, "email");
    assert.equal(node.orderBy[1]?.direction, "desc");
  });

  it("preserves all other fields on the node", () => {
    // Arrange
    const initial = from(TestUser);

    // Act
    const node = orderBy("name", "asc")(initial);

    // Assert
    assert.equal(node.tag, initial.tag);
    assert.equal(node.columns, initial.columns);
    assert.deepEqual(node.conditions, initial.conditions);
    assert.equal(node.limit, initial.limit);
    assert.equal(node.offset, initial.offset);
  });

  it("returns a frozen SelectNode", () => {
    // Act
    const node = orderBy("name", "asc")(from(TestUser));

    // Assert
    assert.ok(Object.isFrozen(node));
  });

  it("orderBy array on returned node is frozen", () => {
    // Act
    const node = orderBy("name", "asc")(from(TestUser));

    // Assert
    assert.ok(Object.isFrozen(node.orderBy));
  });

  it("does NOT mutate the input node", () => {
    // Arrange
    const initial = from(TestUser);
    const lengthBefore = initial.orderBy.length;

    // Act
    orderBy("name", "asc")(initial);

    // Assert
    assert.equal(initial.orderBy.length, lengthBefore);
  });
});

// ---------------------------------------------------------------------------
// limit()
// ---------------------------------------------------------------------------

describe("limit()", () => {
  it("sets the limit field", () => {
    // Act
    const node = limit(10)(from(TestUser));

    // Assert
    assert.equal(node.limit, 10);
  });

  it("overwrites a previously set limit (last call wins)", () => {
    // Act
    const node = limit(5)(limit(100)(from(TestUser)));

    // Assert
    assert.equal(node.limit, 5);
  });

  it("preserves all other fields on the node", () => {
    // Arrange
    const initial = from(TestUser);

    // Act
    const node = limit(10)(initial);

    // Assert
    assert.equal(node.tag, initial.tag);
    assert.equal(node.columns, initial.columns);
    assert.deepEqual(node.conditions, initial.conditions);
    assert.deepEqual(node.orderBy, initial.orderBy);
    assert.equal(node.offset, initial.offset);
  });

  it("returns a frozen SelectNode", () => {
    // Act
    const node = limit(10)(from(TestUser));

    // Assert
    assert.ok(Object.isFrozen(node));
  });

  it("does NOT mutate the input node", () => {
    // Arrange
    const initial = from(TestUser);

    // Act
    limit(10)(initial);

    // Assert
    assert.equal(initial.limit, undefined);
  });
});

// ---------------------------------------------------------------------------
// offset()
// ---------------------------------------------------------------------------

describe("offset()", () => {
  it("sets the offset field", () => {
    // Act
    const node = offset(20)(from(TestUser));

    // Assert
    assert.equal(node.offset, 20);
  });

  it("overwrites a previously set offset (last call wins)", () => {
    // Act
    const node = offset(40)(offset(0)(from(TestUser)));

    // Assert
    assert.equal(node.offset, 40);
  });

  it("preserves all other fields on the node", () => {
    // Arrange
    const initial = from(TestUser);

    // Act
    const node = offset(20)(initial);

    // Assert
    assert.equal(node.tag, initial.tag);
    assert.equal(node.columns, initial.columns);
    assert.deepEqual(node.conditions, initial.conditions);
    assert.deepEqual(node.orderBy, initial.orderBy);
    assert.equal(node.limit, initial.limit);
  });

  it("returns a frozen SelectNode", () => {
    // Act
    const node = offset(20)(from(TestUser));

    // Assert
    assert.ok(Object.isFrozen(node));
  });

  it("does NOT mutate the input node", () => {
    // Arrange
    const initial = from(TestUser);

    // Act
    offset(20)(initial);

    // Assert
    assert.equal(initial.offset, undefined);
  });
});

// ---------------------------------------------------------------------------
// pipe() composition
// ---------------------------------------------------------------------------

describe("pipe() composition", () => {
  it("composes from(), where(), orderBy(), and limit() correctly", () => {
    // Act
    const node: SelectNode = pipe(
      from(TestUser),
      where(eq("email", "alice@example.com")),
      orderBy("name", "asc"),
      limit(10),
    );

    // Assert
    assert.equal(node.tag, "Select");
    assert.equal(node.model.name, "users");
    assert.equal(node.conditions.length, 1);
    assert.equal(node.conditions[0]?.tag, "Eq");
    assert.equal(node.orderBy.length, 1);
    assert.equal(node.orderBy[0]?.column, "name");
    assert.equal(node.orderBy[0]?.direction, "asc");
    assert.equal(node.limit, 10);
  });

  it("accumulates multiple where() conditions through pipe()", () => {
    // Act
    const node = pipe(
      from(TestUser),
      where(eq("email", "alice@example.com")),
      where(gt("age", 18)),
    );

    // Assert
    assert.equal(node.conditions.length, 2);
    assert.equal(node.conditions[0]?.tag, "Eq");
    assert.equal(node.conditions[1]?.tag, "Gt");
  });

  it("accumulates multiple orderBy() clauses through pipe()", () => {
    // Act
    const node = pipe(
      from(TestUser),
      orderBy("name", "asc"),
      orderBy("email", "desc"),
    );

    // Assert
    assert.equal(node.orderBy.length, 2);
    assert.equal(node.orderBy[0]?.column, "name");
    assert.equal(node.orderBy[1]?.column, "email");
  });

  it("composes select(), where(), orderBy(), limit(), and offset() together", () => {
    // Act
    const node = pipe(
      from(TestUser),
      select("id", "email", "name"),
      where(eq("email", "bob@example.com")),
      orderBy("name", "desc"),
      limit(5),
      offset(10),
    );

    // Assert
    assert.deepEqual(node.columns, ["id", "email", "name"]);
    assert.equal(node.conditions.length, 1);
    assert.equal(node.orderBy.length, 1);
    assert.equal(node.limit, 5);
    assert.equal(node.offset, 10);
  });

  it("final composed node is frozen", () => {
    // Act
    const node = pipe(
      from(TestUser),
      where(eq("id", "x")),
      orderBy("name", "asc"),
      limit(10),
    );

    // Assert
    assert.ok(Object.isFrozen(node));
  });

  it("intermediate nodes are not mutated by subsequent pipeline steps", () => {
    // Arrange - capture an intermediate snapshot
    const initial = from(TestUser);
    const afterWhere = where(eq("id", "x"))(initial);

    // Act - further transforms
    pipe(afterWhere, orderBy("name", "asc"), limit(10));

    // Assert - intermediate node is unchanged
    assert.equal(afterWhere.orderBy.length, 0);
    assert.equal(afterWhere.limit, undefined);
  });
});
