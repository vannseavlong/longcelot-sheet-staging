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

Creates a boolean column. Renders as a `ONE_OF_LIST` dropdown in the sheet (not a native checkbox — see [`SheetStyleConfig`](#sheetstyleconfig) and FAQ.md #10 for why) restricted to `TRUE`/`FALSE` by default, or `1`/`0` if configured.

**Parameters:**

- `options?: { format?: 'TRUE_FALSE' | '1_0' }` — overrides the project-wide `sheetStyle.booleanFormat` default for this column only.

**Modifiers:**

- `.required()`
- `.default(value)` - true or false

**Example:**

```typescript
is_active: boolean().default(true)
verified: boolean().required()
legacy_flag: boolean({ format: '1_0' }) // overrides the project-wide default for this column
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
  tokens: unknown;                                        // admin OAuth tokens object
  onSchemaMismatch?: 'warn' | 'error' | 'auto-sync';
  permissions?: Record<string, ActorPermission>;          // cross-actor permission matrix
  driveFolder?: DriveFolderConfig;                        // folder organisation in Drive
  sharedDriveId?: string;                                 // target a Google Workspace Shared Drive
  tokenStore?: TokenStore;                                // per-actor token persistence
  storage?: StorageAdapter;                               // file upload provider
  sheetStyle?: SheetStyleConfig;                          // header color, frozen rows/columns (see Type Definitions)
  cache?: SheetReadCacheConfig;                           // read cache tuning — see Type Definitions and FAQ.md #11
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
  actor: string;         // preferred — the data domain (e.g. 'admin', 'seller', 'student')
  role?: string;         // @deprecated — use actor instead (accepted for backward compat, emits console.warn)
  actorSheetId?: string;
  // Cross-actor fields (see Cross-Actor Operations below)
  targetActor?: string;  // preferred — which actor's sheet to access
  targetRole?: string;   // @deprecated — use targetActor instead (accepted for backward compat, emits console.warn)
  targetSheetId?: string;
}
```

**Returns:** `SheetAdapter` with context

**Example:**

```typescript
const userContext = adapter.withContext({
  userId: 'user_123',
  actor: 'student',      // preferred
  actorSheetId: 'sheet-id-xyz',
});
```

### `adapter.asActor(targetActor, targetSheetId)`

Convenience method — clones the current context and sets cross-actor fields. Requires `withContext()` to have been called first.

**Parameters:**

- `targetActor: string` - The actor type to access
- `targetSheetId: string` - The sheet ID of the target actor

**Returns:** `SheetAdapter` pointing at the target actor's sheet

**Example:**

```typescript
// Teacher accessing a student's sheet
const teacherCtx = adapter.withContext({
  userId: 'teacher_001',
  actor: 'teacher',
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

### `adapter.createUserSheet(userId, role, email, options?)`

Creates a new sheet for a user and registers them in the admin `users` table.

When `actorTokens` are provided (or resolved via `tokenStore`), the sheet is created in **the actor's own Google Drive**. Otherwise the admin's Drive is used (previous behaviour).

**Parameters:**

- `userId: string`
- `role: string`
- `email: string`
- `options?: CreateUserSheetOptions`
  - `actorTokens?: OAuthTokens` — actor's own Google OAuth tokens; sheet is created in their Drive
  - `extraFields?: Record<string, unknown>` — extra columns spread into the `users` table `create()` call

**Returns:** `Promise<string>` - Sheet ID

**Example:**

```typescript
// Basic (sheet in admin's Drive)
const sheetId = await adapter.createUserSheet('user_123', 'student', 'student@school.com');

// Actor-owned (sheet in student's Drive)
const sheetId = await adapter.createUserSheet('user_123', 'student', 'student@school.com', {
  actorTokens: { access_token: '...', refresh_token: '...' },
  extraFields: { display_name: 'Alice' },
});
```

### `adapter.upload(file, options)`

Uploads a file using the configured `StorageAdapter`. Throws `SchemaError` if no storage adapter is configured.

**Parameters:**

- `file: Buffer`
- `options: UploadOptions`
  - `filename: string`
  - `mimeType: string`
  - `folder?: string` — subfolder path; created if missing (e.g. `'uploads/products'`)
  - `public?: boolean` — make the file publicly readable (Drive: sets `anyone / reader` permission)

**Returns:** `Promise<string>` - Public URL

**Example:**

```typescript
import { DriveStorageAdapter } from 'longcelot-sheet-db';

const adapter = createSheetAdapter({
  ...,
  storage: new DriveStorageAdapter({ folder: 'uploads' }),
});

const url = await adapter.upload(imageBuffer, {
  filename: 'product.jpg',
  mimeType: 'image/jpeg',
  public: true,
});
// 'https://drive.google.com/uc?id=FILE_ID'
```

### `adapter.deleteFile(url)`

Deletes a file via the configured `StorageAdapter`. Throws `SchemaError` if no storage adapter is configured.

**Parameters:**

- `url: string` - URL previously returned by `adapter.upload()`

**Returns:** `Promise<void>`

### `adapter.syncSchema(schema)`

Syncs a schema to Google Sheets. Creates the tab if missing, appends any new columns, and — whenever headers are written (new tab or new columns) — applies sheet formatting: auto-fit column widths, header fill color, frozen header row (and first column if configured), and `BOOLEAN`/`ONE_OF_LIST` data validation dropdowns for `boolean()`/`enum()` columns. No formatting calls are made when nothing changed. Configure via `sheetStyle` on `createSheetAdapter()` (see [`SheetStyleConfig`](#sheetstyleconfig)).

**Parameters:**

- `schema: TableSchema`

**Returns:** `Promise<void>`

**Example:**

```typescript
await adapter.syncSchema(bookingsSchema);
```

## CRUD Operations

> **Read caching**: `findMany()`, `findOne()`, `count()`, `update()`, and `delete()` all read through `SheetClient.getAllRows()`, which caches each tab's rows in memory for a short TTL (default 2s, enabled by default) and de-duplicates concurrent reads for the same tab into a single Sheets API request. This exists to keep normal usage under Google's read-quota limits — see [`SheetReadCacheConfig`](#sheetreadcacheconfig) to tune it and FAQ.md #11 for the incident that motivated it. Every write (`create`, `update`, `delete`, `createMany`) invalidates the cache for the tab it touched, so a read immediately after a write through the same adapter instance always sees fresh data.

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
  includeDeleted?: boolean; // see softDelete below — default: false
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

When the table's schema has `softDelete: true`, rows with a populated `_deleted_at` are excluded automatically. Pass `includeDeleted: true` to see them anyway.

### `table.findOne(options)`

Finds a single row. Like `findMany()`, excludes soft-deleted rows unless `includeDeleted: true` is passed.

**Parameters:**

```typescript
{
  where?: Record<string, unknown>;
  includeDeleted?: boolean;
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

Updates rows matching criteria. Column `default()` values are **never** applied here — a field omitted from `data` keeps its existing value rather than being reset to the schema default. Defaults only apply on `create()`.

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

Deletes rows matching criteria. If `softDelete: true` is set on the schema, sets `_deleted_at` instead of removing the row — the row is then excluded from `findMany()`/`findOne()`/`count()` by default (pass `includeDeleted: true` to see it).

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

**Returns:** `Promise<unknown>` - OAuth tokens (save to `.lsdb-tokens.json`)

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

### `lsdb init [--integrate]`

Initializes a new project. With `--integrate`, merges into an existing project without overwriting files.

**Creates:**

- `lsdb.config.ts` — actor config with per-actor `sheetIdEnv` mappings
- `.env` — Google OAuth vars + one `DEV_<ROLE>_SHEET_ID` per non-admin actor
- `schemas/admin/` — scaffolds `users`, `credentials`, `schema_versions` tables

```bash
npx lsdb init
npx lsdb init --integrate   # safe merge into existing project
```

### `lsdb generate <table-name>`

Interactively generates a new table schema file.

```bash
npx lsdb generate bookings
```

### `lsdb sync [--all-users] [--dry-run]`

Syncs all schemas to Google Sheets. Iterates every configured actor and prints a per-actor status table: Actor | Sheet ID | Tables | Status.

- `--all-users` — also pushes schema changes to every registered user sheet (reads `actor_sheet_id` values from admin `users` table, skips sheets that are already up-to-date via schema hash comparison)
- `--dry-run` — preview `--all-users` changes without applying them (requires `--all-users`)

```bash
npx lsdb sync
npx lsdb sync --all-users
npx lsdb sync --all-users --dry-run
```

### `lsdb validate`

Validates all schema files.

**Checks:**

- Duplicate table names
- Unknown actors
- Missing required fields
- Invalid enum / min > max

### `lsdb seed <seed-file> [--all-actors]`

Seeds data from a JS/TS file (exporting `Record<string, unknown[]>`).

- `--all-actors` — distributes seed records to every user's actor sheet (reads from admin `users` table)

```bash
npx lsdb seed ./seeds/initial.js
npx lsdb seed ./seeds/initial.js --all-actors
```

### `lsdb mock-users [count]`

Creates `count` mock Google Sheets for development (default: 3). Rotates through configured non-admin actor roles.

```bash
npx lsdb mock-users
npx lsdb mock-users 5
```

### `lsdb migrate [--prisma] [--sql] [--output <dir>]`

Exports registered schemas to production DB formats.

- `--prisma` — writes `schema.prisma` (Prisma DSL)
- `--sql` — writes `schema.sql` (SQL DDL `CREATE TABLE` statements)
- `--output <dir>` — output directory (default: current directory)

```bash
npx lsdb migrate --prisma --output ./prisma
npx lsdb migrate --sql
npx lsdb migrate --prisma --sql --output ./migration
```

### `lsdb migrate-data [--table <name>] [--all-users] [--output <dir>] [--dry-run]`

Generates a `migrate-data.js` script that reads row data from Google Sheets and calls a stub `insertRow()` function. Replace the stub with your real DB client (Prisma, Sequelize, etc.) to move data.

> **Actors vs RBAC roles** — see [Actors vs Application Roles](#actors-vs-application-roles) below.

**Flags:**
- `--table <name>` — export a single table only
- `--all-users` — also reads every registered user's `actor_sheet_id` from the admin `users` table and exports their actor sheets. The generated script includes a per-user loop with `userId` passed to `insertRow` so target DB rows can be associated with the correct user FK.
- `--output <dir>` — output directory (default: current directory)
- `--dry-run` — preview export plan without writing any files

```bash
npx lsdb migrate-data
npx lsdb migrate-data --all-users
npx lsdb migrate-data --all-users --dry-run
npx lsdb migrate-data --table bookings
```

> **Deprecated aliases**: `lsdb export` and `lsdb export-data` still work but emit a deprecation warning — they forward to `lsdb migrate` and `lsdb migrate-data` respectively. In standard tooling (Prisma Migrate, Rails, Flyway), "migrate" means schema-only DDL changes, which is why the schema/DDL export command is named `migrate`; the row-data export command is `migrate-data`.

### Migration scenarios

| Goal | Command |
|------|---------|
| Copy table structure only (schema / DDL) | `lsdb migrate --prisma` or `--sql` |
| Copy structure + admin sheet row data | `lsdb migrate-data` |
| Copy structure + all user-sheet row data | `lsdb migrate-data --all-users` |
| Preview export plan without writing files | add `--dry-run` to either command |

### `lsdb drop-table [table-names...] [--all-users] [--yes] [--dry-run] [--token-file <path>]`

Deletes table schema file(s) and the corresponding Google Sheet tab(s). `sync` never removes anything on its own — this is the explicit, confirmed way to remove a table from both the codebase and the live sheet(s).

- No positional args — interactive checkbox over every defined table (space to toggle, enter to confirm)
- Positional args — one or more `tableName` or `actor/tableName` (use the `actor/` form when the same table name exists under more than one actor)
- `--all-users` — also drops the tab from every registered user's personal sheet (reads `actor_sheet_id` from the admin `users` table)
- `--yes` — skip the confirmation prompt
- `--dry-run` — print the plan without making any changes
- `--token-file <path>` — CI/CD, same as `sync --token-file`

```bash
npx lsdb drop-table bookings
npx lsdb drop-table bookings old_notifications --all-users
npx lsdb drop-table --dry-run
npx lsdb drop-table                      # interactive
```

Invalid table names produce a clear error (with a "did you mean" suggestion when close to a real name) instead of silently doing nothing. Warns if another table's `ref()` points at a table being dropped, since it doesn't rewrite `ref()` strings in other schema files.

### `lsdb drop-column [table-name] [column-names...] [--all-users] [--yes] [--dry-run] [--token-file <path>]`

Removes column(s) from a table's schema file and deletes the matching column(s) from the live Google Sheet, including all data in them.

- Table omitted — interactive single-select list
- Column names omitted — interactive checkbox over that table's columns
- Refuses to drop reserved auto-generated columns (`_id`, `_created_at`, `_updated_at`, `_deleted_at`) or the table's primary key column (drop the whole table instead)
- Resolves each column's *live* position in the sheet's current header row before deleting — not the schema file's declared order, since `sync` appends new columns at the end
- Same `--all-users`/`--yes`/`--dry-run`/`--token-file` flags as `drop-table`

```bash
npx lsdb drop-column bookings notes
npx lsdb drop-column bookings                 # interactive column checkbox
npx lsdb drop-column                          # interactive table + column
```

### `lsdb rename-column [table-name] [old-name] [new-name] [--all-users] [--yes] [--dry-run] [--token-file <path>]`

Renames a column in the schema file and overwrites the corresponding Google Sheet **header cell in place** — existing row data is preserved, unlike a drop-and-re-add. This is the safe way to fix a column name without losing data the next time the sheet syncs or a mismatch triggers `auto-sync`.

- Any of `table-name`/`old-name`/`new-name` omitted — prompts interactively (list, list, then text input)
- New name must be a valid identifier (`^[a-zA-Z_][a-zA-Z0-9_]*$`), not already used on the table, and not a reserved name
- Warns (doesn't block) if another table's `ref()` points at `table.oldName` — those `ref()` strings aren't rewritten automatically
- Same `--all-users`/`--yes`/`--dry-run`/`--token-file` flags as `drop-table`

```bash
npx lsdb rename-column bookings notes remarks
npx lsdb rename-column                        # fully interactive
```

### `lsdb doctor`

Health check: validates env vars, config file, OAuth tokens, and schema directory.

### `lsdb status`

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
// Option A: withContext with targetActor + targetSheetId
const ctx = adapter.withContext({
  userId: 'teacher_001',
  actor: 'teacher',
  actorSheetId: 'teacher-sheet-id',
  targetActor: 'student',
  targetSheetId: 'student-sheet-id-123',
});

// Option B: asActor() shorthand
const ctx = adapter
  .withContext({ userId: 'teacher_001', actor: 'teacher', actorSheetId: 'teacher-sheet-id' })
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
  default?: JsonValue;  // string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue } — needed for json() column defaults
  min?: number;
  max?: number;
  enum?: (string | number | boolean)[];
  pattern?: RegExp;
  readonly?: boolean;
  primary?: boolean;  // auto-generates nanoid for string columns
  ref?: string;       // 'table.column' FK reference
  index?: boolean;
  booleanFormat?: BooleanFormat; // boolean() columns only — overrides the project-wide sheetStyle default
}
```

### `BooleanFormat`

```typescript
type BooleanFormat = 'TRUE_FALSE' | '1_0';
```

Value pair a `boolean()` column reads/writes as. Configurable project-wide via [`SheetStyleConfig.booleanFormat`](#sheetstyleconfig) (default `'TRUE_FALSE'`) or per-column via `boolean({ format })`, which takes priority when set.

### `UserContext`

```typescript
interface UserContext {
  userId: string;
  /** Preferred. The data domain (actor) for this operation — e.g. 'admin', 'seller', 'student'. */
  actor?: string;
  /** @deprecated Use actor instead. Accepted for backward compat; emits console.warn when used. */
  role?: string;
  actorSheetId?: string;
  /** Preferred. Cross-actor: which actor's sheet to access. */
  targetActor?: string;
  /** @deprecated Use targetActor instead. Accepted for backward compat; emits console.warn when used. */
  targetRole?: string;
  targetSheetId?: string;   // cross-actor: the target actor's sheet ID
}
```

> **actor vs role**: `actor` is the lsdb concept of a *data domain* (which Google Sheet, which schemas). It is **not** an application-level RBAC role. If your app has dynamic permissions (admin/manager/viewer), build those in a `roles` + `role_permissions` table and enforce them in your own middleware — lsdb intentionally does not provide RBAC.

### Actors vs Application Roles

| Concept | Controls | Dynamic? | Where defined |
|---------|----------|----------|---------------|
| **Actor** (`actor:`) | Which Google Sheet + table schemas to use | No — fixed in `lsdb.config.ts` | Config file |
| **App RBAC role** | What a user is allowed to do in your app | Yes — rows in your app's DB | Your app layer |

Every field that identifies an actor follows this naming, so it can't be mistaken for an RBAC role at the point of writing the code:

| Location | Preferred | Deprecated alias |
|---|---|---|
| `ActorConfig` (`lsdb.config.ts`) | `name` | `role` |
| `UserContext` (`withContext()`) | `actor` | `role` |
| `UserContext` cross-actor target | `targetActor` | `targetRole` |

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
  /** Preferred. The actor's identifier — e.g. 'admin', 'seller', 'student'. */
  name?: string;
  /** @deprecated Use name instead. Accepted for backward compat; emits console.warn when used. */
  role?: string;
  sheetIdEnv: string;   // env var name that holds this actor's sheet ID
}
```

### `SheetStyleConfig`

```typescript
interface SheetStyleConfig {
  headerColor?: string;          // hex color for the header row fill, e.g. '#E8F0FE'
  freezeHeader?: boolean;        // default: true
  freezeFirstColumn?: boolean;   // default: false
  booleanFormat?: BooleanFormat; // 'TRUE_FALSE' | '1_0' — default: 'TRUE_FALSE'
}
```

Passed as `sheetStyle` on `createSheetAdapter()`. Auto-fit column width and `boolean()`/`enum()` data validation dropdowns are always applied — no config needed. `booleanFormat` is the project-wide default for every `boolean()` column; override an individual column with `boolean({ format })` (see [`boolean()`](#boolean)).

### `SheetReadCacheConfig`

```typescript
interface SheetReadCacheConfig {
  enabled?: boolean; // default: true
  ttlMs?: number;    // default: 2000 (2s)
}
```

Passed as `cache` on `createSheetAdapter()`. Bounds and de-duplicates `values.get` calls made through `SheetClient.getAllRows()` — see the read caching note under [CRUD Operations](#crud-operations) and FAQ.md #11.

```typescript
const adapter = createSheetAdapter({
  // ...
  cache: { ttlMs: 5000 },     // widen the window for a read-heavy admin dashboard
  // cache: { enabled: false } // disable entirely (not recommended — see FAQ.md #11)
});
```

The cache is per-`SheetClient` instance and per-process — it does not know about writes made outside the adapter (a human editing the sheet directly, or another process/server instance sharing the same spreadsheet). `ttlMs` bounds how stale those external changes can appear; call `adapter.getClient().invalidateCache(spreadsheetId, sheetName)` to force a specific tab to refetch immediately.

### `SchemaMismatchBehaviour`

```typescript
type SchemaMismatchBehaviour = 'warn' | 'error' | 'auto-sync';
```

Configured via `onSchemaMismatch` in `createSheetAdapter()`:
- `'warn'` — logs to stderr, continues (default)
- `'error'` — throws `SchemaMismatchError`
- `'auto-sync'` — syncs the actor sheet before proceeding

### `OAuthTokens`

```typescript
interface OAuthTokens {
  access_token?: string | null;
  refresh_token?: string | null;
  expiry_date?: number | null;
  id_token?: string | null;
  token_type?: string | null;
  scope?: string | null;
}
```

### `TokenStore`

```typescript
interface TokenStore {
  get(actorId: string): Promise<OAuthTokens | null>;
  set(actorId: string, tokens: OAuthTokens): Promise<void>;
}
```

Passed as `tokenStore` to `createSheetAdapter`. The adapter calls `get(userId)` in `createUserSheet` when `actorTokens` is not provided directly. Callers are responsible for calling `set(userId, tokens)` after each Google OAuth callback.

### `DriveFolderConfig`

```typescript
interface DriveFolderConfig {
  root: string;                        // folder name at Drive root; created if missing
  subfolders?: Record<string, string>; // actor role -> subfolder name (defaults to role name)
}
```

### `UploadOptions`

```typescript
interface UploadOptions {
  filename: string;
  mimeType: string;
  folder?: string;   // subfolder path relative to driveFolder.root; created if missing
  public?: boolean;  // when true, sets Drive permission: anyone / reader
}
```

### `StorageAdapter`

```typescript
interface StorageAdapter {
  upload(file: Buffer, options: UploadOptions): Promise<string>; // returns public URL
  delete(url: string): Promise<void>;
}
```

### `CreateUserSheetOptions`

```typescript
interface CreateUserSheetOptions {
  actorTokens?: OAuthTokens;             // create sheet in actor's Drive when provided
  extraFields?: Record<string, unknown>; // extra columns merged into the users table row
}
```

### `DriveStorageAdapter`

```typescript
class DriveStorageAdapter implements StorageAdapter {
  constructor(options?: { folder?: string }); // default folder: 'uploads'
  upload(file: Buffer, options: UploadOptions): Promise<string>;
  delete(url: string): Promise<void>;
}
```

Built-in `StorageAdapter` implementation that uploads to Google Drive and returns a `https://drive.google.com/uc?id=…` URL. The adapter's `SheetClient` is injected automatically at `createSheetAdapter()` time — no credential repetition needed.

**Example:**

```typescript
import { DriveStorageAdapter } from 'longcelot-sheet-db';

const adapter = createSheetAdapter({
  adminSheetId: process.env.ADMIN_SHEET_ID,
  credentials: { ... },
  tokens: adminTokens,
  driveFolder: { root: 'My App', subfolders: { seller: 'Sellers' } },
  sharedDriveId: process.env.SHARED_DRIVE_ID,  // optional
  tokenStore: myTokenStore,                     // optional
  storage: new DriveStorageAdapter({ folder: 'uploads' }),
});
```
