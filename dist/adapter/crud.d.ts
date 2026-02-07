import { SheetClient } from './sheetClient';
import { TableSchema, FindOptions, UpdateOptions, DeleteOptions } from '../schema/types';
export declare class CRUDOperations {
    private client;
    private spreadsheetId;
    private schema;
    constructor(client: SheetClient, spreadsheetId: string, schema: TableSchema);
    create(data: Record<string, any>): Promise<Record<string, any>>;
    findMany(options?: FindOptions): Promise<Record<string, any>[]>;
    findOne(options?: FindOptions): Promise<Record<string, any> | null>;
    update(options: UpdateOptions): Promise<number>;
    delete(options: DeleteOptions): Promise<number>;
    private getHeaders;
    private validateAndApplyDefaults;
    private serializeValue;
    private deserializeRow;
    private matchesWhere;
}
//# sourceMappingURL=crud.d.ts.map