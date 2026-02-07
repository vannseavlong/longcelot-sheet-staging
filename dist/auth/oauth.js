"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OAuthManager = void 0;
exports.createOAuthManager = createOAuthManager;
const google_auth_library_1 = require("google-auth-library");
class OAuthManager {
    constructor(config) {
        this.client = new google_auth_library_1.OAuth2Client(config.clientId, config.clientSecret, config.redirectUri);
    }
    getAuthUrl(scopes = ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive.file']) {
        return this.client.generateAuthUrl({
            access_type: 'offline',
            scope: scopes,
        });
    }
    async getTokens(code) {
        const { tokens } = await this.client.getToken(code);
        return tokens;
    }
    async refreshTokens(refreshToken) {
        this.client.setCredentials({ refresh_token: refreshToken });
        const { credentials } = await this.client.refreshAccessToken();
        return credentials;
    }
    async verifyToken(token) {
        const ticket = await this.client.verifyIdToken({
            idToken: token,
            audience: this.client._clientId,
        });
        return ticket.getPayload();
    }
}
exports.OAuthManager = OAuthManager;
function createOAuthManager(config) {
    return new OAuthManager(config);
}
//# sourceMappingURL=oauth.js.map