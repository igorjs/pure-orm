/**
 * runtime-smoke.mjs - Smoke test for the built package.
 *
 * Validates that the dist/ output is importable and the core API works.
 * Uses only console.log and throws on failure (no node:test, no node:assert)
 * so it runs on any Node version without flags.
 *
 * Run:
 *   node tests/runtime-smoke.mjs
 */

const orm = await import("../dist/index.js");

let passed = 0;
let failed = 0;

const assert = (condition, message) => {
  if (!condition) {
    console.log(`  FAIL: ${message}`);
    failed++;
  } else {
    console.log(`  ok: ${message}`);
    passed++;
  }
};

const section = name => console.log(`\n--- ${name} ---`);

// ---- Exports exist ----

section("Core exports");
assert(typeof orm.Model === "function", "Model is a function");
assert(typeof orm.Field === "function", "Field is a function");
assert(typeof orm.from === "function", "from is a function");
assert(typeof orm.select === "function", "select is a function");
assert(typeof orm.where === "function", "where is a function");
assert(typeof orm.eq === "function", "eq is a function");
assert(typeof orm.execute === "function", "execute is a function");
assert(typeof orm.findOne === "function", "findOne is a function");
assert(typeof orm.compile === "function", "compile is a function");

section("Mutation exports");
assert(typeof orm.insert === "function", "insert is a function");
assert(typeof orm.update === "function", "update is a function");
assert(typeof orm.remove === "function", "remove is a function");
assert(typeof orm.hardRemove === "function", "hardRemove is a function");
assert(typeof orm.restore === "function", "restore is a function");
assert(typeof orm.returning === "function", "returning is a function");
assert(typeof orm.onConflict === "function", "onConflict is a function");

section("Join exports");
assert(typeof orm.join === "function", "join is a function");
assert(typeof orm.leftJoin === "function", "leftJoin is a function");
assert(typeof orm.on === "function", "on is a function");

section("Aggregate exports");
assert(typeof orm.count === "function", "count is a function");
assert(typeof orm.sum === "function", "sum is a function");
assert(typeof orm.avg === "function", "avg is a function");
assert(typeof orm.min === "function", "min is a function");
assert(typeof orm.max === "function", "max is a function");

section("Window exports");
assert(typeof orm.rowNumber === "function", "rowNumber is a function");
assert(typeof orm.rank === "function", "rank is a function");
assert(typeof orm.denseRank === "function", "denseRank is a function");

section("Relation exports");
assert(typeof orm.hasOne === "function", "hasOne is a function");
assert(typeof orm.hasMany === "function", "hasMany is a function");
assert(typeof orm.belongsTo === "function", "belongsTo is a function");
assert(typeof orm.manyToMany === "function", "manyToMany is a function");
assert(typeof orm.include === "function", "include is a function");
assert(typeof orm.lazy === "function", "lazy is a function");

section("Advanced query exports");
assert(typeof orm.groupBy === "function", "groupBy is a function");
assert(typeof orm.having === "function", "having is a function");
assert(typeof orm.withCte === "function", "withCte is a function");
assert(typeof orm.exists === "function", "exists is a function");
assert(typeof orm.notExists === "function", "notExists is a function");
assert(typeof orm.raw === "function", "raw is a function");
assert(typeof orm.sql === "function", "sql is a function");

section("Soft delete exports");
assert(typeof orm.withDeleted === "function", "withDeleted is a function");
assert(typeof orm.onlyDeleted === "function", "onlyDeleted is a function");

section("Dialect exports");
assert(typeof orm.createPostgresDialect === "function", "createPostgresDialect is a function");
assert(typeof orm.createSqliteDialect === "function", "createSqliteDialect is a function");

section("Migration exports");
assert(typeof orm.createSnapshot === "function", "createSnapshot is a function");
assert(typeof orm.diffSnapshots === "function", "diffSnapshots is a function");
assert(typeof orm.generateMigration === "function", "generateMigration is a function");
assert(typeof orm.applyMigration === "function", "applyMigration is a function");

section("Audit exports");
assert(typeof orm.createAuditHooks === "function", "createAuditHooks is a function");
assert(typeof orm.auditLog === "function", "auditLog is a function");

// ---- Functional test: build and compile a query ----

section("Functional: build + compile query");

const { Schema } = await import("@igorjs/pure-ts");

const User = orm.Model("users", {
  fields: {
    id: orm.Field(Schema.string, { primaryKey: true, default: "uuid" }),
    name: orm.Field(Schema.string),
    email: orm.Field(Schema.string, { unique: true }),
  },
});

const node = orm.where(orm.eq("name", "Alice"))(orm.from(User));
assert(node.tag === "Select", "from() produces a SelectNode");
assert(node.conditions.length === 1, "where() adds a condition");

const pg = orm.createPostgresDialect();
const compiled = pg.compileSelect(node);
assert(compiled.sql.includes('"users"'), "SQL contains table name");
assert(compiled.sql.includes("$1"), "SQL has PG placeholder");
assert(compiled.params[0] === "Alice", "params contain the value");

const sqlite = orm.createSqliteDialect();
const sqliteCompiled = sqlite.compileSelect(node);
assert(sqliteCompiled.sql.includes("?"), "SQLite uses ? placeholder");

// ---- Summary ----

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
