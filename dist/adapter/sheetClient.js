"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SheetClient = void 0;
const googleapis_1 = require("googleapis");
class SheetClient {
    constructor(credentials, tokens) {
        this.auth = new googleapis_1.google.auth.OAuth2(credentials.clientId, credentials.clientSecret, credentials.redirectUri);
        this.auth.setCredentials(tokens);
        this.sheets = googleapis_1.google.sheets({ version: 'v4', auth: this.auth });
    }
    async createSpreadsheet(title) {
        const response = await this.sheets.spreadsheets.create({
            requestBody: {
                properties: { title },
            },
        });
        return response.data.spreadsheetId;
    }
    async addSheet(spreadsheetId, sheetName) {
        await this.sheets.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: {
                requests: [
                    {
                        addSheet: {
                            properties: { title: sheetName },
                        },
                    },
                ],
            },
        });
    }
    async getSheetNames(spreadsheetId) {
        const response = await this.sheets.spreadsheets.get({ spreadsheetId });
        return response.data.sheets?.map((sheet) => sheet.properties?.title || '') || [];
    }
    async writeHeader(spreadsheetId, sheetName, headers) {
        await this.sheets.spreadsheets.values.update({
            spreadsheetId,
            range: `${sheetName}!A1`,
            valueInputOption: 'RAW',
            requestBody: {
                values: [headers],
            },
        });
    }
    async appendRow(spreadsheetId, sheetName, values) {
        await this.sheets.spreadsheets.values.append({
            spreadsheetId,
            range: `${sheetName}!A:A`,
            valueInputOption: 'RAW',
            requestBody: {
                values: [values],
            },
        });
    }
    async getAllRows(spreadsheetId, sheetName) {
        const response = await this.sheets.spreadsheets.values.get({
            spreadsheetId,
            range: `${sheetName}!A:ZZ`,
        });
        return response.data.values || [];
    }
    async updateRow(spreadsheetId, sheetName, rowIndex, values) {
        await this.sheets.spreadsheets.values.update({
            spreadsheetId,
            range: `${sheetName}!A${rowIndex}`,
            valueInputOption: 'RAW',
            requestBody: {
                values: [values],
            },
        });
    }
    async deleteRow(spreadsheetId, sheetName, rowIndex) {
        const sheetId = await this.getSheetId(spreadsheetId, sheetName);
        await this.sheets.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: {
                requests: [
                    {
                        deleteDimension: {
                            range: {
                                sheetId,
                                dimension: 'ROWS',
                                startIndex: rowIndex - 1,
                                endIndex: rowIndex,
                            },
                        },
                    },
                ],
            },
        });
    }
    async shareWithUser(spreadsheetId, email, role = 'writer') {
        const drive = googleapis_1.google.drive({ version: 'v3', auth: this.auth });
        await drive.permissions.create({
            fileId: spreadsheetId,
            requestBody: {
                type: 'user',
                role,
                emailAddress: email,
            },
        });
    }
    async getSheetId(spreadsheetId, sheetName) {
        const response = await this.sheets.spreadsheets.get({ spreadsheetId });
        const sheet = response.data.sheets?.find((s) => s.properties?.title === sheetName);
        return sheet?.properties?.sheetId || 0;
    }
}
exports.SheetClient = SheetClient;
//# sourceMappingURL=sheetClient.js.map