---
name: auth
description: Handle authentication with longcelot-sheet-db. Use when implementing Google OAuth2 login flow, exchanging authorization codes for tokens, refreshing expired tokens, verifying Google ID tokens, hashing or comparing passwords with bcrypt, or validating password strength.
license: MIT
metadata:
  package: longcelot-sheet-db
  version: "0.1.5"
---

# longcelot-sheet-db — Authentication

The package provides two authentication utilities: **OAuthManager** for Google OAuth2 (required for Sheets API access) and **password utilities** for bcrypt-based password hashing.

## Google OAuth2 — OAuthManager

### Why OAuth is required

Google Sheets API requires OAuth2 for all read/write operations. This is a hard requirement — there is no way to bypass it. OAuth is used strictly for **backend-to-Google-Sheets** communication. Your app's own authentication (JWT, sessions, etc.) is separate and unaffected.

### Creating the OAuthManager

```typescript
import { createOAuthManager } from 'longcelot-sheet-db';

const oauth = createOAuthManager({
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

### Complete OAuth2 Flow

**Step 1 — Generate authorization URL and redirect user:**

```typescript
const authUrl = oauth.getAuthUrl();
// Redirect user to authUrl in their browser
res.redirect(authUrl);
```

**Step 2 — Handle the callback and exchange code for tokens:**

```typescript
// In your redirect URI handler (e.g., GET /auth/callback)
app.get('/auth/callback', async (req, res) => {
  const { code } = req.query;
  const tokens = await oauth.getTokens(code as string);
  // tokens contains: access_token, refresh_token, id_token, expiry_date

  // Verify the user's identity
  const payload = await oauth.verifyToken(tokens.id_token!);
  // payload.email, payload.name, payload.sub (Google user ID)

  // Store tokens securely (e.g., encrypted in DB or session)
  // Use tokens when creating the SheetAdapter
});
```

**Step 3 — Refresh expired tokens:**

```typescript
const refreshedTokens = await oauth.refreshTokens(storedRefreshToken);
// Use refreshedTokens.access_token for the next request
```

### OAuthManager methods

| Method | Signature | Description |
|--|--|--|
| `getAuthUrl()` | `() => string` | Returns Google authorization URL |
| `getTokens(code)` | `(code: string) => Promise<Credentials>` | Exchanges auth code for tokens |
| `refreshTokens(refreshToken)` | `(token: string) => Promise<Credentials>` | Refreshes an expired access token |
| `verifyToken(idToken)` | `(token: string) => Promise<TokenPayload>` | Verifies and decodes a Google ID token |

### Passing Tokens to the Adapter

```typescript
import { createSheetAdapter } from 'longcelot-sheet-db';

const adapter = createSheetAdapter({
  adminSheetId: process.env.ADMIN_SHEET_ID!,
  credentials: { clientId, clientSecret, redirectUri },
  tokens: userTokens, // Credentials object from getTokens() or refreshTokens()
});
```

## Password Utilities

For apps that need username/password authentication alongside or instead of Google OAuth:

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
// Store hash in your credentials table, never the plain text password
```

### comparePassword()

```typescript
const isValid = await comparePassword('SecurePass123!', storedHash);
// Returns true if the password matches
```

### validatePasswordStrength()

```typescript
const { valid, errors } = validatePasswordStrength('weakpass');
// valid: false
// errors: ['Password must be at least 8 characters', 'Must contain uppercase letter', ...]

const { valid } = validatePasswordStrength('SecurePass123!');
// valid: true
```

## Common Mistakes

- **Not storing the `refresh_token`** — Google only returns `refresh_token` on the first authorization. Store it persistently; losing it requires the user to re-authorize.
- **Creating the adapter with expired `access_token`** — Access tokens expire after 1 hour. Always call `oauth.refreshTokens()` before constructing the adapter if the stored token is expired (`tokens.expiry_date < Date.now()`).
- **Using `verifyToken()` for access control** — `verifyToken()` confirms the token's cryptographic validity and returns the user's Google profile, but your app must still check whether the user exists in your `users` table.
- **Storing plaintext passwords** — Always use `hashPassword()` before persisting credentials. Never store the raw password.
- **Calling `hashPassword()` synchronously** — It is async (bcrypt); always `await` it.
