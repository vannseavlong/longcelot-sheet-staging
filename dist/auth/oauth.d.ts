export interface OAuthConfig {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
}
export declare class OAuthManager {
    private client;
    constructor(config: OAuthConfig);
    getAuthUrl(scopes?: string[]): string;
    getTokens(code: string): Promise<any>;
    refreshTokens(refreshToken: string): Promise<any>;
    verifyToken(token: string): Promise<any>;
}
export declare function createOAuthManager(config: OAuthConfig): OAuthManager;
//# sourceMappingURL=oauth.d.ts.map