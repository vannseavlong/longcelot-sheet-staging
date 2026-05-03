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
npx sheet-db init       # Initialize project structure
npx sheet-db generate   # Interactive schema generator
npx sheet-db sync       # Sync schemas to Google Sheets
npx sheet-db validate   # Validate schema definitions
npx sheet-db seed       # Seed test data
npx sheet-db doctor     # Health check
npx sheet-db status     # Show registered tables
```

## Architecture

```
src/
├── adapter/      # SheetAdapter, CRUD operations, Google Sheets client
├── auth/         # OAuth manager, password hashing (bcrypt)
├── cli/          # CLI commands (init, generate, sync, validate, etc.)
├── errors/       # Custom errors: ValidationError, PermissionError, SchemaError
├── schema/       # Schema DSL: defineTable, columnBuilder, types
└── utils/        # Environment validation, logging
```

**Main exports** (`src/index.ts`):
- `createSheetAdapter` - Create database adapter instance
- `defineTable` - Define table schemas
- `createOAuthManager` - Google OAuth handling
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