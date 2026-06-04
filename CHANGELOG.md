# Changelog

All notable changes to `@igorjs/pure-orm` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Versioning policy while pre-1.0 and the per-subsystem maturity levels are
documented in [STABILITY.md](./STABILITY.md). In short: while the major version
is `0`, breaking changes are allowed only on **minor** bumps and every such
change is listed under "Changed" or "Removed" below.

## [Unreleased]

### Added

- `CHANGELOG.md` and `STABILITY.md`: a written semantic-versioning policy and a
  public per-subsystem stability matrix, so adopters can reason about risk.

### In progress

The migration engine is being hardened ahead of `0.2.0` (the highest-priority
work, because the differ could previously lose data). Tracked in separate
changes:

- A destructive-change guard: `migrate:generate` fails closed on any
  `DROP TABLE` / `DROP COLUMN` unless `--allow-destructive` is passed.
- First-class rename detection (`renamedFrom` annotation + `RenameTable` /
  `RenameColumn` operations) so renames preserve data instead of dropping and
  recreating.
- Foreign keys are now emitted in `CREATE TABLE`, and `DROP INDEX` is reversible
  (the last `MANUAL REVIEW` generator fallback is removed).

## [0.1.0]

Initial development version: pure query composition over an immutable AST,
PostgreSQL and SQLite dialects, Lambda-ready connections, read-side relations,
soft deletes, timestamps, auditing, and a migration CLI
(`generate` / `up` / `down` / `status` / `validate`). Not yet published to a
registry.

[Unreleased]: https://github.com/igorjs/pure-orm/compare/main...HEAD
[0.1.0]: https://github.com/igorjs/pure-orm/releases/tag/v0.1.0
