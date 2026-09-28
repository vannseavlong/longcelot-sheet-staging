# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

`longcelot-sheet-db` is a schema-first, actor-aware database adapter that uses Google Sheets as the storage engine. Designed for MVPs, prototypes, staging environments, and internal tools.

**Key architectural concepts:**
- **Actors**: User roles (admin, user, seller) that determine where data is stored
- **Schema DSL**: TypeScript builder API for defining table schemas
- **Context**: Every operation requires context (userId, role, actorSheetId) for permission enforcement

## Common Commands

```bash
# Build, test, lint
pnpm build      # Compile TypeScript to dist/
pnpm test       # Run Jest tests
pnpm test:watch # Run tests in watch mode
pnpm lint       # ESLint check
pnpm dev        # Watch mode for development

# CLI commands (via npx or pnpm dlx)
npx lsdb init       # Initialize project structure
npx lsdb auth       # Authorize with Google, save .lsdb-tokens.json (run once, before sync)
npx lsdb generate   # Interactive schema generator
npx lsdb sync       # Sync schemas to Google Sheets
npx lsdb sync --table bookings,payments  # Sync only specific table(s) — avoids Sheets API quota limits on large schemas
npx lsdb validate   # Validate schema definitions
npx lsdb seed       # Seed test data
npx lsdb doctor     # Health check
npx lsdb status     # Show registered tables
npx lsdb erdiagram  # Generate Mermaid ER diagram (ER-DIAGRAM.md)
npx lsdb migrate --sql --apply --connection-string $DATABASE_URL   # apply DDL to a live Postgres/MySQL DB
npx lsdb migrate-data --run --connection-string $DATABASE_URL --driver postgres  # run the data cutover now
```

## Architecture

```
src/
├── adapter/      # SheetAdapter, CRUD operations, Google Sheets client
│   ├── types.ts        # DatabaseAdapter / TableOperations / StorageClient contract (Phase 16.1)
│   ├── accessControl.ts  # Shared cross-actor permission matrix + tenant-key resolution (Phase 16.3)
│   ├── createDatabaseAdapter.ts  # Single env-driven factory across all engines (Phase 16.2/16.7)
│   └── sql/           # Postgres / MySQL / Prisma adapters (Phase 16.2)
├── auth/         # OAuth manager, password hashing (bcrypt)
├── cli/          # CLI commands (init, generate, sync, validate, etc.)
├── errors/       # Custom errors: ValidationError, PermissionError, SchemaError
├── schema/       # Schema DSL: defineTable, columnBuilder, types
└── utils/        # Environment validation, logging
```

**Every storage engine implements the same `DatabaseAdapter`/`TableOperations` contract** (`src/adapter/types.ts`) — `SheetAdapter`, and the Postgres/MySQL/Prisma adapters under `src/adapter/sql/`, so application CRUD code (`adapter.withContext({...}).table(name).create({...})`) is identical regardless of engine. `src/adapter/accessControl.ts` holds the cross-actor permission matrix and tenant-key resolution shared by every adapter (`SheetAdapter` delegates to it rather than reimplementing it) — a non-Sheets engine has no physical per-user sheet, so it uses an injected `tenant_id` column instead, with `context.actorSheetId`/`targetSheetId` reused as the opaque tenant value; see FAQ.md #13 for the full tenancy ADR and the real cross-engine bugs (DATETIME vs TIMESTAMP, MySQL's lack of `CREATE INDEX IF NOT EXISTS`, Prisma's leading-underscore field-name restriction, etc.) found by testing against real Postgres/MySQL/Prisma rather than only asserting on generated DDL strings. `createDatabaseAdapter({ driver })` (or `$DB_DRIVER`) picks the engine from one config value; `pg`/`mysql2` are optional peerDependencies, lazily required only inside `createPostgresAdapter()`/`createMySQLAdapter()` so importing this package never pulls either in for Sheets-only consumers.

**`src/adapter/driveTenancy.ts`** holds the actor-vs-admin Drive client resolution (`resolveActorClient()`: `actorTokens` > `tokenStore.get(userId)` > admin client) and `driveFolder.root/subfolders[role]` folder resolution (`resolveRoleFolder()`) shared between `SheetAdapter.createUserSheet()` (sheet placement) and `DriveStorageAdapter` (file upload placement, injected via `_setClient(client, tenancy)`) — extracted so a file uploaded via `adapter.upload()` under `withContext()` always lands in the same Drive/folder as that actor's sheet, instead of always going through one admin-level client regardless of actor. See FAQ.md #15.

**`SheetClient.getAllRows()` has a built-in read cache** (in-memory, 2s TTL by default, enabled by default) — every `findMany()`/`findOne()`/`count()`/`update()`/`delete()` call routes through it, and every write method (`appendRow`, `appendRows`, `updateRow`, `deleteRow`, `writeHeader`) invalidates the relevant tab's entry. This exists to stay under Google's per-user Sheets API read quota; see FAQ.md #11 for the incident and `SheetReadCacheConfig` in API.md for tuning. When touching `getAllRows()`, `getDataRows()` (in `crud.ts`), or any of the write methods in `sheetClient.ts`, keep the invalidate-on-write pairing intact — a read path added without going through `getAllRows()`, or a write added without calling `invalidateCache()`, will silently reintroduce stale-read or cache-never-clears bugs. The cache itself lives in its own `SheetReadCache` class (`sheetClient.ts`), not directly on `SheetClient`, specifically so it can be shared across multiple `SheetClient` instances — see `actorClientForCrud` below. It also tracks a per-key generation counter bumped by `invalidateCache()`, so a read that's still in flight when a write lands doesn't clobber the cache with pre-write data once it resolves.

**`ctx.prefetch(tableNames)`** (`sheetAdapter.ts`) / **`SheetClient.getAllRowsBatch()`** — warms the read cache above for several tables with one `spreadsheets.values.batchGet` per spreadsheet instead of one `values.get` per table, closing the gap where a handler reading N different tables still made N API calls even with the cache warm. Optional on `DatabaseAdapter`/`StorageClient` (`adapter/types.ts`), no-op on the SQL adapters. See FAQ.md #11/#16 and `tests/unit/prefetchBatch.test.ts`.

**`actorClientForCrud`** (opt-in, `SheetAdapterConfig`) — routes a context actor's table operations on their *own* sheet through that actor's own OAuth client (`src/adapter/actorCrudClient.ts`: `ActorClientPool` + `ActorRoutedStorageClient`) instead of the shared admin client, so per-actor reads/writes count against that actor's own Sheets API quota. Every pooled actor client shares the admin client's `SheetReadCache` instance (not a private one), so cache invalidation still works across clients. Requires `tokenStore`; a revoked/expired grant raises typed `ActorAuthError` (or falls back to the admin client with `onAuthError: 'fallback-admin'`). See FAQ.md #16. **No test coverage yet** — see TODO.md Phase 24.2.

**`sheetSharing`/`shareWithActor`** (`SheetAdapterConfig` / `CreateUserSheetOptions`) — `createUserSheet()` shares a newly created admin-owned sheet with the actor's own email by default (`shareWithActor: true`); set `false` to skip that (sheet becomes app-only, `email` becomes optional), or set `shareRole: 'reader'`/`'commenter'` to limit what the actor can do with it. A failed share raises typed `SheetSharingError` carrying the orphaned `sheetId`. See FAQ.md #17. **No test coverage yet** — see TODO.md Phase 24.3.

**Main exports** (`src/index.ts`):
- `createSheetAdapter` - Create database adapter instance
- `createPostgresAdapter`, `createMySQLAdapter`, `createPrismaAdapter` - SQL-backed `DatabaseAdapter` implementations (Phase 16.2)
- `createDatabaseAdapter` - Single factory picking the engine via config or `$DB_DRIVER`
- `defineTable` - Define table schemas
- `createOAuthManager`, `createLoginOAuthManager` - Google OAuth handling
- `createAuthRouter`, `verifyJwt` - Express sign-in routes + JWT verification
- `hashPassword`, `comparePassword`, `validatePasswordStrength` - Password utilities

## Important Rules

From `Rules.md`:
- **No `any` type** in production code — use `unknown` + runtime narrowing
- Use custom errors: `ValidationError`, `PermissionError`, `SchemaError`
- Test locations: `tests/unit/` and `test/integration/`
- Commit format: Conventional Commits (`feat(scope):`, `fix(scope):`, etc.)
- Pre-commit checklist: lint → build → tests must pass

## Environment Requirements

The package requires Google OAuth2 credentials:
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`
- `ADMIN_SHEET_ID`

These must be validated before runtime operations.