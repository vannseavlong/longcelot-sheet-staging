export type DataType = 'string' | 'number' | 'boolean' | 'date' | 'json';

export interface ColumnDefinition {
  type: DataType;
  required?: boolean;
  unique?: boolean;
  default?: string | number | boolean | null;
  min?: number;
  max?: number;
  enum?: (string | number | boolean)[];
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

export interface ActorConfig {
  role: string;
  sheetIdEnv: string;
}

export type SchemaMismatchBehaviour = 'warn' | 'error' | 'auto-sync';

export interface SheetDBConfig {
  projectName: string;
  superAdminEmail: string;
  actors: ActorConfig[];
  onSchemaMismatch?: SchemaMismatchBehaviour;
  schemasDir?: string;
}

export interface ActorPermission {
  canAccess: string[];
  tables?: string[];
  allowedOperations?: Array<'create' | 'read' | 'update' | 'delete'>;
}

export interface UserContext {
  userId: string;
  role: string;
  actorSheetId?: string;
  targetRole?: string;
  targetSheetId?: string;
}

export interface WhereClause {
  [key: string]: unknown;
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
  data: Record<string, unknown>;
  skipFKValidation?: boolean;
}

export interface UpsertOptions {
  where: WhereClause;
  data: Record<string, unknown>;
  skipFKValidation?: boolean;
}

export interface DeleteOptions {
  where: WhereClause;
}

export type FKResolver = (tableName: string, columnName: string, value: unknown) => Promise<boolean>;

// ── Drive / Auth types ────────────────────────────────────────────────────────

export interface OAuthTokens {
  access_token?: string | null;
  refresh_token?: string | null;
  expiry_date?: number | null;
  id_token?: string | null;
  token_type?: string | null;
  scope?: string | null;
}

export interface TokenStore {
  get(actorId: string): Promise<OAuthTokens | null>;
  set(actorId: string, tokens: OAuthTokens): Promise<void>;
}

export interface DriveFolderConfig {
  /** Folder name at the root of My Drive (or Shared Drive when sharedDriveId is set). Created if missing. */
  root: string;
  /** Map of actor role → subfolder name inside root. Falls back to the role name when omitted. */
  subfolders?: Record<string, string>;
}

export interface UploadOptions {
  filename: string;
  mimeType: string;
  /** Subfolder path relative to driveFolder.root (or Drive root). Created if missing. */
  folder?: string;
  /** When true, sets a Drive permission of type 'anyone', role 'reader'. */
  public?: boolean;
}

export interface StorageAdapter {
  upload(file: Buffer, options: UploadOptions): Promise<string>;
  delete(url: string): Promise<void>;
}

export interface CreateUserSheetOptions {
  /** OAuth tokens from the actor's own Google login. When provided, the sheet is created in the actor's Drive. */
  actorTokens?: OAuthTokens;
  /** Extra fields spread into the users table create() call. */
  extraFields?: Record<string, unknown>;
}
