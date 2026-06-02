# Skill Specification — longcelot-sheet-db

## Package Summary

`longcelot-sheet-db` is a **schema-first, actor-aware database adapter** that uses Google Sheets as the storage backend. It targets Node.js backends for MVPs, prototypes, and staging environments where database infrastructure cost should be zero.

---

## Target Audience

- Backend developers building with Node.js (Express, NestJS, Fastify, etc.)
- Teams prototyping features and needing a zero-cost staging database
- AI coding agents that need to generate, read, or modify code that uses this package

---

## Skill Coverage Goals

Each skill must be independently useful. An agent reading only one skill must be able to complete the tasks described in that skill's `description` field without needing to read other skills first (beyond the `core` skill for initial setup).

### core
**Goal**: Agent can install the package, configure environment variables, construct a `SheetAdapter`, register schemas, configure `onSchemaMismatch` and `permissions`, and wire the adapter into an existing backend.

**Must cover:**
- Installation commands for npm / pnpm / yarn / bun
- Required environment variables and their purpose
- `createSheetAdapter()` and full `SheetAdapterConfig` (including `onSchemaMismatch` and `permissions`)
- `registerSchema()` / `registerSchemas()`
- `withContext()` and `asActor()` overview
- `createUserSheet()` for user onboarding
- Integration pattern with existing auth (JWT → actorSheetId mapping)
- Common mistakes: missing registerSchema, stale tokens, actor mismatch, CJS/ESM constraint

### schema
**Goal**: Agent can define complete, valid schema files using `defineTable()` and all column builder types and modifiers, with correct understanding of `primary()` auto-generation and `ref()` runtime enforcement.

**Must cover:**
- `defineTable()` signature with all options
- All five column builder types: `string`, `number`, `boolean`, `date`, `json`
- All column modifiers with runtime behavior descriptions
- `primary()`: string auto-generates nanoid; number must be supplied; only one per table; PK readonly on update
- `ref()`: FK validation on create/update; `skipFKValidation` option; circular ref detection
- Auto-generated columns and which must NOT be manually defined
- `actor` field and how it controls sheet routing
- `timestamps` and `softDelete` options
- File naming conventions and directory structure
- Common mistakes: redefining auto columns, duplicate table names, multiple primaries, unregistered FK target

### crud
**Goal**: Agent can perform all CRUD operations correctly, including `createMany()` for bulk inserts, `upsert()` for insert-or-update, `count()` for counting, filtering, pagination, and soft-delete.

**Must cover:**
- `withContext()` and `UserContext` type
- `create()` with validation, defaults, ID generation, `CreateOptions`
- `createMany()` — single API call, all validation runs per-row
- `findMany()` with all `FindOptions` fields
- `findOne()` and null handling
- `count()` with and without `where`
- `update()` behavior (bulk match, PK strip, readonly throw, unique re-check)
- `upsert()` — `findOne` + `update` or `create` logic
- `delete()` with hard vs. soft delete distinction
- Serialization table (boolean, json, null)
- Performance characteristics and row limits
- Common mistakes: missing await, no-match behavior, large dataset, looping create vs createMany

### auth
**Goal**: Agent can implement the full Google OAuth2 flow, understands which manager to use for user identity (`createLoginOAuthManager`) vs Sheets access only (`createOAuthManager`), and can use bcrypt password utilities.

**Must cover:**
- Why two OAuth managers exist and when to use each
- `createOAuthManager` (Sheets scopes only — no id_token)
- `createLoginOAuthManager` (includes openid — verifyToken works)
- `OAuthConfig` and `OAuthManager` class
- Full 3-step OAuth flow: getAuthUrl → getTokens → verifyToken
- `refreshTokens()` and when to call it
- Passing tokens to `createSheetAdapter()`
- `hashPassword()`, `comparePassword()`, `validatePasswordStrength()`
- Common mistakes: wrong manager for login, losing refresh_token, storing plaintext passwords

### auth-router
**Goal**: Agent can wire up Google Sign-In routes using `createAuthRouter`, configure `registrationPolicy` for login-only or open-registration roles, and run multiple auth endpoints on the same server.

**Must cover:**
- `createAuthRouter()` and `AuthRouterOptions` type
- Routes exposed: `GET /auth/google` and `GET /auth/callback`
- `onUser` callback — return user or null
- `registrationPolicy: 'login-only'` — null → 401
- `registrationPolicy: 'open'` — null → JWT with bare profile
- `GoogleProfile` fields
- `basePath` for multiple role endpoints
- JWT format and backend verification
- `createLoginOAuthManager` for manual wiring
- Common mistakes: using wrong OAuth manager, onUser throwing vs returning null, missing frontendUrl protocol

### permissions
**Goal**: Agent can configure a cross-actor permission matrix, wire `targetRole`/`targetSheetId` in context, use `asActor()`, and perform cross-actor CRUD including aggregation across multiple user sheets.

**Must cover:**
- `ActorPermission` type (canAccess, tables)
- `permissions` map in `SheetAdapterConfig`
- `targetRole` / `targetSheetId` in `UserContext`
- `asActor()` shorthand
- Full cross-actor CRUD example (create, findMany, update, delete)
- Admin bypass behavior
- Fetching `targetSheetId` from admin `users` table
- Aggregating data across multiple user sheets
- Complete permission enforcement error table
- Common mistakes: hardcoding targetSheetId, missing targetSheetId, unregistered target schema

### migrations
**Goal**: Agent can configure schema version tracking, push schema changes to all user sheets, export schemas to Prisma/SQL, and generate a data migration script.

**Must cover:**
- `schema_versions` built-in table columns and purpose
- `computeSchemaHash()` utility
- `onSchemaMismatch` modes and when to use each
- `SchemaMismatchError`
- `sync --all-users` and `--dry-run`
- Exponential backoff for rate limits
- `sheet-db export --prisma` and `--sql` output format
- `sheet-db migrate` script generation and insertRow stub
- Full migration path (export → review → migrate data → swap adapter)
- What persists after migration (user_id yes, actor_sheet_id no)
- Common mistakes: modifying schema_versions manually, not doing dry-run first

### cli
**Goal**: Agent can run any `sheet-db` CLI command correctly, understand what each command does, use new flags (`--token-file`, `--skip-existing`, `--upsert`), and troubleshoot common CLI failures.

**Must cover:**
- All 11 commands: init (--integrate), generate, sync, validate, seed, mock-users, doctor, status, export, migrate
- `sync --all-users`, `--dry-run`, `--token-file` (CI usage)
- `seed --skip-existing`, `--upsert`, `--all-actors`
- Static vs dynamic seed file format
- `sheet-db.config.ts` full structure with `ActorConfig` (role + sheetIdEnv)
- `.sheet-db-tokens.json` lifecycle
- Common mistakes: missing env vars, committing token file, not syncing after schema change, re-seeding without --skip-existing, CI hangs without --token-file

---

## Content Constraints

- Each SKILL.md must be ≤ 500 lines
- Description field must be ≤ 1024 characters and include "Use when" trigger phrases
- Code examples must be TypeScript (the package ships TypeScript types)
- All API types shown must match `src/index.ts` exports exactly
- Avoid duplicating content between skills — cross-reference instead

---

## Failure Mode Priority

The following failure modes are the most commonly encountered and must appear in skill "Common Mistakes" sections:

1. `core`: Missing `registerSchema()` before `table()` — most common first-timer mistake
2. `crud`: Missing `await` on async operations
3. `schema`: Manually defining `_id` or other auto-generated columns
4. `cli` / `sync`: Not running sync after schema changes
5. `auth`: Using `createOAuthManager` for user login (missing openid scope → verifyToken throws)
6. `auth`: Losing the `refresh_token` on first OAuth exchange
7. `core`: Upgrading chalk/inquirer/nanoid to ESM-only versions
8. `cli` / `seed`: Re-seeding without `--skip-existing` causes unique constraint violations
9. `permissions`: Setting `targetRole` without `targetSheetId`
10. `crud`: Looping `create()` instead of using `createMany()` for bulk inserts
