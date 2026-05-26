import { OAuth2Client } from 'google-auth-library';

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export class OAuthManager {
  private client: OAuth2Client;

  constructor(config: OAuthConfig) {
    this.client = new OAuth2Client(config.clientId, config.clientSecret, config.redirectUri);
  }

  getAuthUrl(scopes: string[] = ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive.file']): string {
    return this.client.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
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

  async verifyToken(token: string): Promise<unknown> {
    const ticket = await this.client.verifyIdToken({
      idToken: token,
      audience: this.client._clientId,
    });
    return ticket.getPayload();
  }
}

export function createOAuthManager(config: OAuthConfig): OAuthManager {
  return new OAuthManager(config);
}
