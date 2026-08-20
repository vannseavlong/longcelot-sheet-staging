---
name: auth
description: Handle authentication with longcelot-sheet-db. Use when implementing Google OAuth2 for backend Sheets access, exchanging authorization codes for tokens, refreshing expired tokens, verifying Google ID tokens for user identity, hashing or comparing passwords with bcrypt, or validating password strength. For user-facing Google Sign-In with built-in Express routes, see skills/auth-router/SKILL.md.
license: MIT
metadata:
  package: longcelot-sheet-db
  version: "0.1.44"
---

# longcelot-sheet-db — Authentication

The package provides two layers of authentication:
1. **OAuthManager** — Google OAuth2 (required for Sheets API access)
2. **Password utilities** — bcrypt-based hashing for username/password flows

---

## Two OAuth Managers — Choose the Right One

| Function | Scopes included | Produces `id_token`? | Use for |
|---|---|---|---|
| `createOAuthManager` | `spreadsheets`, `drive.file` | ❌ No | Backend-to-Sheets only |
| `createLoginOAuthManager` | + `openid email profile` | ✅ Yes | User-facing Google Sign-In |

**Critical**: `verifyToken()` requires an `id_token`. It only works when `openid` scope was requested. Always use `createLoginOAuthManager` when you need to identify the user.

`LOGIN_SCOPES` (the array `createLoginOAuthManager` defaults to) is exported too — useful for
extending rather than retyping it: `[...LOGIN_SCOPES, 'https://www.googleapis.com/auth/calendar.readonly']`.
If you're using `createAuthRouter` (see `skills/auth-router/SKILL.md`) rather than wiring routes
manually, it has its own `scopes` option that does the same override at the router level.

```typescript
import { createOAuthManager, createLoginOAuthManager } from 'longcelot-sheet-db';

// Backend-to-Sheets only (no id_token, verifyToken will throw)
const sheetsOAuth = createOAuthManager({
  clientId: process.env.GOOGLE_CLIENT_ID!,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
  redirectUri: process.env.GOOGLE_REDIRECT_URI!,
});

// User-facing Sign-In (includes openid, verifyToken works)
const loginOAuth = createLoginOAuthManager({
  clientId: process.env.GOOGLE_CLIENT_ID!,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
  redirectUri: process.env.GOOGLE_REDIRECT_URI!,
});
```

### OAuthConfig type

```typescript
interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}
```

---

## Complete OAuth2 Flow (manual wiring)

**Step 1 — Generate auth URL and redirect user:**

```typescript
const authUrl = loginOAuth.getAuthUrl();
// Optional: pass custom scopes
const customUrl = loginOAuth.getAuthUrl(['openid', 'email', 'https://www.googleapis.com/auth/spreadsheets']);
res.redirect(authUrl);
```

**Step 2 — Handle callback, exchange code, verify identity:**

```typescript
app.get('/auth/callback', async (req, res) => {
  const tokens = await loginOAuth.getTokens(req.query.code as string);
  // tokens contains: access_token, refresh_token, id_token, expiry_date

  const profile = await loginOAuth.verifyToken(
    (tokens as Record<string, string>).id_token
  );
  // profile.email, profile.name, profile.sub (Google user ID)
  // profile.email_verified — always verify this is true before trusting the email
});
```

**Step 3 — Refresh expired tokens:**

```typescript
const refreshed = await oauth.refreshTokens(storedRefreshToken);
// Use refreshed.access_token for the next request
```

> **The CLI does not require you to wire steps 1–2 yourself.** `lsdb auth` (see `skills/cli/SKILL.md`) drives this same exchange for the admin Sheets token: it opens the consent URL for you and, when `redirectUri` is `localhost`/`127.0.0.1` and that port is free, catches the `?code=` redirect with a short-lived local HTTP server instead of asking you to copy it out of the browser's address bar. That's CLI-only tooling (`src/cli/lib/oauthCallbackServer.ts`) — it doesn't change what `getAuthUrl()`/`getTokens()` do when you call `OAuthManager` directly in your own server code.

---

## OAuthManager methods

| Method | Signature | Description |
|---|---|---|
| `getAuthUrl(scopes?)` | `(scopes?: string[]) => string` | Returns Google authorization URL |
| `getTokens(code)` | `(code: string) => Promise<unknown>` | Exchanges auth code for tokens |
| `refreshTokens(refreshToken)` | `(token: string) => Promise<unknown>` | Refreshes an expired access token |
| `verifyToken(idToken)` | `(token: string) => Promise<unknown>` | Verifies and decodes a Google ID token — requires `openid` scope |

---

## Passing Tokens to the Adapter

```typescript
import { createSheetAdapter } from 'longcelot-sheet-db';

const adapter = createSheetAdapter({
  adminSheetId: process.env.ADMIN_SHEET_ID!,
  credentials: { clientId, clientSecret, redirectUri },
  tokens: userTokens, // token object from getTokens() or refreshTokens()
});
```

---

## Password Utilities

For apps using username/password authentication alongside or instead of Google OAuth:

```typescript
import {
  hashPassword,
  comparePassword,
  validatePasswordStrength,
} from 'longcelot-sheet-db';
```

### hashPassword()

```typescript
const hash = await hashPassword('SecurePass123!');
// Uses bcrypt with 10 salt rounds
// Store hash in your credentials table — never the plain text
```

### comparePassword()

```typescript
const isValid = await comparePassword('SecurePass123!', storedHash);
// Returns true if the password matches the hash
```

### validatePasswordStrength()

```typescript
const { valid, errors } = validatePasswordStrength('weakpass');
// valid: false
// errors: ['Password must be at least 8 characters', 'Must contain uppercase letter', ...]

const { valid } = validatePasswordStrength('SecurePass123!');
// valid: true
```

---

## Common Mistakes

- **Using `createOAuthManager` for user login** — It does not request `openid` scope so Google never returns an `id_token`. Calling `verifyToken()` on its tokens always throws `"The verifyIdToken method requires an ID Token"`. Use `createLoginOAuthManager` instead.
- **Not storing the `refresh_token`** — Google only returns `refresh_token` on the first authorization. Store it persistently; losing it requires the user to re-authorize from scratch.
- **Creating the adapter with an expired `access_token`** — Access tokens expire after 1 hour. Check `tokens.expiry_date < Date.now()` before constructing the adapter and refresh first if needed.
- **Not verifying `email_verified`** — `verifyToken()` returns the raw Google profile. Always check `profile.email_verified === true` before using the email as a trusted identity.
- **Storing plaintext passwords** — Always `await hashPassword()` before persisting. Never store the raw password string.
- **For built-in Express auth routes** — See `skills/auth-router/SKILL.md` for `createAuthRouter` which wires `/auth/google` and `/auth/callback` routes automatically.
