// Copyright 2026 igorjs. SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "@igorjs/pure-test";
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
      expect(err.tag).toBe("ConnectionError");
      expect(err.message).toBe("connection timeout");
    });

    it("includes cause when provided", () => {
      // Arrange
      const cause = new Error("ECONNREFUSED");

      // Act
      const err = connectionError("failed", cause);

      // Assert
      expect(err.cause).toBe(cause);
    });

    it("omits cause property when not provided", () => {
      // Act
      const err = connectionError("timeout");

      // Assert
      expect("cause" in err).toBe(false);
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
      expect(err.tag).toBe("QueryError");
      expect(err.sql).toBe(sql);
      expect(err.params).toEqual(["u_123"]);
    });

    it("freezes the params array", () => {
      // Arrange / Act
      const err = queryError("fail", "SELECT 1", ["a", "b"]);

      // Assert
      expect(Object.isFrozen(err.params)).toBeTruthy();
    });
  });

  describe("validationError", () => {
    it("produces a ValidationError with optional field and value", () => {
      // Act
      const err = validationError("invalid email", "email", "not-an-email");

      // Assert
      expect(err.tag).toBe("ValidationError");
      expect(err.field).toBe("email");
      expect(err.value).toBe("not-an-email");
    });

    it("omits field and value when not provided", () => {
      // Act
      const err = validationError("invalid input");

      // Assert
      expect("field" in err).toBe(false);
      expect("value" in err).toBe(false);
    });
  });

  describe("migrationError", () => {
    it("produces a MigrationError with migration name", () => {
      // Act
      const err = migrationError("checksum mismatch", "0001_add_users");

      // Assert
      expect(err.tag).toBe("MigrationError");
      expect(err.migration).toBe("0001_add_users");
    });
  });

  describe("transactionError", () => {
    it("produces a TransactionError", () => {
      // Act
      const err = transactionError("deadlock detected");

      // Assert
      expect(err.tag).toBe("TransactionError");
      expect(err.message).toBe("deadlock detected");
    });
  });

  describe("constraintError", () => {
    it("produces a ConstraintError with constraint and table", () => {
      // Act
      const err = constraintError("duplicate key", "users_email_unique", "users");

      // Assert
      expect(err.tag).toBe("ConstraintError");
      expect(err.constraint).toBe("users_email_unique");
      expect(err.table).toBe("users");
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
        expect(Object.isFrozen(err)).toBeTruthy();
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
      expect(result).toBe("connection");
    });
  });
});
