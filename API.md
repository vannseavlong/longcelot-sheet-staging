# API Documentation

## Table of Contents

- [Schema Definition](#schema-definition)
- [Column Builders](#column-builders)
- [Sheet Adapter](#sheet-adapter)
- [CRUD Operations](#crud-operations)
- [Authentication](#authentication)
- [CLI Commands](#cli-commands)

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
  tokens: any; // OAuth tokens
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

Creates a new adapter instance with user context.

**Parameters:**

```typescript
{
  userId: string;
  role: string;
  actorSheetId?: string;
}
```

**Returns:** `SheetAdapter` with context

**Example:**

```typescript
const userContext = adapter.withContext({
  userId: 'user_123',
  role: 'user',
  actorSheetId: 'sheet-id-xyz',
});
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

### `table.create(data)`

Creates a new row.

**Parameters:**

- `data: Record<string, any>` - Row data

**Returns:** `Promise<Record<string, any>>` - Created row with generated fields

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
  where?: Record<string, any>;
  limit?: number;
  offset?: number;
  orderBy?: string;
  order?: 'asc' | 'desc';
}
```

**Returns:** `Promise<Record<string, any>[]>`

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
  where?: Record<string, any>;
}
```

**Returns:** `Promise<Record<string, any> | null>`

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
  where: Record<string, any>;
  data: Record<string, any>;
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

Deletes rows matching criteria.

**Parameters:**

```typescript
{
  where: Record<string, any>;
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

**Returns:** `Promise<any>` - OAuth tokens

### `oauth.refreshTokens(refreshToken)`

Refreshes expired tokens.

**Parameters:**

- `refreshToken: string`

**Returns:** `Promise<any>` - New tokens

### `oauth.verifyToken(idToken)`

Verifies an ID token.

**Parameters:**

- `idToken: string`

**Returns:** `Promise<any>` - Token payload

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

### `sheet-db init`

Initializes a new longcelot-sheet-db project.

**Creates:**

- `sheet-db.config.ts`
- `.env`
- `schemas/` directory

### `sheet-db generate <table-name>`

Generates a new table schema interactively.

**Example:**

```bash
pnpm sheet-db generate bookings
```

### `sheet-db sync`

Syncs all schemas to Google Sheets.

**Actions:**

- Creates missing sheets
- Adds missing columns
- Never deletes existing data

### `sheet-db validate`

Validates all schemas.

**Checks:**

- Duplicate table names
- Invalid modifiers
- Unknown actors
- Missing required fields

## Type Definitions

### `TableSchema`

```typescript
interface TableSchema {
  name: string;
  actor: string;
  timestamps?: boolean;
  softDelete?: boolean;
  columns: Record<string, ColumnDefinition>;
}
```

### `ColumnDefinition`

```typescript
interface ColumnDefinition {
  type: 'string' | 'number' | 'boolean' | 'date' | 'json';
  required?: boolean;
  unique?: boolean;
  default?: any;
  min?: number;
  max?: number;
  enum?: any[];
  pattern?: RegExp;
  readonly?: boolean;
  primary?: boolean;
  ref?: string;
  index?: boolean;
}
```

### `UserContext`

```typescript
interface UserContext {
  userId: string;
  role: string;
  actorSheetId?: string;
}
```
