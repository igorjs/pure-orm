# Stability and versioning

This document records what `@igorjs/pure-orm` promises about API stability. It
exists because the largest practical barrier to adopting an ORM is not a missing
feature — it is not knowing which parts are safe to depend on. See ADR-0012 for
the rationale.

## Versioning policy

The project follows [Semantic Versioning](https://semver.org/).

While the major version is `0` (pre-1.0):

- **Breaking changes are allowed only on minor bumps** (`0.x` → `0.(x+1)`), never
  on patch bumps.
- Every breaking change is listed under "Changed" or "Removed" in
  [CHANGELOG.md](./CHANGELOG.md).
- Patch bumps (`0.x.y` → `0.x.(y+1)`) are additive or fix-only.

The path to `1.0.0`: every subsystem below at **Beta** or higher, the migration
differ proven safe against data loss, and published benchmarks. Until then a 1.0
promise would be false.

## Peer dependency: `@igorjs/pure-fx`

The core is built on `@igorjs/pure-fx`, which is itself pre-1.0 and can change
under us. The supported range is pinned as a peer dependency:

| Peer            | Supported range |
| --------------- | --------------- |
| `@igorjs/pure-fx` | `^0.1.0`        |

A change to the supported `pure-fx` range is itself a breaking change and gets a
minor bump and a changelog entry.

## Stability matrix

Levels:

- **Stable** — API committed; changes follow semver strictly. (Nothing is here
  yet — there is no published release.)
- **Beta** — API is settling and well covered by tests; minor-version breaking
  changes possible but called out in the changelog.
- **Experimental** — usable but actively changing; expect breaking changes.
- **Planned** — designed (see the linked ADR) but not yet implemented.

| Subsystem | Level | Notes |
| --- | --- | --- |
| Query builder (`select`/`insert`/`update`/`delete`, conditions, joins, CTE, subquery, window, aggregates) | Beta | Immutable AST + `pipe()`; extensive unit coverage. |
| Query execution (compile, execute, result mapping) | Beta | Per-query compile; performance work is Planned (ADR-0011). |
| Dialect — PostgreSQL | Beta | Full feature parity target. |
| Dialect — SQLite | Beta | Full feature parity target. |
| Connections (pool, lambda, transaction) | Beta | TCP drivers (pg, better-sqlite3); edge drivers Planned (ADR-0003). |
| Model & read-side relations (`include`, `lazy`) | Beta | Write-side/nested writes Planned (ADR-0008). |
| Migrations (snapshot, differ, generator, runner, state) | Experimental | Hardening in progress (ADR-0004, ADR-0005); see CHANGELOG. |
| CLI (`generate`/`up`/`down`/`status`/`validate`) | Experimental | Surface still changing alongside the migration engine. |
| Soft deletes & timestamps | Beta | |
| Audit logging | Experimental | |
| Runtime validation (Standard Schema) | Planned | ADR-0009 |
| Introspection / `pull` / codegen | Planned | ADR-0006 |
| Dev `push` & seeding | Planned | ADR-0007 |
| MySQL / MariaDB | Planned | ADR-0002 |
| Serverless / edge drivers | Planned | ADR-0003 |
| Rich column types (jsonb, arrays, vectors, …) | Planned | ADR-0010 |

## Change-review policy

Because the data layer is expensive to migrate away from, changes to the
highest-risk subsystems — the **differ**, the **compiler**, and the
**connection layer** — warrant a second reviewer before merge. Recruiting at
least one co-maintainer is a prerequisite for `1.0.0` (ADR-0012).
