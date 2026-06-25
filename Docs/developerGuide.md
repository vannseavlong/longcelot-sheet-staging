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

## 13. Cross-Actor Operations

By default, actors can only access their own sheet. Cross-actor access lets one role operate on another role's tables (e.g. a teacher grading a student's scores).

### 13.1 Configure the Permission Matrix

Pass `permissions` when creating the adapter:

```ts
const adapter = createSheetAdapter({
  adminSheetId: process.env.ADMIN_SHEET_ID,
  credentials: { clientId, clientSecret, redirectUri },
  tokens: oauthTokens,
  permissions: {
    teacher: {
      canAccess: ["student"],           // which actor sheets teacher can enter
      tables: ["scores", "attendance"], // optional: restrict to these tables only
    },
    parent: {
      canAccess: ["student"],
      tables: ["scores", "attendance"],
    },
  },
});
```

### 13.2 Set Cross-Actor Context

Provide both the caller's context **and** the target sheet:

```ts
// Fetch the student's sheet ID from your users table first, then:
const ctx = adapter.withContext({
  userId: "teacher_001",
  actor: "teacher",
  actorSheetId: "teacher-sheet-id",
  targetActor: "student",
  targetSheetId: "student-sheet-id-from-users-table",
});
```

Or use the `asActor()` shorthand:

```ts
const teacherCtx = adapter.withContext({
  userId: "teacher_001",
  actor: "teacher",
  actorSheetId: "teacher-sheet-id",
});

const crossCtx = teacherCtx.asActor("student", "student-sheet-id");
```

### 13.3 CRUD Across Actor Sheets

All four operations work seamlessly — they route to the **target** sheet, not the caller's:

```ts
// CREATE — teacher writes a score into the student's sheet
await crossCtx.table("scores").create({
  student_id: "student_123",
  subject: "Mathematics",
  score: 95,
  graded_by: "teacher_001",
});

// READ — teacher reads back scores from the student's sheet
const scores = await crossCtx.table("scores").findMany({
  where: { student_id: "student_123" },
});

// UPDATE — teacher corrects a score
await crossCtx.table("scores").update({
  where: { _id: "score_xyz" },
  data: { score: 98 },
});

// DELETE — teacher removes an erroneous entry
await crossCtx.table("scores").delete({ where: { _id: "score_xyz" } });
```

### 13.4 Security Rules

| Scenario | Result |
|---|---|
| No `permissions` configured for a role attempting cross-actor access | `PermissionError` |
| Role not in `canAccess` list for the target | `PermissionError` |
| Table not in the allowed `tables` list | `PermissionError` |
| `targetSheetId` missing while `targetActor` is set | `PermissionError` |
| Admin role — no config needed | Always allowed |

### 13.5 Fetching All Student Data Across Multiple Sheets

```ts
// 1. Get your teacher's student list from their own sheet
const myStudents = await adapter
  .withContext({ userId: teacherId, actor: "teacher", actorSheetId: teacherSheetId })
  .table("teacher_students")
  .findMany({ where: { teacher_id: teacherId } });

// 2. Loop and aggregate
const allScores = [];
for (const student of myStudents) {
  const scores = await adapter
    .withContext({
      userId: teacherId,
      actor: "teacher",
      actorSheetId: teacherSheetId,
      targetActor: "student",
      targetSheetId: student.actor_sheet_id,
    })
    .table("scores")
    .findMany();

  allScores.push(...scores.map((s) => ({ ...s, student_name: student.name })));
}
```

---

---

## 14. Auth Routes & Role-Differentiated Login

### 14.1 Why two OAuth managers?

| Function | Scopes | Purpose |
|---|---|---|
| `createOAuthManager` | `spreadsheets`, `drive.file` | Backend-to-Sheets only — no `id_token` |
| `createLoginOAuthManager` | + `openid email profile` | User-facing Sign-In — produces `id_token` for `verifyToken()` |

`verifyToken()` only works when `openid` scope was requested. Always use `createLoginOAuthManager` for user-facing Google Sign-In.

### 14.2 createAuthRouter — wires up two Express routes

```typescript
import express from 'express';
import { createSheetAdapter, createAuthRouter } from 'longcelot-sheet-db';

const app = express();
const adapter = createSheetAdapter({ ... });

const auth = createAuthRouter({
  adapter,
  jwtSecret: process.env.JWT_SECRET!,
  frontendUrl: process.env.FRONTEND_URL!,
  registrationPolicy: 'login-only', // or 'open'
  async onUser(profile, adapter) {
    const ctx = adapter.withContext({
      userId: 'auth',
      actor: 'admin',
      actorSheetId: process.env.ADMIN_SHEET_ID!,
    });
    return await ctx.table('users').findOne({ where: { email: profile.email } });
  },
});

app.use(auth.handler);
// Routes: GET /auth/google  →  GET /auth/callback  →  redirect to frontendUrl?token=...
```

### 14.3 Registration Policy

| Policy | Who can log in |
|---|---|
| `'login-only'` | Only users already in the `users` table. Returns `401` if `onUser` returns `null`. Best for admin/manager portals. |
| `'open'` (default) | Any Google-authenticated user; use `onUser` to create the user on first sign-in. Best for public-facing apps. |

**Pattern: login-only role (admin/manager portal)**

```typescript
registrationPolicy: 'login-only',
async onUser(profile, adapter) {
  // User must already exist — if not found, router returns 401 automatically
  return await ctx.table('admins').findOne({ where: { email: profile.email } });
}
```

**Pattern: open role (end users can self-register)**

```typescript
registrationPolicy: 'open',
async onUser(profile, adapter) {
  let user = await ctx.table('users').findOne({ where: { email: profile.email } });
  if (!user) {
    const sheetId = await adapter.createUserSheet(profile.sub, 'user', profile.email);
    user = await ctx.table('users').findOne({ where: { email: profile.email } });
  }
  return user;
}
```

### 14.4 Multiple auth endpoints (one per role)

```typescript
// Admin portal — login-only at /admin/auth/google
app.use(createAuthRouter({ ..., registrationPolicy: 'login-only', basePath: '/admin' }).handler);

// User portal — open registration at /auth/google
app.use(createAuthRouter({ ..., registrationPolicy: 'open', basePath: '' }).handler);
```

---

## 15. Bulk Operations & Aggregates

### 15.1 createMany — batch insert

```typescript
// All rows inserted in a single Google Sheets API call
await ctx.table('products').createMany([
  { name: 'Widget A', price: 9.99 },
  { name: 'Widget B', price: 19.99 },
]);
```

### 15.2 upsert — insert-or-update

```typescript
await ctx.table('users').upsert({
  where: { email: 'admin@example.com' },
  data: { role: 'admin', status: 'active' },
});
```

### 15.3 count — without loading all rows

```typescript
const pending = await ctx.table('orders').count({ where: { status: 'pending' } });
const total = await ctx.table('orders').count(); // no filter
```

---

## 16. Best Practices

- Keep schemas simple
- Use actors consistently
- Avoid large datasets (hundreds to low thousands rows)
- Treat as staging environment
- Design with future migration in mind (use `user_id` as primary identity)
- Never expose OAuth tokens in client-side code
- For cross-actor access, always fetch the `targetSheetId` from your admin `users` table at request time
- Use `createLoginOAuthManager` for user-facing Sign-In; `createOAuthManager` for backend-only Sheets access
- Use `--skip-existing` for idempotent seed scripts (safe to run multiple times)
- Use `--token-file` in CI to avoid interactive OAuth prompts