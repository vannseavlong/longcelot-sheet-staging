# Reply to bEasy Feedback — longcelot-sheet-db

Thank you for the detailed feedback from building the bEasy admin portal. Every point was valid and actionable. Here is what we've done and what's still on the roadmap.

---

## What's fixed in this release

### 1. OAuth scopes — `verifyToken()` now works ✅

**Your issue**: `getAuthUrl()` only requested `spreadsheets`/`drive.file` scopes, so Google never returned an `id_token`. `verifyToken()` always threw.

**Fix**: We now ship two separate OAuth factory functions:

```typescript
// For backend-to-Sheets communication only (original behavior — no id_token)
const sheetsOAuth = createOAuthManager({ clientId, clientSecret, redirectUri });

// For user-facing Google Sign-In — includes openid, email, profile scopes
// verifyToken() works with tokens produced by this manager
const loginOAuth = createLoginOAuthManager({ clientId, clientSecret, redirectUri });
```

You no longer need to import `google-auth-library` yourself.

---

### 2. Built-in auth route helpers ✅

**Your issue**: No provided Express route handler for the Google Sign-In → JWT flow.

**Fix**: `createAuthRouter` wires up `GET /auth/google` and `GET /auth/callback` for you:

```typescript
import { createAuthRouter } from 'longcelot-sheet-db';

app.use(createAuthRouter({
  adapter,
  jwtSecret: process.env.JWT_SECRET!,
  frontendUrl: process.env.FRONTEND_URL!,
  async onUser(profile, adapter) {
    return await ctx.table('users').findOne({ where: { email: profile.email } });
  },
}).handler);
```

The JWT is HS256-signed using Node's built-in `crypto` — no extra dependency needed.

---

### 3. Seed duplicate handling — `--skip-existing` and `--upsert` ✅

**Your issue**: Re-seeding threw on unique constraint violations.

**Fix**:

```bash
pnpm sheet-db seed seeds/admin.ts --skip-existing  # skip on conflict
pnpm sheet-db seed seeds/admin.ts --upsert          # update on conflict
```

Both flags work with `--all-actors` as well.

---

### 4. `upsert()` in CRUD ✅

**Your issue**: No insert-or-update without manual `findOne()` + branch.

**Fix**:

```typescript
await ctx.table('users').upsert({
  where: { email: 'admin@example.com' },
  data: { role: 'admin', status: 'active' },
});
```

---

### 5. `sync --token-file` for CI/CD ✅

**Your issue**: `sheet-db sync` required interactive browser OAuth — blocked CI pipelines.

**Fix**:

```bash
# In GitHub Actions (store tokens in a repository secret):
echo "$SHEET_DB_TOKENS" > /tmp/tokens.json
npx sheet-db sync --token-file /tmp/tokens.json
```

The file is the same `.sheet-db-tokens.json` format the CLI already writes locally — no new format to learn.

---

### 6. `createMany()` bulk insert ✅

**Your issue**: Seeding N rows = N API calls (~3–7 seconds for 10 rows).

**Fix**: All rows go into a single `values.append` call:

```typescript
await ctx.table('products').createMany([
  { name: 'Widget A', price: 9.99 },
  { name: 'Widget B', price: 19.99 },
]);
```

---

### 7. Dynamic seed file format ✅

**Your issue**: Seed file was a static object — no way to pass env vars or CLI arguments cleanly.

**Fix**: Both formats are now accepted:

```typescript
// Static (existing — still works)
export default { users: [ ... ] }

// Dynamic — receives process.env
export default async function(env: NodeJS.ProcessEnv) {
  return {
    users: [{ email: env.SUPER_ADMIN_EMAIL, role: 'admin' }],
  }
}
```

---

### 8. `count()` aggregate ✅

**Your issue**: Counting rows required loading the entire sheet.

**Fix**:

```typescript
const pending = await ctx.table('orders').count({ where: { status: 'pending' } });
const total   = await ctx.table('orders').count();
```

---

## Your question: Role-differentiated login (login-only vs open signup)

`createAuthRouter` has a `registrationPolicy` option that handles exactly this:

```typescript
// Admin portal — users must already exist, no self-signup
createAuthRouter({ ..., registrationPolicy: 'login-only' })

// User portal — any Google user can register on first sign-in
createAuthRouter({ ..., registrationPolicy: 'open' })
```

**How it works:**
- Your `onUser` callback receives the verified Google profile and returns a user object (or `null` if not found).
- With `'login-only'`: if `onUser` returns `null`, the router automatically returns `401 Access denied — contact an admin`.
- With `'open'`: if `onUser` returns `null`, the user is let through with their bare Google profile — use this to trigger `adapter.createUserSheet()` inside `onUser` for new users.

You can run multiple routers on different paths:

```typescript
// Admin at /admin/auth/google
app.use(createAuthRouter({ ..., registrationPolicy: 'login-only', basePath: '/admin' }).handler);

// Users at /auth/google  
app.use(createAuthRouter({ ..., registrationPolicy: 'open' }).handler);
```

---

## Still on the roadmap (not yet implemented)

| # | Item | Priority |
|---|------|----------|
| 2b | NestJS guard / middleware variant of `createAuthRouter` | Medium |
| 5b | Service account alternative for CI (no tokens file needed) | Medium |
| 6b | `invite-only` registration policy (user must exist with `status: 'invited'`) | Future |
| 7b | CLI `--env` flag to pass individual env vars to dynamic seed files | Future |
| 9 | `adapter.join()` — query across multiple actor sheets in memory | Medium |

---

## Breaking changes

None. All changes are additive. Existing code continues to work unchanged.

---

Thank you again for taking the time to document these pain points — this feedback directly shaped what shipped. If you hit anything else while building, please open an issue or ping us directly.
