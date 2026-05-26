# API Documentation

## Table of Contents

- [Schema Definition](#schema-definition)
- [Column Builders](#column-builders)
- [Sheet Adapter](#sheet-adapter)
- [CRUD Operations](#crud-operations)
- [Authentication](#authentication)
- [CLI Commands](#cli-commands)
- [Cross-Actor Operations](#cross-actor-operations)
- [Type Definitions](#type-definitions)

## Schema Definition

### `defineTable(config)`

Defines a table schema.

**Parameters:**

```typescript
{
  name: string;           // Table name
  actor: string;          // Actor that owns this table
  timestamps?: boolean;   // Add _created_at, _updated_at (default: false)
  softDelete?: boolean;   // Add _deleted_at (default: false)
  columns: {
    [columnName: string]: ColumnBuilder | ColumnDefinition;
  };
}
```

**Returns:** `TableSchema`

**Example:**

```typescript
import { defineTable, string, number } from 'longcelot-sheet-db';

const bookingsSchema = defineTable({
  name: 'bookings',
  actor: 'user',
  timestamps: true,
  columns: {
    booking_id: string().required().unique(),
    price: number().min(0),
  },
});
```

## Column Builders

### `string()`

Creates a string column.

**Modifiers:**

- `.required()` - Cannot be null
- `.unique()` - Must be unique
- `.default(value)` - Default value
- `.min(length)` - Minimum length
- `.max(length)` - Maximum length
- `.enum(values)` - Allowed values
- `.pattern(regex)` - Regex validation
- `.primary()` - Primary key
- `.readonly()` - Cannot be updated
- `.ref(table.column)` - Foreign key reference
- `.index()` - Create index

**Example:**

```typescript
email: string().required().unique().min(5).max(100)
status: string().enum(['active', 'inactive']).default('active')
```

### `number()`

Creates a number column.

**Modifiers:**

- `.required()`
- `.unique()`
- `.default(value)`
- `.min(value)` - Minimum value
- `.max(value)` - Maximum value

**Example:**

```typescript
age: number().min(0).max(120)
price: number().min(0).required()
```

### `boolean()`

Creates a boolean column.

**Modifiers:**

- `.required()`
- `.default(value)` - true or false

**Example:**

```typescript
is_active: boolean().default(true)
verified: boolean().required()
```

### `date()`

Creates a date column (stored as ISO string).

**Modifiers:**

- `.required()`
- `.default(value)`

**Example:**

```typescript
birth_date: date().required()
expires_at: date()
```

### `json()`

Creates a JSON column (stored as JSON string).

**Modifiers:**

- `.required()`
- `.default(value)`

**Example:**

```typescript
metadata: json()
settings: json().default({})
```

## Sheet Adapter

### `createSheetAdapter(config)`

Creates a new sheet adapter instance.

**Parameters:**

```typescript
{
  adminSheetId: string;
  credentials: {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
  };
  tokens: unknown;                          // OAuth tokens object
  onSchemaMismatch?: 'warn' | 'error' | 'auto-sync';
  permissions?: Record<string, ActorPermission>; // cross-actor permission matrix
}
```

**Returns:** `SheetAdapter`

**Example:**

```typescript
const adapter = createSheetAdapter({
  adminSheetId: process.env.ADMIN_SHEET_ID,
  credentials: {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    redirectUri: process.env.GOOGLE_REDIRECT_URI,
  },
  tokens: userTokens,
});
```

### `adapter.registerSchema(schema)`

Registers a single schema.

**Parameters:**

- `schema: TableSchema`

**Example:**

```typescript
adapter.registerSchema(bookingsSchema);
```

### `adapter.registerSchemas(schemas)`

Registers multiple schemas at once.

**Parameters:**

- `schemas: TableSchema[]`

**Example:**

```typescript
adapter.registerSchemas([usersSchema, bookingsSchema, paymentsSchema]);
```

### `adapter.withContext(context)`

Creates a new adapter instance with user context. Optionally starts an async schema version check when `onSchemaMismatch` is configured.

**Parameters:**

```typescript
{
  userId: string;
  role: string;
  actorSheetId?: string;
  // Cross-actor fields (see Cross-Actor Operations below)
  targetRole?: string;
  targetSheetId?: string;
}
```

**Returns:** `SheetAdapter` with context

**Example:**

```typescript
const userContext = adapter.withContext({
  userId: 'user_123',
  role: 'student',
  actorSheetId: 'sheet-id-xyz',
});
```

### `adapter.asActor(targetRole, targetSheetId)`

Convenience method — clones the current context and sets cross-actor fields. Requires `withContext()` to have been called first.

**Parameters:**

- `targetRole: string` - The actor type to access
- `targetSheetId: string` - The sheet ID of the target actor

**Returns:** `SheetAdapter` pointing at the target actor's sheet

**Example:**

```typescript
// Teacher accessing a student's sheet
const teacherCtx = adapter.withContext({
  userId: 'teacher_001',
  role: 'teacher',
  actorSheetId: 'teacher-sheet-id',
});
const studentCtx = teacherCtx.asActor('student', 'student-sheet-id-123');
const scores = await studentCtx.table('scores').findMany({});
```

### `adapter.table(tableName)`

Gets CRUD operations for a table.

**Parameters:**

- `tableName: string`

**Returns:** `CRUDOperations`

**Example:**

```typescript
const bookings = adapter.table('bookings');
```

### `adapter.createUserSheet(userId, role, email)`

Creates a new sheet for a user.

**Parameters:**

- `userId: string` - Unique user ID
- `role: string` - User role/actor
- `email: string` - User email

**Returns:** `Promise<string>` - Sheet ID

**Example:**

```typescript
const sheetId = await adapter.createUserSheet('user_123', 'student', 'student@school.com');
```

### `adapter.syncSchema(schema)`

Syncs a schema to Google Sheets.

**Parameters:**

- `schema: TableSchema`

**Returns:** `Promise<void>`

**Example:**

```typescript
await adapter.syncSchema(bookingsSchema);
```

## CRUD Operations

### `table.create(data, options?)`

Creates a new row.

**Parameters:**

- `data: Record<string, unknown>` - Row data
- `options?: { skipFKValidation?: boolean }` - Skip FK checks for bulk seeding

**Returns:** `Promise<Record<string, unknown>>` - Created row with generated fields

**Example:**

```typescript
const booking = await table.create({
  booking_id: 'bk_001',
  service: 'Consultation',
  date: new Date().toISOString(),
  price: 100,
});
```

### `table.findMany(options)`

Finds multiple rows.

**Parameters:**

```typescript
{
  where?: Record<string, unknown>;
  limit?: number;
  offset?: number;
  orderBy?: string;
  order?: 'asc' | 'desc';
}
```

**Returns:** `Promise<Record<string, unknown>[]>`

**Example:**

```typescript
const bookings = await table.findMany({
  where: { status: 'pending' },
  orderBy: 'date',
  order: 'desc',
  limit: 10,
});
```

### `table.findOne(options)`

Finds a single row.

**Parameters:**

```typescript
{
  where?: Record<string, unknown>;
}
```

**Returns:** `Promise<Record<string, unknown> | null>`

**Example:**

```typescript
const booking = await table.findOne({
  where: { booking_id: 'bk_001' },
});
```

### `table.update(options)`

Updates rows matching criteria.

**Parameters:**

```typescript
{
  where: Record<string, unknown>;
  data: Record<string, unknown>;
  skipFKValidation?: boolean;
}
```

**Returns:** `Promise<number>` - Number of rows updated

**Example:**

```typescript
const updated = await table.update({
  where: { booking_id: 'bk_001' },
  data: { status: 'confirmed' },
});
```

### `table.delete(options)`

Deletes rows matching criteria. If `softDelete: true` is set on the schema, sets `_deleted_at` instead of removing the row.

**Parameters:**

```typescript
{
  where: Record<string, unknown>;
}
```

**Returns:** `Promise<number>` - Number of rows deleted

**Example:**

```typescript
const deleted = await table.delete({
  where: { booking_id: 'bk_001' },
});
```

## Authentication

### `createOAuthManager(config)`

Creates an OAuth manager.

**Parameters:**

```typescript
{
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}
```

**Returns:** `OAuthManager`

### `oauth.getAuthUrl()`

Gets the OAuth authorization URL.

**Returns:** `string`

**Example:**

```typescript
const authUrl = oauth.getAuthUrl();
// Redirect user to authUrl
```

### `oauth.getTokens(code)`

Exchanges authorization code for tokens.

**Parameters:**

- `code: string` - Authorization code from OAuth callback

**Returns:** `Promise<unknown>` - OAuth tokens (save to `.sheet-db-tokens.json`)

### `oauth.refreshTokens(refreshToken)`

Refreshes expired tokens.

**Parameters:**

- `refreshToken: string`

**Returns:** `Promise<unknown>` - New tokens

### `oauth.verifyToken(idToken)`

Verifies an ID token.

**Parameters:**

- `idToken: string`

**Returns:** `Promise<unknown>` - Token payload

### `hashPassword(password)`

Hashes a password using bcrypt.

**Parameters:**

- `password: string`

**Returns:** `Promise<string>` - Hashed password

**Example:**

```typescript
const hash = await hashPassword('SecurePass123!');
```

### `comparePassword(password, hash)`

Compares a password with a hash.

**Parameters:**

- `password: string` - Plain text password
- `hash: string` - Hashed password

**Returns:** `Promise<boolean>`

**Example:**

```typescript
const isValid = await comparePassword('SecurePass123!', hash);
```

### `validatePasswordStrength(password)`

Validates password strength.

**Parameters:**

- `password: string`

**Returns:**

```typescript
{
  valid: boolean;
  errors: string[];
}
```

**Example:**

```typescript
const { valid, errors } = validatePasswordStrength('weak');
if (!valid) {
  console.log(errors); // ["Password must be at least 8 characters long", ...]
}
```

## CLI Commands

### `sheet-db init [--integrate]`

Initializes a new project. With `--integrate`, merges into an existing project without overwriting files.

**Creates:**

- `sheet-db.config.ts` — actor config with per-actor `sheetIdEnv` mappings
- `.env` — Google OAuth vars + one `DEV_<ROLE>_SHEET_ID` per non-admin actor
- `schemas/admin/` — scaffolds `users`, `credentials`, `schema_versions` tables

```bash
npx sheet-db init
npx sheet-db init --integrate   # safe merge into existing project
```

### `sheet-db generate <table-name>`

Interactively generates a new table schema file.

```bash
npx sheet-db generate bookings
```

### `sheet-db sync [--all-users] [--dry-run]`

Syncs all schemas to Google Sheets. Iterates every configured actor and prints a per-actor status table: Actor | Sheet ID | Tables | Status.

- `--all-users` — also pushes schema changes to every registered user sheet (reads `actor_sheet_id` values from admin `users` table, skips sheets that are already up-to-date via schema hash comparison)
- `--dry-run` — preview `--all-users` changes without applying them (requires `--all-users`)

```bash
npx sheet-db sync
npx sheet-db sync --all-users
npx sheet-db sync --all-users --dry-run
```

### `sheet-db validate`

Validates all schema files.

**Checks:**

- Duplicate table names
- Unknown actors
- Missing required fields
- Invalid enum / min > max

### `sheet-db seed <seed-file> [--all-actors]`

Seeds data from a JS/TS file (exporting `Record<string, unknown[]>`).

- `--all-actors` — distributes seed records to every user's actor sheet (reads from admin `users` table)

```bash
npx sheet-db seed ./seeds/initial.js
npx sheet-db seed ./seeds/initial.js --all-actors
```

### `sheet-db mock-users [count]`

Creates `count` mock Google Sheets for development (default: 3). Rotates through configured non-admin actor roles.

```bash
npx sheet-db mock-users
npx sheet-db mock-users 5
```

### `sheet-db export [--prisma] [--sql] [--output <dir>]`

Exports registered schemas to production DB formats.

- `--prisma` — writes `schema.prisma` (Prisma DSL)
- `--sql` — writes `schema.sql` (SQL DDL `CREATE TABLE` statements)
- `--output <dir>` — output directory (default: current directory)

```bash
npx sheet-db export --prisma --output ./prisma
npx sheet-db export --sql
npx sheet-db export --prisma --sql --output ./migration
```

### `sheet-db migrate [--table <name>] [--output <dir>] [--dry-run]`

Generates a `migrate.js` script that reads every table from Google Sheets and calls a stub `insertRow()` function. Replace the stub with your real DB client to move data.

- `--table <name>` — migrate a single table only
- `--output <dir>` — output directory (default: current directory)
- `--dry-run` — preview migration plan without writing any files

```bash
npx sheet-db migrate
npx sheet-db migrate --table bookings
npx sheet-db migrate --dry-run
```

### `sheet-db doctor`

Health check: validates env vars, config file, OAuth tokens, and schema directory.

### `sheet-db status`

Displays project status: actor list, env var values, OAuth token state, and all registered tables with column counts.

## Cross-Actor Operations

Cross-actor operations allow one actor (e.g. teacher) to perform CRUD on another actor's sheet (e.g. student), subject to a permission matrix.

### Permission Matrix Configuration

```typescript
const adapter = createSheetAdapter({
  adminSheetId: process.env.ADMIN_SHEET_ID,
  credentials: { clientId, clientSecret, redirectUri },
  tokens: oauthTokens,
  permissions: {
    teacher: {
      canAccess: ['student'],
      tables: ['scores', 'attendance'],  // omit to allow all tables
    },
  },
});
```

### Cross-Actor Context

```typescript
// Option A: withContext with targetRole + targetSheetId
const ctx = adapter.withContext({
  userId: 'teacher_001',
  role: 'teacher',
  actorSheetId: 'teacher-sheet-id',
  targetRole: 'student',
  targetSheetId: 'student-sheet-id-123',
});

// Option B: asActor() shorthand
const ctx = adapter
  .withContext({ userId: 'teacher_001', role: 'teacher', actorSheetId: 'teacher-sheet-id' })
  .asActor('student', 'student-sheet-id-123');

// All CRUD operations now target the student sheet
await ctx.table('scores').create({ student_id: 'stu_456', score: 95 });
const scores = await ctx.table('scores').findMany({ where: { student_id: 'stu_456' } });
await ctx.table('scores').update({ where: { _id: 'score_001' }, data: { score: 98 } });
await ctx.table('scores').delete({ where: { _id: 'score_001' } });
```

### Permission Rules

| Scenario | Behaviour |
|---|---|
| Same actor access | Always allowed |
| Admin access | Bypasses all permission checks |
| Cross-actor — role in `permissions.canAccess` | Allowed |
| Cross-actor — role not in `permissions` | `PermissionError` |
| Cross-actor — table not in `permissions.tables` | `PermissionError` |
| Cross-actor — `targetSheetId` missing | `PermissionError` |

---

## Type Definitions

### `TableSchema`

```typescript
interface TableSchema {
  name: string;
  actor: string;
  timestamps?: boolean;
  softDelete?: boolean;
  columns: Record<string, ColumnDefinition>;
  pkColumn?: string;  // set automatically when primary() is used
}
```

### `ColumnDefinition`

```typescript
interface ColumnDefinition {
  type: 'string' | 'number' | 'boolean' | 'date' | 'json';
  required?: boolean;
  unique?: boolean;
  default?: string | number | boolean | null;
  min?: number;
  max?: number;
  enum?: (string | number | boolean)[];
  pattern?: RegExp;
  readonly?: boolean;
  primary?: boolean;  // auto-generates nanoid for string columns
  ref?: string;       // 'table.column' FK reference
  index?: boolean;
}
```

### `UserContext`

```typescript
interface UserContext {
  userId: string;
  role: string;
  actorSheetId?: string;
  targetRole?: string;      // cross-actor: which actor type to access
  targetSheetId?: string;   // cross-actor: the target actor's sheet ID
}
```

### `ActorPermission`

```typescript
interface ActorPermission {
  canAccess: string[];    // actor roles this role can access
  tables?: string[];      // restrict to specific tables (omit = all tables)
}
```

### `ActorConfig`

```typescript
interface ActorConfig {
  role: string;
  sheetIdEnv: string;   // env var name that holds this actor's sheet ID
}
```

### `SchemaMismatchBehaviour`

```typescript
type SchemaMismatchBehaviour = 'warn' | 'error' | 'auto-sync';
```

Configured via `onSchemaMismatch` in `createSheetAdapter()`:
- `'warn'` — logs to stderr, continues (default)
- `'error'` — throws `SchemaMismatchError`
- `'auto-sync'` — syncs the actor sheet before proceeding
