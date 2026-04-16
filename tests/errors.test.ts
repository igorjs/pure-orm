import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import type { DbError } from "../src/errors/errors.ts";
import {
  connectionError,
  constraintError,
  migrationError,
  queryError,
  transactionError,
  validationError,
} from "../src/errors/errors.ts";

describe("DbError constructors", () => {
  describe("connectionError", () => {
    it("produces a ConnectionError with correct tag and message", () => {
      // Arrange
      const message = "connection timeout";

      // Act
      const err = connectionError(message);

      // Assert
      assert.equal(err.tag, "ConnectionError");
      assert.equal(err.message, "connection timeout");
    });

    it("includes cause when provided", () => {
      // Arrange
      const cause = new Error("ECONNREFUSED");

      // Act
      const err = connectionError("failed", cause);

      // Assert
      assert.equal(err.cause, cause);
    });

    it("omits cause property when not provided", () => {
      // Act
      const err = connectionError("timeout");

      // Assert
      assert.equal("cause" in err, false);
    });
  });

  describe("queryError", () => {
    it("produces a QueryError with sql and params", () => {
      // Arrange
      const sql = "SELECT * FROM users WHERE id = $1";
      const params = ["u_123"];

      // Act
      const err = queryError("query failed", sql, params);

      // Assert
      assert.equal(err.tag, "QueryError");
      assert.equal(err.sql, sql);
      assert.deepEqual(err.params, ["u_123"]);
    });

    it("freezes the params array", () => {
      // Arrange / Act
      const err = queryError("fail", "SELECT 1", ["a", "b"]);

      // Assert
      assert.ok(Object.isFrozen(err.params));
    });
  });

  describe("validationError", () => {
    it("produces a ValidationError with optional field and value", () => {
      // Act
      const err = validationError("invalid email", "email", "not-an-email");

      // Assert
      assert.equal(err.tag, "ValidationError");
      assert.equal(err.field, "email");
      assert.equal(err.value, "not-an-email");
    });

    it("omits field and value when not provided", () => {
      // Act
      const err = validationError("invalid input");

      // Assert
      assert.equal("field" in err, false);
      assert.equal("value" in err, false);
    });
  });

  describe("migrationError", () => {
    it("produces a MigrationError with migration name", () => {
      // Act
      const err = migrationError("checksum mismatch", "0001_add_users");

      // Assert
      assert.equal(err.tag, "MigrationError");
      assert.equal(err.migration, "0001_add_users");
    });
  });

  describe("transactionError", () => {
    it("produces a TransactionError", () => {
      // Act
      const err = transactionError("deadlock detected");

      // Assert
      assert.equal(err.tag, "TransactionError");
      assert.equal(err.message, "deadlock detected");
    });
  });

  describe("constraintError", () => {
    it("produces a ConstraintError with constraint and table", () => {
      // Act
      const err = constraintError("duplicate key", "users_email_unique", "users");

      // Assert
      assert.equal(err.tag, "ConstraintError");
      assert.equal(err.constraint, "users_email_unique");
      assert.equal(err.table, "users");
    });
  });

  describe("immutability", () => {
    it("all error objects are frozen", () => {
      // Act
      const errors = [
        connectionError("a"),
        queryError("a", "SELECT 1", []),
        validationError("a"),
        migrationError("a", "m"),
        transactionError("a"),
        constraintError("a", "c", "t"),
      ];

      // Assert
      for (const err of errors) {
        assert.ok(Object.isFrozen(err), `${err.tag} should be frozen`);
      }
    });
  });

  describe("type discrimination", () => {
    it("supports exhaustive pattern matching via tag", () => {
      // Arrange
      const err: DbError = connectionError("timeout");

      // Act
      const result = (() => {
        switch (err.tag) {
          case "ConnectionError":
            return "connection";
          case "QueryError":
            return "query";
          case "ValidationError":
            return "validation";
          case "MigrationError":
            return "migration";
          case "TransactionError":
            return "transaction";
          case "ConstraintError":
            return "constraint";
        }
      })();

      // Assert
      assert.equal(result, "connection");
    });
  });
});
