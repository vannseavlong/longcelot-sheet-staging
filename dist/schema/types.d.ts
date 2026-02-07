export type DataType = 'string' | 'number' | 'boolean' | 'date' | 'json';
export interface ColumnDefinition {
    type: DataType;
    required?: boolean;
    unique?: boolean;
    default?: any;
    min?: number;
    max?: number;
    enum?: any[];
    pattern?: RegExp;
    readonly?: boolean;
    primary?: boolean;
    ref?: string;
    index?: boolean;
}
export interface TableSchema {
    name: string;
    actor: string;
    timestamps?: boolean;
    softDelete?: boolean;
    columns: Record<string, ColumnDefinition>;
}
export interface SheetDBConfig {
    projectName: string;
    superAdminEmail: string;
    actors: string[];
}
export interface UserContext {
    userId: string;
    role: string;
    actorSheetId?: string;
}
export interface WhereClause {
    [key: string]: any;
}
export interface FindOptions {
    where?: WhereClause;
    limit?: number;
    offset?: number;
    orderBy?: string;
    order?: 'asc' | 'desc';
}
export interface UpdateOptions {
    where: WhereClause;
    data: Record<string, any>;
}
export interface DeleteOptions {
    where: WhereClause;
}
//# sourceMappingURL=types.d.ts.map