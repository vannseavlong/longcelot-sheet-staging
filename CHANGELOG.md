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

## [Unreleased] — Phase 9 (CLI naming, docs alignment, actor/role API)

### Added

- **`sheet-db export-data`** — new CLI command replacing `sheet-db migrate`. Generates an `export-data.js` script that reads row data from Google Sheets and stubs an `insertRow()` call for the target DB. Keeps full backward compatibility: `sheet-db migrate` still works but emits a deprecation warning.
- **`sheet-db export-data --all-users`** — extends data export to cover every registered user sheet. Reads all `actor_sheet_id` values from the admin `users` table and generates a per-user loop in the script, with `userId` passed to `insertRow` for correct FK association in the target DB.
- **`sheet-db export-data --dry-run`** — previews what would be exported without writing any files.
- **`UserContext.actor`** — new preferred field on `UserContext` for the actor/data-domain identifier. Replaces the misleadingly named `role` field.

### Changed

- **`UserContext.role` is deprecated** — the `role` field conflates the package's data-domain concept (which Google Sheet / schemas to use) with application-level RBAC roles (what a user is allowed to do). Renamed to `actor`. Both fields are accepted; passing only `role` emits a `console.warn` deprecation notice and still works. Update call sites to `withContext({ actor: '...' })`.
- **All internal `withContext` call sites** updated to `actor:` in CLI commands (`seed`, `sync`, `mock-users`) and adapter helper (`asActor`).
- **README — Migration Path section** rewritten: removed "coming soon" labels, added "Which export command do I need?" decision table, added "Actors vs Application Roles" comparison table, added "Dev vs Production data model" note.
- **API.md** — `withContext()` and all cross-actor examples updated to `actor:`, `UserContext` type updated, `sheet-db migrate` section replaced with `sheet-db export-data`, migration scenarios table added.

### Deprecated

- **`sheet-db migrate`** — renamed to `sheet-db export-data`. The alias is kept and will be removed in a future minor release. Update your scripts and CI pipelines.
- **`UserContext.role`** — use `actor` instead. Will be removed in a future minor release.

---

## [Unreleased] — Phase 10 (actor config naming, sheet formatting & UX)

### Added

- **`ActorConfig.name`** — new preferred field on actor entries in `sheet-db.config.ts` for the actor identifier. Replaces the misleadingly named `role` field, which read as an RBAC role assignment at the point of writing config (`{ role: 'operation' }` looks identical to an RBAC role, even after reading the docs). A shared `resolveActorName()` helper normalises `name`/`role`/bare-string actor entries across all CLI commands.
- **`UserContext.targetActor`** — new preferred field for the cross-actor target, replacing `targetRole`. Closes out the part of Phase 9.5's actor/role rename that didn't extend to the cross-actor fields.
- **Automatic sheet formatting** — `syncSchema()` / `createUserSheet()` now format every tab whenever headers are written (new tab or appended columns): auto-fit column widths (`autoResizeDimensions`), a header row fill color, a frozen header row, and `BOOLEAN`/`ONE_OF_LIST` data validation dropdowns for `boolean()`/`enum()` columns. No config required; no formatting calls when nothing changed.
- **`sheetStyle` config option** on `createSheetAdapter()` — `{ headerColor?, freezeHeader?, freezeFirstColumn? }`. Overrides the built-in header color (`#E8F0FE`) and freeze defaults (`freezeHeader: true`, `freezeFirstColumn: false`).
- **`SheetClient.formatSheet()`** (new method, exported types `ColumnValidationRule` / `SheetFormattingOptions`) — builds the batched `repeatCell` / `updateSheetProperties` / `autoResizeDimensions` / `setDataValidation` requests in a single `batchUpdate` call.

### Changed

- **`ActorConfig.role` is deprecated** — use `name` instead. Both fields are accepted; passing only `role` emits a `console.warn` deprecation notice and still works.
- **`UserContext.targetRole` is deprecated** — use `targetActor` instead. Both fields are accepted; passing only `targetRole` emits a `console.warn` deprecation notice and still works. `asActor()`'s first parameter is renamed `targetActor` (positional — no call-site changes needed).
- **CLI commands** (`init`, `sync`, `mock-users`, `seed`, `generate`, `status`, `validate`, `export`, `export-data`) updated to read `name` (falling back to deprecated `role`) from actor config entries.
- **README / API.md / Docs/developerGuide.md / skills (`core`, `cli`, `permissions`)** — actor config examples and cross-actor examples updated to `name:`/`targetActor:`; new "Sheet Formatting" sections documenting `sheetStyle`.

### Deprecated

- **`ActorConfig.role`** — use `name` instead. Will be removed in a future minor release.
- **`UserContext.targetRole`** — use `targetActor` instead. Will be removed in a future minor release.

---

## [0.1.19] — 2026-06-19

### Added

#### Adapter — Drive Architecture

- **`driveFolder` config option** — pass `{ root: string; subfolders?: Record<string, string> }` to `createSheetAdapter` to organise all created spreadsheets under a named folder hierarchy in Google Drive. Root folder and per-role subfolders are created automatically on first use and cached. Works with both My Drive and Shared Drives.
- **`sharedDriveId` config option** — when set, all Drive file-creation and folder-lookup calls pass `supportsAllDrives: true` and target the specified Shared Drive. Enables Google Workspace teams to centralise all staging sheets in a managed Shared Drive.
- **`tokenStore` config option** — accepts a `TokenStore` (`get(actorId)` / `set(actorId, tokens)`) so per-actor OAuth tokens can be persisted externally (Redis, DB, file). The adapter calls `tokenStore.get(userId)` in `createUserSheet` when `actorTokens` is not passed directly, enabling actor-owned sheet creation without surfacing tokens at every call site.
- **`storage` config option** — accepts any `StorageAdapter` implementation for file upload. Pass `new DriveStorageAdapter()` (built-in) or a custom provider (S3, GCS, Cloudinary). The adapter's own `SheetClient` is injected into `DriveStorageAdapter` automatically — no credential repetition required.
- **`DriveStorageAdapter` class** (exported) — built-in file upload via Google Drive. Resolves nested folder paths (`uploads/products`) on demand, caches folder IDs, and optionally sets `anyone / reader` permission for public access.
- **`adapter.upload(file, options)`** — delegates to the configured `StorageAdapter`. Returns a public URL (e.g. `https://drive.google.com/uc?id=...` for Drive). Throws `SchemaError` if no storage adapter is configured.
- **`adapter.deleteFile(url)`** — delegates delete to the configured `StorageAdapter`. `DriveStorageAdapter` extracts the Drive file ID from the URL and calls `drive.files.delete`.

#### Adapter — Actor-owned sheets

- **`createUserSheet` now accepts actor OAuth tokens** — when `actorTokens` are provided (or resolved via `tokenStore`), the spreadsheet is created in the **actor's own Google Drive** using their OAuth client. The actor client then shares the sheet with the admin email. This removes the admin's storage quota burden and eliminates the single-token dependency. Falls back to admin-client creation when no actor tokens are present (backward compatible).

#### New exported types

- `OAuthTokens` — shape of a Google OAuth token set (`access_token`, `refresh_token`, `expiry_date`, …)
- `TokenStore` — interface for per-actor token persistence
- `DriveFolderConfig` — shape of the `driveFolder` config option
- `UploadOptions` — `{ filename, mimeType, folder?, public? }` passed to `adapter.upload()`
- `StorageAdapter` — two-method interface (`upload`, `delete`) for pluggable file storage
- `CreateUserSheetOptions` — options object for `createUserSheet` (`actorTokens?`, `extraFields?`)

### Changed

- **`createUserSheet` 4th parameter** — previously `extraFields?: Record<string, unknown>` (positional). Now `options?: CreateUserSheetOptions`. **Migration:** wrap existing `extraFields` usage inside the options object: `{ extraFields: { ... } }`.
- **`SheetClient.createSpreadsheet`** — internally switched from `sheets.spreadsheets.create` to `drive.files.create` (same result; enables `parents` placement and Shared Drive support). No change for callers.
- **`SheetClient.shareWithUser`** — now uses the already-initialised `this.drive` instance instead of creating a new `google.drive` call per invocation.

### Added (internal)

- `SheetClient.findOrCreateFolder(name, parentId?, sharedDriveId?)` — Drive folder lookup with create-on-miss.
- `SheetClient.uploadFile(buffer, filename, mimeType, folderId?, makePublic?)` — multipart Drive upload.
- `SheetClient.deleteFile(fileId)` — Drive file deletion.

---

## [0.1.18] — 2026-06-16

### Fixed

#### CLI — `mock-users`
- **`sheet-db mock-users` no longer throws `PermissionError` unconditionally.** The command was calling `adapter.createUserSheet()` on the raw (context-less) adapter. `hasPermission()` returns `false` when `this.context` is `undefined`, so every run failed with 0 users created. Fixed by constructing an admin context (`role: 'admin'`) before the user creation loop and routing all `createUserSheet` calls through it.
- **`schemasDir` config option is now applied in `mock-users`.** Schema files were always loaded from the hard-coded path `process.cwd()/schemas/{role}` regardless of what `schemasDir` was set to in `sheet-db.config.ts`. Fixed in line with the same change made to `sync`.

#### Adapter — `createUserSheet`
- **`createUserSheet` now accepts an optional `extraFields` parameter.** Previously the method hard-coded exactly five fields into the `users` table row (`user_id`, `role`, `email`, `actor_sheet_id`, `created_at`). Projects with additional required columns on `users` received a `ValidationError` or permanently empty cells. The new signature is:
  ```ts
  createUserSheet(userId, role, email, extraFields?: Record<string, unknown>)
  ```
  `extraFields` is spread after the base fields, so callers can supply any extra schema columns without overwriting the core ones.

#### CLI — `sync`
- **`schemasDir` config option is now applied in `sync`.** `loadSchemasForActor` was hard-coded to `process.cwd()/schemas/{role}`. Projects with a custom `schemasDir` in `sheet-db.config.ts` always got "No schemas found." Fixed: the schemas root is now derived from `config.schemasDir` when set, with `path.resolve` so both relative and absolute paths work. Fallback is unchanged (`schemas/`).

#### Types
- Added `schemasDir?: string` to `SheetDBConfig` interface in `src/schema/types.ts`.

---

## [0.1.16] — 2026-06-02

### Added

#### Auth — Google Sign-In & Express route helpers
- **`createLoginOAuthManager(config)`** — new factory pre-configured with `openid email profile` scopes alongside Sheets scopes. Produces an `id_token` so `verifyToken()` works for user-facing Google Sign-In. `createOAuthManager` is unchanged (Sheets-only, no `id_token`).
- **`getAuthUrl(scopes?)`** — now accepts an optional `scopes` override on both managers.
- **`createAuthRouter(options)`** — Express-compatible middleware that wires `GET /auth/google` and `GET /auth/callback` automatically. Signs an HS256 JWT (Node built-in `crypto`, no extra dep) and redirects to `frontendUrl?token=...`. Options: `adapter`, `jwtSecret`, `frontendUrl`, `onUser`, `registrationPolicy`, `oauthConfig`, `basePath`.
- **`registrationPolicy`** on `createAuthRouter` — `'open'` (default, any Google user can get in) or `'login-only'` (user must already exist in your users table; `onUser` returning `null` sends a `401`). Solves the common pattern of admin/manager portals that block self-registration.
- Exported types: `AuthRouterOptions`, `AuthRouter`, `GoogleProfile`, `RegistrationPolicy`.

#### CRUD — new operations
- **`table.upsert({ where, data })`** — insert-or-update: calls `findOne` first; updates if found, creates if not. Exported `UpsertOptions` type.
- **`table.createMany(rows[])`** — batch insert. All rows validated individually then written in a single `values.append` API call (one round-trip regardless of row count). `SheetClient.appendRows()` added internally.
- **`table.count({ where? })`** — returns the number of matching rows without loading full row objects.

#### CLI — new flags
- **`seed <file> --skip-existing`** — skip rows where a unique column already matches; no error on re-seed (idempotent).
- **`seed <file> --upsert`** — update existing rows on unique conflict instead of throwing.
- **`seed <file>` dynamic format** — seed file may now `export default async function(env: NodeJS.ProcessEnv)` returning the seed object. Plain object export is still supported.
- **`sync --token-file <path>`** — load a pre-stored tokens JSON file instead of the interactive browser OAuth prompt; enables unattended CI/CD pipelines.

#### Skills / docs
- Added three new skill files: `skills/permissions/SKILL.md`, `skills/migrations/SKILL.md`, `skills/auth-router/SKILL.md`.
- Updated all five existing skills to v0.1.15 with accurate API descriptions.
- Updated `_artifacts/skill_tree.yaml`, `domain_map.yaml`, `skill_spec.md`.
- Updated `README.md`, `Docs/developerGuide.md` with new API sections and examples.
- Added `DEVELOPER_REPLY.md` — response to bEasy developer feedback.

### Changed
- `OAuthManager` constructor now accepts a `defaultScopes` parameter; `getAuthUrl` falls back to instance default scopes if none passed.
- Seed command now returns per-table stats (inserted / upserted / skipped / failed) instead of a single inserted/failed counter.
- `seed --all-actors` output label updated to "inserted/updated" to reflect upsert paths.

---

## [0.1.15] — 2026-05-26

> Internal release — version bump only, no functional changes over 0.1.14.

---

## [0.1.14] — 2026-05-26

> Internal release — version bump only, no functional changes over 0.1.13.

---

## [0.1.13] — 2026-05-26

### Added

#### Phase 5: CLI Completeness
- **`sheet-db migrate`** — generates a `migrate.js` script that reads every table from Google Sheets and calls a stub `insertRow()`. Replace the stub with your Prisma/Sequelize/MySQL client to move data to production. Supports `--table <name>` (single table), `--output <dir>`, and `--dry-run` (preview plan without writing files).
- **`sheet-db init --integrate`** — integrates into an existing project without overwriting `sheet-db.config.ts` or `.env`; appends missing Google OAuth vars to `.env` if needed.
- **`sheet-db mock-users [count]`** — creates mock Google Sheets for development (default: 3); rotates through configured non-admin actor roles.
- **`sheet-db seed <file> --all-actors`** — distributes seed records to every user's actor sheet by reading `actor_sheet_id` from the admin `users` table.
- **`sheet-db export --prisma / --sql`** — generates `schema.prisma` or SQL DDL from registered schemas; supports `--output <dir>`.
- **`sheet-db sync --all-users [--dry-run]`** — pushes schema changes to all registered user sheets; uses schema hash comparison to skip up-to-date sheets; exponential backoff on rate-limit errors.

#### TypeScript Strictness
- Replaced all `any` usages in production source with `unknown` or concrete types across: `crud.ts`, `sheetClient.ts`, `oauth.ts`, `generate.ts`, `seed.ts`, `mock-users.ts`, `status.ts`, `validate.ts`, `types.ts`, `columnBuilder.ts`.
- `ColumnDefinition.default` is now `string | number | boolean | null` (was `any`).
- `ColumnDefinition.enum` is now `(string | number | boolean)[]` (was `any[]`).
- `WhereClause` is now `Record<string, unknown>` (was `Record<string, any>`).
- `UpdateOptions.data` is now `Record<string, unknown>` (was `Record<string, any>`).
- CRUD method signatures updated to `Record<string, unknown>` throughout.

### Changed
- `CRUDOperations.create` / `findMany` / `findOne` return `Record<string, unknown>` instead of `Record<string, any>`.
- Boolean deserialization in `crud.ts` now checks `value === 'TRUE'` only (removed unreachable `|| value === true` branch after `sheetClient` was typed to return `string[][]`).

### Fixed
- `OAuth2Client.setCredentials` now correctly receives a `Credentials`-typed cast instead of raw `unknown`.

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
