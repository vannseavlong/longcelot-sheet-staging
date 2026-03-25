# longcelot-sheet-db — Developer Guide

---

## 1. Installation

```bash
pnpm add longcelot-sheet-db
```

---

## 2. Project Setup

Initialize the project:

```bash
pnpm sheet-db init
```

Creates:

- `sheet-db.config.ts`
- `schemas/` folder
- `.env` template with required variables

---

## 3. Configure Google OAuth (Required)

This package **requires Google OAuth2** to function. You cannot skip this.

### 3.1 Set up Google Cloud Credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project
3. Enable **Google Sheets API** and **Google Drive API**
4. Go to **Credentials** → **Create Credentials** → **OAuth 2.0 Client ID**
5. Set authorized redirect URIs (e.g., `http://localhost:3000/auth/callback`)
6. Copy your **Client ID** and **Client Secret**

### 3.2 Configure Environment Variables

Add to your `.env` file:

```env
GOOGLE_CLIENT_ID=your_client_id
GOOGLE_CLIENT_SECRET=your_client_secret
GOOGLE_REDIRECT_URI=http://localhost:3000/auth/callback
ADMIN_SHEET_ID=your_admin_sheet_id
```

---

## 4. Define Schemas

Create a table definition:

```ts
import { defineTable, string, date } from "longcelot-sheet-db";

export default defineTable({
  name: "bookings",
  actor: "user",
  timestamps: true,
  columns: {
    service: string().required(),
    date: date(),
    status: string().enum(['pending', 'confirmed', 'cancelled']).default('pending')
  }
});
```

---

## 5. Sync Schema to Sheets

```bash
pnpm sheet-db sync
```

This creates or updates tables in Google Sheets.

**Note**: `sync` only updates the admin sheet. User sheets are created when users register via `adapter.createUserSheet()`.

---

## 6. Configure Adapter

```ts
import { createSheetAdapter } from "longcelot-sheet-db";

const adapter = createSheetAdapter({
  adminSheetId: process.env.ADMIN_SHEET_ID,
  credentials: {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    redirectUri: process.env.GOOGLE_REDIRECT_URI,
  },
  tokens: userOAuthTokens,
});
```

---

## 7. Register Schemas

```ts
import bookingsSchema from "./schemas/bookings";

adapter.registerSchema(bookingsSchema);
```

---

## 8. Inject Runtime Context

Provide identity information per request:

```ts
const db = adapter.withContext({
  userId: "user_123",
  role: "user",
  actorSheetId: "user-sheet-id-xyz"
});
```

This enables:

- role routing
- permission checks
- sheet resolution

---

## 9. Perform CRUD Operations

### Create

```ts
await db.table("bookings").create({
  service: "Consultation",
  date: new Date().toISOString()
});
```

### Read

```ts
const bookings = await db.table("bookings").findMany({
  where: { status: 'pending' },
  limit: 10
});
```

### Update

```ts
await db.table("bookings").update({
  where: { booking_id: 'bk_001' },
  data: { status: 'confirmed' }
});
```

### Delete

```ts
await db.table("bookings").delete({
  where: { booking_id: 'bk_001' }
});
```

---

## 10. Validation Rules

Columns support:

- required values
- default values
- uniqueness constraints
- enums
- min/max length/value
- regex pattern validation

Invalid writes throw descriptive errors.

---

## 11. Integrating with Existing Projects

If you already have a backend (Express, NestJS, etc.):

```bash
# 1. Add the package
pnpm add longcelot-sheet-db

# 2. Initialize
npx sheet-db init

# 3. Configure .env with OAuth credentials

# 4. Define schemas

# 5. Sync
npx sheet-db sync
```

**Map your existing auth to sheet-db context**:

```ts
// Your Express/NestJS route
app.get('/bookings', async (req, res) => {
  // Your existing auth provides user info
  const developerUser = req.user;

  // Map to sheet-db context
  const userContext = adapter.withContext({
    userId: developerUser.id,
    role: developerUser.role,
    actorSheetId: developerUser.sheetId,
  });

  const bookings = await userContext.table('bookings').findMany();
  res.json(bookings);
});
```

---

## 12. Recommended Project Structure

```
schemas/
  user/
    bookings.ts
    profile.ts
  admin/
    users.ts
    credentials.ts
  teacher/
    classes.ts
    grades.ts
```

Organize schemas by actor.

---

## 13. Best Practices

- Keep schemas simple
- Use actors consistently
- Avoid large datasets (hundreds to low thousands rows)
- Treat as staging environment
- Design with future migration in mind (use `user_id` as primary identity)
- Never expose OAuth tokens in client-side code