export { ValidationError } from './errors/ValidationError';
export { PermissionError } from './errors/PermissionError';
export { SchemaError } from './errors/SchemaError';
export { SchemaMismatchError } from './errors/SchemaMismatchError';

export { defineTable } from './schema/defineTable';
export { string, number, boolean, date, json, ColumnBuilder } from './schema/columnBuilder';
export { createSheetAdapter, SheetAdapter } from './adapter/sheetAdapter';
export { DriveStorageAdapter } from './adapter/driveStorageAdapter';
export { createOAuthManager, createLoginOAuthManager, OAuthManager } from './auth/oauth';
export { createAuthRouter } from './auth/router';
export { hashPassword, comparePassword, validatePasswordStrength } from './auth/password';

export type {
  TableSchema,
  ColumnDefinition,
  SheetDBConfig,
  ActorConfig,
  ActorPermission,
  SheetStyleConfig,
  SchemaMismatchBehaviour,
  UserContext,
  FindOptions,
  UpdateOptions,
  UpsertOptions,
  DeleteOptions,
  CreateOptions,
  OAuthTokens,
  TokenStore,
  DriveFolderConfig,
  UploadOptions,
  StorageAdapter,
  CreateUserSheetOptions,
} from './schema/types';

export { computeSchemaHash } from './utils/schemaHash';

export type { SheetAdapterConfig } from './adapter/sheetAdapter';
export type { OAuthConfig } from './auth/oauth';
export type {
  AuthRouterOptions,
  AuthRouter,
  GoogleProfile,
  RegistrationPolicy,
} from './auth/router';
