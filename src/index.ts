export { ValidationError } from './errors/ValidationError';
export { PermissionError } from './errors/PermissionError';
export { SchemaError } from './errors/SchemaError';
export { SchemaMismatchError } from './errors/SchemaMismatchError';

export { defineTable } from './schema/defineTable';
export { string, number, boolean, date, json, ColumnBuilder } from './schema/columnBuilder';
export { createSheetAdapter, SheetAdapter } from './adapter/sheetAdapter';
export { createOAuthManager, OAuthManager } from './auth/oauth';
export { hashPassword, comparePassword, validatePasswordStrength } from './auth/password';

export type {
  TableSchema,
  ColumnDefinition,
  SheetDBConfig,
  ActorConfig,
  SchemaMismatchBehaviour,
  UserContext,
  FindOptions,
  UpdateOptions,
  DeleteOptions,
} from './schema/types';

export { computeSchemaHash } from './utils/schemaHash';

export type { SheetAdapterConfig } from './adapter/sheetAdapter';
export type { OAuthConfig } from './auth/oauth';
