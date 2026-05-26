# Changelog

> **How to read this file**
>
> Every time a new version is released, a new section is added here at the top.
> Changes are grouped by type:
> - **Added** – new features
> - **Changed** – changes to existing behaviour
> - **Fixed** – bug fixes
> - **Removed** – removed features
> - **Security** – security fixes
>
> The `[Unreleased]` section collects changes that are merged but not yet published to npm.
> When you run `npm publish`, rename `[Unreleased]` to the new version number and date.

All notable changes to this project will be documented in this file.
This project follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) and [Semantic Versioning](https://semver.org/).

---

## [0.1.12] — 2026-05-26

### Added

#### Cross-Actor CRUD Operations (Phase 4)
- **`permissions` option on `SheetAdapterConfig`** — define a permission matrix that controls which roles can access other actors' sheets and which tables they may touch. Example: `{ teacher: { canAccess: ['student'], tables: ['scores', 'attendance'] } }`.
- **`targetRole` and `targetSheetId` on `UserContext`** — pass these alongside the caller's own context to route all CRUD operations to a different actor's sheet.
- **`asActor(targetRole, targetSheetId)`** on `SheetAdapter` — convenience method that clones the current context with cross-actor fields set, avoiding repetitive `withContext()` calls.
- **Cross-actor permission enforcement in `hasPermission()`** — checks the permission matrix for `canAccess` and optional `tables` restrictions. Throws `PermissionError` with a clear message for every violation scenario (no config, not in canAccess list, table not allowed, missing targetSheetId).
- **Cross-actor sheet routing in `resolveSpreadsheetId()`** — when `targetRole` is set and differs from the caller's role, CRUD operations use `targetSheetId` instead of `actorSheetId`. Admin role bypasses all checks.
- **`ActorPermission` type** exported from the package.
- **18 unit tests** in `tests/unit/crossActorPermissions.test.ts` covering same-actor access, `asActor()`, cross-actor allow/deny, missing targetSheetId, admin bypass, and CRUD routing verification (findMany / create / update / delete each confirmed to hit the correct spreadsheet ID).

#### Schema Export (Phase 3 — test coverage)
- **`generatePrismaModel` and `generateSQLTable` are now exported** from `src/cli/commands/export.ts`, making them unit-testable without going through the CLI.
- **19 unit tests** in `tests/unit/export.test.ts` covering: Prisma model generation (all DataTypes, PK `@id`, `@default(cuid())`, optional `?`, `@unique`, `@relation` for FK columns), SQL DDL generation (all DataTypes, `PRIMARY KEY`, `FOREIGN KEY`, `NOT NULL`, fallback `_id` PK).

#### Developer Experience
- **`jest.config.js` `maxWorkers: 1`** — prevents Jest worker SIGKILL on memory-constrained environments when all test suites run together.
- **`Docs/developerGuide.md` Section 13** — new cross-actor operations guide covering permission matrix config, `withContext` + `asActor()` usage, all four CRUD operations, security rules table, and multi-sheet aggregation pattern.

### Changed
- `TODO.md` Phase 3 and Phase 4 implementation checklists fully checked off.

---

## [0.1.9] — ready to publish

### Added

#### Schema Integrity (Q11)
- **`computeSchemaHash(schema)`** — exported utility that computes a deterministic SHA-256 hash of a table's column definitions. Hash changes when any column is added, removed, or retyped; ordering of column definitions does not affect the hash.
- **`SchemaMismatchError`** — new error class thrown when `onSchemaMismatch: 'error'` is set and a user actor sheet's schema hash differs from the registered schema.
- **`schema_versions` built-in admin table** — scaffolded automatically by `sheet-db init`. Stores one row per `(actor_sheet_id, table_name)` with `schema_hash`, `synced_at`, and `column_count`. Read and written internally by the adapter.
- **`onSchemaMismatch` adapter option** — `'warn'` logs to stderr and continues (default), `'error'` throws `SchemaMismatchError`, `'auto-sync'` silently syncs the actor sheet and updates the version record before the first CRUD operation completes.
- **Schema pre-flight in `withContext()`** — when `onSchemaMismatch` is configured, `withContext()` immediately starts an async version check in the background. All CRUD methods (`create`, `findMany`, `findOne`, `update`, `delete`) await this shared promise before proceeding — so the check runs exactly once per context instance, never per call.
- **`SheetAdapter.upsertSchemaVersion(actorSheetId, tableName, hash, columnCount)`** — public method for CLI tools and external tooling to write version records.
- **`SheetAdapter.getSchemaVersion(actorSheetId, tableName)`** — public method to read the stored version record for a given sheet + table pair.
- **`sync --all-users`** — pushes schema changes to every registered user sheet by reading `actor_sheet_id` values from the admin `users` table. Updates `schema_versions` after each successful sync. Skips sheets that are already up-to-date (hash match).
- **`sync --all-users --dry-run`** — previews which user sheets are outdated and what would be synced without applying any changes.
- **Exponential backoff in `sync --all-users`** — retries failing API calls up to 5 times with delays of 1 s → 2 s → 4 s → 8 s → 16 s (capped at 32 s) on Google Sheets rate-limit errors (HTTP 429 / quota exceeded).

#### Multi-Actor Config (Q10)
- **`ActorConfig` type** — actors in `sheet-db.config.ts` now use `{ role: string; sheetIdEnv: string }` objects, mapping each actor role to its sheet ID environment variable.
- **`SchemaMismatchBehaviour` type** — exported union `'warn' | 'error' | 'auto-sync'`.
- **Multi-actor `.env` scaffolding** — `sheet-db init` generates a `DEV_<ROLE>_SHEET_ID=` line for every non-admin actor.
- **Per-actor status table in `sync`** — `sheet-db sync` iterates all configured actors and prints: Actor | Sheet ID | Tables | Status. Actors without a sheet ID env var are skipped with a warning (non-fatal).
- **`actor_sheet_id` column on admin `users` table** — included in the schema scaffolded by `sheet-db init`.
- **`schema_versions` schema file** — `sheet-db init` now also writes `schemas/admin/schema_versions.ts`.
- **`onSchemaMismatch: 'warn'`** — included as a commented default in the config scaffolded by `sheet-db init`.

#### Primary Key & Foreign Key (Q pre-existing — shipped in 0.1.8)
- `primary()` column modifier — auto-generates a nanoid on `create()` for string PKs; strips PK silently on `update()`.
- `ref('table.column')` — FK validation on `create()` and `update()`; skip via `{ skipFKValidation: true }`.
- Circular reference detection at `registerSchema()` time.
- `sheet-db export --prisma` / `--sql` — generates `schema.prisma` and SQL DDL from registered schemas.

### Changed
- **`SheetDBConfig.actors`** type changed from `string[]` to `ActorConfig[]`. CLI commands normalize both shapes at runtime for backward compatibility.
- **`sync` command** resolves each actor's sheet ID from its `sheetIdEnv` field rather than hardcoding `ADMIN_SHEET_ID`.
- **`CRUDOperations` constructor** — accepts an optional fifth argument `preFlight?: Promise<void>` that each async method awaits before executing. Internal change; no API surface change for callers.

---

## [0.1.5] - 2026-03-09

### Added
- Download count badge in `README.md`

### Changed
- Updated `LICENSE` copyright year to 2026

---

## [0.1.0] - 2026-03-09

### Added
- Initial public release of `longcelot-sheet-db`
- `defineTable()` schema DSL with fluent column builders (`string()`, `number()`, `boolean()`, `date()`, `json()`)
- Column modifiers: `required`, `unique`, `default`, `min`, `max`, `enum`, `pattern`, `readonly`, `primary`, `ref`, `index`
- Auto-generated fields: `_id` (nanoid), `_created_at`, `_updated_at`, `_deleted_at`
- `SheetAdapter` — main adapter with actor-based sheet routing and permission enforcement
- `SheetClient` — low-level Google Sheets API wrapper
- `CRUDOperations` — `create`, `findMany`, `findOne`, `update`, `delete` with where/orderBy/limit/offset
- Uniqueness constraint enforcement via `checkUniqueness()` in `create()` and `update()`
- Soft delete support via `_deleted_at` column
- `OAuthManager` — full Google OAuth2 flow (auth URL, token exchange, refresh, verify)
- Password utilities: `hashPassword()`, `comparePassword()`, `validatePasswordStrength()` (bcrypt)
- CLI binary `sheet-db` with commands:
  - `init` — interactive project scaffolding
  - `generate` — interactive schema builder
  - `validate` — schema validation
  - `sync` — sync schemas to Google Sheets with OAuth token storage/refresh
  - `seed` — load initial/test data into sheets
  - `doctor` — diagnostics and environment health checks
  - `status` — show tables, actors, and sheet IDs
- Custom error classes: `ValidationError`, `PermissionError`, `SchemaError`
- Structured logger (`src/utils/logger.ts`) using chalk
- Environment variable validator (`src/utils/env.ts`)
- Jest test suite — 28 tests passing (unit + integration with `MockSheetClient`)
- CI/CD pipeline via `.github/workflows/ci.yml` (Node 18 & 20, build + test + lint)
- `SECURITY.md` — vulnerability reporting policy
- `CONTRIBUTING.md` — contribution guide
- `LICENSE` — MIT

### Changed
- `dist/` removed from version control and added to `.gitignore`
- `package.json` updated with `files`, `repository`, `engines`, `publishConfig` for npm publish readiness

---

[Unreleased]: https://github.com/vannseavlong/longcelot-sheet-staging/compare/v0.1.5...HEAD
[0.1.5]: https://github.com/vannseavlong/longcelot-sheet-staging/compare/v0.1.0...v0.1.5
[0.1.0]: https://github.com/vannseavlong/longcelot-sheet-staging/releases/tag/v0.1.0
