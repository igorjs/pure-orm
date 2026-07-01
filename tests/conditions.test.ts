// Copyright 2026 igorjs. SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "@igorjs/pure-test";
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
      expect(node.tag).toBe("Eq");
      expect(node.tag === "Eq" && node.column).toBe(column);
      expect(node.tag === "Eq" && node.value).toBe(value);
    });

    it("is frozen", () => {
      // Act
      const node = eq("name", "alice");

      // Assert
      expect(Object.isFrozen(node)).toBeTruthy();
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
      expect(node.tag).toBe("Ne");
      expect(node.tag === "Ne" && node.column).toBe(column);
      expect(node.tag === "Ne" && node.value).toBe(value);
    });

    it("is frozen", () => {
      // Act
      const node = ne("status", "inactive");

      // Assert
      expect(Object.isFrozen(node)).toBeTruthy();
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
      expect(node.tag).toBe("Gt");
      expect(node.tag === "Gt" && node.column).toBe(column);
      expect(node.tag === "Gt" && node.value).toBe(value);
    });

    it("is frozen", () => {
      // Act
      const node = gt("age", 18);

      // Assert
      expect(Object.isFrozen(node)).toBeTruthy();
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
      expect(node.tag).toBe("Gte");
      expect(node.tag === "Gte" && node.column).toBe(column);
      expect(node.tag === "Gte" && node.value).toBe(value);
    });

    it("is frozen", () => {
      // Act
      const node = gte("score", 100);

      // Assert
      expect(Object.isFrozen(node)).toBeTruthy();
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
      expect(node.tag).toBe("Lt");
      expect(node.tag === "Lt" && node.column).toBe(column);
      expect(node.tag === "Lt" && node.value).toBe(value);
    });

    it("is frozen", () => {
      // Act
      const node = lt("price", 50.0);

      // Assert
      expect(Object.isFrozen(node)).toBeTruthy();
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
      expect(node.tag).toBe("Lte");
      expect(node.tag === "Lte" && node.column).toBe(column);
      expect(node.tag === "Lte" && node.value).toBe(value);
    });

    it("is frozen", () => {
      // Act
      const node = lte("quantity", 10);

      // Assert
      expect(Object.isFrozen(node)).toBeTruthy();
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
      expect(node.tag).toBe("Like");
      expect(node.tag === "Like" && node.column).toBe(column);
      expect(node.tag === "Like" && node.pattern).toBe(pattern);
    });

    it("is frozen", () => {
      // Act
      const node = like("email", "%@example.com");

      // Assert
      expect(Object.isFrozen(node)).toBeTruthy();
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
      expect(node.tag).toBe("ILike");
      expect(node.tag === "ILike" && node.column).toBe(column);
      expect(node.tag === "ILike" && node.pattern).toBe(pattern);
    });

    it("is frozen", () => {
      // Act
      const node = ilike("name", "%alice%");

      // Assert
      expect(Object.isFrozen(node)).toBeTruthy();
    });
  });

  describe("isNull", () => {
    it("produces an IsNull node with the correct tag and column", () => {
      // Arrange
      const column = "deleted_at";

      // Act
      const node = isNull(column);

      // Assert
      expect(node.tag).toBe("IsNull");
      expect(node.tag === "IsNull" && node.column).toBe(column);
    });

    it("is frozen", () => {
      // Act
      const node = isNull("deleted_at");

      // Assert
      expect(Object.isFrozen(node)).toBeTruthy();
    });
  });

  describe("isNotNull", () => {
    it("produces an IsNotNull node with the correct tag and column", () => {
      // Arrange
      const column = "verified_at";

      // Act
      const node = isNotNull(column);

      // Assert
      expect(node.tag).toBe("IsNotNull");
      expect(node.tag === "IsNotNull" && node.column).toBe(column);
    });

    it("is frozen", () => {
      // Act
      const node = isNotNull("verified_at");

      // Assert
      expect(Object.isFrozen(node)).toBeTruthy();
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
      expect(node.tag).toBe("InArray");
      expect(node.tag === "InArray" && node.column).toBe(column);
      expect(node.tag === "InArray" && node.values).toEqual(["admin", "editor"]);
    });

    it("the node itself is frozen", () => {
      // Act
      const node = inArray("role", ["admin"]);

      // Assert
      expect(Object.isFrozen(node)).toBeTruthy();
    });

    it("the values array on the node is frozen", () => {
      // Arrange
      const source = ["a", "b", "c"];

      // Act
      const node = inArray("col", source);

      // Assert
      expect(node.tag === "InArray" && Object.isFrozen(node.values)).toBeTruthy();
    });

    it("freezes a copy so mutating the source array does not affect the node", () => {
      // Arrange
      const source = ["x", "y"];

      // Act
      const node = inArray("col", source);
      source.push("z");

      // Assert
      expect(node.tag).toBe("InArray");
      expect(node.tag === "InArray" ? node.values.length : -1).toBe(2);
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
      expect(node.tag).toBe("Between");
      expect(node.tag === "Between" && node.column).toBe(column);
      expect(node.tag === "Between" && node.low).toBe(low);
      expect(node.tag === "Between" && node.high).toBe(high);
    });

    it("is frozen", () => {
      // Act
      const node = between("age", 18, 65);

      // Assert
      expect(Object.isFrozen(node)).toBeTruthy();
    });
  });

  describe("not", () => {
    it("wraps a condition in a Not node", () => {
      // Arrange
      const inner = eq("active", true);

      // Act
      const node = not(inner);

      // Assert
      expect(node.tag).toBe("Not");
      expect(node.tag === "Not" && node.condition).toEqual(inner);
    });

    it("is frozen", () => {
      // Act
      const node = not(eq("active", false));

      // Assert
      expect(Object.isFrozen(node)).toBeTruthy();
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
      expect(node.tag).toBe("And");
      expect(node.tag === "And" ? node.conditions.length : -1).toBe(3);
      expect(node.tag === "And" ? node.conditions[0] : null).toEqual(c1);
      expect(node.tag === "And" ? node.conditions[1] : null).toEqual(c2);
      expect(node.tag === "And" ? node.conditions[2] : null).toEqual(c3);
    });

    it("accepts two conditions", () => {
      // Arrange
      const c1 = eq("a", 1);
      const c2 = eq("b", 2);

      // Act
      const node = and(c1, c2);

      // Assert
      expect(node.tag).toBe("And");
      expect(node.tag === "And" ? node.conditions.length : -1).toBe(2);
    });

    it("is frozen", () => {
      // Act
      const node = and(eq("x", 1), eq("y", 2));

      // Assert
      expect(Object.isFrozen(node)).toBeTruthy();
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
      expect(node.tag).toBe("Or");
      expect(node.tag === "Or" ? node.conditions.length : -1).toBe(2);
      expect(node.tag === "Or" ? node.conditions[0] : null).toEqual(c1);
      expect(node.tag === "Or" ? node.conditions[1] : null).toEqual(c2);
    });

    it("accepts three or more conditions", () => {
      // Arrange
      const c1 = eq("role", "admin");
      const c2 = eq("role", "editor");
      const c3 = eq("role", "viewer");

      // Act
      const node = or(c1, c2, c3);

      // Assert
      expect(node.tag).toBe("Or");
      expect(node.tag === "Or" ? node.conditions.length : -1).toBe(3);
    });

    it("is frozen", () => {
      // Act
      const node = or(eq("a", 1), eq("b", 2));

      // Assert
      expect(Object.isFrozen(node)).toBeTruthy();
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
      expect(node.tag).toBe("Or");
      expect(node.tag === "Or" ? node.conditions.length : -1).toBe(2);
      expect(node.tag === "Or" ? node.conditions[0].tag : null).toBe("And");
      expect(node.tag === "Or" ? node.conditions[1].tag : null).toBe("Eq");
    });

    it("supports not wrapping a compound condition", () => {
      // Arrange
      const inner = or(eq("status", "banned"), isNull("verified_at"));

      // Act
      const node = not(inner);

      // Assert
      expect(node.tag).toBe("Not");
      expect(node.tag === "Not" && node.condition.tag).toBe("Or");
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
        expect(reached).toBeTruthy();
      }
    });
  });
});
