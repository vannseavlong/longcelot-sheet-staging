import { SheetAdapter } from '../adapter/sheetAdapter';
import { OAuthManager, createLoginOAuthManager, OAuthConfig } from './oauth';
import { ValidationError } from '../errors';

export type RegistrationPolicy = 'open' | 'login-only';

export interface AuthRouterOptions {
  /** The lsdb adapter instance (must have `users` schema registered) */
  adapter: SheetAdapter;
  /** Secret used to sign JWTs */
  jwtSecret: string;
  /** URL to redirect the browser to after successful auth (your frontend) */
  frontendUrl: string;
  /**
   * Called with the verified Google profile after OAuth callback.
   * Return the user object to embed in the JWT, or null to reject.
   *
   * - `'open'` policy: if null is returned the user is created automatically.
   * - `'login-only'` policy: if null is returned a 401 is sent (no self-registration).
   */
  onUser: (profile: GoogleProfile, adapter: SheetAdapter) => Promise<Record<string, unknown> | null>;
  /**
   * Controls whether unknown users can self-register.
   * - `'open'` (default) — any authenticated Google user can get in; call `adapter.createUserSheet()` in `onUser` for new users.
   * - `'login-only'` — user must already be returned by `onUser`; throws 401 if null.
   */
  registrationPolicy?: RegistrationPolicy;
  /** OAuth config — if omitted, reads GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REDIRECT_URI from env */
  oauthConfig?: OAuthConfig;
  /** Path prefix for the two routes (default: '') */
  basePath?: string;
  /** JWT lifetime in seconds. The issued token cannot be revoked before this, so keep it short-lived. Default: 86400 (1 day). */
  jwtExpiresInSeconds?: number;
  /**
   * Where the JWT is handed to the frontend after login.
   * - `'query'` (default, backward-compatible) — `?token=...`. Lands in server access logs and the
   *   `Referer` header of any request the frontend page subsequently makes.
   * - `'fragment'` — `#token=...`. Never sent to any server (browsers strip the fragment before
   *   issuing the request), so it doesn't appear in access logs or `Referer` headers. Recommended
   *   for new integrations; not the default because it requires the frontend to read
   *   `location.hash` instead of a query param.
   */
  tokenDelivery?: 'query' | 'fragment';
  /**
   * OAuth scopes requested on the login redirect. Defaults to `LOGIN_SCOPES`
   * (`['openid', 'email', 'profile', ...SHEETS_SCOPES]`) for backward compatibility.
   *
   * Override this to drop scopes your app doesn't need on the *end user's own grant* — e.g.
   * `['openid', 'email', 'profile']` for a router used purely for sign-in, with Sheets/Drive
   * access happening server-side under a separate admin-owned token. `spreadsheets` and
   * `drive.file` are Google-classified sensitive scopes; requesting them unnecessarily triggers
   * Google's "hasn't verified this app" interstitial on every login.
   *
   * Must include `'openid'` — the callback exchanges the code for an `id_token` (via
   * `oauth.verifyToken()`) to build the `GoogleProfile` passed to `onUser`, and Google only
   * issues an `id_token` when `openid` was requested. Omitting it throws `ValidationError`
   * at router-creation time rather than failing per-request during the OAuth callback.
   */
  scopes?: string[];
}

export interface GoogleProfile {
  sub: string;
  email: string;
  name: string;
  picture?: string;
  email_verified?: boolean;
}

/** Minimal type-safe shape for an Express-compatible request/response */
interface Req {
  query: Record<string, string | undefined>;
}
interface Res {
  redirect: (url: string) => void;
  status: (code: number) => { json: (body: unknown) => void };
}

const DEFAULT_JWT_EXPIRES_IN_SECONDS = 60 * 60 * 24; // 1 day
const DEFAULT_STATE_MAX_AGE_MS = 10 * 60 * 1000; // 10 minutes — long enough to complete a Google consent screen

function signJwt(payload: Record<string, unknown>, secret: string, expiresInSeconds: number): string {
  // Minimal HS256 JWT without a third-party dep — uses Node's built-in crypto
  const crypto = require('crypto') as typeof import('crypto');
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const iat = Math.floor(Date.now() / 1000);
  const body = Buffer.from(
    JSON.stringify({ ...payload, iat, exp: iat + expiresInSeconds })
  ).toString('base64url');
  const sig = crypto
    .createHmac('sha256', secret)
    .update(`${header}.${body}`)
    .digest('base64url');
  return `${header}.${body}.${sig}`;
}

/**
 * Verifies a token issued by `createAuthRouter`'s callback — checks the HS256 signature
 * (constant-time comparison) and rejects an expired or malformed token. Returns the decoded
 * payload (including `iat`/`exp`) on success, `null` otherwise. Exported because until this
 * existed, downstream apps had no package-supported way to verify the JWT lsdb issues and were
 * left to reimplement HS256 verification themselves.
 */
export function verifyJwt(token: string, secret: string): Record<string, unknown> | null {
  const crypto = require('crypto') as typeof import('crypto');
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;

  const expectedSig = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf-8'));
  } catch {
    return null;
  }

  const exp = payload.exp;
  if (typeof exp === 'number' && Math.floor(Date.now() / 1000) >= exp) return null;

  return payload;
}

/**
 * Self-contained, unpredictable OAuth `state` value — HMAC-signed rather than server-session-backed
 * so it fits this router's stateless design (no session store dependency). Round-tripped through
 * Google unmodified and re-verified in the callback (`verifyState`) as CSRF protection for the
 * login flow: without it, an attacker can start their own OAuth transaction and trick a victim's
 * browser into completing it under the attacker's identity.
 */
function signState(secret: string): string {
  const crypto = require('crypto') as typeof import('crypto');
  const nonce = crypto.randomBytes(16).toString('base64url');
  const ts = Date.now().toString();
  const payload = `${nonce}.${ts}`;
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function verifyState(state: string | undefined, secret: string, maxAgeMs: number): boolean {
  if (!state) return false;
  const parts = state.split('.');
  if (parts.length !== 3) return false;
  const [nonce, ts, sig] = parts;

  const crypto = require('crypto') as typeof import('crypto');
  const expectedSig = crypto.createHmac('sha256', secret).update(`${nonce}.${ts}`).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return false;
  }

  const issuedAt = Number(ts);
  if (!Number.isFinite(issuedAt)) return false;
  return Date.now() - issuedAt <= maxAgeMs;
}

export interface AuthRouter {
  /** Mount on an Express app: `app.use(router.handler)` */
  handler: (req: Req, res: Res, next: () => void) => Promise<void>;
  /** The path that starts the OAuth flow (e.g. `/auth/google`) */
  loginPath: string;
  /** The OAuth redirect path (e.g. `/auth/callback`) */
  callbackPath: string;
}

/**
 * Creates an Express-compatible auth router that wires up two routes:
 *
 *   GET {basePath}/auth/google    — redirects to Google OAuth consent screen
 *   GET {basePath}/auth/callback  — exchanges code, verifies identity, issues JWT
 *
 * @example
 * ```typescript
 * import express from 'express'
 * import { createAuthRouter } from 'longcelot-sheet-db'
 *
 * const auth = createAuthRouter({
 *   adapter,
 *   jwtSecret: process.env.JWT_SECRET!,
 *   frontendUrl: process.env.FRONTEND_URL!,
 *   registrationPolicy: 'login-only',   // admin-only — no self-signup
 *   async onUser(profile, adapter) {
 *     const ctx = adapter.withContext({ userId: 'auth', actor: 'admin', actorSheetId: process.env.ADMIN_SHEET_ID! })
 *     return await ctx.table('users').findOne({ where: { email: profile.email } })
 *   },
 * })
 *
 * app.use(auth.handler)
 * ```
 */
export function createAuthRouter(options: AuthRouterOptions): AuthRouter {
  const {
    adapter,
    jwtSecret,
    frontendUrl,
    onUser,
    registrationPolicy = 'open',
    basePath = '',
    jwtExpiresInSeconds = DEFAULT_JWT_EXPIRES_IN_SECONDS,
    tokenDelivery = 'query',
    scopes,
  } = options;

  if (scopes && !scopes.includes('openid')) {
    throw new ValidationError(
      "AuthRouterOptions.scopes must include 'openid' — the callback exchanges the OAuth code " +
      "for an id_token to build the GoogleProfile passed to onUser, and Google only issues an " +
      "id_token when 'openid' was requested. Add 'openid' to the list, or omit `scopes` to use " +
      'the default LOGIN_SCOPES.',
      'scopes'
    );
  }

  const oauthCfg: OAuthConfig = options.oauthConfig ?? {
    clientId: process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    redirectUri: process.env.GOOGLE_REDIRECT_URI!,
  };

  const oauth: OAuthManager = createLoginOAuthManager(oauthCfg);

  const loginPath = `${basePath}/auth/google`;
  const callbackPath = `${basePath}/auth/callback`;

  const handler = async (req: Req, res: Res, next: () => void): Promise<void> => {
    const url = (req as unknown as { path?: string; url?: string }).path
      ?? (req as unknown as { url?: string }).url
      ?? '';

    const pathname = url.split('?')[0];

    if (pathname === loginPath) {
      const state = signState(jwtSecret);
      const authUrl = oauth.getAuthUrl(scopes, state);
      res.redirect(authUrl);
      return;
    }

    if (pathname === callbackPath) {
      if (!verifyState(req.query['state'], jwtSecret, DEFAULT_STATE_MAX_AGE_MS)) {
        res.status(401).json({ error: 'Invalid or expired OAuth state — possible CSRF attempt, restart login' });
        return;
      }

      const code = req.query['code'];
      if (!code) {
        res.status(400).json({ error: 'Missing OAuth code' });
        return;
      }

      let tokens: Record<string, unknown>;
      try {
        tokens = (await oauth.getTokens(code)) as Record<string, unknown>;
      } catch {
        res.status(401).json({ error: 'Failed to exchange OAuth code' });
        return;
      }

      let profile: GoogleProfile;
      try {
        const idToken = tokens['id_token'] as string;
        if (!idToken) throw new Error('No id_token in OAuth response — ensure openid scope is requested');
        profile = (await oauth.verifyToken(idToken)) as GoogleProfile;
      } catch (err) {
        // Log the real cause server-side only — echoing a caught exception's message back into
        // the HTTP response is an information-disclosure risk (CWE-209): onUser/token verification
        // can throw errors carrying internal detail (a DB error, a Sheets API error, a stack-trace
        // string), and the recipient here is the end user's own browser completing the OAuth
        // redirect, not a trusted operator.
        console.error('[lsdb auth] Token verification failed:', err);
        res.status(401).json({ error: 'Token verification failed' });
        return;
      }

      let user: Record<string, unknown> | null;
      try {
        user = await onUser(profile, adapter);
      } catch (err) {
        console.error('[lsdb auth] onUser callback threw:', err);
        res.status(500).json({ error: 'Authentication failed' });
        return;
      }

      if (user === null) {
        if (registrationPolicy === 'login-only') {
          res
            .status(401)
            .json({ error: `Access denied: '${profile.email}' is not an authorised user. Contact an admin.` });
          return;
        }
        // 'open' policy — fall through with minimal profile as user payload
        user = { email: profile.email, name: profile.name, sub: profile.sub };
      }

      const jwt = signJwt(user, jwtSecret, jwtExpiresInSeconds);
      const separator = tokenDelivery === 'fragment' ? '#' : '?';
      res.redirect(`${frontendUrl}${separator}token=${jwt}`);
      return;
    }

    next();
  };

  return { handler, loginPath, callbackPath };
}
