---
name: core
description: Set up and configure longcelot-sheet-db. Use when installing the package, creating a SheetAdapter, providing OAuth credentials and tokens, wiring environment variables, configuring schema mismatch behavior, adding a cross-actor permissions matrix, configuring Drive folder organisation (driveFolder), Shared Drive (sharedDriveId), per-actor token persistence (tokenStore), file upload (storage / DriveStorageAdapter), or connecting the adapter to an existing backend (Express, NestJS, etc.).
license: MIT
metadata:
  package: longcelot-sheet-db
  version: "0.1.19"
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
  tokens: unknown;                                        // admin Google OAuth2 token object
  onSchemaMismatch?: SchemaMismatchBehaviour;             // 'warn' | 'error' | 'auto-sync'
  permissions?: Record<string, ActorPermission>;          // cross-actor access matrix
  driveFolder?: DriveFolderConfig;                        // folder organisation in Drive
  sharedDriveId?: string;                                 // target a Google Workspace Shared Drive
  tokenStore?: TokenStore;                                // per-actor OAuth token persistence
  storage?: StorageAdapter;                               // file upload provider
  sheetStyle?: SheetStyleConfig;                          // header color, frozen rows/columns
}
```

For Drive folder organisation, actor-owned sheets, Shared Drive, `TokenStore`, and `StorageAdapter` / `DriveStorageAdapter`, see `skills/drive/SKILL.md`.

> **Actor field naming**: every field that identifies an actor is named `name`/`actor`/`targetActor` — never `role` — because `role` reads as an application RBAC role at the point of writing the code. `sheet-db.config.ts` actor entries use `{ name: 'admin', sheetIdEnv: ... }`; `withContext()` uses `actor:`/`targetActor:`. The old `role`/`targetRole` fields still work as deprecated aliases (emit `console.warn`) but should not be used in new code. Modeling RBAC sub-roles as separate actors is the most common mistake this causes — see `skills/permissions/SKILL.md`.

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
    actor: user.actorType,        // must match an actor `name` defined in your config
    actorSheetId: user.sheetId,   // Google Sheet ID for this user's actor
  });

  const bookings = await ctx.table('bookings').findMany();
  res.json(bookings);
});
```

---

## Creating a User Sheet on Registration

When a new user registers, create their personal sheet and register them in the admin users table:

```typescript
// Basic — sheet created in admin's Drive (previous behaviour, unchanged)
const sheetId = await adapter.createUserSheet(userId, role, email);

// With options — sheet created in the actor's own Drive when actorTokens provided
const sheetId = await adapter.createUserSheet(userId, role, email, {
  actorTokens: tokensFromGoogleCallback, // OAuthTokens from oauth.getTokens(code)
  extraFields: { display_name: 'Alice' }, // extra columns in the users table row
});
// Creates a new Google Spreadsheet named '{role}-{userId}'
// Adds all tables for that role as sheet tabs with correct headers
// Inserts a row in admin 'users' table with user_id, role, email, actor_sheet_id + extraFields
// Returns the new sheetId — store it in your JWT/session for withContext() calls
```

See `skills/drive/SKILL.md` for the full actor-owned sheet pattern and `TokenStore`.

---

## asActor() Helper

Switch context to a different target actor without reconstructing the full context:

```typescript
const teacherCtx = adapter.withContext({
  userId: 'teacher_001',
  actor: 'teacher',
  actorSheetId: 'teacher-sheet-id',
});

// Switch to access a student's sheet (requires permissions config)
const crossCtx = teacherCtx.asActor('student', 'student-sheet-id');
await crossCtx.table('scores').findMany();
```

---

## Sheet Formatting

Every tab created or extended by `syncSchema()` / `createUserSheet()` is auto-formatted: columns auto-fit to content, the header row gets a fill color and is frozen, and `boolean()`/`enum()` columns get dropdown data validation (`ONE_OF_LIST` — deliberately not a native checkbox for `boolean()`, see FAQ.md #10). No config is required.

The validation range is bounded (200 rows past the data that existed at sync time, not the whole sheet — see FAQ.md #10) but self-heals as rows are appended: `create()` automatically re-extends it every 100 rows so dropdown UI keeps up with organic growth between syncs. Bulk inserts via `createMany()` don't trigger this — run `sheet-db sync` after a large seed/migration to format the new rows.

Override the defaults:

```typescript
const adapter = createSheetAdapter({
  // ...
  sheetStyle: {
    headerColor: '#E8F0FE',      // optional, this is also the built-in default
    freezeHeader: true,          // default: true
    freezeFirstColumn: false,    // default: false
    booleanFormat: 'TRUE_FALSE', // default: 'TRUE_FALSE', or '1_0'
  },
});
```

`booleanFormat` is the project-wide default for every `boolean()` column. Override one column without changing the rest via `boolean({ format: '1_0' })` — see `skills/schema/SKILL.md`.

---

## Common Mistakes

- **Missing `registerSchema()` before `table()`** — Calling `adapter.table('x')` before `registerSchema()` throws `SchemaError: Table x is not registered`.
- **Wrong `actorSheetId` in `withContext()`** — The `actorSheetId` must belong to a sheet owned by that role; using the admin sheet ID for a non-admin actor causes a `PermissionError`.
- **Stale/expired OAuth tokens** — Access tokens expire after 1 hour. Pass refreshed tokens from `OAuthManager.refreshTokens()` when constructing the adapter.
- **Not calling `registerSchema()` for FK-referenced tables** — If a schema uses `ref('users._id')`, the `users` schema must also be registered or FK validation throws `SchemaError: Referenced table 'users' is not registered`.
- **ESM/CJS mismatch** — The package ships CommonJS. Do **not** upgrade `chalk`, `inquirer`, or `nanoid` to ESM-only versions (chalk v5+, inquirer v9+, nanoid v4+) without migrating the project to ESM.
