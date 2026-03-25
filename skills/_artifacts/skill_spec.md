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
**Goal**: Agent can install the package, configure environment variables, construct a `SheetAdapter`, register schemas, and wire the adapter into an existing backend.

**Must cover:**
- Installation commands for npm / pnpm / yarn / bun
- Required environment variables and their purpose
- `createSheetAdapter()` and `SheetAdapterConfig`
- `registerSchema()` / `registerSchemas()`
- `withContext()` pattern overview
- `createUserSheet()` for user onboarding
- Integration pattern with existing auth (JWT → actorSheetId mapping)
- Common mistakes: missing registerSchema, stale tokens, actor mismatch, CJS/ESM constraint

### schema
**Goal**: Agent can define complete, valid schema files using `defineTable()` and all column builder types and modifiers.

**Must cover:**
- `defineTable()` signature with all options
- All five column builder types: `string`, `number`, `boolean`, `date`, `json`
- All column modifiers with behavior descriptions
- Auto-generated columns and which must NOT be manually defined
- `actor` field and how it controls sheet routing
- `timestamps` and `softDelete` options
- File naming conventions and directory structure
- Common mistakes: redefining auto columns, duplicate table names, actor mismatch

### crud
**Goal**: Agent can perform all CRUD operations correctly, including context setup, filtering, pagination, soft-delete behavior, and serialization rules.

**Must cover:**
- `withContext()` and `UserContext` type
- `create()` with validation, defaults, ID generation
- `findMany()` with all `FindOptions` fields
- `findOne()` and null handling
- `update()` behavior (bulk match, readonly skip, unique re-check)
- `delete()` with hard vs. soft delete distinction
- Serialization table (boolean, json, null)
- Performance characteristics and row limits
- Common mistakes: missing await, no-match behavior, large dataset warning

### auth
**Goal**: Agent can implement the full Google OAuth2 flow and use bcrypt password utilities correctly.

**Must cover:**
- Why OAuth is required (not optional)
- `createOAuthManager()` and `OAuthConfig`
- Full 3-step OAuth flow: getAuthUrl → getTokens → verifyToken
- `refreshTokens()` and when to call it
- Passing tokens to `createSheetAdapter()`
- `hashPassword()`, `comparePassword()`, `validatePasswordStrength()`
- Common mistakes: losing refresh_token, using expired access_token, storing plaintext passwords

### cli
**Goal**: Agent can run any `sheet-db` CLI command correctly, understand what each command does, and troubleshoot common CLI failures.

**Must cover:**
- All 7 commands: init, generate, sync, validate, seed, doctor, status
- What each command creates or modifies
- `sheet-db.config.ts` structure
- `.sheet-db-tokens.json` lifecycle
- Common mistakes: missing env vars for sync, committing token file, running init twice

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
4. `sync` (cli): Not running sync after schema changes
5. `auth`: Losing the `refresh_token` on first OAuth exchange
6. `core`: Upgrading chalk/inquirer/nanoid to ESM-only versions
