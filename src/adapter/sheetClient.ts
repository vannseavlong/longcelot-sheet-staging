import { google, sheets_v4, drive_v3 } from 'googleapis';
import { OAuth2Client, Credentials } from 'google-auth-library';
import { Readable } from 'stream';

export interface CreateSpreadsheetOptions {
  /** Place the spreadsheet inside this Drive folder ID. */
  folderId?: string;
  /** When set, enables supportsAllDrives for Shared Drive placement. */
  sharedDriveId?: string;
}

export type ColumnValidationRule =
  | { columnIndex: number; type: 'BOOLEAN' }
  | { columnIndex: number; type: 'ONE_OF_LIST'; values: (string | number | boolean)[] };

export interface SheetFormattingOptions {
  /** Total number of header columns — used for fill/auto-resize ranges. */
  columnCount: number;
  headerColor?: string;
  freezeHeader?: boolean;
  freezeFirstColumn?: boolean;
  validations?: ColumnValidationRule[];
}

function hexToRgb(hex: string): { red: number; green: number; blue: number } {
  const normalized = hex.replace('#', '');
  const r = parseInt(normalized.substring(0, 2), 16);
  const g = parseInt(normalized.substring(2, 4), 16);
  const b = parseInt(normalized.substring(4, 6), 16);
  return { red: r / 255, green: g / 255, blue: b / 255 };
}

export class SheetClient {
  private sheets: sheets_v4.Sheets;
  private drive: drive_v3.Drive;
  private auth: OAuth2Client;

  constructor(credentials: { clientId: string; clientSecret: string; redirectUri: string }, tokens: unknown) {
    this.auth = new google.auth.OAuth2(
      credentials.clientId,
      credentials.clientSecret,
      credentials.redirectUri
    );
    this.auth.setCredentials(tokens as Credentials);
    this.sheets = google.sheets({ version: 'v4', auth: this.auth });
    this.drive = google.drive({ version: 'v3', auth: this.auth });
  }

  async createSpreadsheet(title: string, options?: CreateSpreadsheetOptions): Promise<string> {
    const supportsAllDrives = !!(options?.sharedDriveId || options?.folderId);
    const parents = options?.folderId
      ? [options.folderId]
      : options?.sharedDriveId
      ? [options.sharedDriveId]
      : undefined;

    const response = await this.drive.files.create({
      supportsAllDrives,
      requestBody: {
        name: title,
        mimeType: 'application/vnd.google-apps.spreadsheet',
        ...(parents ? { parents } : {}),
      },
      fields: 'id',
    });
    return response.data.id!;
  }

  async findOrCreateFolder(name: string, parentId?: string, sharedDriveId?: string): Promise<string> {
    const escapedName = name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    let q = `name='${escapedName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
    if (parentId) q += ` and '${parentId}' in parents`;

    const listParams: drive_v3.Params$Resource$Files$List = {
      q,
      fields: 'files(id)',
      pageSize: 1,
    };

    if (sharedDriveId) {
      listParams.corpora = 'drive';
      listParams.driveId = sharedDriveId;
      listParams.includeItemsFromAllDrives = true;
      listParams.supportsAllDrives = true;
    }

    const found = await this.drive.files.list(listParams);
    if (found.data.files && found.data.files.length > 0) {
      return found.data.files[0].id!;
    }

    const createParents = parentId
      ? [parentId]
      : sharedDriveId
      ? [sharedDriveId]
      : undefined;

    const created = await this.drive.files.create({
      supportsAllDrives: !!sharedDriveId,
      requestBody: {
        name,
        mimeType: 'application/vnd.google-apps.folder',
        ...(createParents ? { parents: createParents } : {}),
      },
      fields: 'id',
    });
    return created.data.id!;
  }

  async uploadFile(
    buffer: Buffer,
    filename: string,
    mimeType: string,
    folderId?: string,
    makePublic?: boolean
  ): Promise<string> {
    const readable = new Readable();
    readable.push(buffer);
    readable.push(null);

    const response = await this.drive.files.create({
      requestBody: {
        name: filename,
        ...(folderId ? { parents: [folderId] } : {}),
      },
      media: {
        mimeType,
        body: readable,
      },
      fields: 'id',
    });

    const fileId = response.data.id!;

    if (makePublic) {
      await this.drive.permissions.create({
        fileId,
        requestBody: { type: 'anyone', role: 'reader' },
      });
    }

    return fileId;
  }

  async deleteFile(fileId: string): Promise<void> {
    await this.drive.files.delete({ fileId });
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

  /**
   * Applies header fill color, frozen rows/columns, auto-fit column widths, and
   * boolean/enum data validation dropdowns in a single batchUpdate call.
   */
  async formatSheet(
    spreadsheetId: string,
    sheetName: string,
    options: SheetFormattingOptions
  ): Promise<void> {
    const sheetId = await this.getSheetId(spreadsheetId, sheetName);
    const requests: sheets_v4.Schema$Request[] = [];

    if (options.headerColor) {
      requests.push({
        repeatCell: {
          range: {
            sheetId,
            startRowIndex: 0,
            endRowIndex: 1,
            startColumnIndex: 0,
            endColumnIndex: options.columnCount,
          },
          cell: {
            userEnteredFormat: { backgroundColor: hexToRgb(options.headerColor) },
          },
          fields: 'userEnteredFormat.backgroundColor',
        },
      });
    }

    if (options.freezeHeader || options.freezeFirstColumn) {
      const fields: string[] = [];
      const gridProperties: sheets_v4.Schema$GridProperties = {};
      if (options.freezeHeader) {
        gridProperties.frozenRowCount = 1;
        fields.push('gridProperties.frozenRowCount');
      }
      if (options.freezeFirstColumn) {
        gridProperties.frozenColumnCount = 1;
        fields.push('gridProperties.frozenColumnCount');
      }
      requests.push({
        updateSheetProperties: {
          properties: { sheetId, gridProperties },
          fields: fields.join(','),
        },
      });
    }

    requests.push({
      autoResizeDimensions: {
        dimensions: {
          sheetId,
          dimension: 'COLUMNS',
          startIndex: 0,
          endIndex: options.columnCount,
        },
      },
    });

    for (const rule of options.validations ?? []) {
      requests.push({
        setDataValidation: {
          range: {
            sheetId,
            startRowIndex: 1,
            startColumnIndex: rule.columnIndex,
            endColumnIndex: rule.columnIndex + 1,
          },
          rule: {
            condition:
              rule.type === 'BOOLEAN'
                ? { type: 'BOOLEAN' }
                : {
                    type: 'ONE_OF_LIST',
                    values: rule.values.map((v) => ({ userEnteredValue: String(v) })),
                  },
            strict: true,
            showCustomUi: true,
          },
        },
      });
    }

    await this.sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests },
    });
  }

  async appendRow(spreadsheetId: string, sheetName: string, values: string[]): Promise<void> {
    await this.sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${sheetName}!A:A`,
      valueInputOption: 'RAW',
      requestBody: {
        values: [values],
      },
    });
  }

  async appendRows(spreadsheetId: string, sheetName: string, rows: string[][]): Promise<void> {
    if (rows.length === 0) return;
    await this.sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${sheetName}!A:A`,
      valueInputOption: 'RAW',
      requestBody: {
        values: rows,
      },
    });
  }

  async getAllRows(spreadsheetId: string, sheetName: string): Promise<string[][]> {
    const response = await this.sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!A:ZZ`,
    });
    return response.data.values || [];
  }

  async updateRow(spreadsheetId: string, sheetName: string, rowIndex: number, values: string[]): Promise<void> {
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
    await this.drive.permissions.create({
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
