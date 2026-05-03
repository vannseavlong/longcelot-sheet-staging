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
  pkColumn?: string;
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

export interface CreateOptions {
  skipFKValidation?: boolean;
}

export interface UpdateOptions {
  where: WhereClause;
  data: Record<string, any>;
  skipFKValidation?: boolean;
}

export interface DeleteOptions {
  where: WhereClause;
}

export type FKResolver = (tableName: string, columnName: string, value: unknown) => Promise<boolean>;
