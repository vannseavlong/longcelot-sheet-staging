---
name: core
description: Set up and configure longcelot-sheet-db. Use when installing the package, creating a SheetAdapter, providing OAuth credentials and tokens, wiring environment variables, configuring schema mismatch behavior, adding a cross-actor permissions matrix, or connecting the adapter to an existing backend (Express, NestJS, etc.).
license: MIT
metadata:
  package: longcelot-sheet-db
  version: "0.1.15"
---

# longcelot-sheet-db — Core Setup

`longcelot-sheet-db` is a schema-first, actor-aware database adapter that uses **Google Sheets as the storage engine**. Designed for MVPs, prototypes, staging environments, and internal tools where zero infrastructure cost is a priority.

## Installation

```bash
npm install longcelot-sheet-db
pnpm add longcelot-sheet-db
yarn add longcelot-sheet-db
bun add longcelot-sheet-db
```

---

## Required Environment Variables

```env
GOOGLE_CLIENT_ID=your_client_id
GOOGLE_CLIENT_SECRET=your_client_secret
GOOGLE_REDIRECT_URI=http://localhost:3000/auth/callback
ADMIN_SHEET_ID=your_central_admin_google_sheet_id
SUPER_ADMIN_EMAIL=admin@example.com
```

> `GOOGLE_REDIRECT_URI` must exactly match a URI registered in the Google Cloud Console OAuth 2.0 credentials.

---

## Creating the Adapter

```typescript
import { createSheetAdapter } from 'longcelot-sheet-db';

const adapter = createSheetAdapter({
  adminSheetId: process.env.ADMIN_SHEET_ID!,
  credentials: {
    clientId: process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    redirectUri: process.env.GOOGLE_REDIRECT_URI!,
  },
  tokens: userOAuthTokens, // obtained from OAuthManager.getTokens()
});
```

### Full SheetAdapterConfig type

```typescript
interface SheetAdapterConfig {
  adminSheetId: string;
  credentials: {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
  };
  tokens: unknown;                          // Google OAuth2 token object
  onSchemaMismatch?: SchemaMismatchBehaviour; // 'warn' | 'error' | 'auto-sync'
  permissions?: Record<string, ActorPermission>; // cross-actor access matrix
}
```

---

## Registering Schemas

Schemas **must** be registered before calling `adapter.table()`:

```typescript
import bookingsSchema from './schemas/user/bookings';
import usersSchema from './schemas/admin/users';

adapter.registerSchema(bookingsSchema);
// or register many at once:
adapter.registerSchemas([bookingsSchema, usersSchema]);
```

---

## Schema Mismatch Detection

`onSchemaMismatch` detects when a user's sheet has an outdated schema (e.g., missing new columns). The check runs automatically on `withContext()` for non-admin users.

```typescript
const adapter = createSheetAdapter({
  // ...
  onSchemaMismatch: 'warn',      // log warning and continue (default)
  // onSchemaMismatch: 'error',  // throw SchemaMismatchError
  // onSchemaMismatch: 'auto-sync', // sync the user sheet silently before proceeding
});
```

| Mode | Behaviour |
|---|---|
| `'warn'` | Logs to stderr and continues — safe for production rollouts |
| `'error'` | Throws `SchemaMismatchError` — hard-fail on stale clients |
| `'auto-sync'` | Silently syncs and updates the schema version record |

Run `sheet-db sync --all-users` to push schema changes to all registered user sheets proactively.

---

## Cross-Actor Permissions Matrix

When one role needs to access another role's sheets (e.g., teacher accessing student data), configure a `permissions` map:

```typescript
const adapter = createSheetAdapter({
  // ...
  permissions: {
    teacher: {
      canAccess: ['student'],           // roles this actor can access
      tables: ['scores', 'attendance'], // omit to allow all tables
    },
    parent: {
      canAccess: ['student'],
      tables: ['scores'],
    },
  },
});
```

See `skills/permissions/SKILL.md` for full cross-actor CRUD examples.

---

## Integrating with an Existing Backend

OAuth in this package is strictly for **backend-to-Google-Sheets** communication. Your app's own authentication (JWT, sessions, etc.) is untouched.

```typescript
// Express example
app.get('/bookings', async (req, res) => {
  const user = req.user; // from your JWT middleware

  const ctx = adapter.withContext({
    userId: user.id,
    role: user.role,             // must match an actor defined in your config
    actorSheetId: user.sheetId, // Google Sheet ID for this user's role
  });

  const bookings = await ctx.table('bookings').findMany();
  res.json(bookings);
});
```

---

## Creating a User Sheet on Registration

When a new user registers, create their personal sheet and register them in the admin users table:

```typescript
const sheetId = await adapter.createUserSheet(userId, role, email);
// Creates a new Google Spreadsheet named '{role}-{userId}'
// Adds all tables for that role as sheet tabs with headers
// Inserts a row in admin 'users' table with user_id, role, email, actor_sheet_id
// Returns the new sheetId — store it for future withContext() calls
```

---

## asActor() Helper

Switch context to a different target actor without reconstructing the full context:

```typescript
const teacherCtx = adapter.withContext({
  userId: 'teacher_001',
  role: 'teacher',
  actorSheetId: 'teacher-sheet-id',
});

// Switch to access a student's sheet (requires permissions config)
const crossCtx = teacherCtx.asActor('student', 'student-sheet-id');
await crossCtx.table('scores').findMany();
```

---

## Common Mistakes

- **Missing `registerSchema()` before `table()`** — Calling `adapter.table('x')` before `registerSchema()` throws `SchemaError: Table x is not registered`.
- **Wrong `actorSheetId` in `withContext()`** — The `actorSheetId` must belong to a sheet owned by that role; using the admin sheet ID for a non-admin actor causes a `PermissionError`.
- **Stale/expired OAuth tokens** — Access tokens expire after 1 hour. Pass refreshed tokens from `OAuthManager.refreshTokens()` when constructing the adapter.
- **Not calling `registerSchema()` for FK-referenced tables** — If a schema uses `ref('users._id')`, the `users` schema must also be registered or FK validation throws `SchemaError: Referenced table 'users' is not registered`.
- **ESM/CJS mismatch** — The package ships CommonJS. Do **not** upgrade `chalk`, `inquirer`, or `nanoid` to ESM-only versions (chalk v5+, inquirer v9+, nanoid v4+) without migrating the project to ESM.
