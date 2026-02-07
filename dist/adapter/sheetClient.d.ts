export declare class SheetClient {
    private sheets;
    private auth;
    constructor(credentials: {
        clientId: string;
        clientSecret: string;
        redirectUri: string;
    }, tokens: any);
    createSpreadsheet(title: string): Promise<string>;
    addSheet(spreadsheetId: string, sheetName: string): Promise<void>;
    getSheetNames(spreadsheetId: string): Promise<string[]>;
    writeHeader(spreadsheetId: string, sheetName: string, headers: string[]): Promise<void>;
    appendRow(spreadsheetId: string, sheetName: string, values: any[]): Promise<void>;
    getAllRows(spreadsheetId: string, sheetName: string): Promise<any[][]>;
    updateRow(spreadsheetId: string, sheetName: string, rowIndex: number, values: any[]): Promise<void>;
    deleteRow(spreadsheetId: string, sheetName: string, rowIndex: number): Promise<void>;
    shareWithUser(spreadsheetId: string, email: string, role?: 'reader' | 'writer'): Promise<void>;
    private getSheetId;
}
//# sourceMappingURL=sheetClient.d.ts.map