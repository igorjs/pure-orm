import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  and,
  between,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  like,
  lt,
  lte,
  ne,
  not,
  or,
} from "../src/query/conditions.ts";
import type { ConditionNode } from "../src/query/types.ts";

describe("condition functions", () => {
  describe("eq", () => {
    it("produces an Eq node with the correct tag, column, and value", () => {
      // Arrange
      const column = "id";
      const value = 42;

      // Act
      const node = eq(column, value);

      // Assert
      assert.equal(node.tag, "Eq");
      assert.equal(node.tag === "Eq" && node.column, column);
      assert.equal(node.tag === "Eq" && node.value, value);
    });

    it("is frozen", () => {
      // Act
      const node = eq("name", "alice");

      // Assert
      assert.ok(Object.isFrozen(node));
    });
  });

  describe("ne", () => {
    it("produces a Ne node with the correct tag, column, and value", () => {
      // Arrange
      const column = "status";
      const value = "inactive";

      // Act
      const node = ne(column, value);

      // Assert
      assert.equal(node.tag, "Ne");
      assert.equal(node.tag === "Ne" && node.column, column);
      assert.equal(node.tag === "Ne" && node.value, value);
    });

    it("is frozen", () => {
      // Act
      const node = ne("status", "inactive");

      // Assert
      assert.ok(Object.isFrozen(node));
    });
  });

  describe("gt", () => {
    it("produces a Gt node with the correct tag, column, and value", () => {
      // Arrange
      const column = "age";
      const value = 18;

      // Act
      const node = gt(column, value);

      // Assert
      assert.equal(node.tag, "Gt");
      assert.equal(node.tag === "Gt" && node.column, column);
      assert.equal(node.tag === "Gt" && node.value, value);
    });

    it("is frozen", () => {
      // Act
      const node = gt("age", 18);

      // Assert
      assert.ok(Object.isFrozen(node));
    });
  });

  describe("gte", () => {
    it("produces a Gte node with the correct tag, column, and value", () => {
      // Arrange
      const column = "score";
      const value = 100;

      // Act
      const node = gte(column, value);

      // Assert
      assert.equal(node.tag, "Gte");
      assert.equal(node.tag === "Gte" && node.column, column);
      assert.equal(node.tag === "Gte" && node.value, value);
    });

    it("is frozen", () => {
      // Act
      const node = gte("score", 100);

      // Assert
      assert.ok(Object.isFrozen(node));
    });
  });

  describe("lt", () => {
    it("produces a Lt node with the correct tag, column, and value", () => {
      // Arrange
      const column = "price";
      const value = 50.0;

      // Act
      const node = lt(column, value);

      // Assert
      assert.equal(node.tag, "Lt");
      assert.equal(node.tag === "Lt" && node.column, column);
      assert.equal(node.tag === "Lt" && node.value, value);
    });

    it("is frozen", () => {
      // Act
      const node = lt("price", 50.0);

      // Assert
      assert.ok(Object.isFrozen(node));
    });
  });

  describe("lte", () => {
    it("produces a Lte node with the correct tag, column, and value", () => {
      // Arrange
      const column = "quantity";
      const value = 10;

      // Act
      const node = lte(column, value);

      // Assert
      assert.equal(node.tag, "Lte");
      assert.equal(node.tag === "Lte" && node.column, column);
      assert.equal(node.tag === "Lte" && node.value, value);
    });

    it("is frozen", () => {
      // Act
      const node = lte("quantity", 10);

      // Assert
      assert.ok(Object.isFrozen(node));
    });
  });

  describe("like", () => {
    it("produces a Like node with the correct tag, column, and pattern", () => {
      // Arrange
      const column = "email";
      const pattern = "%@example.com";

      // Act
      const node = like(column, pattern);

      // Assert
      assert.equal(node.tag, "Like");
      assert.equal(node.tag === "Like" && node.column, column);
      assert.equal(node.tag === "Like" && node.pattern, pattern);
    });

    it("is frozen", () => {
      // Act
      const node = like("email", "%@example.com");

      // Assert
      assert.ok(Object.isFrozen(node));
    });
  });

  describe("ilike", () => {
    it("produces an ILike node with the correct tag, column, and pattern", () => {
      // Arrange
      const column = "name";
      const pattern = "%alice%";

      // Act
      const node = ilike(column, pattern);

      // Assert
      assert.equal(node.tag, "ILike");
      assert.equal(node.tag === "ILike" && node.column, column);
      assert.equal(node.tag === "ILike" && node.pattern, pattern);
    });

    it("is frozen", () => {
      // Act
      const node = ilike("name", "%alice%");

      // Assert
      assert.ok(Object.isFrozen(node));
    });
  });

  describe("isNull", () => {
    it("produces an IsNull node with the correct tag and column", () => {
      // Arrange
      const column = "deleted_at";

      // Act
      const node = isNull(column);

      // Assert
      assert.equal(node.tag, "IsNull");
      assert.equal(node.tag === "IsNull" && node.column, column);
    });

    it("is frozen", () => {
      // Act
      const node = isNull("deleted_at");

      // Assert
      assert.ok(Object.isFrozen(node));
    });
  });

  describe("isNotNull", () => {
    it("produces an IsNotNull node with the correct tag and column", () => {
      // Arrange
      const column = "verified_at";

      // Act
      const node = isNotNull(column);

      // Assert
      assert.equal(node.tag, "IsNotNull");
      assert.equal(node.tag === "IsNotNull" && node.column, column);
    });

    it("is frozen", () => {
      // Act
      const node = isNotNull("verified_at");

      // Assert
      assert.ok(Object.isFrozen(node));
    });
  });

  describe("inArray", () => {
    it("produces an InArray node with the correct tag, column, and values", () => {
      // Arrange
      const column = "role";
      const values = ["admin", "editor"] as const;

      // Act
      const node = inArray(column, values);

      // Assert
      assert.equal(node.tag, "InArray");
      assert.equal(node.tag === "InArray" && node.column, column);
      assert.deepEqual(node.tag === "InArray" && node.values, ["admin", "editor"]);
    });

    it("the node itself is frozen", () => {
      // Act
      const node = inArray("role", ["admin"]);

      // Assert
      assert.ok(Object.isFrozen(node));
    });

    it("the values array on the node is frozen", () => {
      // Arrange
      const source = ["a", "b", "c"];

      // Act
      const node = inArray("col", source);

      // Assert
      assert.ok(node.tag === "InArray" && Object.isFrozen(node.values));
    });

    it("freezes a copy so mutating the source array does not affect the node", () => {
      // Arrange
      const source = ["x", "y"];

      // Act
      const node = inArray("col", source);
      source.push("z");

      // Assert
      assert.equal(node.tag === "InArray" && node.values.length, 2);
    });
  });

  describe("between", () => {
    it("produces a Between node with the correct tag, column, low, and high", () => {
      // Arrange
      const column = "created_at";
      const low = "2024-01-01";
      const high = "2024-12-31";

      // Act
      const node = between(column, low, high);

      // Assert
      assert.equal(node.tag, "Between");
      assert.equal(node.tag === "Between" && node.column, column);
      assert.equal(node.tag === "Between" && node.low, low);
      assert.equal(node.tag === "Between" && node.high, high);
    });

    it("is frozen", () => {
      // Act
      const node = between("age", 18, 65);

      // Assert
      assert.ok(Object.isFrozen(node));
    });
  });

  describe("not", () => {
    it("wraps a condition in a Not node", () => {
      // Arrange
      const inner = eq("active", true);

      // Act
      const node = not(inner);

      // Assert
      assert.equal(node.tag, "Not");
      assert.deepEqual(node.tag === "Not" && node.condition, inner);
    });

    it("is frozen", () => {
      // Act
      const node = not(eq("active", false));

      // Assert
      assert.ok(Object.isFrozen(node));
    });
  });

  describe("and", () => {
    it("accepts variadic condition arguments and groups them under an And node", () => {
      // Arrange
      const c1 = eq("active", true);
      const c2 = gt("age", 18);
      const c3 = isNull("deleted_at");

      // Act
      const node = and(c1, c2, c3);

      // Assert
      assert.equal(node.tag, "And");
      assert.equal(node.tag === "And" && node.conditions.length, 3);
      assert.deepEqual(node.tag === "And" && node.conditions[0], c1);
      assert.deepEqual(node.tag === "And" && node.conditions[1], c2);
      assert.deepEqual(node.tag === "And" && node.conditions[2], c3);
    });

    it("accepts two conditions", () => {
      // Arrange
      const c1 = eq("a", 1);
      const c2 = eq("b", 2);

      // Act
      const node = and(c1, c2);

      // Assert
      assert.equal(node.tag, "And");
      assert.equal(node.tag === "And" && node.conditions.length, 2);
    });

    it("is frozen", () => {
      // Act
      const node = and(eq("x", 1), eq("y", 2));

      // Assert
      assert.ok(Object.isFrozen(node));
    });
  });

  describe("or", () => {
    it("accepts variadic condition arguments and groups them under an Or node", () => {
      // Arrange
      const c1 = eq("status", "active");
      const c2 = eq("status", "pending");

      // Act
      const node = or(c1, c2);

      // Assert
      assert.equal(node.tag, "Or");
      assert.equal(node.tag === "Or" && node.conditions.length, 2);
      assert.deepEqual(node.tag === "Or" && node.conditions[0], c1);
      assert.deepEqual(node.tag === "Or" && node.conditions[1], c2);
    });

    it("accepts three or more conditions", () => {
      // Arrange
      const c1 = eq("role", "admin");
      const c2 = eq("role", "editor");
      const c3 = eq("role", "viewer");

      // Act
      const node = or(c1, c2, c3);

      // Assert
      assert.equal(node.tag, "Or");
      assert.equal(node.tag === "Or" && node.conditions.length, 3);
    });

    it("is frozen", () => {
      // Act
      const node = or(eq("a", 1), eq("b", 2));

      // Assert
      assert.ok(Object.isFrozen(node));
    });
  });

  describe("composition", () => {
    it("supports nesting and/or/not together", () => {
      // Arrange - build: (active = true AND age > 18) OR (role = 'admin')
      const activeAndAdult = and(eq("active", true), gt("age", 18));
      const isAdmin = eq("role", "admin");

      // Act
      const node = or(activeAndAdult, isAdmin);

      // Assert
      assert.equal(node.tag, "Or");
      assert.equal(node.tag === "Or" && node.conditions.length, 2);
      assert.equal(node.tag === "Or" && node.conditions[0].tag, "And");
      assert.equal(node.tag === "Or" && node.conditions[1].tag, "Eq");
    });

    it("supports not wrapping a compound condition", () => {
      // Arrange
      const inner = or(eq("status", "banned"), isNull("verified_at"));

      // Act
      const node = not(inner);

      // Assert
      assert.equal(node.tag, "Not");
      assert.equal(node.tag === "Not" && node.condition.tag, "Or");
    });
  });

  describe("type discrimination", () => {
    it("all condition nodes are ConditionNode-compatible and support exhaustive switching", () => {
      // Arrange
      const nodes: ConditionNode[] = [
        eq("a", 1),
        ne("a", 1),
        gt("a", 1),
        gte("a", 1),
        lt("a", 1),
        lte("a", 1),
        like("a", "%b%"),
        ilike("a", "%b%"),
        isNull("a"),
        isNotNull("a"),
        inArray("a", [1, 2]),
        between("a", 1, 10),
        not(eq("a", 1)),
        and(eq("a", 1)),
        or(eq("a", 1)),
      ];

      // Act / Assert — each tag is reachable without a default case
      for (const node of nodes) {
        let reached = false;
        switch (node.tag) {
          case "Eq":
          case "Ne":
          case "Gt":
          case "Gte":
          case "Lt":
          case "Lte":
          case "Like":
          case "ILike":
          case "IsNull":
          case "IsNotNull":
          case "InArray":
          case "Between":
          case "Not":
          case "And":
          case "Or":
            reached = true;
        }
        assert.ok(reached, `tag ${node.tag} was not handled`);
      }
    });
  });
});
