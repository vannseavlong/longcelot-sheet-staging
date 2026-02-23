/**
 * In-memory mock of SheetClient for use in unit/integration tests.
 * No Google API credentials required.
 */

type SheetData = Map<string, any[][]>; // sheetName -> rows (row 0 = headers)

export class MockSheetClient {
  private spreadsheets: Map<string, SheetData> = new Map();
  private idCounter = 1;

  /** Pre-seed a spreadsheet so tests can skip createSpreadsheet */
  seed(spreadsheetId: string, sheetName: string, rows: any[][]) {
    if (!this.spreadsheets.has(spreadsheetId)) {
      this.spreadsheets.set(spreadsheetId, new Map());
    }
    this.spreadsheets.get(spreadsheetId)!.set(sheetName, rows.map((r) => [...r]));
  }

  async createSpreadsheet(_title: string): Promise<string> {
    const id = `mock-sheet-${this.idCounter++}`;
    this.spreadsheets.set(id, new Map());
    return id;
  }

  async addSheet(spreadsheetId: string, sheetName: string): Promise<void> {
    this._ensureSpreadsheet(spreadsheetId);
    const sheets = this.spreadsheets.get(spreadsheetId)!;
    if (!sheets.has(sheetName)) {
      sheets.set(sheetName, []);
    }
  }

  async getSheetNames(spreadsheetId: string): Promise<string[]> {
    this._ensureSpreadsheet(spreadsheetId);
    return Array.from(this.spreadsheets.get(spreadsheetId)!.keys());
  }

  async writeHeader(spreadsheetId: string, sheetName: string, headers: string[]): Promise<void> {
    this._ensureSheet(spreadsheetId, sheetName);
    const rows = this.spreadsheets.get(spreadsheetId)!.get(sheetName)!;
    if (rows.length === 0) {
      rows.push([...headers]);
    } else {
      rows[0] = [...headers];
    }
  }

  async appendRow(spreadsheetId: string, sheetName: string, values: any[]): Promise<void> {
    this._ensureSheet(spreadsheetId, sheetName);
    this.spreadsheets.get(spreadsheetId)!.get(sheetName)!.push([...values]);
  }

  async getAllRows(spreadsheetId: string, sheetName: string): Promise<any[][]> {
    this._ensureSheet(spreadsheetId, sheetName);
    return this.spreadsheets.get(spreadsheetId)!.get(sheetName)!.map((r) => [...r]);
  }

  async updateRow(
    spreadsheetId: string,
    sheetName: string,
    rowIndex: number,
    values: any[]
  ): Promise<void> {
    this._ensureSheet(spreadsheetId, sheetName);
    const rows = this.spreadsheets.get(spreadsheetId)!.get(sheetName)!;
    rows[rowIndex - 1] = [...values]; // rowIndex is 1-based
  }

  async deleteRow(spreadsheetId: string, sheetName: string, rowIndex: number): Promise<void> {
    this._ensureSheet(spreadsheetId, sheetName);
    const rows = this.spreadsheets.get(spreadsheetId)!.get(sheetName)!;
    rows.splice(rowIndex - 1, 1); // rowIndex is 1-based
  }

  async shareWithUser(_spreadsheetId: string, _email: string, _role: string): Promise<void> {
    // no-op in tests
  }

  /** Helper: get raw rows for assertions */
  getRows(spreadsheetId: string, sheetName: string): any[][] {
    return this.spreadsheets.get(spreadsheetId)?.get(sheetName) ?? [];
  }

  private _ensureSpreadsheet(spreadsheetId: string) {
    if (!this.spreadsheets.has(spreadsheetId)) {
      this.spreadsheets.set(spreadsheetId, new Map());
    }
  }

  private _ensureSheet(spreadsheetId: string, sheetName: string) {
    this._ensureSpreadsheet(spreadsheetId);
    const sheets = this.spreadsheets.get(spreadsheetId)!;
    if (!sheets.has(sheetName)) {
      sheets.set(sheetName, []);
    }
  }
}
