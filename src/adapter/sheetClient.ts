import { google, sheets_v4 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';

export class SheetClient {
  private sheets: sheets_v4.Sheets;
  private auth: OAuth2Client;

  constructor(credentials: { clientId: string; clientSecret: string; redirectUri: string }, tokens: any) {
    this.auth = new google.auth.OAuth2(
      credentials.clientId,
      credentials.clientSecret,
      credentials.redirectUri
    );
    this.auth.setCredentials(tokens);
    this.sheets = google.sheets({ version: 'v4', auth: this.auth });
  }

  async createSpreadsheet(title: string): Promise<string> {
    const response = await this.sheets.spreadsheets.create({
      requestBody: {
        properties: { title },
      },
    });
    return response.data.spreadsheetId!;
  }

  async addSheet(spreadsheetId: string, sheetName: string): Promise<void> {
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

  async getSheetNames(spreadsheetId: string): Promise<string[]> {
    const response = await this.sheets.spreadsheets.get({ spreadsheetId });
    return response.data.sheets?.map((sheet) => sheet.properties?.title || '') || [];
  }

  async writeHeader(spreadsheetId: string, sheetName: string, headers: string[]): Promise<void> {
    await this.sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetName}!A1`,
      valueInputOption: 'RAW',
      requestBody: {
        values: [headers],
      },
    });
  }

  async appendRow(spreadsheetId: string, sheetName: string, values: any[]): Promise<void> {
    await this.sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${sheetName}!A:A`,
      valueInputOption: 'RAW',
      requestBody: {
        values: [values],
      },
    });
  }

  async getAllRows(spreadsheetId: string, sheetName: string): Promise<any[][]> {
    const response = await this.sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!A:ZZ`,
    });
    return response.data.values || [];
  }

  async updateRow(spreadsheetId: string, sheetName: string, rowIndex: number, values: any[]): Promise<void> {
    await this.sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetName}!A${rowIndex}`,
      valueInputOption: 'RAW',
      requestBody: {
        values: [values],
      },
    });
  }

  async deleteRow(spreadsheetId: string, sheetName: string, rowIndex: number): Promise<void> {
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

  async shareWithUser(spreadsheetId: string, email: string, role: 'reader' | 'writer' = 'writer'): Promise<void> {
    const drive = google.drive({ version: 'v3', auth: this.auth });
    await drive.permissions.create({
      fileId: spreadsheetId,
      requestBody: {
        type: 'user',
        role,
        emailAddress: email,
      },
    });
  }

  private async getSheetId(spreadsheetId: string, sheetName: string): Promise<number> {
    const response = await this.sheets.spreadsheets.get({ spreadsheetId });
    const sheet = response.data.sheets?.find((s) => s.properties?.title === sheetName);
    return sheet?.properties?.sheetId || 0;
  }
}
