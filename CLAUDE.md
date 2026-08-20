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
npx lsdb generate   # Interactive schema generator
npx lsdb sync       # Sync schemas to Google Sheets
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

**`SheetClient.getAllRows()` has a built-in read cache** (in-memory, 2s TTL by default, enabled by default) — every `findMany()`/`findOne()`/`count()`/`update()`/`delete()` call routes through it, and every write method (`appendRow`, `appendRows`, `updateRow`, `deleteRow`, `writeHeader`) invalidates the relevant tab's entry. This exists to stay under Google's per-user Sheets API read quota; see FAQ.md #11 for the incident and `SheetReadCacheConfig` in API.md for tuning. When touching `getAllRows()`, `getDataRows()` (in `crud.ts`), or any of the write methods in `sheetClient.ts`, keep the invalidate-on-write pairing intact — a read path added without going through `getAllRows()`, or a write added without calling `invalidateCache()`, will silently reintroduce stale-read or cache-never-clears bugs.

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