# CLAUDE.md - Complete Agent Guide for longcelot-sheet-db

## Project Overview

**longcelot-sheet-db** is an npm package that provides a schema-first, actor-aware database adapter using Google Sheets as the storage engine. Built for MVPs, prototypes, staging environments, and internal tools where cost and simplicity are priorities over scale.

**Package**: `longcelot-sheet-db` | **Version**: `0.1.0` | **License**: MIT | **Target**: Node.js backends

## Philosophy

- **Cost-first design** - Zero infrastructure cost for staging
- **Schema-first** - TypeScript DSL defines structure
- **Actor-based isolation** - Each role owns their own Google Sheet
- **Simple over clever** - Predictable, explicit behavior
- **Migration-ready** - Clean path to production databases

## Quick Reference

```bash
npm run build          # Compile TypeScript (tsc)
npm run dev            # Watch mode (tsc --watch)  
npm run test           # Tests not implemented yet ❌
npm install            # Install dependencies (not committed)
```

**CLI Binary**: `sheet-db`  
**Commands**: `init`, `generate`, `sync` (partial), `validate`  
**Missing Commands** (mentioned in docs): `seed`, `doctor`, `status`

## Project Structure

```
longcelot-sheet-db/
├── src/                              # Source code
│   ├── index.ts                      # Public API exports (entry point)
│   ├── schema/                       # Schema system
│   │   ├── types.ts                  # Core TypeScript interfaces
│   │   ├── columnBuilder.ts          # Fluent builder API (string(), number(), etc.)
│   │   └── defineTable.ts            # defineTable() - converts builders to schema
│   ├── adapter/                      # Database adapter layer
│   │   ├── sheetClient.ts            # Low-level Google Sheets API wrapper
│   │   ├── crud.ts                   # CRUDOperations class - database operations
│   │   └── sheetAdapter.ts           # SheetAdapter - main entry point
│   ├── auth/                         # Authentication
│   │   ├── oauth.ts                  # OAuthManager - Google OAuth2 flow
│   │   └── password.ts               # bcrypt password hashing
│   └── cli/                          # Command-line interface
│       ├── index.ts                  # CLI entry (commander-based, bin: "sheet-db")
│       └── commands/                 # CLI commands
│           ├── init.ts               # Project scaffolding (✅ working)
│           ├── generate.ts           # Schema generator (✅ working)
│           ├── sync.ts               # Sync to Sheets (⚠️ partial - needs OAuth)
│           └── validate.ts           # Schema validation (✅ working)
├── dist/                             # Compiled JS output
│   └── [mirrors src/]                # ⚠️ Currently committed (should be in .gitignore)
├── Docs/                             # Documentation
│   ├── overview.md                   # Project vision and design philosophy
│   ├── apiReference.md               # API documentation
│   ├── architecture.md               # System architecture
│   └── developerGuide.md             # Developer getting started guide
├── node_modules/                     # Dependencies (✅ installed)
├── .bolt/                            # Bolt scaffolding metadata
├── .git/                             # Git repository
├── package.json                      # Package manifest
├── tsconfig.json                     # TypeScript configuration
├── README.md                         # User-facing documentation
├── API.md                            # Detailed API reference
├── CLAUDE.md                         # This file - agent guide
└── .gitignore                        # Git ignore rules

MISSING (should be created):
├── tests/                            # ❌ No tests exist
├── examples/                         # ❌ Referenced but doesn't exist
├── CHANGELOG.md                      # ❌ Version history
├── CONTRIBUTING.md                   # ❌ Contribution guide
└── .github/workflows/                # ❌ CI/CD pipeline
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

## Current State & Implementation Status

### ✅ FULLY IMPLEMENTED & WORKING

#### Core Schema System
- **defineTable()** - Converts builder columns to ColumnDefinition
- **Auto-generated fields**: `_id` (nanoid), `_created_at`, `_updated_at`, `_deleted_at`
- **Column builders**: string(), number(), boolean(), date(), json()
- **Column modifiers**: required, unique, default, min, max, enum, pattern, readonly, primary, ref, index
- **Schema registry** - Map-based storage in SheetAdapter

#### Adapter Layer
- **SheetClient** - Full Google Sheets API wrapper
  - createSpreadsheet(), addSheet(), getSheetNames()
  - writeHeader(), appendRow(), getAllRows()
  - updateRow(), deleteRow(), shareWithUser()
- **SheetAdapter** - Main entry point
  - registerSchema(), registerSchemas()
  - withContext() - Context injection
  - table() - Get CRUD operations
  - createUserSheet() - Create and configure user sheets
  - syncSchema() - Create sheets and headers
  - resolveSpreadsheetId() - Actor-based routing
  - hasPermission() - Permission enforcement
- **CRUDOperations** - Database-like operations
  - create() - Validates, applies defaults, generates IDs
  - findMany() - With where/orderBy/limit/offset
  - findOne() - First matching record
  - update() - Bulk updates with where clause
  - delete() - Hard delete or soft delete
  - validateAndApplyDefaults() - Schema validation
  - serializeValue() / deserializeRow() - Data conversion

#### Authentication
- **OAuthManager** - Complete OAuth2 flow
  - getAuthUrl() - Generate auth URL
  - getTokens() - Exchange code for tokens
  - refreshTokens() - Refresh expired tokens
  - verifyToken() - Verify ID tokens
- **Password utilities** - bcrypt hashing
  - hashPassword() - 10 salt rounds
  - comparePassword() - Verify password
  - validatePasswordStrength() - Enforce password rules

#### CLI Commands
- **init** ✅ - Fully working
  - Interactive prompts for project config
  - Creates sheet-db.config.ts, .env, schemas/
  - Generates default admin schemas (users, credentials)
- **generate** ✅ - Fully working
  - Interactive schema builder
  - Prompts for columns, types, modifiers
  - Generates TypeScript schema files
- **validate** ✅ - Fully working
  - Validates all schemas in schemas/
  - Checks for duplicates, invalid actors, missing fields
  - Reports errors with context
- **sync** ⚠️ - Partially implemented
  - Loads and validates schemas ✅
  - Environment variable checks ✅
  - Actual sync to sheets ❌ (needs OAuth token flow)

#### TypeScript Configuration
- Target: ES2020, Module: CommonJS
- Strict mode enabled
- Declaration files and source maps generated
- No path aliases - relative imports throughout

### ⚠️ PARTIALLY IMPLEMENTED

1. **Sync Command** - Validates but doesn't execute
   - Location: [src/cli/commands/sync.ts](src/cli/commands/sync.ts)
   - Issue: Requires OAuth token storage/refresh implementation
   - Workaround: Use adapter.syncSchema() directly in code

2. **Documentation** - Good but needs examples
   - API docs exist but lack real-world usage patterns
   - Missing troubleshooting guide
   - No migration guide for moving to production

### ❌ NOT IMPLEMENTED (Mentioned but Missing)

#### Missing Features (High Priority)
1. **Tests** - No test framework or test files
   - npm test is placeholder: `echo "Tests not implemented yet"`
   - No Jest/Mocha/Vitest configuration
   - No test fixtures or mocks
   - **Impact**: Can't verify changes don't break functionality

2. **Uniqueness Enforcement** - Modifier defined but not checked
   - unique() modifier exists in column builder
   - Not validated during create() or update()
   - **Impact**: Duplicate values can be inserted
   - **Fix needed**: Add check in validateAndApplyDefaults()

3. **Examples Directory** - Referenced in docs but doesn't exist
   - README mentions "See examples/student-app"
   - Directory doesn't exist in repo
   - **Impact**: Users can't see working examples
   - **Fix needed**: Create examples/ with 2-3 working demos

#### Missing Features (Medium Priority)
4. **Index Support** - Modifier defined but not implemented
   - index() modifier exists
   - No index creation or usage
   - **Impact**: No performance optimization available
   - **Fix needed**: Create helper sheets for indexed columns

5. **Foreign Key Validation** - ref() modifier not enforced
   - ref() modifier accepts "table.column" strings
   - No validation that referenced records exist
   - **Impact**: Orphaned references possible
   - **Fix needed**: Add validation in create/update

6. **Advanced CLI Commands** (mentioned in overview.md)
   - `seed` - Load initial/test data
   - `doctor` - Diagnostics and health checks
   - `status` - Show tables, actors, sheet IDs
   - **Impact**: Manual setup required

#### Missing Infrastructure
7. **CI/CD Pipeline** - No automated testing/deployment
8. **Changelog** - No version history tracking
9. **Contributing Guide** - No contributor documentation
10. **Security Policy** - No vulnerability reporting process
## 🚀 RECOMMENDATIONS & IMPROVEMENTS

### CRITICAL ISSUES TO FIX

#### 1. dist/ Should NOT Be Committed
**Issue**: Compiled files in version control bloat the repo  
**Fix**:
```bash
git rm -r --cached dist
echo "dist/" >> .gitignore
git commit -m "chore: remove dist from version control"
```

**Update package.json**:
```json
{
  "scripts": {
    "build": "rm -rf dist && tsc",
    "prepublishOnly": "npm run build"
  }
}
```

#### 2. Add Testing Infrastructure
**Create test setup**:
```bash
npm install --save-dev jest @types/jest ts-jest
```

**Create `jest.config.js`**:
```javascript
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  collectCoverageFrom: ['src/**/*.ts'],
  coveragePathIgnorePatterns: ['/node_modules/', '/dist/'],
  testMatch: ['**/tests/**/*.test.ts']
};
```

**Update package.json**:
```json
{
  "scripts": {
    "test": "jest",
    "test:watch": "jest --watch",
    "test:coverage": "jest --coverage"
  }
}
```

#### 3. Implement Uniqueness Validation
**Location**: `src/adapter/crud.ts` in `validateAndApplyDefaults()`

**Add before create/update**:
```typescript
// Check unique constraints
for (const [columnName, column] of Object.entries(this.schema.columns)) {
  if (column.unique && result[columnName] !== undefined) {
    const existing = await this.findOne({ where: { [columnName]: result[columnName] } });
    if (existing && (mode === 'create' || existing._id !== result._id)) {
      throw new Error(`Value for ${columnName} must be unique`);
    }
  }
}
```

#### 4. Create Examples Directory
**Structure**:
```
examples/
├── README.md
├── basic-usage/
│   ├── package.json
│   ├── schemas/
│   └── index.ts
└── student-app/
    ├── package.json
    ├── schemas/
    └── app.ts
```

### RECOMMENDED IMPROVEMENTS

#### Folder Structure Enhancement
```
src/
├── adapter/           # ✅ Keep
├── auth/             # ✅ Keep
├── cli/              # ✅ Keep
├── schema/           # ✅ Keep
├── utils/            # ➕ ADD
│   ├── logger.ts     # Structured logging
│   ├── validator.ts  # Common validation functions
│   └── helpers.ts    # Utility functions
└── errors/           # ➕ ADD
    ├── index.ts
    ├── ValidationError.ts
    ├── PermissionError.ts
    └── SchemaError.ts
```

#### Custom Error Classes
```typescript
// src/errors/ValidationError.ts
export class ValidationError extends Error {
  constructor(message: string, public field?: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

// src/errors/PermissionError.ts
export class PermissionError extends Error {
  constructor(message: string, public role?: string) {
    super(message);
    this.name = 'PermissionError';
  }
}
```

#### Structured Logging
```typescript
// src/utils/logger.ts
import chalk from 'chalk';

export const logger = {
  info: (msg: string) => console.log(chalk.blue(`ℹ ${msg}`)),
  error: (msg: string) => console.error(chalk.red(`✖ ${msg}`)),
  warn: (msg: string) => console.warn(chalk.yellow(`⚠ ${msg}`)),
  success: (msg: string) => console.log(chalk.green(`✓ ${msg}`)),
  debug: (msg: string) => process.env.DEBUG && console.log(chalk.gray(`• ${msg}`)),
};
```

#### Environment Validation
```typescript
// src/utils/env.ts
export function validateEnv(): void {
  const required = [
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    'GOOGLE_REDIRECT_URI',
    'ADMIN_SHEET_ID',
  ];
  
  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}
```

### FEATURE ADDITIONS

#### Priority 1 (Essential)
- [ ] **Complete sync command** - Implement OAuth token flow
- [ ] **Add uniqueness checking** - Enforce unique constraints
- [ ] **Create tests** - Minimum 60% coverage
- [ ] **Create examples** - At least 2 working examples

#### Priority 2 (Important)
- [ ] **seed command** - Load initial/test data
- [ ] **doctor command** - Diagnostics and health checks
- [ ] **status command** - Show project status
- [ ] **Migration helper** - Export to SQL DDL

#### Priority 3 (Nice to Have)
- [ ] **Index support** - Create helper lookup sheets
- [ ] **Foreign key validation** - Enforce ref constraints
- [ ] **Query builder** - Advanced where clauses (gt, lt, contains)
- [ ] **Batch operations** - bulkCreate, bulkUpdate

### DOCUMENTATION IMPROVEMENTS

#### Create Missing Docs
```
docs/
├── CONTRIBUTING.md       # Contribution guidelines
├── CHANGELOG.md          # Version history
├── TROUBLESHOOTING.md    # Common issues and solutions
└── MIGRATION_GUIDE.md    # Moving to production DB
```

#### Enhance Existing Docs
- Add real-world examples to API.md
- Add architecture diagrams to architecture.md
- Add video/GIF demos to README.md
- Add troubleshooting section

### CODE QUALITY ENHANCEMENTS

#### Add Linting
```bash
npm install --save-dev eslint @typescript-eslint/parser @typescript-eslint/eslint-plugin prettier
```

**Create .eslintrc.js**:
```javascript
module.exports = {
  parser: '@typescript-eslint/parser',
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
  ],
  rules: {
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/explicit-function-return-type': 'off',
  },
};
```

#### Add Pre-commit Hooks
```bash
npm install --save-dev husky lint-staged
npx husky install
```

**package.json**:
```json
{
  "lint-staged": {
    "*.ts": ["eslint --fix", "prettier --write"]
  }
}
```

### CI/CD SETUP

**Create `.github/workflows/ci.yml`**:
```yaml
name: CI
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm ci
      - run: npm run build
      - run: npm test
      - run: npm run lint
      - name: Upload coverage
        uses: codecov/codecov-action@v3
```

### PERFORMANCE OPTIMIZATIONS

1. **Caching** - Cache sheet metadata to reduce API calls
2. **Batch operations** - Combine multiple row operations
3. **Lazy loading** - Don't load all rows for simple queries
4. **Pagination helper** - Better memory management for large datasets
5. **Connection pooling** - Reuse auth clients

### SECURITY IMPROVEMENTS

1. Add `SECURITY.md` with vulnerability reporting process
2. Implement rate limiting for OAuth
3. Add token rotation mechanism
4. Validate all user inputs
5. Add request signing for API calls

## IMMEDIATE ACTION ITEMS

### Must Do (Next Session)
1. ✅ Remove `dist/` from git and add to `.gitignore`
2. ✅ Create `examples/` with at least one basic example
3. ✅ Setup Jest for testing
4. ✅ Implement uniqueness validation in CRUD operations
5. ✅ Create CHANGELOG.md

### Should Do (This Week)
6. Complete sync command with OAuth flow
7. Add custom error classes
8. Create 10-15 unit tests
9. Add CONTRIBUTING.md
10. Setup basic CI/CD

### Nice to Have (This Month)
11. Implement seed command
12. Add doctor command
13. Create migration helper
14. Add comprehensive examples
15. Setup code coverage reporting

## COMMON TASKS

### Adding a New Feature
1. Create feature branch: `git checkout -b feature/name`
2. Implement in `src/`
3. Add tests in `tests/`
4. Update CHANGELOG.md
5. Update relevant docs
6. Submit PR with description

### Running Locally
```bash
npm install
npm run build
npm link  # Link for local testing
```

### Testing Changes
```bash
npm run dev          # Watch mode
npm test             # Run tests
npm run build        # Build for production
```

### Publishing (Future)
```bash
npm version patch    # or minor, major
npm publish
git push --tags
```