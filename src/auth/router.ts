import { SheetAdapter } from '../adapter/sheetAdapter';
import { OAuthManager, createLoginOAuthManager, OAuthConfig } from './oauth';

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

function signJwt(payload: Record<string, unknown>, secret: string): string {
  // Minimal HS256 JWT without a third-party dep — uses Node's built-in crypto
  const crypto = require('crypto') as typeof import('crypto');
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ ...payload, iat: Math.floor(Date.now() / 1000) })).toString('base64url');
  const sig = crypto
    .createHmac('sha256', secret)
    .update(`${header}.${body}`)
    .digest('base64url');
  return `${header}.${body}.${sig}`;
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
  } = options;

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
      const authUrl = oauth.getAuthUrl();
      res.redirect(authUrl);
      return;
    }

    if (pathname === callbackPath) {
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
        res.status(401).json({ error: `Token verification failed: ${err}` });
        return;
      }

      let user: Record<string, unknown> | null;
      try {
        user = await onUser(profile, adapter);
      } catch (err) {
        res.status(500).json({ error: `onUser callback threw: ${err}` });
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

      const jwt = signJwt(user, jwtSecret);
      res.redirect(`${frontendUrl}?token=${jwt}`);
      return;
    }

    next();
  };

  return { handler, loginPath, callbackPath };
}
