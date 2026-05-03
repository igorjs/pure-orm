import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { Schema } from "@igorjs/pure-fx";

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
    assert.equal(camelToSnake("id"), "id");
  });

  it("converts simple camelCase to snake_case", () => {
    // Arrange
    const input = "authorId";

    // Act
    const result = camelToSnake(input);

    // Assert
    assert.equal(result, "author_id");
  });

  it("converts PascalCase to snake_case", () => {
    // Arrange
    const input = "CreatedAt";

    // Act
    const result = camelToSnake(input);

    // Assert
    assert.equal(result, "created_at");
  });

  it("handles consecutive uppercase letters (acronym prefix)", () => {
    // Arrange
    const input = "HTMLParser";

    // Act
    const result = camelToSnake(input);

    // Assert
    assert.equal(result, "html_parser");
  });

  it("handles trailing acronym (parseURL)", () => {
    // Arrange
    const input = "parseURL";

    // Act
    const result = camelToSnake(input);

    // Assert
    assert.equal(result, "parse_url");
  });

  it("passes through already-snake_case strings unchanged", () => {
    // Arrange
    const input = "user_profile_id";

    // Act
    const result = camelToSnake(input);

    // Assert
    assert.equal(result, "user_profile_id");
  });

  it("converts multi-segment camelCase", () => {
    // Arrange
    const input = "updatedAt";

    // Act
    const result = camelToSnake(input);

    // Assert
    assert.equal(result, "updated_at");
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
    assert.equal(f._tag, "FieldDef");
    assert.ok(Object.isFrozen(f));
  });

  it("stores the provided schema", () => {
    // Arrange
    const schema = Schema.number;

    // Act
    const f = Field(schema);

    // Assert
    assert.strictEqual(f.schema, schema);
  });

  it("sets _hasDefault to false when no config is provided", () => {
    // Arrange / Act
    const f = Field(Schema.string);

    // Assert
    assert.equal(f._hasDefault, false);
  });

  it("sets _hasDefault to false when config has no default", () => {
    // Arrange / Act
    const f = Field(Schema.string, { primaryKey: true });

    // Assert
    assert.equal(f._hasDefault, false);
  });

  it("sets _hasDefault to true when config includes a default", () => {
    // Arrange / Act
    const f = Field(Schema.string, { default: "uuid" });

    // Assert
    assert.equal(f._hasDefault, true);
  });

  it("sets _hasDefault to true when config includes primaryKey and default", () => {
    // Arrange / Act
    const f = Field(Schema.string, { primaryKey: true, default: "uuid" });

    // Assert
    assert.equal(f._hasDefault, true);
  });

  it("stores an empty frozen config object when no config is provided", () => {
    // Arrange / Act
    const f = Field(Schema.boolean);

    // Assert
    assert.deepEqual(f.config, {});
    assert.ok(Object.isFrozen(f.config));
  });

  it("stores and freezes the provided config", () => {
    // Arrange
    const config = { unique: true, index: true };

    // Act
    const f = Field(Schema.string, config);

    // Assert
    assert.equal(f.config.unique, true);
    assert.equal(f.config.index, true);
    assert.ok(Object.isFrozen(f.config));
  });

  it("stores a custom columnName in config", () => {
    // Arrange / Act
    const f = Field(Schema.string, { columnName: "user_name" });

    // Assert
    assert.equal(f.config.columnName, "user_name");
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
    assert.equal(result.length, 3);
    assert.equal(result[1]?.name, "createdAt");
    assert.equal(result[1]?.columnName, "created_at");
    assert.equal(result[2]?.name, "updatedAt");
    assert.equal(result[2]?.columnName, "updated_at");
  });

  it("does not mutate the original array", () => {
    // Arrange
    const base: readonly ColumnMetadata[] = Object.freeze([]);

    // Act
    const result = injectTimestampColumns(base);

    // Assert
    assert.equal(base.length, 0);
    assert.equal(result.length, 2);
  });

  it("returns a frozen array", () => {
    // Arrange / Act
    const result = injectTimestampColumns([]);

    // Assert
    assert.ok(Object.isFrozen(result));
  });

  it("timestamp column configs are frozen", () => {
    // Arrange / Act
    const result = injectTimestampColumns([]);

    // Assert
    for (const col of result) {
      assert.ok(Object.isFrozen(col));
      assert.ok(Object.isFrozen(col.config));
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
    assert.equal(UserModel.$name, "users");
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
    assert.deepEqual(colNames, ["id", "author_id", "created_at"]);
  });

  it("respects a custom columnName override in FieldConfig", () => {
    // Arrange / Act
    const MyModel = Model("my_table", {
      fields: {
        userName: Field(Schema.string, { columnName: "display_name" }),
      },
    });

    // Assert
    assert.equal(MyModel.$columns[0]?.columnName, "display_name");
  });

  it("stores field name as column.name (camelCase)", () => {
    // Arrange / Act
    const MyModel = Model("things", {
      fields: { authorId: Field(Schema.number) },
    });

    // Assert
    assert.equal(MyModel.$columns[0]?.name, "authorId");
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
    assert.ok(result.isOk);
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
    assert.ok(result.isErr);
  });

  it("does not inject timestamp columns when options.timestamps is absent", () => {
    // Arrange / Act
    const MyModel = Model("things", {
      fields: { id: Field(Schema.string) },
    });

    // Assert
    assert.equal(MyModel.$columns.length, 1);
  });

  it("does not inject timestamp columns when options.timestamps is false", () => {
    // Arrange / Act
    const MyModel = Model("things", {
      fields: { id: Field(Schema.string) },
      options: { timestamps: false },
    });

    // Assert
    assert.equal(MyModel.$columns.length, 1);
  });

  it("injects timestamp columns when options.timestamps is true", () => {
    // Arrange / Act
    const MyModel = Model("things", {
      fields: { id: Field(Schema.string) },
      options: { timestamps: true },
    });

    // Assert
    assert.equal(MyModel.$columns.length, 3);
    const names = MyModel.$columns.map(c => c.columnName);
    assert.deepEqual(names, ["id", "created_at", "updated_at"]);
  });

  it("stores $options correctly", () => {
    // Arrange / Act
    const MyModel = Model("things", {
      fields: { id: Field(Schema.string) },
      options: { timestamps: true, softDelete: false },
    });

    // Assert
    assert.equal(MyModel.$options.timestamps, true);
    assert.equal(MyModel.$options.softDelete, false);
  });

  it("$options defaults to an empty object when not provided", () => {
    // Arrange / Act
    const MyModel = Model("things", {
      fields: { id: Field(Schema.string) },
    });

    // Assert
    assert.deepEqual(MyModel.$options, {});
  });

  it("the returned Model object is frozen", () => {
    // Arrange / Act
    const MyModel = Model("things", {
      fields: { id: Field(Schema.string) },
    });

    // Assert
    assert.ok(Object.isFrozen(MyModel));
  });

  it("$columns is a frozen array", () => {
    // Arrange / Act
    const MyModel = Model("things", {
      fields: { id: Field(Schema.string) },
    });

    // Assert
    assert.ok(Object.isFrozen(MyModel.$columns));
  });

  it("$options is frozen", () => {
    // Arrange / Act
    const MyModel = Model("things", {
      fields: { id: Field(Schema.string) },
      options: { timestamps: true },
    });

    // Assert
    assert.ok(Object.isFrozen(MyModel.$options));
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
      assert.ok(Object.isFrozen(col), `column '${col.name}' should be frozen`);
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
    assert.ok(Object.isFrozen(MyModel.$columns[0]?.config));
  });
});
