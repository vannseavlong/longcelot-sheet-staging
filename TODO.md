# Roadmap & Release Plan

> Architectural Q&A and design rationale live in [FAQ.md](./FAQ.md).

---

## Phase 1: Core Correctness (PK & FK Modifiers)

- [x] Add `pkColumn` field to `TableSchema` after `defineTable()` validates only one `primary()` exists
- [x] `CRUDOperations.create()`: auto-generate nanoid for string `pkColumn` if not supplied
- [x] `CRUDOperations.update()`: strip `pkColumn` from data silently (readonly)
- [x] Add `resolveForeignKeys()` helper in `SheetAdapter`
- [x] Call `resolveForeignKeys()` at start of `create()` and `update()` unless `skipFKValidation` is set
- [x] Update export command to emit `@id` + `@relation` (Prisma) and `PRIMARY KEY` + `FOREIGN KEY` (SQL)
- [x] Tests: PK auto-gen, PK readonly on update, FK pass, FK fail, `skipFKValidation`, circular ref

---

## Phase 2: Developer Experience & Integration

### Multi-actor config & env scaffolding

- [x] Update actors config shape in `sheet-db.config.ts` DSL
- [x] `init`: scaffold `DEV_*_SHEET_ID` per non-admin actor
- [x] `sync`: iterate all actors and print per-actor status table
- [x] Ensure admin `users` table schema includes `actor_sheet_id` column

### CLI for development & test data

- [x] Implement `sheet-db mock-users` — generate dummy actor Google Sheets for testing
- [x] `sheet-db seed --all-actors` — distribute seed data across all actor types
- [x] `sheet-db sync --all-users` — push schema changes to all registered user sheets

### Schema version tracking

- [x] Schema hash computation utility
- [x] `schema_versions` admin table scaffolded by `init`
- [x] Mismatch detection in `withContext()`
- [x] `onSchemaMismatch` config option (`'warn'` | `'error'` | `'auto-sync'`)
- [x] `sync --all-users` with exponential backoff for rate limits
- [x] `--dry-run` flag for `sync --all-users`
- [x] Tests: mismatch detection, auto-sync trigger, bulk sync

### General

- [x] `init --integrate` — merge into existing project without overwriting files
- [ ] Better developer documentation for OAuth flow (lower priority)

---

## Phase 3: Schema Syncing & Migrations

- [x] `sheet-db export --prisma` — export schemas to `schema.prisma`
- [x] `sheet-db export --sql` — export schemas to SQL DDL `CREATE TABLE` statements
- [x] Migration guide documentation
- [x] Tests: mismatch detection, auto-sync trigger, bulk sync

---

## Phase 4: Cross-Actor CRUD Operations

- [x] Add `ActorPermission` interface and `permissions` field to `SheetAdapterConfig`
- [x] Add `targetRole` and `targetSheetId` to `UserContext` type
- [x] Update `hasPermission()` to check permission matrix for cross-actor access
- [x] Update `resolveSpreadsheetId()` to use `targetSheetId` when cross-actor
- [x] Validate: ensure `targetSheetId` is provided when cross-actor
- [x] Validate: throw clear error when table not in allowed list
- [x] Update TypeScript types in `src/schema/types.ts`
- [x] Add `asActor()` helper method
- [x] Tests: same actor, cross-actor with permission (CRUD), cross-actor without permission, wrong table, admin bypass
- [x] Document use cases in `Docs/developerGuide.md`
- [ ] `adapter.join()` — query across multiple actor sheets (future)
- [ ] Permission matrix validation and improved error messages

---

## Phase 5: Additional CLI Enhancements

- [x] `init --integrate`
- [x] `mock-users`
- [x] `sync --all-users`
- [x] `export --prisma` / `--sql`
- [x] `export-data` (renamed from `migrate`)

---

## Phase 6: Developer-Reported Improvements (bEasy feedback)

### 6.1 OAuth — Identity Scopes & User Login

- [x] Document `getAuthUrl()` optional `scopes[]` parameter
- [x] Add `createLoginOAuthManager()` — pre-configured with `openid email profile` + Sheets scopes

### 6.2 Auth Route Helpers

- [x] Export `createAuthRouter(options)` — wires `GET /auth/google` and `GET /auth/callback`
- [x] Accept `onUser` callback for user lookup / shape control
- [x] `registrationPolicy` option: `'login-only'` vs `'open'`
- [ ] NestJS guard / middleware variant (future)

### 6.3 Seed Duplicate Handling

- [x] `--skip-existing` flag
- [x] `--upsert` flag
- [x] Dynamic seed file — accept `export default async function(env)`

### 6.4 `upsert()` CRUD method

- [x] `table.upsert({ where, data })` — insert if not found, update if exists
- [x] Export `UpsertOptions` type

### 6.5 `createMany()` Bulk Insert

- [x] `table.createMany(rows[])` — batch into a single `values.append` call
- [x] Returns array of created records with auto-generated `_id`s

### 6.6 `count()` Aggregate

- [x] `table.count({ where? })` — return number of matching rows efficiently

### 6.7 Dynamic Seed File Format

- [x] Accept `export default async function(env: NodeJS.ProcessEnv)` as seed file export
- [x] Fall back to plain object export for backward compatibility

### 6.8 CI-Friendly Sync

- [x] `--token-file <path>` flag — inject pre-stored tokens file, skip interactive OAuth prompt
- [ ] Document service account alternative (future)

### 6.9 Role-Differentiated Auth

- [x] `registrationPolicy`: `'open'` | `'login-only'`
- [ ] `'invite-only'` policy (future)

---

## Phase 7: Bug Fixes

### 7.1 `sync` does not add new columns to existing tables (Critical) — Fixed

- [x] Fix `syncSchema()` to diff row-1 headers and append missing columns
- [x] Tests: new tab (all headers written), existing tab no changes (no-op), existing tab missing columns (appended), data rows preserved

### 7.2 `mock-users` throws `PermissionError` unconditionally (Critical) — Fixed

- [x] Fix `mock-users.ts`: call `createUserSheet` on an admin-context adapter

### 7.3 `createUserSheet` inserts incomplete row (High) — Fixed

- [x] Add `extraFields?: Record<string, unknown>` param to `createUserSheet` and merge into `create()` call

### 7.4 `schemasDir` config option never applied (High) — Fixed

- [x] Add `schemasDir?: string` to `SheetDBConfig` in `types.ts`
- [x] Update `loadSchemasForActor` in `sync.ts` to use `schemasDir`
- [x] Apply same fix to schema-load loop in `mock-users.ts`

---

## Phase 8: Drive Architecture & File Upload

### 8.1 Actor-owned sheets (sheets live in actor's Drive, not admin's)

- [x] Define `OAuthTokens` interface in `types.ts`
- [x] Define `CreateUserSheetOptions` interface (`actorTokens?`, `extraFields?`) in `types.ts`
- [x] Add `credentials` field to `SheetAdapter`
- [x] Update `createUserSheet` 4th param to `options?: CreateUserSheetOptions`
- [x] When `actorTokens` provided: create `actorClient`, create sheet in actor's Drive
- [x] When no `actorTokens`: fall back to admin-client behaviour (backward compatible)
- [x] Tests: actor-owned sheet uses actor client, admin fallback, `extraFields` passed through

### 8.2 Drive folder organisation

- [x] Define `DriveFolderConfig` interface in `types.ts`
- [x] Add `driveFolder?: DriveFolderConfig` to `SheetAdapterConfig`
- [x] Add `findOrCreateFolder()` to `SheetClient`
- [x] Change `SheetClient.createSpreadsheet` to use Drive `files.create` with `parents`
- [x] Add `_folderCache: Map<string, string>` to `SheetAdapter`
- [x] Add `resolveFolderForRole()` helper
- [x] Call `resolveFolderForRole` in `createUserSheet` before creating the spreadsheet
- [x] `mock-users` and `sync` respect `driveFolder` when configured
- [x] Tests: folder created, cache used on subsequent calls, no folder when config omitted

### 8.3 Pluggable file upload — `StorageAdapter` + `DriveStorageAdapter`

- [x] Define `UploadOptions` interface in `types.ts`
- [x] Define `StorageAdapter` interface in `types.ts`
- [x] Add `uploadFile()` and `deleteFile()` to `SheetClient`
- [x] Create `src/adapter/driveStorageAdapter.ts`
- [x] `DriveStorageAdapter` exposes `_setClient()` for adapter injection
- [x] Add `storage?: StorageAdapter` to `SheetAdapterConfig`
- [x] Inject client into `DriveStorageAdapter` in `SheetAdapter` constructor
- [x] Add `adapter.upload()` and `adapter.deleteFile()`
- [x] Export `DriveStorageAdapter`, `StorageAdapter`, `UploadOptions` from `src/index.ts`
- [x] Tests: upload delegates, deleteFile delegates, throws when no storage configured

### 8.4 Per-actor token lifecycle — `TokenStore`

- [x] Define `TokenStore` interface in `types.ts`
- [x] Add `tokenStore?: TokenStore` to `SheetAdapterConfig`
- [x] In `createUserSheet`: call `await tokenStore.get(userId)` as fallback when no `actorTokens`
- [x] Export `TokenStore` and `OAuthTokens` from `src/index.ts`
- [x] Tests: `tokenStore.get` called when no `actorTokens`, `actorTokens` takes priority

### 8.5 Shared Drive (Google Workspace) support

- [x] Add `sharedDriveId?: string` to `SheetAdapterConfig`
- [x] Pass `sharedDriveId` to `createSpreadsheet` and `findOrCreateFolder`
- [x] Tests: `sharedDriveId` passed through to client `createSpreadsheet` call

---

## Phase 9: CLI Naming, Docs Alignment & Dev/Prod Parity

### 9.1 Rename `migrate` → `export-data`

- [x] Rename command file to `export-data.ts`
- [x] Update CLI entry to register `export-data`
- [x] Keep `migrate` as deprecated alias with warning
- [x] Update README.md migration section
- [x] Tests: renamed command runs, deprecated alias emits warning
- [x] Update API.md command reference section (superseded/completed by Phase 13's `export`/`export-data` → `migrate`/`migrate-data` rename — see below)
- [x] Update CHANGELOG.md with breaking change note (see Phase 13)

### 9.2 README and API.md contradiction on `export --prisma/--sql`

- [x] Remove "coming soon" markers from README.md for implemented commands
- [x] Audit API.md — confirm CLI examples match actual CLI behaviour (re-audited as part of Phase 13's rename)
- [ ] Add single source-of-truth note in README.md pointing to API.md
- [ ] Mark genuinely unimplemented flags as `[planned]` consistently in both files

### 9.3 Schema-only vs schema+data export guidance

- [x] Add "Which export command do I need?" decision table to README.md
- [x] Mirror decision table in API.md under a "Migration scenarios" section

### 9.4 `export-data --all-users`

- [x] Add `--all-users` flag to `export-data`
- [x] Read all rows from admin `users` table to collect `actor_sheet_id` values
- [x] For each actor sheet, read all registered tables and collect rows
- [x] Generated script annotates rows with `user_id` FK
- [x] `--dry-run`: print summary without writing the script
- [x] Tests: admin-only export, all-users export, dry-run output
- [ ] Handle Google Sheets API rate limits with exponential backoff in generated script

### 9.5 Actor vs Role rename

- [x] Rename `withContext({ role })` → `withContext({ actor })` with backward-compatible alias + deprecation warning
- [x] Update all internal references `context.role` → `context.actor`
- [x] Add "Actors vs Application Roles" section to README.md
- [x] Update all `withContext` examples in README to use `actor:`
- [x] Tests: both `actor` and deprecated `role` field work; deprecation warning logged
- [ ] Add same "Actors vs Application Roles" section to `Docs/architecture.md`
- [ ] Update API.md `UserContext` type definition to reflect rename

### 9.6 Dev/prod parity gap documentation

- [x] Add "Dev vs Production data model" section to README.md
- [ ] In `mock-users` output, print note about dev vs prod sheet topology
- [ ] (Optional) `--multi-sheet` flag for `mock-users` — create N separate actor sheets to simulate production

---

## Summary

### Completed ✅

- PK auto-generation (nanoid) and readonly enforcement on update
- FK validation via `ref()` with `skipFKValidation` option
- `migrate --prisma` and `migrate --sql` (renamed from `export`, Phase 13)
- `sheet-db mock-users` CLI
- `seed --all-actors`, `seed --skip-existing`, `seed --upsert`, dynamic seed file format
- `init --integrate`
- Multi-actor `.env` scaffolding and `sync` per-actor status table
- `sync --all-users` with exponential backoff and `--dry-run`
- Schema version hash tracking and `onSchemaMismatch` config
- Cross-actor CRUD with permission matrix and `asActor()` helper
- `createAuthRouter` with `registrationPolicy` and `onUser` callback
- `createLoginOAuthManager`
- `upsert()`, `createMany()`, `count()`
- `sync --token-file` for CI/CD
- `syncSchema()` additive column diff fix
- `mock-users` PermissionError fix
- `createUserSheet` with `extraFields`, actor-owned sheet, `TokenStore`, `DriveFolderConfig`, `sharedDriveId`
- `DriveStorageAdapter` + `StorageAdapter` interface + `adapter.upload()` / `adapter.deleteFile()`
- `migrate-data` (renamed from `export-data`, itself renamed from `migrate`, Phase 13) with `--all-users` and `--dry-run`
- `migrate-data --table` accepts a comma-separated list of table names (partial migration, e.g. `--table users,credentials,setup`), shared by both the script-generation path and `--run` via `filterSchemasByTable()`
- `withContext({ actor })` rename with `role` deprecation alias
- `ActorConfig.role` → `name`, `UserContext.targetRole` → `targetActor` (both with deprecation aliases)
- Automatic sheet formatting: auto-fit columns, header fill/freeze, boolean/enum data validation dropdowns, `sheetStyle` config
- `lsdb drop-table` / `lsdb drop-column` / `lsdb rename-column` — interactive or scripted, `--all-users`-aware, `rename-column` preserves data via in-place header edit (Phase 13)
- `DatabaseAdapter` / `TableOperations` / `StorageClient` formal adapter contract in `src/adapter/types.ts`, `SheetAdapter`/`CRUDOperations`/`SheetClient` now implement them explicitly (Phase 16.1)

### To Do ⏳

- **Production backend portability (Phase 16, 16.1 done)** — the `DatabaseAdapter`/`TableOperations`/`StorageClient` contract now exists (`src/adapter/types.ts`), but no runtime SQL adapter implements it yet; today's `migrate`/`migrate-data` are still one-time export tools, not a drop-in replacement for `createSheetAdapter`
- `adapter.join()` — cross-actor join queries (medium priority)
- `Docs/architecture.md`: Actors vs Application Roles section
- `mock-users` output: dev vs prod topology note
- NestJS auth guard variant (future)
- `'invite-only'` registration policy (future)
- Service account alternative for sync (future)
- Column encryption, audit logs, row-level permissions (lower priority)
- `values.batchGet` batching across tables read within one request handler (medium priority — see Phase 12 follow-ups)
- Optional write-side rate limiter for bulk `create()`/`update()` loops (lower priority)

---

## Phase 10: Developer-Reported Improvements (2026-06-25 feedback)

### 10.1 Actor Config Field Naming — closes out 9.5

- [x] `ActorConfig.role` → `name` (`sheet-db.config.ts` actor entries), `role` kept as deprecated alias with `console.warn`
- [x] `UserContext.targetRole` → `targetActor`, `targetRole` kept as deprecated alias with `console.warn`
- [x] Add shared `resolveActorName()` helper to dedupe the `name ?? role` fallback used across CLI commands
- [x] Update `init` scaffold to write `name:` in generated `sheet-db.config.ts`
- [x] Update `sync`, `mock-users`, `seed`, `generate`, `status`, `validate`, `export`, `export-data` to read `name` with `role` fallback
- [x] `asActor()` internal parameter renamed `targetActor` for consistency (no signature break — positional arg)
- [x] Tests: `name` preferred, deprecated `role`/`targetRole` aliases still work and warn, `asActor()` cross-actor flow unaffected
- [x] Docs: README.md, API.md, Docs/developerGuide.md, skills/core, skills/cli, skills/permissions updated to `name:` / `targetActor`

### 10.2 Sheet Formatting & UX

- [x] Auto-fit column width via `autoResizeDimensions` after every header write (new tab or appended columns)
- [x] Header row background fill (`repeatCell`) with built-in default color, overridable via `sheetStyle.headerColor`
- [x] Freeze header row by default (`sheetStyle.freezeHeader`, default `true`) and optional first column (`sheetStyle.freezeFirstColumn`, default `false`)
- [x] Data validation dropdowns for `boolean()` (`BOOLEAN` rule) and `string().enum([...])` (`ONE_OF_LIST` rule) columns, applied alongside header formatting
- [x] Wire `sheetStyle?: SheetStyleConfig` into `SheetAdapterConfig`
- [x] Tests: header fill applied, freeze applied, auto-resize requested, boolean/enum validation rules generated correctly, no formatting calls when nothing changed
- [x] Docs: README.md / API.md `sheetStyle` config section, FAQ.md #10

---

## Phase 11: Bug Fixes (developer-reported, `longcelot-sheet-db@0.1.22`) — Fixed

### 11.1 Boolean/enum validation leaks ~1000 phantom rows into every read (Critical) — Fixed

- [x] Bound `setDataValidation` range in `formatSheet()` to actual data rows instead of leaving `endRowIndex` unbounded
- [x] Defend the read path: `findMany()`/`update()`/`count()`/`delete()` filter out rows with an empty/null `_id` before returning, regardless of cause
- [x] Loosen `ColumnBuilder.default()`'s type to accept structured values for `json()` columns (was `string | number | boolean | null` only)
- [x] Tests: validation range bounded to real data + buffer, phantom null-`_id` rows filtered out, `json().default([])` type-checks and applies at runtime

### 11.2 `update()` silently resets defaulted columns omitted from the patch body (Critical) — Fixed

- [x] `validateAndApplyDefaults()`: only apply `column.default` when `mode === 'create'`; a field missing on `update()` means "leave it alone"
- [x] Tests: partial update preserves a non-default value on a defaulted column that's omitted from the patch

### 11.3 `findMany()`/`findOne()` don't honor soft-delete, contradicting the docs (High) — Fixed

- [x] `findMany()` excludes rows with a populated `_deleted_at` by default when `schema.softDelete` is true
- [x] `count()` excludes soft-deleted rows by default too, matching the documented behavior in `skills/crud/SKILL.md`
- [x] Add `includeDeleted?: boolean` to `FindOptions` as an explicit opt-in to see soft-deleted rows
- [x] Tests: soft-deleted row excluded by default from `findMany()`/`findOne()`/`count()`, included with `includeDeleted: true`

### 11.4 Follow-up to 11.1 — validation buffer doesn't grow past 200 rows on its own (Medium) — Fixed

- [x] `SheetClient.appendRow()` now returns the 1-based row number it wrote to (parsed from the Sheets API's `updates.updatedRange`, no extra read)
- [x] `SheetClient.extendValidation()` — re-applies boolean/enum validation bounded to `dataRowCount + VALIDATION_ROW_BUFFER`, without touching header color/freeze/auto-resize
- [x] `CRUDOperations.create()` calls `extendValidation()` every `VALIDATION_CHECK_INTERVAL` (100, half the 200-row buffer) rows, only when the schema actually has boolean/enum columns
- [x] Extracted shared `buildValidationRules()` into `src/utils/validationRules.ts` (was duplicated between `SheetAdapter` and now `CRUDOperations`)
- [x] Scoped to `create()` only — `createMany()`/bulk seeding still relies on a manual `sheet-db sync` afterward, consistent with existing seed-data guidance
- [x] Tests: no-op below the check interval, extends exactly once at the interval boundary with correct `dataRowCount`, never fires for schemas without boolean/enum columns, `extendValidation()` request shape bounded correctly and isolated from header/freeze/auto-resize requests

### 11.5 Feature: `boolean()` renders as a configurable ONE_OF_LIST dropdown, not a native checkbox (closes root cause of 11.1 for boolean columns) — Fixed

- [x] `boolean()` columns now produce a `ONE_OF_LIST` validation rule (`['TRUE','FALSE']` or `['1','0']`) instead of the native `BOOLEAN` checkbox type — removed `ColumnValidationRule`'s `BOOLEAN` variant entirely (no longer produced anywhere)
- [x] `BooleanFormat = 'TRUE_FALSE' | '1_0'` type added; configurable both project-wide and per-column
- [x] `SheetStyleConfig.booleanFormat?: BooleanFormat` — project-wide default (falls back to `'TRUE_FALSE'`)
- [x] `boolean({ format })` — per-column override, takes priority over the project-wide default
- [x] `CRUDOperations` takes the resolved project-wide default as a 6th constructor arg (set by `SheetAdapter.table()` from `sheetStyle.booleanFormat`); `serializeValue()`/`deserializeRow()` resolve `column.booleanFormat ?? defaultBooleanFormat`
- [x] `deserializeRow()` accepts both `'TRUE'` and `'1'` as true regardless of configured format, for sheets with mixed write history across a format change
- [x] `computeSchemaHash()` includes `booleanFormat` so a per-column format change is detected as schema drift
- [x] Shipped as the new default for everyone (no opt-in) — existing checkboxes render as a dropdown on the next sync; already-written cell values (`'TRUE'`/`'FALSE'`) are unaffected
- [x] Tests: project-wide default applied, per-column override wins, mixed-format read compatibility, schema-sync builds `ONE_OF_LIST` for boolean() columns

---

## Phase 12: Bug Fixes (developer-reported, `longcelot-sheet-db@0.1.28`) — Fixed

### 12.1 `getAllRows()` had no caching, causing `429 RESOURCE_EXHAUSTED` under real concurrency (Critical) — Fixed

- [x] Add in-memory read cache to `SheetClient.getAllRows()`, keyed by `spreadsheetId::sheetName`, default 2s TTL, enabled by default
- [x] De-duplicate concurrent `getAllRows()` calls for the same tab into a single in-flight request
- [x] Invalidate the relevant tab's cache entry from every write path: `appendRow`, `appendRows`, `updateRow`, `deleteRow`, `writeHeader`
- [x] A failed read is never cached — next call retries against the API instead of replaying the error
- [x] Add `cache?: SheetReadCacheConfig` (`{ enabled?, ttlMs? }`) to `SheetAdapterConfig`, threaded to both the admin `SheetClient` and the actor-owned client created in `createUserSheet`
- [x] Expose `SheetClient.invalidateCache(spreadsheetId, sheetName)` for callers writing to a sheet outside the adapter
- [x] Tests: repeated reads cached, concurrent reads de-duplicated, per-tab isolation, TTL expiry refetches, `enabled: false` bypass, each write method invalidates, failed read doesn't poison cache
- [x] Docs: CLAUDE.md architecture note, API.md `SheetReadCacheConfig` + CRUD Operations caching note, FAQ.md #11 incident write-up, CHANGELOG.md, README.md

### Follow-ups not yet done

- [ ] Batch multiple table reads within a single request handler into one `spreadsheets.values.batchGet` call instead of N separate `getAllRows()` calls (the cache collapses *repeated* reads of the *same* tab, but a handler reading 3 different tables, like `loadCatalog()` in a typical RBAC router, still makes 3 API calls)
- [ ] Optional write-side rate limiter / token bucket for bulk `create()`/`update()` loops outside of `createMany()`, to smooth bursts the same way `sync --all-users`' exponential backoff does for schema syncing

---

## Phase 13: Schema Drop/Rename CLI + `migrate`/`migrate-data` rename (2026-07-08)

### 13.1 `lsdb drop-table` / `lsdb drop-column` / `lsdb rename-column`

- [x] `SheetClient.deleteSheet()` — strict sheetId lookup (throws instead of the `getSheetId()` `|| 0` fallback), invalidates cache
- [x] `SheetClient.deleteColumns()` — batches multiple `deleteDimension` requests sorted descending so indexes don't shift mid-batch
- [x] `SheetClient.updateHeaderCell()` — single-cell header overwrite (`columnIndexToA1Letter()` helper), used by rename to preserve existing row data instead of drop + re-add
- [x] `src/schema/reservedColumns.ts` — `RESERVED_COLUMN_NAMES`, shared by `defineTable.ts` and the new commands so they can't drift
- [x] `src/utils/schemaFileMutator.ts` — `removeColumnLine()`/`renameColumnKey()`, text-level schema file edits that return `ok:false` instead of guessing on anything they can't confirm is safe (e.g. a column definition spanning multiple lines)
- [x] `src/utils/suggest.ts` — Levenshtein-based `closestMatch()` for "did you mean" errors
- [x] `src/cli/lib/oauthFlow.ts`, `src/cli/lib/backoff.ts` — extracted from `sync.ts` (now 4 call sites: `sync`, `drop-table`, `drop-column`, `rename-column`)
- [x] `src/cli/lib/schemaLoader.ts`, `src/cli/lib/resolveTable.ts`, `src/cli/lib/adminAdapter.ts` — shared schema loading (with file paths), table-name resolution/disambiguation, and adapter/`--all-users` sheet-target setup
- [x] `lsdb drop-table [table-names...]` — interactive checkbox or positional args, `--all-users`/`--yes`/`--dry-run`/`--token-file`, warns on dangling `ref()`s, best-effort `schema_versions` cleanup
- [x] `lsdb drop-column [table-name] [column-names...]` — blocks dropping reserved columns and the primary key, resolves column position from the live header row (not schema file order)
- [x] `lsdb rename-column [table-name] [old-name] [new-name]` — renames the sheet header cell in place, updates `schema_versions` hash for touched sheets
- [x] Tests: `sheetClientDestructive`, `schemaFileMutator`, `suggest`, `resolveTable`

### 13.2 Rename `export`/`export-data` → `migrate`/`migrate-data`

- [x] Reclaim `migrate` for schema/DDL export (was a deprecated alias for row-data export pre-9.1 — that old alias is removed, not kept, since it would otherwise silently mean two different things)
- [x] `migrate-data` replaces `export-data` for row-data export; `export`/`export-data` become the new deprecated aliases (forward with a warning), matching the project's existing alias-on-rename convention
- [x] `src/cli/commands/migrate.ts` (was `export.ts`), `src/cli/commands/migrate-data.ts` (was `export-data.ts`) — `generatePrismaModel`/`generateSQLTable` keep their names; `generateExportDataScript` → `generateMigrateDataScript`
- [x] Tests: `tests/unit/export.test.ts` import path updated; `tests/unit/migrate.test.ts` → `tests/unit/migrate-data.test.ts`, covers both the renamed generator and the deprecated `export-data.ts` alias re-export
- [x] Docs: README.md, API.md, FAQ.md, skills/cli/SKILL.md, skills/migrations/SKILL.md, Docs/overview.md, skills/_artifacts/skill_spec.md

---

## Phase 14: ER Diagram CLI (2026-07-09)

### 14.1 `lsdb erdiagram`

- [x] `src/cli/commands/erdiagram.ts` — `generateMermaidERDiagram()` builds a Mermaid `erDiagram` block from loaded `TableSchema[]`: entity blocks with column type + `PK`/`FK`/`UK` markers (PK takes priority), relationship lines per `ref()` column (`||--||` when the FK column is `unique()`, otherwise `||--o{`), dangling `ref()`s (target table not in the loaded set) skipped rather than emitting a broken line
- [x] Wraps the diagram in a Markdown file (`# ER Diagram` header, tables-by-actor summary, ` ```mermaid ` fenced block) — default output `ER-DIAGRAM.md` in the project root, overridable via `--output <file>`
- [x] Re-run behavior: if the target file exists, interactive prompt to overwrite / save under a different name (looped via `resolveOutputPath()` until a free/confirmed path is chosen) / cancel; `--yes` skips the prompt and always overwrites
- [x] Offline — uses `loadSchemasWithPaths()` (schema files only), no adapter/OAuth/Google Sheets calls, consistent with `lsdb migrate`
- [x] Registered in `src/cli/index.ts` with `--output`/`--yes` options
- [x] Tests: entity blocks, PK/FK/UK marker precedence (`_id` fallback vs explicit `primary()`, FK winning over UK), one-to-one vs one-to-many cardinality, dangling `ref()` skipped, empty schema list
- [x] Docs: README.md (CLI section), API.md (CLI Commands reference), FAQ.md (§9 command table), CLAUDE.md (Common Commands), CHANGELOG.md (`[Unreleased]`)

---

## Phase 15: Bug Fix (developer-reported, 2026-07-10)

### 15.1 `date()` columns corrupted by a raw `Date` object write (Critical) — Fixed

- [x] `serializeValue()`: check `value instanceof Date` before the generic `typeof value === 'object'` → `JSON.stringify()` branch; normalize to `.toISOString()` instead, so a `Date` and an ISO string produce identical cell text
- [x] `deserializeRow()`: added `case 'date'` — strips a wrapping quote pair if present (self-heals rows already corrupted by the old behavior, no backfill needed) and re-normalizes to a clean ISO string; falls back to the raw unwrapped value if it still isn't a parseable date
- [x] Tests: `Date` object writes clean, round-trips through `create()`/`findOne()`, ISO string input unchanged, legacy quote-wrapped cell self-heals on read, unparseable cell falls back to raw value
- [x] Docs: FAQ.md #10 incident write-up, API.md `date()` section (accepted input types), CHANGELOG.md `[Unreleased]`

---

## Phase 16: Production Backend Portability — Pluggable SQL Adapters (16.1–16.7 done)

> Goal: swapping `createSheetAdapter` for a real-DB adapter (Postgres/MySQL/etc.) at production cutover should be a config/factory change, not a rewrite of application CRUD code. Today it is not — `SheetAdapter` and `CRUDOperations` are concrete classes with `SheetClient` calls wired directly into them ([crud.ts:19](src/adapter/crud.ts#L19)), and no runtime SQL adapter exists — only DDL/data *export* tooling (`migrate`, `migrate-data`).

### 16.1 Extract a formal adapter contract — Done

- [x] Define a `DatabaseAdapter` interface (`withContext()`, `asActor()`, `table()`) and a `CRUDOperations`-shaped interface (`TableOperations`: `create`, `createMany`, `findMany`, `findOne`, `update`, `upsert`, `delete`, `count`) in `src/adapter/types.ts`, derived from `SheetAdapter`'s current public shape
- [x] Make `SheetAdapter` implement `DatabaseAdapter` explicitly (`class SheetAdapter implements DatabaseAdapter`) instead of the interface being implicit
- [x] Decouple `CRUDOperations` from `SheetClient` — introduce a narrower `StorageClient` interface (`getAllRows`, `appendRow`/`appendRows`, `updateRow`, `deleteRow`, `writeHeader`, optional `extendValidation` since it's Sheets-only) that `SheetClient` implements; `CRUDOperations` now depends on `StorageClient`, not the concrete class (`implements TableOperations`)
- [x] Export the new interfaces (`DatabaseAdapter`, `TableOperations`, `StorageClient`, `ColumnValidationRule`) from `src/index.ts` so a third-party adapter package can implement them without reaching into internals
- [x] Tests: `tests/unit/adapterContract.test.ts` — compile-time-only assertions that `SheetAdapter`/`SheetClient` structurally satisfy `DatabaseAdapter`/`StorageClient`; fails the build if either contract drifts

### 16.2 Build SQL adapters — all shipped from the single `longcelot-sheet-db` package — Done

> Constraint met: no `longcelot-sheet-db-postgres`/`-mysql` split — `createPostgresAdapter`/`createMySQLAdapter`/`createPrismaAdapter` all ship from this one package.

- [x] `createPrismaAdapter(config)` implementing `DatabaseAdapter` (`src/adapter/sql/prismaAdapter.ts`) — **deviation from the literal plan**: takes an already-constructed, already-`prisma generate`'d `PrismaClient` instance (`{ client }`) rather than this package generating `schema.prisma`/running `prisma generate` itself, to avoid in-process codegen fragility (unknown consumer Prisma version, generated-client output path, needing the CLI present). See FAQ.md #13.
- [x] `pg`/`mysql2` added as **optional peerDependencies** (`peerDependenciesMeta.optional: true`), not regular `dependencies`; also present in `devDependencies` for this repo's own tests (`@types/pg` too, for the Postgres integration test's typed `import`)
- [x] Lazy-`require()` each driver only inside its factory, via a shared `lazyRequireDriver()` helper (`src/adapter/sql/lazyRequireDriver.ts`, reused by `createPostgresAdapter`/`createMySQLAdapter`/`migrate --apply`) — throws `SchemaError` with an `npm install <pkg>` hint on missing peer dep
- [x] CRUD parity with `CRUDOperations`: `default()` on create only, soft-delete + `includeDeleted`, PK auto-gen (`_id` always + `pkColumn` separately), FK via `ref()` + `skipFKValidation` — implemented in `SQLTableOperations`/`PrismaTableOperations` (duplicated, not shared, as a deliberate first-pass tradeoff; a `columnValidation.ts` extraction is a documented follow-up now that the Phase 16.4 contract suite exists as a safety net)
- [x] `withContext()`/`asActor()` map onto the Phase 16.3 tenancy model — `actorSheetId`/`targetSheetId` reused as an opaque `tenant_id` value, not Sheets-specific concepts
- [x] Errors: `ValidationError`/`PermissionError`/`SchemaError` reused as designed; `SchemaMismatchError` intentionally **not** reused (it's Sheets-specific by construction — hardcodes `lsdb sync --all-users` wording — and the SQL adapters have no runtime schema-drift detection at all, see next bullet)
- [x] Sheets-only config (`sheetStyle`, `cache`, `driveFolder`, `sharedDriveId`, `onSchemaMismatch`) — resolved as "not part of the shared contract," simply absent from `PostgresAdapterConfig`/`MySQLAdapterConfig`/`PrismaAdapterConfig`; SQL adapters also never auto-create/alter tables at runtime (unlike `SheetAdapter.syncSchema()`) — schema application is `migrate --apply` (16.7), a deploy-time step
- [x] `createDatabaseAdapter({ driver })` (`src/adapter/createDatabaseAdapter.ts`) — single top-level factory, driver from config or `$DB_DRIVER`, default `'sheets'`; `'prisma'` deliberately excluded (see 16.7)
- [x] Verified against real `postgres:16` and `mysql:8` Docker containers (ad hoc scripts + the Phase 16.4 contract suite) — this caught and fixed real cross-engine bugs (DATETIME vs TIMESTAMP, MySQL's lack of `CREATE INDEX IF NOT EXISTS`, ISO datetime rejection, JSON `DEFAULT` needing parens, Prisma's leading-underscore field-name restriction, Prisma's one-sided-`@relation` requirement) — see FAQ.md #13 for the full write-up
- [x] `createPrismaAdapter()` verified against a live `PrismaClient` + real Postgres — `prisma db push --force-reset` needed a human terminal (Prisma's CLI detects AI-agent invocation and refuses without explicit consent), so the user ran it directly; found one more real bug this way: `generatePrismaModel()` emitted a bare field-level `@unique` even on tenant-scoped tables, which — like `generateSQLTable()`'s pre-fix behavior — enforced uniqueness *globally* across every tenant instead of per-tenant. Fixed identically: a composite `@@unique([tenant_id, col])` model-level constraint for non-admin tables, plain `@unique` retained for admin tables. All 18 contract-suite cases pass against the real database. See FAQ.md #13.

### 16.3 Actor → tenancy mapping for SQL (design decision, not just code) — Done

- [x] ADR written: shared tables + `tenant_id` column + adapter-level WHERE-scoping, chosen over Postgres RLS (Postgres-only, needs session-variable connection handling) and schema-per-tenant (heaviest operationally) — full rationale in **FAQ.md §13**
- [x] Cross-actor permission matrix re-implemented at the SQL/Prisma adapter layer — but via **extraction, not reimplementation**: `hasPermission()`/`resolveNonAdminTenantKey()` moved out of `SheetAdapter`'s former private methods into shared `src/adapter/accessControl.ts`; `SheetAdapter` now delegates to them too, so all adapters share one implementation instead of three independent copies
- [x] Tests: `tests/unit/accessControl.test.ts` (same-actor / cross-actor-with-permission / cross-actor-without-permission / admin-bypass, direct against the extracted functions) plus the cross-actor case matrix repeated in the Phase 16.4 contract suite against every adapter; `tests/unit/crossActorPermissions.test.ts` (Sheets-specific) verified to pass **unmodified** after the extraction, proving it's behavior-preserving

### 16.4 Cross-adapter contract test suite — Done

- [x] `tests/contract/runContractSuite.ts` — one behavioral spec (CRUD, upsert, createMany, count, soft-delete, timestamps, uniqueness, FK validation tenant-scoped both ways, cross-actor permission matrix) run against `SheetAdapter` (`tests/contract/sheetAdapter.contract.test.ts`, always on) and against real Postgres/MySQL/Prisma (`test/integration/sql/*.contract.test.ts`, opt-in via `RUN_SQL_INTEGRATION_TESTS=1` — kept out of default `pnpm test` since they need a live database; all three engines verified passing, 18/18 each)
- [x] Picked up automatically by `jest.config.js`'s existing `testMatch` glob — no config change needed; the opt-in gating is handled inside each integration test file (`describe.skip` fallback), not via jest config

### 16.5 Close DDL/schema export fidelity gaps — Done

- [x] `generateSQLTable()`/`generatePrismaModel()` now emit `UNIQUE` (composite `UNIQUE(tenant_id, col)` on non-admin tables — see FAQ.md #13 for why a bare column `UNIQUE` was wrong), `DEFAULT` (parenthesized for `json()` columns — MySQL requirement), `CREATE INDEX`/`@@index([...])` for `index()` columns, and `CHECK (col IN (...))`/a real Prisma `enum` block (falling back to a doc-comment for non-string-identifier-safe enum values) for `enum()` columns
- [x] Also fixed along the way (found via real-engine testing, not originally scoped but necessary for correctness): `date()` → `TIMESTAMP` not MySQL-only `DATETIME`; dropped invalid `CREATE INDEX ... IF NOT EXISTS` (not valid MySQL syntax ever); Prisma field names can't start with `_` (`@map()` + `toPrismaFieldName()` fix, affects every table since `_id` is always present); one-sided `@relation` needs a back-relation field (`collectPrismaBackRelations()`)
- [x] Tests: `tests/unit/migrate.test.ts`, `tests/unit/migrateApply.test.ts` — index/enum/default/unique/tenant_id columns round-trip through `migrate --sql`/`--prisma` output; existing `tests/unit/export.test.ts` updated for the `TIMESTAMP`/`IF NOT EXISTS` changes

### 16.6 Documentation — Done

- [x] README.md "Migration Path": real `createPostgresAdapter`/`createMySQLAdapter`/`createPrismaAdapter`/`createDatabaseAdapter` examples replacing the illustrative `createSQLAdapter` snippet, `--apply`/`--run` usage, optional-peerDependency install story
- [x] FAQ.md: new **§13 SQL Backend Portability & Tenancy** — the tenancy ADR, `skipFKValidation`+native-constraint interaction, the full incident list from real-engine testing, and the `createPrismaAdapter`/`createDatabaseAdapter` design-decision write-ups
- [x] CLAUDE.md: architecture note pointing at `src/adapter/sql/`, `accessControl.ts`, `createDatabaseAdapter.ts`, and the shared `DatabaseAdapter` contract
- [x] API.md: new **SQL Adapters** section (config shapes, all four factories) plus `DatabaseAdapter`/`TableOperations`/`StorageClient` added to Type Definitions (a gap left over from 16.1) and CLI flag docs for `migrate --apply`/`migrate-data --run`
- [x] CHANGELOG.md: new `[Unreleased]` section covering all of 16.1–16.7

### 16.7 CI/CD — automated staging (Sheets) → production (SQL) cutover — Done

> Scope note honored: `.github/workflows/ci.yml` (this package's own build/test/lint/publish) was not touched — the deliverable is primitives + a documented reference pipeline for a **consuming application's** deploy pipeline.

- [x] Env-driven adapter selection: `createDatabaseAdapter()` (16.2) reads `DB_DRIVER=sheets|postgres|mysql` — same function serves both 16.2's "single factory" goal and this bullet, not two separate implementations. `'prisma'` is **not** a supported `DB_DRIVER` value — `createPrismaAdapter()` requires a live `PrismaClient` object, which no env var can hold; documented as the one place a Prisma-track consumer keeps a line of branching in their own app
- [x] Non-interactive schema apply: `lsdb migrate --sql --apply --connection-string <url> [--driver postgres|mysql] [--dry-run]` executes generated DDL statement-by-statement against a live DB; `lsdb migrate --prisma --apply` shells out to `npx prisma migrate deploy` (documented prerequisite: consumer needs an existing `migrations/` folder, created via `prisma migrate dev` once locally — this package doesn't generate migration history, only `schema.prisma`)
- [x] Non-interactive data cutover: `lsdb migrate-data --run --connection-string <url> --driver postgres|mysql [--token-file <path>]` runs the same admin-then-per-user traversal `generateMigrateDataScript()` encodes, but in-process against a real target adapter instead of emitting a stub `insertRow()` script. `--driver prisma` unsupported for the same reason as above — Prisma-track consumers run `--run --driver postgres`/`mysql` for the cutover regardless of their app's long-term client
- [x] Idempotency: `--apply` treats a native "already exists" error as success (`isAlreadyExistsError()`); `--run` always upserts by `_id` (unconditional, no separate `--upsert` opt-in — matches `seed --upsert`'s convention but made the default here since unattended CI reruns need safety by default)
- [x] `--dry-run` on both new commands — `--apply` prints the statements/command that would run; `--run` prints row counts without writing
- [x] Secrets: `--connection-string` falls back to `$DATABASE_URL`, documented as the DB-credential analog of `sync --token-file`'s established OAuth-secrets CI convention
- [x] Reference pipeline: sample GitHub Actions job documented in README.md's Migration Path section (build → `migrate --sql --apply` against staging → smoke test → same on tag push), mirroring this repo's own `publish` job's tag-gate pattern
- [x] Cutover-moment guidance documented in FAQ.md §13: dual-write-then-flip (both stores populated during a transition window via repeated `migrate-data --run`, then a `DB_DRIVER` env flip at deploy — rollback stays possible) recommended as the default over a one-shot cutover, which is harder to roll back from given SQL adapters never auto-create schema at runtime

---

## Phase 17: Additional ORM Adapters — Sequelize & Drizzle (not started)

> Goal: extend the Phase 16 `DatabaseAdapter` roster beyond raw Postgres/MySQL + Prisma. Not equally easy — see design note below before starting either.

### 17.1 Sequelize adapter (straightforward — same shape as Prisma)

- [ ] `createSequelizeAdapter({ sequelize })` — takes an already-constructed, already-`sequelize.sync()`'d (or migrated) `Sequelize` instance with models already defined by the consumer, same "consumer provides the configured instance" pattern as `createPrismaAdapter` (avoids this package generating Sequelize model definitions/migrations itself)
- [ ] `SequelizeTableOperations implements TableOperations` — per-model methods (`Model.create()`, `Model.findAll()`, `Model.update()`, `Model.destroy()`, `Model.count()`) mirror `PrismaTableOperations`'s structure closely
- [ ] Field-name mapping: Sequelize supports `field: '_id'`-style column mapping (or `underscored: true`) analogous to Prisma's `@map()` — reuse the same "raw column name ↔ ORM property name" translation approach as `toPrismaFieldName()`/`buildPrismaFieldMap()` (`src/utils/prismaNaming.ts`), likely needs its own `sequelizeNaming.ts` since Sequelize's own convention/API differs from Prisma's
- [ ] Reconcile Sequelize's **built-in** `timestamps`/`paranoid` (soft-delete) model options with this package's own `schema.timestamps`/`schema.softDelete` — likely disable Sequelize's built-ins (`timestamps: false, paranoid: false` expected on consumer-defined models) and manage `_created_at`/`_updated_at`/`_deleted_at` exactly like the other adapters do, to avoid two competing soft-delete/timestamp mechanisms
- [ ] `tenant_id` composite-uniqueness — same fix class as Phase 16.2/16.5's SQL/Prisma `unique()` bug: Sequelize's `unique: true` column option is global by default too; needs a composite unique index (`sequelize.define(..., { indexes: [{ unique: true, fields: ['tenant_id', 'col'] }] })`) on the consumer's model definition, analogous to `@@unique([tenant_id, col])` — document this as a **consumer responsibility** (unlike Postgres/MySQL/Prisma, this package doesn't generate the Sequelize model definitions, so it can't emit the constraint itself; call this out clearly wherever Sequelize model-authoring is documented)
- [ ] FK tenant-scoping: mirror `createPrismaFKResolver()`/`createSQLFKResolver()` — a `createSequelizeFKResolver()` resolving the referenced schema's actual actor via the shared schema registry, not the calling table's
- [ ] Tests: reuse `tests/contract/runContractSuite.ts` — same suite, new `test/integration/sql/sequelize.contract.test.ts` arm (opt-in, real Postgres/MySQL via Sequelize)

### 17.2 Drizzle ORM adapter (harder — architectural mismatch, needs a design pass first)

> **Design note before starting**: Drizzle is schema-first with statically-typed TS table objects (`pgTable('products', {...})`) and no natural "look up a table by a runtime string name" API — `adapter.table('products')` is fundamentally dynamic, which is in tension with Drizzle's type-inference model. Two paths, pick one deliberately (mirrors the Phase 16.3-style ADR treatment):
>   - (a) Generate Drizzle schema `.ts` files (a new `generateDrizzleSchema()` alongside `generateSQLTable()`/`generatePrismaModel()` in `migrate.ts`) that the consumer imports and passes in, giving up compile-time table-name safety at the `adapter.table(name)` boundary (same tradeoff `createPrismaAdapter`/Prisma's own dynamic model lookup already accepts)
>   - (b) Accept a raw Drizzle `db` instance and drop to Drizzle's lower-level `sql` template-tag / raw-query API dynamically per table name, foregoing Drizzle's query builder/type-safety features almost entirely — at that point much of `src/adapter/sql/queryBuilder.ts`'s existing dialect abstraction could likely be reused instead of adding a Drizzle-specific one
- [ ] Write the ADR (design note above, formalized) before writing adapter code — FAQ.md new entry once decided
- [ ] `createDrizzleAdapter(...)` implementing `DatabaseAdapter`, shape depends on the ADR outcome
- [ ] Tests: `tests/contract/runContractSuite.ts` arm once the adapter exists

---

## Phase 18: Drive Link Rendering & Cleanup (2026-07-26)

> Goal: `adapter.upload()` saved a link to the sheet that didn't reliably render in `<img>`/`<video>`/`<iframe>` — every downstream project (e.g. bEasy's admin-portal and mini-app, independently) ended up writing its own `uc?id=` → embeddable-URL conversion helper. Fix it in the package instead of leaving it as per-project glue code, and confirm the file-delete mechanism (already shipped in Phase 8.3) still works across every link format `upload()` can now produce.

### 18.1 Renderable Drive links by default

- [x] `src/utils/driveMedia.ts` — `classifyDriveMediaKind(mimeType)`, `buildDriveViewUrl(fileId, kind)`, `buildDriveDownloadUrl(fileId)`, `extractDriveFileId(url)`, `toDriveEmbedUrl(url, kind?)`
- [x] `DriveStorageAdapter.upload()` returns a renderable URL by default — thumbnail link for `image/*`, embeddable preview link for `video/*`, viewer link for everything else — chosen from `UploadOptions.mimeType`
- [x] `UploadOptions.linkFormat?: 'auto' | 'download'` — `'download'` opts back into the raw `uc?id=` download-endpoint URL (the previous default) for callers that need the actual bytes rather than a rendered preview
- [x] `DriveStorageAdapter.delete()` (and therefore `adapter.deleteFile()`) extracts the file ID via the same shared `extractDriveFileId()`, so it still works for `uc?id=`, `thumbnail?id=`, and `/file/d/{id}/...` URLs alike
- [x] `classifyDriveMediaKind`, `buildDriveViewUrl`, `buildDriveDownloadUrl`, `extractDriveFileId`, `toDriveEmbedUrl`, `DriveMediaKind` exported from `src/index.ts` — `toDriveEmbedUrl()` lets a consumer normalise pre-existing `uc?id=` links on read without a re-upload
- [x] Tests: `tests/unit/driveFeatures.test.ts` — image/video/file link format per `mimeType`, `linkFormat: 'download'` opt-out, `delete()` against every link format, unit coverage for each `driveMedia.ts` export
- [x] Docs: README.md new "File Upload & Drive Storage" section, API.md (`UploadOptions`, `adapter.upload()`/`adapter.deleteFile()`, `DriveStorageAdapter`, new "Drive link rendering utilities" reference), FAQ.md new §14, CHANGELOG.md `[Unreleased]`

---

## Phase 19: Bug Fix / Feature (developer-reported, 2026-08-20)

### 19.1 `createAuthRouter` — configurable OAuth scopes, dropping the forced Sheets/Drive sensitive-scope request

> Goal: `createAuthRouter` always requested `LOGIN_SCOPES` (identity + `spreadsheets` + `drive.file`) with no override, forcing every login through Google's "hasn't verified this app" interstitial even for routers used purely for sign-in with no intent to touch Sheets/Drive on the *end user's own* OAuth grant.

- [x] `AuthRouterOptions.scopes?: string[]` — threaded into `oauth.getAuthUrl(scopes, state)` (was `oauth.getAuthUrl(undefined, state)`, always falling through to the hardcoded default); omitting it preserves today's behavior exactly (non-breaking)
- [x] Validated eagerly at `createAuthRouter()` call time: `scopes` must include `'openid'` (the callback needs an `id_token` to build `GoogleProfile` for `onUser`) — throws `ValidationError` immediately instead of failing later inside the OAuth callback for a real user
- [x] `LOGIN_SCOPES` exported from `src/auth/oauth.ts` and `src/index.ts` so a caller can extend it (`[...LOGIN_SCOPES, 'extra.scope']`) instead of retyping the default
- [x] Tests: default scope set unchanged, custom `scopes` threaded through to the redirect URL, `ValidationError` thrown when `openid` is omitted
- [x] Docs: `skills/auth-router/SKILL.md` (`AuthRouterOptions` type + new "Trimming OAuth Scopes" section), `CHANGELOG.md` `[Unreleased]`

---

## Phase 20: Bug Fix / Feature (developer-reported, 2026-08-21)

### 20.1 `lsdb --version` hardcoded to `0.1.0`

> Goal: `program.version('0.1.0')` in `src/cli/index.ts` was a literal string, never wired to `package.json` — every published version, including `0.1.39`, reported `0.1.0` back.

- [x] Reads the version from `package.json` at runtime (`getPackageVersion()`, resolved relative to `__dirname` so it works from `dist/cli/index.js`), falls back to `'0.0.0'` if unreadable rather than throwing
- [x] Verified against the built CLI: `node dist/cli/index.js --version` now prints the live `package.json` version

### 20.2 `lsdb auth` command + automatic OAuth redirect capture

> Goal: the OAuth handshake only ever ran implicitly, buried inside the first `sync` (or `drop-table`/`drop-column`/`rename-column`); and the only way to hand the CLI an authorization code was copying it out of the browser's address bar and pasting it into the terminal by hand.

- [x] `lsdb auth` (alias `lsdb login`) — standalone command wrapping the existing `resolveTokens()` flow, meant to run once after `init`, before the first `sync`. `--force` bypasses a stored refresh token to force fresh consent. Purely additive: `sync`/`drop-table`/`drop-column`/`rename-column` still trigger the same flow themselves on first run, unchanged
- [x] `src/cli/lib/oauthCallbackServer.ts` — `tryCaptureViaLoopback(redirectUri)`: binds a short-lived local HTTP server on the redirect URI when it's `localhost`/`127.0.0.1`, serves a styled success/error page, and resolves the `code` param directly from Google's browser redirect. Returns `null` (never throws) for a non-loopback host, a busy port, a denied-consent `?error=`, or a 3-minute timeout — every case degrades to the pre-existing manual-paste prompt rather than failing
- [x] `src/cli/lib/browser.ts` — `openBrowser(url)`: best-effort `open`/`start`/`xdg-open` per platform, swallows all failures since the URL is already printed as a fallback
- [x] `OAuthManager.getRedirectUri()` — new public getter so the CLI (and any other caller) can read back the configured redirect URI without keeping its own copy of `OAuthConfig`
- [x] `resolveTokens(oauth, { force? })` — additive optional second parameter; existing call sites (`sync.ts`, `adminAdapter.ts`) unchanged
- [x] Tests: `tests/unit/oauthCallbackServer.test.ts` — successful capture + success-page body, `?error=` resolves `null`, unrelated paths (e.g. `favicon.ico`) ignored without ending the wait, non-loopback hostname, `https:` redirect URI, malformed URI, and port-already-in-use all resolve `null` without throwing
- [x] Docs: README.md (feature bullet, Quick Start `lsdb auth` step, "Authorize lsdb with Google" section, CLI Commands reference), API.md (`lsdb auth` CLI reference, `oauth.getRedirectUri()`), FAQ.md (`§1` new Q&A, CLI commands table, Quick Start snippet), CLAUDE.md (Common Commands), CHANGELOG.md `[Unreleased]`, `skills/cli/SKILL.md` (new `auth` section, Common Mistakes note), `skills/auth/SKILL.md` (pointer from the manual OAuth walkthrough to the CLI shortcut)

---

## Phase 21: Bug Fix / Feature (developer-reported, 2026-08-21)

### 21.1 `lsdb auth` browser page redesign, brand-consistent with sheet-db-landing

> Goal: the browser page `lsdb auth` shows on success/failure was a generic dark card with emoji icons (✅/❌) — didn't match the project's own landing page (`sheet-db-landing`), which has an established dark gray-950 + cyan-400→blue-500 gradient brand with a distinctive macOS-style terminal-chrome motif (`Terminal.tsx`).

- [x] Reused the landing page's terminal-chrome window (traffic-light title bar, monospace prompt line) and cyan→blue gradient heading instead of a plain card — plain inline CSS, no external stylesheet/font request from the local `http` server
- [x] Replaced the ✅/❌ emoji status indicators with inline SVG check/X icons
- [x] Deliberately excluded the landing page's navbar logo/wordmark (the site's logo is the maintainer's personal mark, not a generic product logo) and any nav — kept to just the confirmation card, per explicit developer decision after being asked
- [x] Success page links to the docs Quick Start (`https://longcelot-sheet-db.web.app/docs/quick-start`), per explicit developer decision after being asked; error page has no CTA
- [x] Security fix along the way: the error page's `message` (Google's `?error=` query param, untrusted input round-tripped through the redirect) is now HTML-escaped before interpolation — it was previously a narrow reflected-XSS opening for the lifetime of the local loopback server
- [x] Verified visually: rendered both pages with headless Chrome (`--headless --screenshot`) and reviewed the output images rather than only reading the HTML/CSS
- [x] Tests: existing `tests/unit/oauthCallbackServer.test.ts` cases still pass unchanged (assert on `'lsdb authorized'` text and HTTP status, not exact markup); added a new case asserting the escaping — a crafted `?error=<img src=x onerror=alert(1)>` comes back HTML-entity-escaped, not raw
- [x] Docs: CHANGELOG.md `[Unreleased]`

---

## Documentation Updates

- [x] README.md: OAuth requirement, integration workflow, `user_id` vs `sheet_id`, migration section, dev/prod parity, actors vs roles, decision tables
- [x] API.md: cross-actor operations, CLI commands (mock-users, sync --all-users, seed --all-actors, export, export-data), type definitions
- [x] CHANGELOG.md: fix duplicate `[Unreleased]` sections
- [x] Docs/architecture.md: cross-actor join section, permission model
- [x] Docs/overview.md: OAuth requirement, roadmap items
- [x] Docs/developerGuide.md: OAuth config, integration workflow
- [x] Docs/apiReference.md: deleted — consolidated into root API.md
- [x] API.md: `UserContext` type rename (`targetActor`), `ActorConfig` rename (`name`), `SheetStyleConfig` added
- [x] Docs/architecture.md: Actors vs Application Roles section
- [x] FAQ.md: actor field naming incident write-up (#2), Sheet Formatting & Data Validation section (#10)
- [x] CHANGELOG.md: breaking change note for `migrate` → `export-data` (historical; superseded by Phase 13's `export`/`export-data` → `migrate`/`migrate-data` rename)
- [x] API.md: Migration scenarios table, `export-data` command reference alignment (superseded — see Phase 13)
- [x] CLAUDE.md: read cache architecture note; API.md: `SheetReadCacheConfig` type + CRUD Operations caching note; FAQ.md: Rate Limits & Read Caching section (#11); README.md: Read Caching subsection; CHANGELOG.md: 0.1.28 entry
- [x] README.md, API.md, FAQ.md, TODO.md, CHANGELOG.md, skills/cli/SKILL.md, skills/migrations/SKILL.md, Docs/overview.md, skills/_artifacts/skill_spec.md: `drop-table`/`drop-column`/`rename-column` commands, `export`/`export-data` → `migrate`/`migrate-data` rename (see Phase 13)
- [x] API.md: `date()` accepted-input clarification; FAQ.md: `date()` corruption incident write-up (§10); CHANGELOG.md: `[Unreleased]` entry (see Phase 15)
