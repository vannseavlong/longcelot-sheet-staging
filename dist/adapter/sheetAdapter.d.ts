import { SheetClient } from './sheetClient';
import { CRUDOperations } from './crud';
import { TableSchema, UserContext } from '../schema/types';
export interface SheetAdapterConfig {
    adminSheetId: string;
    credentials: {
        clientId: string;
        clientSecret: string;
        redirectUri: string;
    };
    tokens: any;
}
export declare class SheetAdapter {
    private client;
    private adminSheetId;
    private schemas;
    private context?;
    constructor(config: SheetAdapterConfig);
    registerSchema(schema: TableSchema): void;
    registerSchemas(schemas: TableSchema[]): void;
    withContext(context: UserContext): SheetAdapter;
    table(tableName: string): CRUDOperations;
    createUserSheet(userId: string, role: string, email: string): Promise<string>;
    syncSchema(schema: TableSchema): Promise<void>;
    private resolveSpreadsheetId;
    private hasPermission;
    private sheetExists;
    getClient(): SheetClient;
}
export declare function createSheetAdapter(config: SheetAdapterConfig): SheetAdapter;
//# sourceMappingURL=sheetAdapter.d.ts.map