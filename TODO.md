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
- [ ] Update API.md command reference section
- [ ] Update CHANGELOG.md with breaking change note

### 9.2 README and API.md contradiction on `export --prisma/--sql`

- [x] Remove "coming soon" markers from README.md for implemented commands
- [ ] Audit API.md — confirm `export` examples match actual CLI behaviour
- [ ] Add single source-of-truth note in README.md pointing to API.md
- [ ] Mark genuinely unimplemented flags as `[planned]` consistently in both files

### 9.3 Schema-only vs schema+data export guidance

- [x] Add "Which export command do I need?" decision table to README.md
- [ ] Mirror decision table in API.md under a "Migration scenarios" section

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
- `export --prisma` and `export --sql`
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
- `export-data` (renamed from `migrate`) with `--all-users` and `--dry-run`
- `withContext({ actor })` rename with `role` deprecation alias
- `ActorConfig.role` → `name`, `UserContext.targetRole` → `targetActor` (both with deprecation aliases)
- Automatic sheet formatting: auto-fit columns, header fill/freeze, boolean/enum data validation dropdowns, `sheetStyle` config

### To Do ⏳

- `adapter.join()` — cross-actor join queries (medium priority)
- API.md: `UserContext` rename, Migration scenarios table, `export-data` command reference
- CHANGELOG.md: breaking change note for `migrate` → `export-data`
- `Docs/architecture.md`: Actors vs Application Roles section
- `mock-users` output: dev vs prod topology note
- NestJS auth guard variant (future)
- `'invite-only'` registration policy (future)
- Service account alternative for sync (future)
- Column encryption, audit logs, row-level permissions (lower priority)

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
- [ ] CHANGELOG.md: breaking change note for `migrate` → `export-data`
- [ ] API.md: Migration scenarios table, `export-data` command reference alignment
