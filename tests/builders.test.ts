import { pipe, Schema } from "@igorjs/pure-fx";
import { describe, expect, it } from "@igorjs/pure-test";

import { Model } from "../src/model/define.ts";
import { Field } from "../src/model/field.ts";
import { from, limit, offset, orderBy, select, where } from "../src/query/builders.ts";
import { and, eq, gt, not, or } from "../src/query/conditions.ts";
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
    expect(node.tag).toBe("Select");
  });

  it("embeds model name in the node", () => {
    // Act
    const node = from(TestUser);

    // Assert
    expect(node.model.name).toBe("users");
  });

  it("embeds model columns in the node", () => {
    // Act
    const node = from(TestUser);

    // Assert
    expect(node.model.columns).toEqual(TestUser.$columns);
  });

  it("embeds model options in the node", () => {
    // Act
    const node = from(TestUser);

    // Assert
    expect(node.model.options).toEqual(TestUser.$options);
  });

  it("sets columns to '*' by default", () => {
    // Act
    const node = from(TestUser);

    // Assert
    expect(node.columns).toBe("*");
  });

  it("starts with an empty conditions array", () => {
    // Act
    const node = from(TestUser);

    // Assert
    expect(node.conditions.length).toBe(0);
  });

  it("starts with an empty orderBy array", () => {
    // Act
    const node = from(TestUser);

    // Assert
    expect(node.orderBy.length).toBe(0);
  });

  it("starts with limit null", () => {
    // Act
    const node = from(TestUser);

    // Assert
    expect(node.limit).toBe(null);
  });

  it("starts with offset null", () => {
    // Act
    const node = from(TestUser);

    // Assert
    expect(node.offset).toBe(null);
  });

  it("sets softDeleteFilter to true when model has softDelete: true", () => {
    // Act
    const node = from(TestUser);

    // Assert
    expect(node.softDeleteFilter).toBe(true);
  });

  it("sets softDeleteFilter to false when model has no softDelete option", () => {
    // Act
    const node = from(TestPost);

    // Assert
    expect(node.softDeleteFilter).toBe(false);
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
    expect(node.softDeleteFilter).toBe(false);
  });

  it("returns a frozen SelectNode", () => {
    // Act
    const node = from(TestUser);

    // Assert
    expect(Object.isFrozen(node)).toBeTruthy();
  });

  it("conditions array on the returned node is frozen", () => {
    // Act
    const node = from(TestUser);

    // Assert
    expect(Object.isFrozen(node.conditions)).toBeTruthy();
  });

  it("orderBy array on the returned node is frozen", () => {
    // Act
    const node = from(TestUser);

    // Assert
    expect(Object.isFrozen(node.orderBy)).toBeTruthy();
  });

  it("model ref on the returned node is frozen", () => {
    // Act
    const node = from(TestUser);

    // Assert
    expect(Object.isFrozen(node.model)).toBeTruthy();
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
    expect(node.columns).toEqual(["id", "email"]);
  });

  it("replaces an earlier select() call (last write wins)", () => {
    // Arrange
    const after1 = select("id")(from(TestUser));

    // Act
    const after2 = select("email", "name")(after1);

    // Assert
    expect(after2.columns).toEqual(["email", "name"]);
  });

  it("preserves all other fields on the node", () => {
    // Arrange
    const initial = from(TestUser);

    // Act
    const node = select("id")(initial);

    // Assert
    expect(node.tag).toBe(initial.tag);
    expect(node.conditions).toEqual(initial.conditions);
    expect(node.orderBy).toEqual(initial.orderBy);
    expect(node.limit).toBe(initial.limit);
    expect(node.offset).toBe(initial.offset);
    expect(node.softDeleteFilter).toBe(initial.softDeleteFilter);
  });

  it("returns a frozen SelectNode", () => {
    // Act
    const node = select("id")(from(TestUser));

    // Assert
    expect(Object.isFrozen(node)).toBeTruthy();
  });

  it("does NOT mutate the input node", () => {
    // Arrange
    const initial = from(TestUser);
    const columnsBefore = initial.columns;

    // Act
    select("id", "email")(initial);

    // Assert
    expect(initial.columns).toBe(columnsBefore);
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
    expect(node.conditions.length).toBe(1);
    expect(node.conditions[0]).toEqual(condition);
  });

  it("accumulates conditions across multiple where() calls (AND semantics)", () => {
    // Arrange
    const c1 = eq("email", "alice@example.com");
    const c2 = gt("age", 18);

    // Act
    const node = where(c2)(where(c1)(from(TestUser)));

    // Assert
    expect(node.conditions.length).toBe(2);
    expect(node.conditions[0]).toEqual(c1);
    expect(node.conditions[1]).toEqual(c2);
  });

  it("preserves all other fields on the node", () => {
    // Arrange
    const initial = from(TestUser);

    // Act
    const node = where(eq("id", "x"))(initial);

    // Assert
    expect(node.tag).toBe(initial.tag);
    expect(node.columns).toBe(initial.columns);
    expect(node.orderBy).toEqual(initial.orderBy);
    expect(node.limit).toBe(initial.limit);
    expect(node.offset).toBe(initial.offset);
  });

  it("returns a frozen SelectNode", () => {
    // Act
    const node = where(eq("id", "x"))(from(TestUser));

    // Assert
    expect(Object.isFrozen(node)).toBeTruthy();
  });

  it("conditions array on returned node is frozen", () => {
    // Act
    const node = where(eq("id", "x"))(from(TestUser));

    // Assert
    expect(Object.isFrozen(node.conditions)).toBeTruthy();
  });

  it("does NOT mutate the input node", () => {
    // Arrange
    const initial = from(TestUser);
    const conditionsBefore = initial.conditions.length;

    // Act
    where(eq("id", "x"))(initial);

    // Assert
    expect(initial.conditions.length).toBe(conditionsBefore);
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
    expect(node.orderBy.length).toBe(1);
    expect(node.orderBy[0]?.column).toBe("name");
    expect(node.orderBy[0]?.direction).toBe("asc");
  });

  it("accumulates clauses across multiple orderBy() calls", () => {
    // Act
    const node = orderBy("email", "desc")(orderBy("name", "asc")(from(TestUser)));

    // Assert
    expect(node.orderBy.length).toBe(2);
    expect(node.orderBy[0]?.column).toBe("name");
    expect(node.orderBy[0]?.direction).toBe("asc");
    expect(node.orderBy[1]?.column).toBe("email");
    expect(node.orderBy[1]?.direction).toBe("desc");
  });

  it("preserves all other fields on the node", () => {
    // Arrange
    const initial = from(TestUser);

    // Act
    const node = orderBy("name", "asc")(initial);

    // Assert
    expect(node.tag).toBe(initial.tag);
    expect(node.columns).toBe(initial.columns);
    expect(node.conditions).toEqual(initial.conditions);
    expect(node.limit).toBe(initial.limit);
    expect(node.offset).toBe(initial.offset);
  });

  it("returns a frozen SelectNode", () => {
    // Act
    const node = orderBy("name", "asc")(from(TestUser));

    // Assert
    expect(Object.isFrozen(node)).toBeTruthy();
  });

  it("orderBy array on returned node is frozen", () => {
    // Act
    const node = orderBy("name", "asc")(from(TestUser));

    // Assert
    expect(Object.isFrozen(node.orderBy)).toBeTruthy();
  });

  it("does NOT mutate the input node", () => {
    // Arrange
    const initial = from(TestUser);
    const lengthBefore = initial.orderBy.length;

    // Act
    orderBy("name", "asc")(initial);

    // Assert
    expect(initial.orderBy.length).toBe(lengthBefore);
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
    expect(node.limit).toBe(10);
  });

  it("overwrites a previously set limit (last call wins)", () => {
    // Act
    const node = limit(5)(limit(100)(from(TestUser)));

    // Assert
    expect(node.limit).toBe(5);
  });

  it("preserves all other fields on the node", () => {
    // Arrange
    const initial = from(TestUser);

    // Act
    const node = limit(10)(initial);

    // Assert
    expect(node.tag).toBe(initial.tag);
    expect(node.columns).toBe(initial.columns);
    expect(node.conditions).toEqual(initial.conditions);
    expect(node.orderBy).toEqual(initial.orderBy);
    expect(node.offset).toBe(initial.offset);
  });

  it("returns a frozen SelectNode", () => {
    // Act
    const node = limit(10)(from(TestUser));

    // Assert
    expect(Object.isFrozen(node)).toBeTruthy();
  });

  it("does NOT mutate the input node", () => {
    // Arrange
    const initial = from(TestUser);

    // Act
    limit(10)(initial);

    // Assert
    expect(initial.limit).toBe(null);
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
    expect(node.offset).toBe(20);
  });

  it("overwrites a previously set offset (last call wins)", () => {
    // Act
    const node = offset(40)(offset(0)(from(TestUser)));

    // Assert
    expect(node.offset).toBe(40);
  });

  it("preserves all other fields on the node", () => {
    // Arrange
    const initial = from(TestUser);

    // Act
    const node = offset(20)(initial);

    // Assert
    expect(node.tag).toBe(initial.tag);
    expect(node.columns).toBe(initial.columns);
    expect(node.conditions).toEqual(initial.conditions);
    expect(node.orderBy).toEqual(initial.orderBy);
    expect(node.limit).toBe(initial.limit);
  });

  it("returns a frozen SelectNode", () => {
    // Act
    const node = offset(20)(from(TestUser));

    // Assert
    expect(Object.isFrozen(node)).toBeTruthy();
  });

  it("does NOT mutate the input node", () => {
    // Arrange
    const initial = from(TestUser);

    // Act
    offset(20)(initial);

    // Assert
    expect(initial.offset).toBe(null);
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
    expect(node.tag).toBe("Select");
    expect(node.model.name).toBe("users");
    expect(node.conditions.length).toBe(1);
    expect(node.conditions[0]?.tag).toBe("Eq");
    expect(node.orderBy.length).toBe(1);
    expect(node.orderBy[0]?.column).toBe("name");
    expect(node.orderBy[0]?.direction).toBe("asc");
    expect(node.limit).toBe(10);
  });

  it("accumulates multiple where() conditions through pipe()", () => {
    // Act
    const node = pipe(
      from(TestUser),
      where(eq("email", "alice@example.com")),
      where(gt("age", 18)),
    );

    // Assert
    expect(node.conditions.length).toBe(2);
    expect(node.conditions[0]?.tag).toBe("Eq");
    expect(node.conditions[1]?.tag).toBe("Gt");
  });

  it("accumulates multiple orderBy() clauses through pipe()", () => {
    // Act
    const node = pipe(from(TestUser), orderBy("name", "asc"), orderBy("email", "desc"));

    // Assert
    expect(node.orderBy.length).toBe(2);
    expect(node.orderBy[0]?.column).toBe("name");
    expect(node.orderBy[1]?.column).toBe("email");
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
    expect(node.columns).toEqual(["id", "email", "name"]);
    expect(node.conditions.length).toBe(1);
    expect(node.orderBy.length).toBe(1);
    expect(node.limit).toBe(5);
    expect(node.offset).toBe(10);
  });

  it("final composed node is frozen", () => {
    // Act
    const node = pipe(from(TestUser), where(eq("id", "x")), orderBy("name", "asc"), limit(10));

    // Assert
    expect(Object.isFrozen(node)).toBeTruthy();
  });

  it("intermediate nodes are not mutated by subsequent pipeline steps", () => {
    // Arrange - capture an intermediate snapshot
    const initial = from(TestUser);
    const afterWhere = where(eq("id", "x"))(initial);

    // Act - further transforms
    pipe(afterWhere, orderBy("name", "asc"), limit(10));

    // Assert - intermediate node is unchanged
    expect(afterWhere.orderBy.length).toBe(0);
    expect(afterWhere.limit).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// from() — timestamps option
// ---------------------------------------------------------------------------

describe("from() — timestamps option", () => {
  it("includes createdAt and updatedAt columns in the model ref when timestamps: true", () => {
    // Arrange
    const TimestampedModel = Model("events", {
      fields: {
        id: Field(Schema.string, { primaryKey: true }),
        title: Field(Schema.string),
      },
      options: { timestamps: true },
    });

    // Act
    const node = from(TimestampedModel);

    // Assert — the two timestamp columns are appended
    const columnNames = node.model.columns.map(c => c.name);
    expect(columnNames.includes("createdAt")).toBeTruthy();
    expect(columnNames.includes("updatedAt")).toBeTruthy();
  });

  it("does NOT include timestamp columns when timestamps option is omitted", () => {
    // Arrange — TestPost has no timestamps option
    // Act
    const node = from(TestPost);

    // Assert
    const columnNames = node.model.columns.map(c => c.name);
    expect(!columnNames.includes("createdAt")).toBeTruthy();
    expect(!columnNames.includes("updatedAt")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// select() — single column
// ---------------------------------------------------------------------------

describe("select() — single column", () => {
  it("sets columns to an array with one entry when called with a single column", () => {
    // Arrange
    const initial = from(TestUser);

    // Act
    const node = select("id")(initial);

    // Assert
    expect(node.columns).toEqual(["id"]);
  });
});

// ---------------------------------------------------------------------------
// where() — complex nested conditions
// ---------------------------------------------------------------------------

describe("where() — complex nested conditions", () => {
  it("accepts and(or(...), not(...)) as a single condition", () => {
    // Arrange
    const initial = from(TestUser);
    const condition = and(
      or(eq("email", "alice@example.com"), eq("email", "bob@example.com")),
      not(eq("id", "banned-id")),
    );

    // Act
    const node = where(condition)(initial);

    // Assert — one top-level condition composed of nested operators
    expect(node.conditions.length).toBe(1);
    expect(node.conditions[0]?.tag).toBe("And");
  });

  it("accumulates complex conditions alongside simple ones", () => {
    // Arrange
    const simple = eq("id", "x");
    const complex = and(
      or(eq("email", "a@b.com"), eq("email", "c@d.com")),
      not(eq("name", "banned")),
    );

    // Act
    const node = where(complex)(where(simple)(from(TestUser)));

    // Assert
    expect(node.conditions.length).toBe(2);
    expect(node.conditions[0]?.tag).toBe("Eq");
    expect(node.conditions[1]?.tag).toBe("And");
  });
});

// ---------------------------------------------------------------------------
// limit() — overwrites previous value
// ---------------------------------------------------------------------------

describe("limit() — overwrites previous value", () => {
  it("the last limit() call wins over earlier ones", () => {
    // Arrange / Act
    const node = limit(1)(limit(999)(from(TestUser)));

    // Assert
    expect(node.limit).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// offset() — overwrites previous value
// ---------------------------------------------------------------------------

describe("offset() — overwrites previous value", () => {
  it("the last offset() call wins over earlier ones", () => {
    // Arrange / Act
    const node = offset(50)(offset(0)(from(TestUser)));

    // Assert
    expect(node.offset).toBe(50);
  });
});
