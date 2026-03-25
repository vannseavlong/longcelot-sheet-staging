---
name: core
description: Set up and configure longcelot-sheet-db. Use when installing the package, creating a SheetAdapter, providing OAuth credentials, wiring environment variables, or connecting the adapter to an existing backend (Express, NestJS, etc.).
license: MIT
metadata:
  package: longcelot-sheet-db
  version: "0.1.5"
---

# longcelot-sheet-db — Core Setup

`longcelot-sheet-db` is a schema-first, actor-aware database adapter that uses **Google Sheets as the storage engine**. It is designed for MVPs, prototypes, staging environments, and internal tools where zero infrastructure cost is a priority.

## Installation

```bash
npm install longcelot-sheet-db
# or
pnpm add longcelot-sheet-db
# or
yarn add longcelot-sheet-db
```

## Required Environment Variables

All five variables must be set before the adapter can function:

```env
GOOGLE_CLIENT_ID=your_client_id
GOOGLE_CLIENT_SECRET=your_client_secret
GOOGLE_REDIRECT_URI=http://localhost:3000/auth/callback
ADMIN_SHEET_ID=your_central_admin_google_sheet_id
SUPER_ADMIN_EMAIL=admin@example.com
```

> **GOOGLE_REDIRECT_URI** must exactly match a URI registered in the Google Cloud Console OAuth 2.0 credentials.

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

### SheetAdapterConfig type

```typescript
interface SheetAdapterConfig {
  adminSheetId: string;
  credentials: {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
  };
  tokens: any; // Google OAuth2 token object
}
```

## Registering Schemas

Schemas **must** be registered before calling `adapter.table()`:

```typescript
import bookingsSchema from './schemas/bookings';
import usersSchema from './schemas/users';

adapter.registerSchema(bookingsSchema);
// or register many at once:
adapter.registerSchemas([bookingsSchema, usersSchema]);
```

## Integrating with an Existing Backend

OAuth in this package is strictly for **backend-to-Google-Sheets** communication. Your app's own authentication (JWT, sessions, etc.) is untouched.

```typescript
// Express example
app.get('/bookings', async (req, res) => {
  const user = req.user; // from your JWT middleware

  const ctx = adapter.withContext({
    userId: user.id,
    role: user.role,           // must match an actor defined in your config
    actorSheetId: user.sheetId, // Google Sheet ID for this user
  });

  const bookings = await ctx.table('bookings').findMany();
  res.json(bookings);
});
```

## Creating a User Sheet on Registration

When a new user registers, create their personal sheet:

```typescript
const sheetId = await adapter.createUserSheet(userId, role);
// Store sheetId in your users table for future withContext() calls
```

## Common Mistakes

- **Missing `registerSchema()` call** — Calling `adapter.table('x')` before `registerSchema()` throws `SchemaError: Schema 'x' not registered`.
- **Wrong `actorSheetId`** — The `actorSheetId` in `withContext()` must match the Google Sheet that belongs to that user's role; using the admin sheet ID for a non-admin actor causes a permission error.
- **Stale/expired OAuth tokens** — Pass refreshed tokens each request or use `OAuthManager.refreshTokens()` to renew before constructing the adapter.
- **ESM/CJS mismatch** — The package ships CommonJS. Do **not** upgrade `chalk`, `inquirer`, or `nanoid` to ESM-only versions (chalk v5+, inquirer v9+, nanoid v4+) without migrating the project to ESM.
