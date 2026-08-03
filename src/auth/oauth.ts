import { OAuth2Client } from 'google-auth-library';

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

const SHEETS_SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.file',
];

const LOGIN_SCOPES = [
  'openid',
  'email',
  'profile',
  ...SHEETS_SCOPES,
];

export class OAuthManager {
  private client: OAuth2Client;
  private defaultScopes: string[];

  constructor(config: OAuthConfig, defaultScopes: string[] = SHEETS_SCOPES) {
    this.client = new OAuth2Client(config.clientId, config.clientSecret, config.redirectUri);
    this.defaultScopes = defaultScopes;
  }

  /**
   * @param state Opaque value round-tripped through Google and returned on the callback.
   *   Pass a per-login, unpredictable value (e.g. `signState()` in router.ts) and verify it
   *   on callback — without this, the OAuth flow has no CSRF protection: an attacker can start
   *   their own OAuth transaction, capture the callback, and trick a victim's browser into
   *   completing it (login CSRF / session fixation).
   */
  getAuthUrl(scopes: string[] = this.defaultScopes, state?: string): string {
    return this.client.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
      prompt: 'consent',
      ...(state ? { state } : {}),
    });
  }

  async getTokens(code: string): Promise<unknown> {
    const { tokens } = await this.client.getToken(code);
    return tokens;
  }

  async refreshTokens(refreshToken: string): Promise<unknown> {
    this.client.setCredentials({ refresh_token: refreshToken });
    const { credentials } = await this.client.refreshAccessToken();
    return credentials;
  }

  /** Verifies a Google ID token. Only works when `openid` scope was requested (use createLoginOAuthManager). */
  async verifyToken(idToken: string): Promise<unknown> {
    const ticket = await this.client.verifyIdToken({
      idToken,
      audience: this.client._clientId,
    });
    return ticket.getPayload();
  }
}

/** Standard adapter-only OAuth — for backend-to-Sheets communication. Does NOT produce id_token. */
export function createOAuthManager(config: OAuthConfig): OAuthManager {
  return new OAuthManager(config, SHEETS_SCOPES);
}

/**
 * Login OAuth manager — pre-configured with `openid email profile` scopes alongside
 * Sheets scopes. Use this for user-facing Google Sign-In. The tokens it produces include
 * an `id_token` that can be verified with `manager.verifyToken(idToken)`.
 */
export function createLoginOAuthManager(config: OAuthConfig): OAuthManager {
  return new OAuthManager(config, LOGIN_SCOPES);
}
