# 📦 longcelot-sheet-db

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
npm install longcelot-sheet-db
# or
pnpm add longcelot-sheet-db
```

### Initialize Project

```bash
pnpm sheet-db init
```

This creates:
- `sheet-db.config.ts` - Project configuration
- `.env` - Environment variables
- `schemas/` - Schema directory

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

## 🛠️ CLI Commands

### Initialize Project

```bash
pnpm sheet-db init
```

Creates project structure and configuration files.

### Generate Schema

```bash
pnpm sheet-db generate bookings
```

Interactive schema generator with prompts for columns and types.

### Sync Schemas

```bash
pnpm sheet-db sync
```

Creates missing sheets and adds missing columns (never deletes data).

### Validate Schemas

```bash
pnpm sheet-db validate
```

Checks for:
- Duplicate table names
- Invalid modifiers
- Unknown actors
- Missing required fields

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

See the [Student Web App](./examples/student-app) for a complete implementation with:
- 4 actors (admin, student, teacher, parent)
- 20+ schema definitions
- Authentication flow
- Role-based permissions
- CRUD operations

## 🔄 Migration Path

When you're ready for production:

1. Every schema maps cleanly to SQL tables
2. Replace `createSheetAdapter` with your DB adapter
3. Update CRUD calls (minimal changes)
4. No logic trapped in Sheets

```typescript
// Development (Sheets)
const adapter = createSheetAdapter({ ... });

// Production (Prisma, Sequelize, etc.)
const adapter = createSQLAdapter({ ... });
```

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
