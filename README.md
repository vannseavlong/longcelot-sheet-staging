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
- 🛠️ **CLI Tools**: Initialize, generate, sync, validate, seed, migrate, drop/rename schema elements, mock-users
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
npx lsdb init

# pnpm
pnpm dlx lsdb init

# yarn
yarn dlx lsdb init

# bun
bunx lsdb init
```

This creates:
- `lsdb.config.ts` - Project configuration
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
- You map your user identity to lsdb context (see "Integrating into an Existing Project" below)

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
// lsdb.config.ts
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

`lsdb init` scaffolds all env vars automatically based on the actors you define.

### Actors vs Application Roles

These two concepts are distinct — confusing them leads to wrong architecture decisions:

| Concept | What it controls | Dynamic? | Where defined |
|---------|-----------------|----------|---------------|
| **Actor** | *Where* data is stored (which Google Sheet, which schemas) | No — fixed in `lsdb.config.ts` | Config file |
| **App RBAC role** | *What* a user can do (read orders, edit products, etc.) | Yes — rows in `roles` / `role_permissions` tables | Your app's DB layer |

The `actor` field in `withContext()` is the lsdb actor concept, not an RBAC role. If you need fine-grained permissions (e.g. "manager can approve but not delete"), build a `roles` + `role_permissions` table in the admin sheet and enforce it in your application layer — lsdb intentionally does not provide RBAC.

**Field names follow the same rule everywhere actor identity appears** — each was renamed away from `role` because the bare word `role` reads as an RBAC role at the point of writing the code, regardless of what the docs say:

| Location | Preferred field | Deprecated alias (still works, warns) |
|---|---|---|
| `lsdb.config.ts` actor entries | `name` | `role` |
| `withContext()` | `actor` | `role` |
| `withContext()` cross-actor target | `targetActor` | `targetRole` |

Modeling RBAC sub-roles (e.g. `operation`, `finance`, `marketing`) as separate actors is the most common version of this mistake — it usually means you need rows in a `roles` / `role_permissions` table inside one actor, not one actor config entry per sub-role.

### Dev vs Production data model

In development, each actor type shares **one** sheet (`DEV_SELLER_SHEET_ID` for all sellers). In production, `createUserSheet()` creates **one sheet per registered user**. This means:

- Some bugs that only appear with per-user data isolation are invisible in dev.
- Use `lsdb mock-users` to create separate actor sheets that mirror the production topology for more realistic local testing.

> **Tip**: Add a "Dev vs Production" section to your own `README.md` noting which tests cover per-user-sheet scenarios.

This same per-user isolation generalizes directly to the SQL adapters ([Migration Path](#-migration-path)): each non-admin table gets an injected `tenant_id` column, and `context.actorSheetId` — a real spreadsheet ID on Sheets — becomes the opaque `tenant_id` value on Postgres/MySQL/Prisma. Admin tables have no `tenant_id` column at all, matching Sheets' single global admin sheet. See [FAQ.md §13](./FAQ.md#13-sql-backend-portability--tenancy) for the full design rationale.

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
- `default(value)` - Default value, applied on `create()` only (accepts arrays/objects for `json()` columns)
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

Configure the behaviour in `lsdb.config.ts`:

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

When you push a schema change, run `lsdb sync --all-users` to propagate it to every registered user sheet and update the version records in one go:

```bash
# Push schema changes to all user sheets
npx lsdb sync --all-users

# Preview what would change without applying
npx lsdb sync --all-users --dry-run
```

### Integrating into an Existing Project
If you already have a working backend (e.g., Express, NestJS), you can safely inject `longcelot-sheet-db` without ripping out your framework:

```bash
# 1. Add the package
pnpm add longcelot-sheet-db

# 2. Initialize project (creates config and schemas directory)
npx lsdb init

# 3. Update your .env with Google OAuth credentials

# 4. Define your schemas in schemas/ directory

# 5. Sync schemas to Google Sheets
npx lsdb sync

# 6. Use in your backend code
```

**How it works with your existing auth**:
- Your app continues to use your existing authentication (JWT, sessions, cookies)
- When you need to access data, map your authenticated user to lsdb context:

```typescript
// Your Express/NestJS route handler
app.get('/bookings', async (req, res) => {
  // Your existing auth provides user info
  const developerUser = req.user; // From your JWT/session

  // Map to lsdb context
  const userContext = adapter.withContext({
    userId: developerUser.id,        // Your app's user ID
    role: developerUser.role,         // 'student', 'teacher', etc.
    actorSheetId: developerUser.sheetId, // From lsdb user registry
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

The `sheet_id` dictates the **physical storage location** on Google Drive — it exists only in the lsdb world. When you eventually graduate from Google Sheets to a production SQL database (MySQL, PostgreSQL), the `sheet_id` goes away entirely.

The `user_id` dictates the **logical domain identity** — it persists across all databases. This is your app's true primary key that ties your entire system together.

| Field | Purpose | Persists after migration |
|-------|---------|--------------------------|
| `sheet_id` | Physical location in Google Drive | No — Google Sheets only |
| `user_id` | Logical user identity | Yes — becomes PK in SQL |

**Migration example**: When you export to Prisma, `user_id` becomes your primary key, while `sheet_id` is simply not included in the export.

## 🛠️ CLI Commands

> All commands can be run with `npx`, `pnpm dlx`, `yarn dlx`, or `bunx` — or directly as `lsdb <command>` if installed globally.

### Initialize Project

```bash
npx lsdb init
# pnpm dlx lsdb init
# yarn dlx lsdb init
# bunx lsdb init
```

Creates project structure and configuration files.

### Generate Schema

```bash
npx lsdb generate bookings
# pnpm dlx lsdb generate bookings
# yarn dlx lsdb generate bookings
# bunx lsdb generate bookings
```

Interactive schema generator with prompts for columns and types.

### Sync Schemas

```bash
npx lsdb sync
# pnpm dlx lsdb sync
# yarn dlx lsdb sync
# bunx lsdb sync
```

Creates missing sheets and adds missing columns (never deletes data). Iterates **all actors** defined in `lsdb.config.ts` and prints a per-actor status table:

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
npx lsdb sync --all-users           # apply
npx lsdb sync --all-users --dry-run # preview only
```

**`--token-file <path>`** — CI/CD-friendly: load a pre-stored tokens JSON file instead of triggering the interactive browser OAuth prompt. Inject the file from a CI secret:

```bash
# In GitHub Actions:
echo "$LSDB_TOKENS" > /tmp/tokens.json
npx lsdb sync --token-file /tmp/tokens.json
```

### Validate Schemas

```bash
npx lsdb validate
# pnpm dlx lsdb validate
# yarn dlx lsdb validate
# bunx lsdb validate
```

Checks for:
- Duplicate table names
- Invalid modifiers
- Unknown actors
- Missing required fields

### Seed Data

```bash
npx lsdb seed <seed-file>
# pnpm dlx lsdb seed seeds/admin.ts
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
npx lsdb seed seeds/admin.ts --skip-existing  # idempotent re-seed
npx lsdb seed seeds/admin.ts --upsert          # update on conflict
```

### Doctor

```bash
npx lsdb doctor
# pnpm dlx lsdb doctor
# yarn dlx lsdb doctor
# bunx lsdb doctor
```

Runs environment and configuration health checks.

### Status

```bash
npx lsdb status
# pnpm dlx lsdb status
# yarn dlx lsdb status
# bunx lsdb status
```

Shows all registered tables, actors, and their sheet IDs.

### ER Diagram

```bash
npx lsdb erdiagram
# pnpm dlx lsdb erdiagram
# yarn dlx lsdb erdiagram
# bunx lsdb erdiagram
```

Generates `ER-DIAGRAM.md` (Mermaid `erDiagram`) mapping every registered table, its columns, and `ref()` relationships — offline, no Google Sheets calls. If the file already exists, prompts to overwrite, save under a different name, or cancel; pass `--yes` to overwrite non-interactively, or `--output <file>` to target a different path.

```bash
npx lsdb erdiagram --output docs/schema.md
npx lsdb erdiagram --yes
```

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

### Sign-In Router (`createAuthRouter`)

```typescript
import { createAuthRouter, verifyJwt } from 'longcelot-sheet-db';

const auth = createAuthRouter({
  adapter,
  jwtSecret: process.env.JWT_SECRET!,
  frontendUrl: process.env.FRONTEND_URL!,
  registrationPolicy: 'login-only',
  jwtExpiresInSeconds: 60 * 60 * 24, // default: 1 day
  tokenDelivery: 'fragment', // '#token=...' — never hits server access logs/Referer; default is 'query' for backward compatibility
  scopes: ['openid', 'email', 'profile'], // default: LOGIN_SCOPES (adds Sheets/Drive) — trim to identity-only to skip Google's sensitive-scope verification screen
  async onUser(profile, adapter) {
    const ctx = adapter.withContext({ userId: 'auth', actor: 'admin', actorSheetId: process.env.ADMIN_SHEET_ID! });
    return await ctx.table('users').findOne({ where: { email: profile.email } });
  },
});

app.use(auth.handler); // GET {basePath}/auth/google, GET {basePath}/auth/callback

// In your own auth middleware, verify the JWT this router issues:
const payload = verifyJwt(token, process.env.JWT_SECRET!); // null if invalid, expired, or tampered
```

The login flow is CSRF-protected with a signed `state` parameter and the issued JWT carries an `exp`
claim — see [OWASP-TOP-10.md → A01/A02/A07](./OWASP-TOP-10.md) for the reasoning.

`scopes` must include `'openid'` — the callback needs an `id_token` to build the `GoogleProfile`
passed to `onUser`; omitting it throws `ValidationError` when `createAuthRouter()` is called. See
[`skills/auth-router/SKILL.md`](./skills/auth-router/SKILL.md#trimming-oauth-scopes-avoiding-the-unverified-app-screen)
for when to trim scopes and what `spreadsheets`/`drive.file` being Google-classified *sensitive*
scopes means for the consent screen.

### Password Hashing

```typescript
import { hashPassword, comparePassword, validatePasswordStrength } from 'longcelot-sheet-db';

const hash = await hashPassword('SecurePass123!');

const isValid = await comparePassword('SecurePass123!', hash);

const { valid, errors } = validatePasswordStrength('password');
```

## 📁 File Upload & Drive Storage

```typescript
import { createSheetAdapter, DriveStorageAdapter } from 'longcelot-sheet-db';

const adapter = createSheetAdapter({
  ...,
  storage: new DriveStorageAdapter({ folder: 'uploads' }),
});

// Returns a URL that renders directly — no per-project conversion helper needed.
const avatarUrl = await adapter.upload(imageBuffer, { filename: 'avatar.jpg', mimeType: 'image/jpeg', public: true });
// 'https://drive.google.com/thumbnail?id=FILE_ID&sz=w1000'  → drop straight into <img src>

const videoUrl = await adapter.upload(videoBuffer, { filename: 'demo.mp4', mimeType: 'video/mp4', public: true });
// 'https://drive.google.com/file/d/FILE_ID/preview'          → drop straight into <iframe src>

const pdfUrl = await adapter.upload(pdfBuffer, { filename: 'invoice.pdf', mimeType: 'application/pdf', public: true });
// 'https://drive.google.com/file/d/FILE_ID/view'              → clickable open/preview link

// Deleting a file works with any URL adapter.upload() ever returned for it:
await adapter.deleteFile(avatarUrl);
```

The link format is chosen automatically from `mimeType` (image → thumbnail, video → embeddable preview, everything else → viewer link). If you need the raw downloadable file instead of a rendered preview (e.g. re-fetching bytes server-side), pass `linkFormat: 'download'`.

Already have links saved in the old `uc?id=` download format from before this behaviour shipped? Normalise them on read instead of writing your own conversion helper:

```typescript
import { toDriveEmbedUrl } from 'longcelot-sheet-db';

const embeddable = toDriveEmbedUrl(row.avatar_url, 'image');
```

See [`UploadOptions`](./API.md#uploadoptions) and [`adapter.upload()`](./API.md#adapteruploadfile-options) in API.md for the full option/return reference, and FAQ.md §14 for why the raw `uc?id=` link never rendered reliably.

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
- **Data validation dropdowns** — `boolean()` columns get a dropdown restricted to `TRUE`/`FALSE` (or `1`/`0`, see below); `string().enum([...])` columns get a dropdown of the allowed values. Both guard against invalid manual edits directly in the sheet.

Override the defaults via `sheetStyle` on `createSheetAdapter()`:

```typescript
const adapter = createSheetAdapter({
  // ...
  sheetStyle: {
    headerColor: '#E8F0FE',     // optional, falls back to this built-in default
    freezeHeader: true,         // default: true
    freezeFirstColumn: false,   // default: false
    booleanFormat: 'TRUE_FALSE', // default: 'TRUE_FALSE', or '1_0'
  },
});
```

Override per column instead of project-wide with `boolean({ format: '1_0' })` — useful when one table needs to match an external system's convention without changing every other table.

### Read Caching & Rate Limits

`findMany()`, `findOne()`, `count()`, `update()`, and `delete()` all read through an in-memory cache in `SheetClient`, enabled by default with a 2-second TTL — repeated or concurrent reads of the same tab within that window are served from cache or de-duplicated into a single Sheets API call instead of one call each. This exists because Google's default quota (60 read requests/min/user) is easy to exhaust once more than a couple of concurrent users are hitting the same tables — see FAQ.md #11 for the incident that motivated it.

Every write invalidates the cache for the tab it touched, so a read right after a write always sees fresh data. Tune or disable it via `cache` on `createSheetAdapter()`:

```typescript
const adapter = createSheetAdapter({
  // ...
  cache: { ttlMs: 5000 }, // default: 2000ms; set enabled: false to disable
});
```

## 🎓 Complete Example

Coming Soon!

## 🔄 Migration Path

When you're ready for production, swapping `createSheetAdapter` for a real database is a **config/factory change, not a CRUD-call rewrite** — `SheetAdapter` and the SQL adapters below all implement the same `DatabaseAdapter`/`TableOperations` contract, so `adapter.withContext({...}).table('products').create({...})` reads identically either way. See [FAQ.md §13](./FAQ.md#13-sql-backend-portability--tenancy) for the tenancy design behind this.

```typescript
import { createDatabaseAdapter } from 'longcelot-sheet-db';

// Picks the engine from $DB_DRIVER ('sheets' | 'postgres' | 'mysql'), or pass driver explicitly.
// A dev's .env points at sheets; CI/production's env points at postgres/mysql — zero code branching.
const adapter = createDatabaseAdapter();
adapter.registerSchemas(schemas);
```

```typescript
// Or construct a specific engine directly:
import { createSheetAdapter, createPostgresAdapter, createMySQLAdapter, createPrismaAdapter } from 'longcelot-sheet-db';

const dev = createSheetAdapter({ adminSheetId, credentials, tokens });
const prod = createPostgresAdapter({ connectionString: process.env.DATABASE_URL });
const prodMysql = createMySQLAdapter({ connectionString: process.env.DATABASE_URL });

// Prisma: pass an already-`prisma generate`'d client — this package never runs Prisma codegen
// itself (see FAQ.md §13). Run `lsdb migrate --prisma` + `prisma generate` first.
import { PrismaClient } from '@prisma/client';
const prodPrisma = createPrismaAdapter({ client: new PrismaClient() });
```

Install only the driver you target — `pg`/`mysql2` are optional peer dependencies, lazily required only inside `createPostgresAdapter()`/`createMySQLAdapter()`, so `npm install longcelot-sheet-db` alone never pulls either in:

```bash
npm install longcelot-sheet-db
npm install pg        # only if targeting Postgres
npm install mysql2    # only if targeting MySQL
npm install prisma @prisma/client   # only if targeting Prisma
```

### Which migrate command do I need?

| Goal | Command |
|------|---------|
| Copy table structure only (schema / DDL) | `lsdb migrate --prisma` or `--sql` |
| Apply that DDL to a live Postgres/MySQL database | `lsdb migrate --sql --apply --connection-string $DATABASE_URL` |
| Copy structure + admin sheet row data | `lsdb migrate-data` |
| Copy structure + all user-sheet row data | `lsdb migrate-data --all-users` |
| Run the data cutover now, no generated script | `lsdb migrate-data --run --connection-string $DATABASE_URL --driver postgres` |
| Preview any of the above without writing/executing | add `--dry-run` |

### Schema export (structure only)

```bash
# Export to Prisma schema
npx lsdb migrate --prisma --output ./prisma

# Export to SQL DDL (CREATE TABLE statements)
npx lsdb migrate --sql --output ./migrations

# Export AND apply directly to a live database — idempotent, safe to rerun
npx lsdb migrate --sql --apply --connection-string postgres://user:pass@host/db
npx lsdb migrate --sql --apply --driver mysql --connection-string $DATABASE_URL

# Prisma: shells out to `prisma migrate deploy` (needs an existing migrations/ folder —
# run `prisma migrate dev` once locally first)
npx lsdb migrate --prisma --apply
```

`--driver` is inferred from the connection string's scheme (`postgres://`/`postgresql://` → postgres, `mysql://` → mysql) when omitted. `--dry-run` prints the statements that would run without executing them.

### Data export (row data → production DB)

```bash
# Generate a migrate-data.js script (admin sheet only)
npx lsdb migrate-data

# Admin sheet + all registered user sheets
npx lsdb migrate-data --all-users

# Preview without writing
npx lsdb migrate-data --all-users --dry-run

# Only migrate specific tables (comma-separated) instead of everything
npx lsdb migrate-data --table users,credentials,setup

# Run the cutover now, in-process — no generated script, no insertRow() stub to fill in
npx lsdb migrate-data --run --all-users --connection-string $DATABASE_URL --driver postgres

# Partial cutover: run now, but only for a specific set of tables
npx lsdb migrate-data --run --table users,credentials,setup --connection-string $DATABASE_URL --driver postgres
```

Without `--run`, `migrate-data` generates a `migrate-data.js` script — replace the `insertRow()` stub with your real DB client and run it once. With `--run`, the cutover happens immediately against `createPostgresAdapter`/`createMySQLAdapter` (not Prisma — see [FAQ.md §13](./FAQ.md#13-sql-backend-portability--tenancy) for why), upserting every row by `_id` so reruns are safe by default — no separate `--upsert` flag needed. `--token-file` works the same as it does for `sync --token-file`, for CI/CD.

`--table <names>` restricts the migration to specific tables instead of everything — pass a single name or a comma-separated list (e.g. `--table users,credentials,setup`) when a use case only needs a subset of the data moved. Works with both the script-generation path and `--run`; an unknown table name fails fast and lists exactly which name(s) weren't found instead of silently skipping them.

> **Note**: `lsdb export` and `lsdb export-data` are deprecated — use `lsdb migrate` and `lsdb migrate-data` instead. In standard tooling (Prisma Migrate, Rails, Flyway), "migrate" means schema-only DDL changes, so the schema/DDL export command is now the one named `migrate`; the row-data export command is `migrate-data`.

### Reference CI/CD pipeline

`--apply`/`--run` are built to be invoked unattended from a deploy pipeline — same secrets convention as `sync --token-file` (`$DATABASE_URL` / a secret manager entry for the connection string, a stored tokens file for the Sheets read side), idempotent by default, `--dry-run` on both for a gated diff-review step. A typical GitHub Actions job:

```yaml
# In GitHub Actions:
jobs:
  deploy:
    steps:
      - uses: actions/checkout@v4
      - run: pnpm install --frozen-lockfile && pnpm build

      # Schema: apply to staging, smoke test, then production only on a version tag —
      # mirrors this package's own `publish` job's `if: startsWith(github.ref, 'refs/tags/v')` gate.
      - run: npx lsdb migrate --sql --apply --connection-string ${{ secrets.STAGING_DATABASE_URL }}
      - run: <your smoke test against staging>
      - if: startsWith(github.ref, 'refs/tags/v')
        run: npx lsdb migrate --sql --apply --connection-string ${{ secrets.PRODUCTION_DATABASE_URL }}

      # Data cutover — run once (or repeatedly during a dual-write transition window, see below),
      # not on every deploy.
      - if: startsWith(github.ref, 'refs/tags/v')
        run: |
          npx lsdb migrate-data --run --all-users \
            --connection-string ${{ secrets.PRODUCTION_DATABASE_URL }} \
            --driver postgres \
            --token-file token.json
```

**When does "ship to production" actually happen?** Two options:

- **Dual-write-then-flip (recommended default)** — both stores stay populated during a transition window: keep writing to Sheets as usual, rerun `migrate-data --run` periodically to keep the SQL side current (safe — always idempotent), then flip `DB_DRIVER=postgres` (via `createDatabaseAdapter()`) at deploy time once you're confident. Rollback is just flipping the env var back, since Sheets was never stopped.
- **One-shot cutover** — run `migrate-data --run` once, flip the driver, and stop writing to Sheets entirely. Simpler, but harder to roll back from: the SQL adapters never auto-create/alter schema at runtime (§16.2), so there's no automatic "flip back and resync" path once Sheets stops being the source of truth.

See [FAQ.md §13](./FAQ.md#13-sql-backend-portability--tenancy) for the full tenancy/cutover design rationale.

## 🗑️ Dropping & Renaming Schema Elements

`lsdb sync` is deliberately **additive-only** — it creates tabs and appends missing columns, but never removes or renames anything, so it can never lose data on its own. Once a table or column is no longer needed (or needs a better name), use these commands to update the schema file *and* the live Google Sheet together:

```bash
# Drop table(s) — deletes the schema file and the Google Sheet tab
npx lsdb drop-table bookings
npx lsdb drop-table                    # interactive checkbox — pick any number of tables
npx lsdb drop-table --all-users        # also drop from every registered user's personal sheet

# Drop column(s) from a table
npx lsdb drop-column bookings notes
npx lsdb drop-column bookings          # interactive checkbox over that table's columns
npx lsdb drop-column                   # interactive: pick the table, then its columns

# Rename a column — updates the header cell in place, existing row data is preserved
npx lsdb rename-column bookings notes remarks
npx lsdb rename-column                 # interactive: pick table, pick column, type new name
```

All three:
- Print a plan and ask for confirmation before touching anything (skip with `--yes`)
- Support `--dry-run` to preview without making changes
- Support `--all-users` to also apply the change to every registered user's personal sheet (reads `actor_sheet_id` from the admin `users` table, same as `sync --all-users`)
- Support `--token-file <path>` for CI
- Refuse to touch reserved auto-generated columns (`_id`, `_created_at`, `_updated_at`, `_deleted_at`); `drop-column` also refuses to drop a table's primary key column (drop the whole table instead)
- Warn — but don't block — if another table's `ref()` points at the table/column being dropped or renamed, since `ref()` strings in *other* schema files aren't rewritten automatically

`rename-column` is the safe way to fix a column name: it edits the Google Sheet header cell in place instead of dropping and re-adding the column, so every existing row keeps its data. This matters most for production, where a bad rename that instead did drop+re-add would silently wipe that column's data across every registered user's sheet the next time it synced.

## ⚡ Performance

- Suitable for **hundreds to low thousands** of rows
- Not suitable for millions of rows
- Read operations: ~200-500ms
- Write operations: ~300-700ms

## 🔒 Security

- bcrypt password hashing (10 rounds), with a guard against silent truncation past bcrypt's 72-byte input limit
- Auth JWTs are short-lived (`exp` claim, 1 day by default) and verifiable via the exported `verifyJwt()` — see [Authentication](#-authentication)
- OAuth login flow is CSRF-protected via a signed `state` parameter
- `.lsdb-tokens.json` (OAuth refresh token) is written with `0o600` permissions — **note: this is plaintext on disk, restricted by file permissions, not encrypted at rest**; treat it as a credential
- `lsdb init` scaffolds `.gitignore` entries for `.env`/`.lsdb-tokens.json` so secrets aren't committed by default
- Sheets private by default — access control depends on who the underlying spreadsheet is shared with, see [OWASP-TOP-10.md → A01](./OWASP-TOP-10.md)
- Role/permission validation on every cross-actor request (`accessControl.ts`)
- SQL adapters use parameterized queries exclusively — no SQL injection risk via the CRUD API

**For the full picture — what's fixed, what's a documented limitation, and what's on you to handle
as the integrating developer or your end users — see [OWASP-TOP-10.md](./OWASP-TOP-10.md), a
category-by-category OWASP Top 10 review of this package including concrete answers to "an end
user's Google account gets compromised" and "someone edits the Sheet directly instead of through the
API."

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
