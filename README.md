# 📦 longcelot-sheet-db

[![CI](https://github.com/vannseavlong/longcelot-sheet-staging/actions/workflows/ci.yml/badge.svg)](https://github.com/vannseavlong/longcelot-sheet-staging/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/longcelot-sheet-db)](https://www.npmjs.com/package/longcelot-sheet-db)
[![npm downloads](https://img.shields.io/npm/dt/longcelot-sheet-db)](https://www.npmjs.com/package/longcelot-sheet-db)
[![license](https://img.shields.io/npm/l/longcelot-sheet-db)](LICENSE)

**Google Sheets-backed Staging Database for Node.js**

A schema-first, actor-aware database adapter that uses Google Sheets as the storage engine. Perfect for MVPs, prototypes, staging environments, and internal tools where cost and simplicity matter.

## 🎯 Purpose

Instead of running MySQL, PostgreSQL, or MongoDB for staging:
- Each user stores their data in **their own Google Sheet**
- Admin maintains a **single centralized registry sheet**
- Authentication powered by **Google OAuth** + optional password
- Developers define schemas that are **automatically converted into sheet tables**

## ✨ Features

- 📝 **Schema-First Design**: Define tables using a TypeScript DSL
- 🔐 **Actor-Based Isolation**: Each user role owns their own sheet
- 🔄 **Auto CRUD**: `create`, `createMany`, `findMany`, `findOne`, `count`, `update`, `upsert`, `delete`
- 🎭 **Role-Based Permissions**: Built-in security boundaries + cross-actor access matrix
- 🔑 **Authentication**: `createAuthRouter` wires Google Sign-In + JWT in one call; role-based registration policy
- 🛠️ **CLI Tools**: Initialize, generate, sync, validate, seed, export, mock-users
- 📊 **Type-Safe**: Full TypeScript support
- 💰 **Cost-Free**: No infrastructure costs for staging
- 🔒 **Schema Integrity**: Hash-based version tracking detects stale user sheets at runtime
- ♻️ **Safe Migrations**: `sync --all-users` pushes schema changes to every user sheet with rate-limit backoff
- 🚀 **CI-Friendly**: `sync --token-file` skips interactive OAuth prompt in CI/CD pipelines

## 🚀 Quick Start

### Installation

```bash
# npm
npm install longcelot-sheet-db

# pnpm
pnpm add longcelot-sheet-db

# yarn
yarn add longcelot-sheet-db

# bun
bun add longcelot-sheet-db
```

### Initialize Project

```bash
# npm
npx sheet-db init

# pnpm
pnpm dlx sheet-db init

# yarn
yarn dlx sheet-db init

# bun
bunx sheet-db init
```

This creates:
- `sheet-db.config.ts` - Project configuration
- `.env` - Environment variables
- `schemas/` - Schema directory

### Set Up Google OAuth

This package **requires Google OAuth2** to function — there is no way to skip it. OAuth is used for the backend to communicate with Google Sheets API.

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a project and enable Google Sheets API and Google Drive API
3. Create OAuth 2.0 credentials (Client ID and Client Secret)
4. Set redirect URI (e.g., `http://localhost:3000/auth/callback`)
5. Add your credentials to `.env`:

```env
GOOGLE_CLIENT_ID=your_client_id
GOOGLE_CLIENT_SECRET=your_client_secret
GOOGLE_REDIRECT_URI=http://localhost:3000/auth/callback
ADMIN_SHEET_ID=your_admin_sheet_id
```

**What if you have your own authentication?**
- OAuth is strictly for **backend-to-Google-Sheets** communication
- Your app's existing authentication (JWT, sessions, etc.) remains untouched
- You map your user identity to sheet-db context (see "Integrating into an Existing Project" below)

### Define a Schema

```typescript
import { defineTable, string, number, date } from 'longcelot-sheet-db';

export default defineTable({
  name: 'bookings',
  actor: 'user',
  timestamps: true,
  columns: {
    booking_id: string().required().unique(),
    service: string().required(),
    date: date().required(),
    status: string().enum(['pending', 'confirmed', 'cancelled']).default('pending'),
    price: number().min(0),
  },
});
```

### Use in Your Application

```typescript
import { createSheetAdapter } from 'longcelot-sheet-db';
import bookingsSchema from './schemas/user/bookings';

const adapter = createSheetAdapter({
  adminSheetId: process.env.ADMIN_SHEET_ID,
  credentials: {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    redirectUri: process.env.GOOGLE_REDIRECT_URI,
  },
  tokens: userOAuthTokens,
});

adapter.registerSchema(bookingsSchema);

const userContext = adapter.withContext({
  userId: 'user_123',
  actor: 'user',
  actorSheetId: 'user-sheet-id',
});

await userContext.table('bookings').create({
  booking_id: 'bk_001',
  service: 'Consultation',
  date: new Date().toISOString(),
  price: 100,
});

const bookings = await userContext.table('bookings').findMany({
  where: { status: 'pending' },
  limit: 10,
});
```

## 📚 Core Concepts

### Actors

Actors are **data domains** — they determine *where* data is stored (which Google Sheet and which table schemas apply). Each actor maps to a sheet ID via an environment variable:

```typescript
// sheet-db.config.ts
actors: [
  { name: "admin",  sheetIdEnv: "ADMIN_SHEET_ID" },
  { name: "user",   sheetIdEnv: "DEV_USER_SHEET_ID" },
  { name: "seller", sheetIdEnv: "DEV_SELLER_SHEET_ID" },
]
```

> `ActorConfig.role` is accepted for backward compatibility but deprecated in favour of `name` — `role` reads as an RBAC role at the exact spot autocomplete shows it, which is the confusion this field exists to prevent. See [Actors vs Application Roles](#actors-vs-application-roles) and [FAQ #2](./FAQ.md#2-actors-vs-rbac-roles).

```env
# .env
ADMIN_SHEET_ID=1ABCyourAdminSheetId
DEV_USER_SHEET_ID=1DEFyourDevUserSheetId    # optional for local dev
DEV_SELLER_SHEET_ID=1GHIyourDevSellerSheetId  # optional for local dev
```

- **admin**: Data stored in central admin sheet (always required)
- **user / seller**: Each actor gets a personal sheet at runtime; `DEV_*_SHEET_ID` values let you sync schemas during development without registering real users

`sheet-db init` scaffolds all env vars automatically based on the actors you define.

### Actors vs Application Roles

These two concepts are distinct — confusing them leads to wrong architecture decisions:

| Concept | What it controls | Dynamic? | Where defined |
|---------|-----------------|----------|---------------|
| **Actor** | *Where* data is stored (which Google Sheet, which schemas) | No — fixed in `sheet-db.config.ts` | Config file |
| **App RBAC role** | *What* a user can do (read orders, edit products, etc.) | Yes — rows in `roles` / `role_permissions` tables | Your app's DB layer |

The `actor` field in `withContext()` is the sheet-db actor concept, not an RBAC role. If you need fine-grained permissions (e.g. "manager can approve but not delete"), build a `roles` + `role_permissions` table in the admin sheet and enforce it in your application layer — sheet-db intentionally does not provide RBAC.

**Field names follow the same rule everywhere actor identity appears** — each was renamed away from `role` because the bare word `role` reads as an RBAC role at the point of writing the code, regardless of what the docs say:

| Location | Preferred field | Deprecated alias (still works, warns) |
|---|---|---|
| `sheet-db.config.ts` actor entries | `name` | `role` |
| `withContext()` | `actor` | `role` |
| `withContext()` cross-actor target | `targetActor` | `targetRole` |

Modeling RBAC sub-roles (e.g. `operation`, `finance`, `marketing`) as separate actors is the most common version of this mistake — it usually means you need rows in a `roles` / `role_permissions` table inside one actor, not one actor config entry per sub-role.

### Dev vs Production data model

In development, each actor type shares **one** sheet (`DEV_SELLER_SHEET_ID` for all sellers). In production, `createUserSheet()` creates **one sheet per registered user**. This means:

- Some bugs that only appear with per-user data isolation are invisible in dev.
- Use `sheet-db mock-users` to create separate actor sheets that mirror the production topology for more realistic local testing.

> **Tip**: Add a "Dev vs Production" section to your own `README.md` noting which tests cover per-user-sheet scenarios.

### Schema DSL

Define tables using a fluent builder API:

```typescript
{
  email: string().required().unique(),
  age: number().min(18).max(100),
  status: string().enum(['active', 'inactive']).default('active'),
  verified: boolean().default(false),
  metadata: json(),
}
```

#### Column Modifiers

- `required()` - Cannot be null
- `unique()` - Enforced uniqueness
- `default(value)` - Default value
- `min(n)` / `max(n)` - Validation constraints
- `enum([...])` - Allowed values
- `pattern(regex)` - Regex validation
- `primary()` - Primary key
- `readonly()` - Cannot be updated
- `ref(table.column)` - Foreign key reference
- `index()` - Create lookup index

### CRUD Operations

```typescript
const table = ctx.table('bookings');

// Create
await table.create({ service: 'Consultation', price: 100 });

// Bulk create — single API call
await table.createMany([
  { service: 'Consultation', price: 100 },
  { service: 'Follow-up', price: 50 },
]);

// Read
await table.findMany({
  where: { status: 'pending' },
  orderBy: 'date',
  order: 'desc',
  limit: 10,
  offset: 0,
});

await table.findOne({ where: { booking_id: 'bk_001' } });

// Count (without loading all rows)
const total = await table.count({ where: { status: 'pending' } });

// Update
await table.update({
  where: { booking_id: 'bk_001' },
  data: { status: 'confirmed' },
});

// Upsert (insert if not found, update if exists)
await table.upsert({
  where: { email: 'admin@example.com' },
  data: { role: 'admin', status: 'active' },
});

// Delete
await table.delete({ where: { booking_id: 'bk_001' } });
```

### Context & Permissions

Every operation requires context:

```typescript
const context = adapter.withContext({
  userId: 'user_123',
  actor: 'user',       // preferred — maps to the actor data domain
  actorSheetId: 'sheet-id',
});
// Note: role: is accepted for backward compatibility but deprecated in favour of actor:
```

Permissions are enforced automatically:
- Users can only access their own sheets
- Admin can access admin tables
- Cross-actor access is blocked

### Schema Version Tracking

`longcelot-sheet-db` computes a **SHA-256 hash** of every table schema and compares it against the hash stored in the built-in `schema_versions` admin table. When `withContext()` is called for a non-admin user, the check runs in the background — every subsequent CRUD call awaits the result before proceeding.

Configure the behaviour in `sheet-db.config.ts`:

```typescript
export default {
  // ...
  onSchemaMismatch: 'warn',    // log warning and continue (default)
  // onSchemaMismatch: 'error',     // throw SchemaMismatchError
  // onSchemaMismatch: 'auto-sync', // sync the actor sheet automatically
};
```

And pass it through to the adapter:

```typescript
import { createSheetAdapter } from 'longcelot-sheet-db';

const adapter = createSheetAdapter({
  adminSheetId: process.env.ADMIN_SHEET_ID,
  credentials: { clientId, clientSecret, redirectUri },
  tokens: oauthTokens,
  onSchemaMismatch: 'warn', // or 'error' or 'auto-sync'
});
```

| Mode | Behaviour |
|------|-----------|
| `'warn'` | Log a warning to stderr and continue — safe for production rollouts |
| `'error'` | Throw `SchemaMismatchError` — useful in staging to hard-fail stale clients |
| `'auto-sync'` | Silently sync the actor sheet and update the version record before proceeding |

When you push a schema change, run `sheet-db sync --all-users` to propagate it to every registered user sheet and update the version records in one go:

```bash
# Push schema changes to all user sheets
npx sheet-db sync --all-users

# Preview what would change without applying
npx sheet-db sync --all-users --dry-run
```

### Integrating into an Existing Project
If you already have a working backend (e.g., Express, NestJS), you can safely inject `longcelot-sheet-db` without ripping out your framework:

```bash
# 1. Add the package
pnpm add longcelot-sheet-db

# 2. Initialize project (creates config and schemas directory)
npx sheet-db init

# 3. Update your .env with Google OAuth credentials

# 4. Define your schemas in schemas/ directory

# 5. Sync schemas to Google Sheets
npx sheet-db sync

# 6. Use in your backend code
```

**How it works with your existing auth**:
- Your app continues to use your existing authentication (JWT, sessions, cookies)
- When you need to access data, map your authenticated user to sheet-db context:

```typescript
// Your Express/NestJS route handler
app.get('/bookings', async (req, res) => {
  // Your existing auth provides user info
  const developerUser = req.user; // From your JWT/session

  // Map to sheet-db context
  const userContext = adapter.withContext({
    userId: developerUser.id,        // Your app's user ID
    role: developerUser.role,         // 'student', 'teacher', etc.
    actorSheetId: developerUser.sheetId, // From sheet-db user registry
  });

  const bookings = await userContext.table('bookings').findMany();
  res.json(bookings);
});
```

### Google Sign-In & Auth Routes

For user-facing Google Sign-In, use `createLoginOAuthManager` (pre-configured with `openid email profile` scopes) and `createAuthRouter` to wire up the two required Express routes automatically.

#### Login-only roles (admin / manager)

```typescript
import express from 'express';
import { createSheetAdapter, createAuthRouter } from 'longcelot-sheet-db';

const adapter = createSheetAdapter({ ... });

const adminAuth = createAuthRouter({
  adapter,
  jwtSecret: process.env.JWT_SECRET!,
  frontendUrl: process.env.FRONTEND_URL!,
  registrationPolicy: 'login-only', // user must already exist — no self-signup
  async onUser(profile, adapter) {
    const ctx = adapter.withContext({
      userId: 'auth',
      role: 'admin',
      actorSheetId: process.env.ADMIN_SHEET_ID!,
    });
    return await ctx.table('users').findOne({ where: { email: profile.email } });
  },
});

app.use(adminAuth.handler);
// Exposes: GET /auth/google  and  GET /auth/callback
```

#### Open registration (regular users)

```typescript
const userAuth = createAuthRouter({
  adapter,
  jwtSecret: process.env.JWT_SECRET!,
  frontendUrl: process.env.FRONTEND_URL!,
  registrationPolicy: 'open', // allows self-signup (default)
  basePath: '/user',           // → /user/auth/google, /user/auth/callback
  async onUser(profile, adapter) {
    const ctx = adapter.withContext({
      userId: 'auth',
      role: 'admin',
      actorSheetId: process.env.ADMIN_SHEET_ID!,
    });
    let user = await ctx.table('users').findOne({ where: { email: profile.email } });
    if (!user) {
      // Auto-create the user and their sheet on first login
      const sheetId = await adapter.createUserSheet(profile.sub, 'user', profile.email);
      user = await ctx.table('users').findOne({ where: { email: profile.email } });
    }
    return user;
  },
});

app.use(userAuth.handler);
```

**Registration policy summary:**

| Policy | Behaviour |
|--------|-----------|
| `'open'` | Any Google-authenticated user can access; `onUser` returning `null` lets them in with bare profile |
| `'login-only'` | `onUser` must return a non-null user; returns `401` if user is not found |

#### Using `createLoginOAuthManager` directly

If you prefer to wire up routes manually:

```typescript
import { createLoginOAuthManager } from 'longcelot-sheet-db';

const oauth = createLoginOAuthManager({
  clientId: process.env.GOOGLE_CLIENT_ID!,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
  redirectUri: process.env.GOOGLE_REDIRECT_URI!,
});

// Step 1: redirect to Google
app.get('/auth/google', (req, res) => res.redirect(oauth.getAuthUrl()));

// Step 2: handle callback
app.get('/auth/callback', async (req, res) => {
  const tokens = await oauth.getTokens(req.query.code as string);
  const profile = await oauth.verifyToken((tokens as Record<string, string>).id_token);
  // ... lookup user, issue JWT
});
```

### Why do we need `user_id` if we have `sheet_id`?

The `sheet_id` dictates the **physical storage location** on Google Drive — it exists only in the sheet-db world. When you eventually graduate from Google Sheets to a production SQL database (MySQL, PostgreSQL), the `sheet_id` goes away entirely.

The `user_id` dictates the **logical domain identity** — it persists across all databases. This is your app's true primary key that ties your entire system together.

| Field | Purpose | Persists after migration |
|-------|---------|--------------------------|
| `sheet_id` | Physical location in Google Drive | No — Google Sheets only |
| `user_id` | Logical user identity | Yes — becomes PK in SQL |

**Migration example**: When you export to Prisma, `user_id` becomes your primary key, while `sheet_id` is simply not included in the export.

## 🛠️ CLI Commands

> All commands can be run with `npx`, `pnpm dlx`, `yarn dlx`, or `bunx` — or directly as `sheet-db <command>` if installed globally.

### Initialize Project

```bash
npx sheet-db init
# pnpm dlx sheet-db init
# yarn dlx sheet-db init
# bunx sheet-db init
```

Creates project structure and configuration files.

### Generate Schema

```bash
npx sheet-db generate bookings
# pnpm dlx sheet-db generate bookings
# yarn dlx sheet-db generate bookings
# bunx sheet-db generate bookings
```

Interactive schema generator with prompts for columns and types.

### Sync Schemas

```bash
npx sheet-db sync
# pnpm dlx sheet-db sync
# yarn dlx sheet-db sync
# bunx sheet-db sync
```

Creates missing sheets and adds missing columns (never deletes data). Iterates **all actors** defined in `sheet-db.config.ts` and prints a per-actor status table:

```
Actor      │ Sheet ID                   │ Tables   │ Status
───────────┼────────────────────────────┼──────────┼────────────
admin      │ 1ABCyourAdminSheetId       │ 3        │ ✅ synced
student    │ 1DEFyourStudentSheetId     │ 5        │ ✅ synced
teacher    │ (not set)                  │ 4        │ ⚠ skipped
```

Actors whose sheet ID env var is not set are skipped with a warning (non-fatal).

**`--all-users`** — after syncing dev actor sheets, reads all rows from the admin `users` table and pushes any missing columns/tables to every registered user sheet. Updates the `schema_versions` record for each one. Uses exponential backoff (1s → 32s) to handle Google Sheets API rate limits.

**`--dry-run`** — combine with `--all-users` to preview which user sheets are outdated without writing any changes:

```bash
npx sheet-db sync --all-users           # apply
npx sheet-db sync --all-users --dry-run # preview only
```

**`--token-file <path>`** — CI/CD-friendly: load a pre-stored tokens JSON file instead of triggering the interactive browser OAuth prompt. Inject the file from a CI secret:

```bash
# In GitHub Actions:
echo "$SHEET_DB_TOKENS" > /tmp/tokens.json
npx sheet-db sync --token-file /tmp/tokens.json
```

### Validate Schemas

```bash
npx sheet-db validate
# pnpm dlx sheet-db validate
# yarn dlx sheet-db validate
# bunx sheet-db validate
```

Checks for:
- Duplicate table names
- Invalid modifiers
- Unknown actors
- Missing required fields

### Seed Data

```bash
npx sheet-db seed <seed-file>
# pnpm dlx sheet-db seed seeds/admin.ts
```

Load initial or test data into your sheets.

**Seed file formats** — both are supported:

```typescript
// Static export (simple)
export default {
  users: [
    { email: 'admin@example.com', role: 'admin', status: 'active' },
  ],
}

// Dynamic export (receives process.env — great for CI or per-environment seeds)
export default async function(env: NodeJS.ProcessEnv) {
  return {
    users: [
      { email: env.SUPER_ADMIN_EMAIL, role: 'admin', status: 'active' },
    ],
  }
}
```

**Flags:**
- `--skip-existing` — skip rows where a unique column already matches (no error on re-seed)
- `--upsert` — update existing rows on unique conflict instead of throwing
- `--all-actors` — distribute seed data to all registered user sheets

```bash
npx sheet-db seed seeds/admin.ts --skip-existing  # idempotent re-seed
npx sheet-db seed seeds/admin.ts --upsert          # update on conflict
```

### Doctor

```bash
npx sheet-db doctor
# pnpm dlx sheet-db doctor
# yarn dlx sheet-db doctor
# bunx sheet-db doctor
```

Runs environment and configuration health checks.

### Status

```bash
npx sheet-db status
# pnpm dlx sheet-db status
# yarn dlx sheet-db status
# bunx sheet-db status
```

Shows all registered tables, actors, and their sheet IDs.

## 🔐 Authentication

### Google OAuth

```typescript
import { createOAuthManager } from 'longcelot-sheet-db';

const oauth = createOAuthManager({
  clientId: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  redirectUri: process.env.GOOGLE_REDIRECT_URI,
});

const authUrl = oauth.getAuthUrl();

const tokens = await oauth.getTokens(code);

const payload = await oauth.verifyToken(idToken);
```

### Password Hashing

```typescript
import { hashPassword, comparePassword, validatePasswordStrength } from 'longcelot-sheet-db';

const hash = await hashPassword('SecurePass123!');

const isValid = await comparePassword('SecurePass123!', hash);

const { valid, errors } = validatePasswordStrength('password');
```

## 📋 Sheet Structure

### Central Admin Sheet

- `users` - User registry with `actor_sheet_id` per user
- `credentials` - Authentication data
- `schema_versions` - Schema hash per `(actor_sheet_id, table_name)` — used for mismatch detection

### User-Owned Sheets

Each user gets their own sheet with tables based on their role:

```
user-sheet-123
  ├── profile
  ├── bookings
  ├── payments
  └── settings
```

### Sheet Formatting

Every tab created or extended by `sync` / `syncSchema()` / `createUserSheet()` is formatted automatically — no config needed:

- **Auto-fit columns** — header and data columns are resized to fit their content.
- **Header row styling** — a light fill color, frozen by default so it stays visible while scrolling.
- **Data validation dropdowns** — `boolean()` columns get a native checkbox; `string().enum([...])` columns get a dropdown of the allowed values. Both guard against invalid manual edits directly in the sheet.

Override the defaults via `sheetStyle` on `createSheetAdapter()`:

```typescript
const adapter = createSheetAdapter({
  // ...
  sheetStyle: {
    headerColor: '#E8F0FE',   // optional, falls back to this built-in default
    freezeHeader: true,       // default: true
    freezeFirstColumn: false, // default: false
  },
});
```

## 🎓 Complete Example

Coming Soon!

## 🔄 Migration Path

When you're ready for production:

1. Every schema maps cleanly to SQL tables
2. Replace `createSheetAdapter` with your DB adapter
3. Update CRUD calls (minimal changes)
4. No logic trapped in Sheets

### Which export command do I need?

| Goal | Command |
|------|---------|
| Copy table structure only (schema / DDL) | `sheet-db export --prisma` or `--sql` |
| Copy structure + admin sheet row data | `sheet-db export-data` |
| Copy structure + all user-sheet row data | `sheet-db export-data --all-users` |
| Preview export plan without writing files | add `--dry-run` to either command |

### Schema export (structure only)

```bash
# Export to Prisma schema
npx sheet-db export --prisma --output ./prisma

# Export to SQL DDL (CREATE TABLE statements)
npx sheet-db export --sql --output ./migrations
```

### Data export (row data → production DB)

```bash
# Admin sheet only
npx sheet-db export-data

# Admin sheet + all registered user sheets
npx sheet-db export-data --all-users

# Preview without writing
npx sheet-db export-data --all-users --dry-run
```

`export-data` generates a `export-data.js` script. Replace the `insertRow()` stub with your real DB client (Prisma, Sequelize, etc.) and run it once.

```typescript
// Development (Sheets)
const adapter = createSheetAdapter({ ... });

// Production (Prisma, Sequelize, etc.)
const adapter = createSQLAdapter({ ... });
```

> **Note**: `sheet-db migrate` is deprecated — use `sheet-db export-data` instead. In standard tooling (Prisma Migrate, Rails, Flyway), "migrate" means schema-only DDL changes. `export-data` correctly names what this command does: move row data.

## ⚡ Performance

- Suitable for **hundreds to low thousands** of rows
- Not suitable for millions of rows
- Read operations: ~200-500ms
- Write operations: ~300-700ms

## 🔒 Security

- bcrypt password hashing (10 rounds)
- OAuth tokens never stored in plain text
- Sheets private by default
- Role validation on every request
- No SQL injection risk

## 📦 Architecture

```
Developer Backend
      ↓
longcelot-sheet-db SDK
      ↓
Google OAuth2 → Google Sheets API
      ↓
Central Admin Sheet
      ↓
User-Owned Sheets
```

## 🎯 Use Cases

Perfect for:
- ✅ MVPs and prototypes
- ✅ Staging environments
- ✅ Internal tools
- ✅ School/small business apps
- ✅ Proof of concepts

Not suitable for:
- ❌ Production at scale
- ❌ High-performance applications
- ❌ Real-time analytics
- ❌ Millions of records

## 🤝 Contributing

Contributions welcome! This package is designed to be:
- Simple over clever
- Explicit over implicit
- Safe over fast

## 📄 License

MIT

## 🙏 Acknowledgments

Built on:
- [Google Sheets API](https://developers.google.com/sheets/api)
- [googleapis](https://github.com/googleapis/google-api-nodejs-client)
- [bcryptjs](https://github.com/dcodeIO/bcrypt.js)
- [commander](https://github.com/tj/commander.js)
- [inquirer](https://github.com/SBoudrias/Inquirer.js)

---

**Note**: This is a staging database solution. For production workloads, migrate to MySQL, PostgreSQL, or MongoDB.
