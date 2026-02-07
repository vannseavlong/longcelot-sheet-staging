import { TableSchema, ColumnDefinition } from './types';
import { ColumnBuilder } from './columnBuilder';
interface TableInput {
    name: string;
    actor: string;
    timestamps?: boolean;
    softDelete?: boolean;
    columns: Record<string, ColumnBuilder | ColumnDefinition>;
}
export declare function defineTable(input: TableInput): TableSchema;
export {};
//# sourceMappingURL=defineTable.d.ts.map