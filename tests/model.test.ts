import { Schema } from "@igorjs/pure-fx";
import { describe, expect, it } from "@igorjs/pure-test";

import { camelToSnake, Model } from "../src/model/define.ts";
import { Field } from "../src/model/field.ts";
import { injectTimestampColumns } from "../src/model/timestamps.ts";
import type { ColumnMetadata } from "../src/model/types.ts";

// ---------------------------------------------------------------------------
// camelToSnake
// ---------------------------------------------------------------------------

describe("camelToSnake", () => {
  it("leaves a single lowercase word unchanged", () => {
    // Arrange / Act / Assert
    expect(camelToSnake("id")).toBe("id");
  });

  it("converts simple camelCase to snake_case", () => {
    // Arrange
    const input = "authorId";

    // Act
    const result = camelToSnake(input);

    // Assert
    expect(result).toBe("author_id");
  });

  it("converts PascalCase to snake_case", () => {
    // Arrange
    const input = "CreatedAt";

    // Act
    const result = camelToSnake(input);

    // Assert
    expect(result).toBe("created_at");
  });

  it("handles consecutive uppercase letters (acronym prefix)", () => {
    // Arrange
    const input = "HTMLParser";

    // Act
    const result = camelToSnake(input);

    // Assert
    expect(result).toBe("html_parser");
  });

  it("handles trailing acronym (parseURL)", () => {
    // Arrange
    const input = "parseURL";

    // Act
    const result = camelToSnake(input);

    // Assert
    expect(result).toBe("parse_url");
  });

  it("passes through already-snake_case strings unchanged", () => {
    // Arrange
    const input = "user_profile_id";

    // Act
    const result = camelToSnake(input);

    // Assert
    expect(result).toBe("user_profile_id");
  });

  it("converts multi-segment camelCase", () => {
    // Arrange
    const input = "updatedAt";

    // Act
    const result = camelToSnake(input);

    // Assert
    expect(result).toBe("updated_at");
  });
});

// ---------------------------------------------------------------------------
// field()
// ---------------------------------------------------------------------------

describe("Field()", () => {
  it("returns a frozen FieldDef with _tag 'FieldDef'", () => {
    // Arrange / Act
    const f = Field(Schema.string);

    // Assert
    expect(f._tag).toBe("FieldDef");
    expect(Object.isFrozen(f)).toBeTruthy();
  });

  it("stores the provided schema", () => {
    // Arrange
    const schema = Schema.number;

    // Act
    const f = Field(schema);

    // Assert
    expect(f.schema).toBe(schema);
  });

  it("sets _hasDefault to false when no config is provided", () => {
    // Arrange / Act
    const f = Field(Schema.string);

    // Assert
    expect(f._hasDefault).toBe(false);
  });

  it("sets _hasDefault to false when config has no default", () => {
    // Arrange / Act
    const f = Field(Schema.string, { primaryKey: true });

    // Assert
    expect(f._hasDefault).toBe(false);
  });

  it("sets _hasDefault to true when config includes a default", () => {
    // Arrange / Act
    const f = Field(Schema.string, { default: "uuid" });

    // Assert
    expect(f._hasDefault).toBe(true);
  });

  it("sets _hasDefault to true when config includes primaryKey and default", () => {
    // Arrange / Act
    const f = Field(Schema.string, { primaryKey: true, default: "uuid" });

    // Assert
    expect(f._hasDefault).toBe(true);
  });

  it("stores an empty frozen config object when no config is provided", () => {
    // Arrange / Act
    const f = Field(Schema.boolean);

    // Assert
    expect(f.config).toEqual({});
    expect(Object.isFrozen(f.config)).toBeTruthy();
  });

  it("stores and freezes the provided config", () => {
    // Arrange
    const config = { unique: true, index: true };

    // Act
    const f = Field(Schema.string, config);

    // Assert
    expect(f.config.unique).toBe(true);
    expect(f.config.index).toBe(true);
    expect(Object.isFrozen(f.config)).toBeTruthy();
  });

  it("stores a custom columnName in config", () => {
    // Arrange / Act
    const f = Field(Schema.string, { columnName: "user_name" });

    // Assert
    expect(f.config.columnName).toBe("user_name");
  });
});

// ---------------------------------------------------------------------------
// injectTimestampColumns()
// ---------------------------------------------------------------------------

describe("injectTimestampColumns()", () => {
  it("appends createdAt and updatedAt columns", () => {
    // Arrange
    const base: readonly ColumnMetadata[] = Object.freeze([
      Object.freeze({ name: "id", columnName: "id", schema: Schema.string, config: {} }),
    ]);

    // Act
    const result = injectTimestampColumns(base);

    // Assert
    expect(result.length).toBe(3);
    expect(result[1]?.name).toBe("createdAt");
    expect(result[1]?.columnName).toBe("created_at");
    expect(result[2]?.name).toBe("updatedAt");
    expect(result[2]?.columnName).toBe("updated_at");
  });

  it("does not mutate the original array", () => {
    // Arrange
    const base: readonly ColumnMetadata[] = Object.freeze([]);

    // Act
    const result = injectTimestampColumns(base);

    // Assert
    expect(base.length).toBe(0);
    expect(result.length).toBe(2);
  });

  it("returns a frozen array", () => {
    // Arrange / Act
    const result = injectTimestampColumns([]);

    // Assert
    expect(Object.isFrozen(result)).toBeTruthy();
  });

  it("timestamp column configs are frozen", () => {
    // Arrange / Act
    const result = injectTimestampColumns([]);

    // Assert
    for (const col of result) {
      expect(Object.isFrozen(col)).toBeTruthy();
      expect(Object.isFrozen(col.config)).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// Model()
// ---------------------------------------------------------------------------

describe("Model()", () => {
  it("sets $name to the provided table name", () => {
    // Arrange / Act
    const UserModel = Model("users", {
      fields: { id: Field(Schema.string, { primaryKey: true, default: "uuid" }) },
    });

    // Assert
    expect(UserModel.$name).toBe("users");
  });

  it("builds $columns from field definitions with auto snake_case names", () => {
    // Arrange / Act
    const PostModel = Model("posts", {
      fields: {
        id: Field(Schema.string, { primaryKey: true, default: "uuid" }),
        authorId: Field(Schema.string),
        createdAt: Field(Schema.string),
      },
    });

    // Assert
    const colNames = PostModel.$columns.map(c => c.columnName);
    expect(colNames).toEqual(["id", "author_id", "created_at"]);
  });

  it("respects a custom columnName override in FieldConfig", () => {
    // Arrange / Act
    const MyModel = Model("my_table", {
      fields: {
        userName: Field(Schema.string, { columnName: "display_name" }),
      },
    });

    // Assert
    expect(MyModel.$columns[0]?.columnName).toBe("display_name");
  });

  it("stores field name as column.name (camelCase)", () => {
    // Arrange / Act
    const MyModel = Model("things", {
      fields: { authorId: Field(Schema.number) },
    });

    // Assert
    expect(MyModel.$columns[0]?.name).toBe("authorId");
  });

  it("exposes a $schema that validates input", () => {
    // Arrange
    const UserModel = Model("users", {
      fields: {
        id: Field(Schema.string),
        age: Field(Schema.number),
      },
    });

    // Act
    const result = UserModel.$schema.parse({ id: "u1", age: 30 });

    // Assert
    expect(result.isOk).toBeTruthy();
  });

  it("$schema rejects invalid input", () => {
    // Arrange
    const UserModel = Model("users", {
      fields: {
        id: Field(Schema.string),
        age: Field(Schema.number),
      },
    });

    // Act
    const result = UserModel.$schema.parse({ id: 42, age: "not-a-number" });

    // Assert
    expect(result.isErr).toBeTruthy();
  });

  it("does not inject timestamp columns when options.timestamps is absent", () => {
    // Arrange / Act
    const MyModel = Model("things", {
      fields: { id: Field(Schema.string) },
    });

    // Assert
    expect(MyModel.$columns.length).toBe(1);
  });

  it("does not inject timestamp columns when options.timestamps is false", () => {
    // Arrange / Act
    const MyModel = Model("things", {
      fields: { id: Field(Schema.string) },
      options: { timestamps: false },
    });

    // Assert
    expect(MyModel.$columns.length).toBe(1);
  });

  it("injects timestamp columns when options.timestamps is true", () => {
    // Arrange / Act
    const MyModel = Model("things", {
      fields: { id: Field(Schema.string) },
      options: { timestamps: true },
    });

    // Assert
    expect(MyModel.$columns.length).toBe(3);
    const names = MyModel.$columns.map(c => c.columnName);
    expect(names).toEqual(["id", "created_at", "updated_at"]);
  });

  it("stores $options correctly", () => {
    // Arrange / Act
    const MyModel = Model("things", {
      fields: { id: Field(Schema.string) },
      options: { timestamps: true, softDelete: false },
    });

    // Assert
    expect(MyModel.$options.timestamps).toBe(true);
    expect(MyModel.$options.softDelete).toBe(false);
  });

  it("$options defaults to an empty object when not provided", () => {
    // Arrange / Act
    const MyModel = Model("things", {
      fields: { id: Field(Schema.string) },
    });

    // Assert
    expect(MyModel.$options).toEqual({});
  });

  it("the returned Model object is frozen", () => {
    // Arrange / Act
    const MyModel = Model("things", {
      fields: { id: Field(Schema.string) },
    });

    // Assert
    expect(Object.isFrozen(MyModel)).toBeTruthy();
  });

  it("$columns is a frozen array", () => {
    // Arrange / Act
    const MyModel = Model("things", {
      fields: { id: Field(Schema.string) },
    });

    // Assert
    expect(Object.isFrozen(MyModel.$columns)).toBeTruthy();
  });

  it("$options is frozen", () => {
    // Arrange / Act
    const MyModel = Model("things", {
      fields: { id: Field(Schema.string) },
      options: { timestamps: true },
    });

    // Assert
    expect(Object.isFrozen(MyModel.$options)).toBeTruthy();
  });

  it("each ColumnMetadata entry is frozen", () => {
    // Arrange / Act
    const MyModel = Model("things", {
      fields: {
        id: Field(Schema.string),
        title: Field(Schema.string),
      },
    });

    // Assert
    for (const col of MyModel.$columns) {
      expect(Object.isFrozen(col)).toBeTruthy();
    }
  });

  it("column config is frozen", () => {
    // Arrange / Act
    const MyModel = Model("things", {
      fields: {
        id: Field(Schema.string, { primaryKey: true, default: "uuid" }),
      },
    });

    // Assert
    expect(Object.isFrozen(MyModel.$columns[0]?.config)).toBeTruthy();
  });
});
