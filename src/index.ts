export { ValidationError } from './errors/ValidationError';
export { PermissionError } from './errors/PermissionError';
export { SchemaError } from './errors/SchemaError';
export { SchemaMismatchError } from './errors/SchemaMismatchError';

export { defineTable } from './schema/defineTable';
export { string, number, boolean, date, json, ColumnBuilder } from './schema/columnBuilder';
export { createSheetAdapter, SheetAdapter } from './adapter/sheetAdapter';
export { DriveStorageAdapter } from './adapter/driveStorageAdapter';
export { createOAuthManager, createLoginOAuthManager, OAuthManager } from './auth/oauth';
export { createAuthRouter, verifyJwt } from './auth/router';
export { hashPassword, comparePassword, validatePasswordStrength } from './auth/password';

export type {
  TableSchema,
  ColumnDefinition,
  SheetDBConfig,
  ActorConfig,
  ActorPermission,
  SheetStyleConfig,
  SheetReadCacheConfig,
  BooleanFormat,
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

// Phase 18: Drive link rendering — `DriveStorageAdapter.upload()` uses these internally to return
// a URL that renders directly (thumbnail/preview/viewer) instead of a raw download link; exported
// so consumers can normalise pre-existing download-format links on read via `toDriveEmbedUrl()`.
export {
  classifyDriveMediaKind,
  buildDriveViewUrl,
  buildDriveDownloadUrl,
  extractDriveFileId,
  toDriveEmbedUrl,
} from './utils/driveMedia';
export type { DriveMediaKind } from './utils/driveMedia';

export type { SheetAdapterConfig } from './adapter/sheetAdapter';
export type { OAuthConfig } from './auth/oauth';
export type {
  AuthRouterOptions,
  AuthRouter,
  GoogleProfile,
  RegistrationPolicy,
} from './auth/router';

// Phase 16: formal adapter contract — implement these to back `adapter.table(name)` with a
// non-Sheets storage engine (e.g. Postgres/MySQL) without reaching into internals.
export type { DatabaseAdapter, TableOperations, StorageClient } from './adapter/types';
export type { ColumnValidationRule } from './adapter/sheetClient';

// Phase 16.2: SQL backends — Postgres/MySQL (pg/mysql2 are optional peerDependencies, lazily
// required only inside these factories) and Prisma (wraps a consumer-provided PrismaClient; see
// PrismaAdapterConfig for why this package doesn't generate/`prisma generate` a client itself).
export { createPostgresAdapter } from './adapter/sql/postgresAdapter';
export type { PostgresAdapterConfig } from './adapter/sql/postgresAdapter';
export { createMySQLAdapter } from './adapter/sql/mysqlAdapter';
export type { MySQLAdapterConfig } from './adapter/sql/mysqlAdapter';
export { createPrismaAdapter, PrismaAdapterBase } from './adapter/sql/prismaAdapter';
export type { PrismaAdapterConfig } from './adapter/sql/prismaAdapter';
export { SQLAdapterBase } from './adapter/sql/sqlAdapterBase';
export type { SQLAdapterConfig } from './adapter/sql/sqlAdapterBase';
export type { SQLConnection, SQLQueryResult } from './adapter/sql/connection';
export type { SQLDialect } from './adapter/sql/dialect';
export { PostgresDialect, MySQLDialect } from './adapter/sql/dialect';
export { createDatabaseAdapter } from './adapter/createDatabaseAdapter';
export type { DBDriver, DatabaseAdapterFactoryConfig } from './adapter/createDatabaseAdapter';

// Phase 16.3: shared access-control primitives — SheetAdapter and the SQL adapters both delegate
// to these instead of reimplementing the cross-actor permission matrix (see FAQ.md #13).
export { hasPermission, resolveNonAdminTenantKey } from './adapter/accessControl';
export type { AccessControlContext } from './adapter/accessControl';
