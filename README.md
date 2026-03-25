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
- 🔄 **Auto CRUD**: Automatic create, read, update, delete operations
- 🎭 **Role-Based Permissions**: Built-in security boundaries
- 🔑 **Authentication**: Google OAuth + bcrypt password hashing
- 🛠️ **CLI Tools**: Initialize, generate, sync, and validate schemas
- 📊 **Type-Safe**: Full TypeScript support
- 💰 **Cost-Free**: No infrastructure costs for staging

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
  role: 'user',
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

Actors are user roles that determine where data is stored:

```typescript
actors: ["admin", "user", "seller"]
```

- **admin**: Data stored in central admin sheet
- **user**: Data stored in user's personal sheet
- **seller**: Data stored in seller's personal sheet

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
const table = adapter.table('bookings');

await table.create({ ... });

await table.findMany({
  where: { status: 'pending' },
  orderBy: 'date',
  order: 'desc',
  limit: 10,
  offset: 0,
});

await table.findOne({ where: { booking_id: 'bk_001' } });

await table.update({
  where: { booking_id: 'bk_001' },
  data: { status: 'confirmed' },
});

await table.delete({ where: { booking_id: 'bk_001' } });
```

### Context & Permissions

Every operation requires context:

```typescript
const context = adapter.withContext({
  userId: 'user_123',
  role: 'user',
  actorSheetId: 'sheet-id',
});
```

Permissions are enforced automatically:
- Users can only access their own sheets
- Admin can access admin tables
- Cross-actor access is blocked

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

Creates missing sheets and adds missing columns (never deletes data).

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
npx sheet-db seed
# pnpm dlx sheet-db seed
# yarn dlx sheet-db seed
# bunx sheet-db seed
```

Load initial or test data into your sheets.

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

- `users` - User registry
- `credentials` - Authentication data
- `actors` - Actor definitions
- `permissions` - Role permissions (optional)

### User-Owned Sheets

Each user gets their own sheet with tables based on their role:

```
user-sheet-123
  ├── profile
  ├── bookings
  ├── payments
  └── settings
```

## 🎓 Complete Example

Coming Soon!

## 🔄 Migration Path

When you're ready for production:

1. Every schema maps cleanly to SQL tables
2. Replace `createSheetAdapter` with your DB adapter
3. Update CRUD calls (minimal changes)
4. No logic trapped in Sheets

We are building this adapter with a strict schema constraint so that graduating to production is effortless. By keeping logic in JS and using standard Data Types, your TS definitions can be directly ported over to a Prisma `schema.prisma` file later.

**Upcoming CLI for migration**:

```bash
# Export schemas to Prisma (coming soon)
npx sheet-db export --prisma --output ./prisma

# Export schemas to SQL DDL (coming soon)
npx sheet-db export --sql --output ./migrations
```

```typescript
// Development (Sheets)
const adapter = createSheetAdapter({ ... });

// Production (Prisma, Sequelize, etc.)
const adapter = createSQLAdapter({ ... });
```

**Data migration workflow**:
1. Export your schemas using `sheet-db export` (coming soon)
2. Fetch all data from Sheets using the adapter: `await adapter.table('x').findMany()`
3. Insert data into your production database
4. Swap the adapter in your code

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
