---
name: auth-router
description: Wire up Google Sign-In Express routes with longcelot-sheet-db. Use when implementing the Google OAuth callback flow as Express middleware, setting up login-only roles (admin/manager) that block self-registration, setting up open-registration roles (users can sign up on first login), issuing JWTs after successful authentication, or handling multiple auth endpoints for different roles on the same server.
license: MIT
metadata:
  package: longcelot-sheet-db
  version: "0.1.15"
---

# longcelot-sheet-db — Auth Router (`createAuthRouter`)

`createAuthRouter` wires up two Express-compatible routes automatically:

- `GET {basePath}/auth/google` — redirects the browser to Google's OAuth consent screen
- `GET {basePath}/auth/callback` — exchanges the code, verifies identity, calls `onUser`, issues a JWT, and redirects to `frontendUrl?token=...`

It uses `createLoginOAuthManager` internally (includes `openid email profile` scopes), so `verifyToken()` always works.

---

## Basic Setup

```typescript
import express from 'express';
import { createSheetAdapter, createAuthRouter } from 'longcelot-sheet-db';

const app = express();
const adapter = createSheetAdapter({ ... });
adapter.registerSchemas([usersSchema, ...]);

const auth = createAuthRouter({
  adapter,
  jwtSecret: process.env.JWT_SECRET!,
  frontendUrl: process.env.FRONTEND_URL!,
  async onUser(profile, adapter) {
    const ctx = adapter.withContext({
      userId: 'auth',
      role: 'admin',
      actorSheetId: process.env.ADMIN_SHEET_ID!,
    });
    return await ctx.table('users').findOne({ where: { email: profile.email } });
  },
});

app.use(auth.handler);
// Exposes: GET /auth/google  and  GET /auth/callback
```

---

## AuthRouterOptions type

```typescript
interface AuthRouterOptions {
  adapter: SheetAdapter;
  jwtSecret: string;
  frontendUrl: string;
  onUser: (profile: GoogleProfile, adapter: SheetAdapter) => Promise<Record<string, unknown> | null>;
  registrationPolicy?: RegistrationPolicy;  // 'open' (default) | 'login-only'
  oauthConfig?: OAuthConfig;               // omit to read from env vars
  basePath?: string;                       // prefix for routes, default ''
}

interface GoogleProfile {
  sub: string;             // Google user ID
  email: string;
  name: string;
  picture?: string;
  email_verified?: boolean;
}

type RegistrationPolicy = 'open' | 'login-only';
```

---

## registrationPolicy — Login-Only vs Open Signup

### `'login-only'` — Admin / Manager portals

Only users already in your `users` table can authenticate. If `onUser` returns `null`, the router automatically returns `401 Access denied`.

```typescript
const adminAuth = createAuthRouter({
  adapter,
  jwtSecret: process.env.JWT_SECRET!,
  frontendUrl: process.env.ADMIN_FRONTEND_URL!,
  registrationPolicy: 'login-only',
  basePath: '/admin',
  async onUser(profile, adapter) {
    const ctx = adapter.withContext({
      userId: 'auth',
      role: 'admin',
      actorSheetId: process.env.ADMIN_SHEET_ID!,
    });
    // If not found → returns null → router sends 401
    return await ctx.table('users').findOne({ where: { email: profile.email } });
  },
});

app.use(adminAuth.handler);
// GET /admin/auth/google  →  GET /admin/auth/callback
```

### `'open'` — End-user self-registration

Any Google-authenticated user can get in. Use `onUser` to auto-create new users on first sign-in.

```typescript
const userAuth = createAuthRouter({
  adapter,
  jwtSecret: process.env.JWT_SECRET!,
  frontendUrl: process.env.FRONTEND_URL!,
  registrationPolicy: 'open',  // default
  async onUser(profile, adapter) {
    const ctx = adapter.withContext({
      userId: 'auth',
      role: 'admin',
      actorSheetId: process.env.ADMIN_SHEET_ID!,
    });

    let user = await ctx.table('users').findOne({ where: { email: profile.email } });

    if (!user) {
      // First-time login — auto-create their sheet and registry entry
      await adapter.createUserSheet(profile.sub, 'user', profile.email);
      user = await ctx.table('users').findOne({ where: { email: profile.email } });
    }

    return user;
  },
});

app.use(userAuth.handler);
```

---

## Policy Behavior Summary

| Policy | `onUser` returns user | `onUser` returns null |
|---|---|---|
| `'open'` | JWT issued with user payload | JWT issued with bare Google profile |
| `'login-only'` | JWT issued with user payload | `401` — Access denied |

---

## Multiple Roles on One Server

Run separate routers for different roles on different paths:

```typescript
// Admin portal at /admin/auth/google
app.use(createAuthRouter({
  adapter,
  jwtSecret: process.env.JWT_SECRET!,
  frontendUrl: process.env.ADMIN_FRONTEND_URL!,
  registrationPolicy: 'login-only',
  basePath: '/admin',
  async onUser(profile, adapter) { /* admin lookup */ },
}).handler);

// Manager portal at /manager/auth/google
app.use(createAuthRouter({
  adapter,
  jwtSecret: process.env.JWT_SECRET!,
  frontendUrl: process.env.MANAGER_FRONTEND_URL!,
  registrationPolicy: 'login-only',
  basePath: '/manager',
  async onUser(profile, adapter) { /* manager lookup */ },
}).handler);

// User portal at /auth/google
app.use(createAuthRouter({
  adapter,
  jwtSecret: process.env.JWT_SECRET!,
  frontendUrl: process.env.USER_FRONTEND_URL!,
  registrationPolicy: 'open',
  async onUser(profile, adapter) { /* user lookup + auto-create */ },
}).handler);
```

---

## JWT Format

The JWT is HS256-signed using Node's built-in `crypto` module — no third-party JWT library required. The payload is whatever object `onUser` returns (or the bare Google profile on `'open'` with a null return), plus `iat` (issued-at timestamp).

```typescript
// Decode on your frontend:
const [, payload] = token.split('.');
const user = JSON.parse(atob(payload));
// user.email, user.role, user.actor_sheet_id, user.iat, ...
```

Verify on your backend:

```typescript
import crypto from 'crypto';

function verifyJwt(token: string, secret: string): Record<string, unknown> {
  const [header, payload, sig] = token.split('.');
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${header}.${payload}`)
    .digest('base64url');
  if (sig !== expected) throw new Error('Invalid JWT signature');
  return JSON.parse(Buffer.from(payload, 'base64url').toString());
}
```

---

## Using `createLoginOAuthManager` Directly

If you prefer manual route wiring instead of `createAuthRouter`:

```typescript
import { createLoginOAuthManager } from 'longcelot-sheet-db';

const oauth = createLoginOAuthManager({
  clientId: process.env.GOOGLE_CLIENT_ID!,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
  redirectUri: process.env.GOOGLE_REDIRECT_URI!,
});

app.get('/auth/google', (req, res) => {
  res.redirect(oauth.getAuthUrl());
});

app.get('/auth/callback', async (req, res) => {
  const tokens = await oauth.getTokens(req.query.code as string) as Record<string, string>;
  const profile = await oauth.verifyToken(tokens.id_token) as GoogleProfile;
  // ... lookup user, issue JWT, redirect
});
```

See `skills/auth/SKILL.md` for the full manual OAuth flow.

---

## Common Mistakes

- **Using `createOAuthManager` instead of `createLoginOAuthManager`** — `createAuthRouter` uses `createLoginOAuthManager` internally. If you wire routes manually, make sure you use `createLoginOAuthManager` — `createOAuthManager` does not request `openid` scope and `verifyToken()` will throw.
- **`onUser` throwing instead of returning null** — Errors thrown inside `onUser` are caught and return a `500` response. If the user simply doesn't exist, return `null` — don't throw.
- **Not guarding `email_verified`** — Some Google accounts have unverified emails (rare). Always check `profile.email_verified === true` before treating the email as a trusted identity.
- **Same `basePath` for two routers** — Two routers with the same `basePath` will both handle `/auth/google`. Give each router a unique `basePath`.
- **Putting the JWT in a cookie** — `createAuthRouter` redirects with `?token=` in the URL by default. If you need `httpOnly` cookies instead, wire the routes manually and set the cookie in your own handler.
- **`frontendUrl` missing the protocol** — Must be a full URL including `https://` or `http://`, e.g., `https://myapp.com/dashboard`. Relative paths will break the redirect.
