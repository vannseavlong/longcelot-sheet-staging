# CLAUDE.md - Agent Guide for longcelot-sheet-db

## Project Overview

**longcelot-sheet-db** is an npm package that provides a schema-first, actor-aware database adapter using Google Sheets as the storage engine. Designed for MVPs, staging environments, and internal tools.

Package name: `longcelot-sheet-db` | Version: `0.1.0` | License: MIT

## Quick Reference

```bash
npm run build    # Compile TypeScript (tsc)
npm run dev      # Watch mode (tsc --watch)
npm run test     # Not implemented yet
```

CLI binary: `sheet-db` (commands: init, generate, sync, validate)

## Project Structure

```
src/
  index.ts                      # Public API exports (entry point)
  schema/
    types.ts                    # Core TypeScript interfaces (TableSchema, ColumnDefinition, UserContext, etc.)
    columnBuilder.ts            # Fluent builder API for column definitions (string(), number(), etc.)
    defineTable.ts              # defineTable() function - converts builder columns to ColumnDefinition, auto-adds _id, timestamps, softDelete fields
  adapter/
    sheetClient.ts              # Low-level Google Sheets API wrapper (CRUD on sheets/rows)
    crud.ts                     # CRUDOperations class - database-like operations on a single table (create, findMany, findOne, update, delete)
    sheetAdapter.ts             # SheetAdapter class - main entry point, schema registry, context/permission management, user sheet creation
  auth/
    oauth.ts                    # OAuthManager - Google OAuth2 flow (auth URL, tokens, refresh, verify)
    password.ts                 # bcrypt password hashing (hashPassword, comparePassword, validatePasswordStrength)
  cli/
    index.ts                    # CLI entry point (commander-based, registered as bin "sheet-db")
    commands/
      init.ts                   # Interactive project scaffolding (creates config, .env, schemas/)
      generate.ts               # Interactive schema generator (prompts for columns/types)
      sync.ts                   # Sync schemas to Google Sheets (partially implemented - needs OAuth tokens)
      validate.ts               # Schema validation (duplicate names, invalid modifiers, unknown actors)
dist/                           # Compiled JS output (committed to repo)
examples/
  student-app/                  # Complete example: 4 actors, 20+ schemas, usage demo
    schemas/{admin,student,teacher,parent}/  # Example schema files
    example-usage.ts            # Working usage examples
```

## Architecture & Key Concepts

### Actor-Based Isolation
- Each "actor" (role) owns its own Google Sheet (e.g., admin, student, teacher, parent)
- Admin data lives in a central admin sheet (`adminSheetId`)
- Non-admin actors use their own sheet (`actorSheetId` from UserContext)
- Permissions enforced in `SheetAdapter.hasPermission()`: admin has full access, actors can only access their own role's tables

### Data Flow
```
Developer Backend -> SheetAdapter -> SheetClient -> Google Sheets API
                        |
                  CRUDOperations (validation, serialization, where-clause filtering)
```

### Schema System
- Schemas defined with `defineTable()` using fluent column builders
- `defineTable()` auto-adds `_id` (nanoid), optional `_created_at`/`_updated_at` timestamps, optional `_deleted_at` soft delete
- Column types: string, number, boolean, date, json
- Column modifiers: required, unique, default, min, max, enum, pattern, readonly, primary, ref, index
- Schemas are registered with `adapter.registerSchema()` before use

### CRUD Operations
- All data read into memory from sheets, filtered/sorted in JS (not suited for large datasets)
- `create`: validates, applies defaults, generates `_id`, appends row
- `findMany`: reads all rows, deserializes, applies where/orderBy/offset/limit in memory
- `update`: reads all rows, matches where clause, updates matching rows one by one
- `delete`: soft delete if schema has `softDelete`, otherwise removes rows (iterates in reverse to avoid index shift)
- Serialization: booleans as "TRUE"/"FALSE", objects as JSON strings, nulls as empty strings

## Code Conventions

### TypeScript
- Target: ES2020, Module: CommonJS
- Strict mode enabled
- Declaration files and source maps generated
- No path aliases - relative imports throughout

### Patterns
- **Factory functions** for public API: `createSheetAdapter()`, `createOAuthManager()`, `defineTable()`, `string()`, `number()`, etc.
- **Classes** for internal implementation: `SheetAdapter`, `SheetClient`, `CRUDOperations`, `OAuthManager`, `ColumnBuilder`
- **Fluent/builder pattern** for column definitions: `string().required().unique().min(5)`
- **`export default`** for schema files
- **Named exports** for everything else via `src/index.ts`
- Error handling: throws `Error` with descriptive messages (no custom error classes)

### Naming
- Files: camelCase (`sheetAdapter.ts`, `columnBuilder.ts`)
- Schema files: snake_case matching table name (`student_teacher_map.ts`)
- Interfaces: PascalCase (`TableSchema`, `UserContext`, `SheetAdapterConfig`)
- Variables/functions: camelCase
- Column names in schemas: snake_case (`user_id`, `actor_sheet_id`, `created_at`)
- Auto-generated columns prefixed with underscore: `_id`, `_created_at`, `_updated_at`, `_deleted_at`

### CLI
- Uses `commander` for command parsing
- Uses `inquirer` (v8) for interactive prompts
- Uses `chalk` (v4, CommonJS-compatible) for colored output
- Config file: `sheet-db.config.ts` (loaded via `require()`)

## Dependencies

### Runtime
- `googleapis` (^128.0.0) - Google Sheets & Drive API
- `bcryptjs` (^2.4.3) - Password hashing
- `commander` (^11.1.0) - CLI framework
- `inquirer` (^8.2.6) - Interactive CLI prompts (v8 for CommonJS compat)
- `nanoid` (^3.3.7) - ID generation (v3 for CommonJS compat)
- `chalk` (^4.1.2) - Terminal colors (v4 for CommonJS compat)

### Dev
- `typescript` (^5.3.3)
- `@types/node`, `@types/bcryptjs`, `@types/inquirer`

**Important**: chalk v4, inquirer v8, and nanoid v3 are used specifically because they are CommonJS-compatible. Do NOT upgrade to ESM-only versions (chalk v5+, inquirer v9+, nanoid v4+) without migrating the project to ESM.

## Environment Variables

```
GOOGLE_CLIENT_ID       # Google OAuth client ID
GOOGLE_CLIENT_SECRET   # Google OAuth client secret
GOOGLE_REDIRECT_URI    # OAuth redirect URI (default: http://localhost:3000/auth/callback)
ADMIN_SHEET_ID         # Central admin Google Sheet ID
SUPER_ADMIN_EMAIL      # Email for super admin (used when creating user sheets)
```

## Current State & Known Limitations

- **No tests** - `npm test` is a placeholder
- **dist/ is committed** - compiled JS is in the repo
- **Sync command is partial** - validates schemas but doesn't actually sync (needs OAuth token flow)
- **No node_modules** - need `npm install` before building
- **No `.env` file** - must be created manually or via `sheet-db init`
- **In-memory filtering** - all rows fetched then filtered in JS; not suitable for large datasets (hundreds to low thousands of rows max)
- **No uniqueness enforcement** on writes (unique modifier defined but not checked during create/update)
- **No index support** (index modifier defined but not implemented)
- **No foreign key validation** (ref modifier defined but not enforced)
- Project was scaffolded with Bolt (.bolt/config.json exists with template: "node")
