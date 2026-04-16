/**
 * Migration SQL generator.
 *
 * Converts ChangeOperations into up/down SQL DDL statements. The generator
 * receives a Dialect for type mapping and identifier quoting so the output
 * is correct for the target database.
 */

import type { Dialect } from "../dialect/dialect.ts";
import type { ChangeOperation, ColumnSnapshot, TableSnapshot } from "./types.ts";

// ---- Helpers ----

const q = (id: string): string => `"${id.replace(/"/g, '""')}"`;

const columnDef = (name: string, col: ColumnSnapshot, dialect: Dialect): string => {
  const config = {
    primaryKey: col.primaryKey,
    unique: col.unique,
    index: col.index,
  };
  const sqlType = dialect.mapFieldType(col.type, config);
  const parts = [q(name), sqlType];
  if (col.primaryKey) parts.push("PRIMARY KEY");
  if (!col.nullable && !col.primaryKey) parts.push("NOT NULL");
  if (col.unique && !col.primaryKey) parts.push("UNIQUE");
  if (
    col.default !== null &&
    col.default !== "uuid" &&
    col.default !== "cuid" &&
    col.default !== "autoincrement"
  ) {
    // Map known defaults to SQL expressions.
    if (col.default === "now") {
      parts.push(`DEFAULT ${dialect.name === "sqlite" ? "datetime('now')" : "NOW()"}`);
    } else {
      parts.push(`DEFAULT ${col.default}`);
    }
  }
  return parts.join(" ");
};

const createTableSql = (table: string, snapshot: TableSnapshot, dialect: Dialect): string => {
  const colDefs = Object.entries(snapshot.columns).map(([name, col]) =>
    columnDef(name, col, dialect),
  );
  return `CREATE TABLE ${q(table)} (\n  ${colDefs.join(",\n  ")}\n);`;
};

const dropTableSql = (table: string): string => `DROP TABLE ${q(table)};`;

// ---- Generate up/down ----

const generateUp = (op: ChangeOperation, dialect: Dialect): string => {
  switch (op.tag) {
    case "CreateTable":
      return createTableSql(op.table, op.snapshot, dialect);

    case "DropTable":
      return dropTableSql(op.table);

    case "AddColumn": {
      const def = columnDef(op.column, op.snapshot, dialect);
      return `ALTER TABLE ${q(op.table)} ADD COLUMN ${def};`;
    }

    case "DropColumn":
      return `ALTER TABLE ${q(op.table)} DROP COLUMN ${q(op.column)};`;

    case "AlterColumn": {
      // ALTER COLUMN is dialect-specific. PostgreSQL uses ALTER COLUMN,
      // SQLite requires recreating the table. For now, emit PG-style.
      const lines: string[] = [];
      if (op.from.type !== op.to.type) {
        const sqlType = dialect.mapFieldType(op.to.type, {});
        lines.push(`ALTER TABLE ${q(op.table)} ALTER COLUMN ${q(op.column)} TYPE ${sqlType};`);
      }
      if (op.from.nullable !== op.to.nullable) {
        const action = op.to.nullable ? "DROP NOT NULL" : "SET NOT NULL";
        lines.push(`ALTER TABLE ${q(op.table)} ALTER COLUMN ${q(op.column)} ${action};`);
      }
      if (op.from.default !== op.to.default) {
        if (op.to.default === null) {
          lines.push(`ALTER TABLE ${q(op.table)} ALTER COLUMN ${q(op.column)} DROP DEFAULT;`);
        } else {
          const defExpr =
            op.to.default === "now"
              ? dialect.name === "sqlite"
                ? "datetime('now')"
                : "NOW()"
              : op.to.default;
          lines.push(
            `ALTER TABLE ${q(op.table)} ALTER COLUMN ${q(op.column)} SET DEFAULT ${defExpr};`,
          );
        }
      }
      return lines.join("\n");
    }

    case "AddIndex": {
      const unique = op.index.unique ? "UNIQUE " : "";
      const cols = op.index.columns.map(q).join(", ");
      return `CREATE ${unique}INDEX ${q(op.index.name)} ON ${q(op.table)} (${cols});`;
    }

    case "DropIndex":
      return `DROP INDEX ${q(op.indexName)};`;
  }
};

const generateDown = (op: ChangeOperation, dialect: Dialect): string => {
  switch (op.tag) {
    case "CreateTable":
      return dropTableSql(op.table);

    case "DropTable":
      return createTableSql(op.table, op.snapshot, dialect);

    case "AddColumn":
      return `ALTER TABLE ${q(op.table)} DROP COLUMN ${q(op.column)};`;

    case "DropColumn": {
      const def = columnDef(op.column, op.snapshot, dialect);
      return `ALTER TABLE ${q(op.table)} ADD COLUMN ${def};`;
    }

    case "AlterColumn": {
      // Reverse: swap from <-> to
      const reversed: ChangeOperation = Object.freeze({
        tag: "AlterColumn",
        table: op.table,
        column: op.column,
        from: op.to,
        to: op.from,
      });
      return generateUp(reversed, dialect);
    }

    case "AddIndex":
      return `DROP INDEX ${q(op.index.name)};`;

    case "DropIndex":
      return `-- MANUAL REVIEW: Cannot auto-generate CREATE INDEX for dropped index "${op.indexName}"`;
  }
};

/**
 * Generates up and down SQL from a list of ChangeOperations.
 *
 * Returns a frozen object with separate up and down SQL strings,
 * each containing all statements for the migration.
 */
const generateMigration = (
  ops: readonly ChangeOperation[],
  dialect: Dialect,
): { readonly up: string; readonly down: string } => {
  const up = ops.map(op => generateUp(op, dialect)).join("\n\n");
  // Down operations are reversed so rollback undoes changes in reverse order.
  const down = [...ops]
    .reverse()
    .map(op => generateDown(op, dialect))
    .join("\n\n");
  return Object.freeze({ up, down });
};

export { generateDown, generateMigration, generateUp };
