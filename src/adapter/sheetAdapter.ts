import { SheetClient } from './sheetClient';
import { CRUDOperations } from './crud';
import {
  TableSchema,
  UserContext,
  FKResolver,
  SchemaMismatchBehaviour,
  ActorPermission,
  DriveFolderConfig,
  TokenStore,
  StorageAdapter,
  UploadOptions,
  CreateUserSheetOptions,
} from '../schema/types';

// Internal context type — always has both actor and role set (normalised by withContext).
interface NormalisedContext {
  userId: string;
  actor: string;
  role: string;
  actorSheetId?: string;
  targetRole?: string;
  targetSheetId?: string;
}
import { PermissionError } from '../errors/PermissionError';
import { SchemaError } from '../errors/SchemaError';
import { SchemaMismatchError } from '../errors/SchemaMismatchError';
import { computeSchemaHash } from '../utils/schemaHash';
import { defineTable } from '../schema/defineTable';
import { string, number } from '../schema/columnBuilder';

// Built-in admin table — tracks schema versions per actor sheet
const SCHEMA_VERSIONS_SCHEMA: TableSchema = defineTable({
  name: 'schema_versions',
  actor: 'admin',
  columns: {
    schema_version_id: string().primary(),
    actor_sheet_id: string().required(),
    table_name: string().required(),
    schema_hash: string().required(),
    synced_at: string().required(),
    column_count: number().required(),
  },
});

export interface SheetAdapterConfig {
  adminSheetId: string;
  credentials: {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
  };
  tokens: unknown;
  onSchemaMismatch?: SchemaMismatchBehaviour;
  permissions?: Record<string, ActorPermission>;
  /** Place sheets in this Drive folder hierarchy. */
  driveFolder?: DriveFolderConfig;
  /** When set, all Drive file operations target this Shared Drive. */
  sharedDriveId?: string;
  /** Per-actor token store. Adapter calls get(userId) in createUserSheet when actorTokens not passed directly. */
  tokenStore?: TokenStore;
  /** File upload provider. Pass new DriveStorageAdapter() for built-in Drive upload. */
  storage?: StorageAdapter;
}

export class SheetAdapter {
  private client: SheetClient;
  private credentials: { clientId: string; clientSecret: string; redirectUri: string };
  private adminSheetId: string;
  private schemas: Map<string, TableSchema> = new Map();
  private context?: NormalisedContext;
  private onSchemaMismatch?: SchemaMismatchBehaviour;
  private permissions?: Record<string, ActorPermission>;
  private driveFolder?: DriveFolderConfig;
  private sharedDriveId?: string;
  private tokenStore?: TokenStore;
  private storage?: StorageAdapter;
  /** Cached Drive folder IDs: role -> folderId */
  private _folderCache = new Map<string, string>();
  /** Pending schema version check promise set by withContext() */
  private _pendingSchemaCheck?: Promise<void>;

  constructor(config: SheetAdapterConfig) {
    // Allow test injection via _client (cast through unknown for type safety)
    this.client = (config as unknown as Record<string, unknown>)._client as SheetClient
      ?? new SheetClient(config.credentials, config.tokens);
    this.credentials = config.credentials;
    this.adminSheetId = config.adminSheetId;
    this.onSchemaMismatch = config.onSchemaMismatch;
    this.permissions = config.permissions;
    this.driveFolder = config.driveFolder;
    this.sharedDriveId = config.sharedDriveId;
    this.tokenStore = config.tokenStore;
    this.storage = config.storage;

    // Inject the admin SheetClient into DriveStorageAdapter so callers don't repeat credentials
    const storageAsAny = this.storage as unknown as Record<string, unknown>;
    if (storageAsAny && typeof storageAsAny['_setClient'] === 'function') {
      (storageAsAny['_setClient'] as (c: SheetClient) => void)(this.client);
    }
  }

  registerSchema(schema: TableSchema): void {
    this.schemas.set(schema.name, schema);
    this.detectCircularRefs();
  }

  registerSchemas(schemas: TableSchema[]): void {
    schemas.forEach((schema) => this.registerSchema(schema));
  }

  withContext(context: UserContext): SheetAdapter {
    // Normalise actor/role: prefer `actor`, fall back to deprecated `role` with a warning.
    let actorValue: string;
    if (context.actor) {
      actorValue = context.actor;
    } else if (context.role) {
      console.warn(
        '[sheet-db] UserContext.role is deprecated — use actor instead. ' +
        'See: https://github.com/longcelot/sheet-db#actors-vs-application-roles'
      );
      actorValue = context.role;
    } else {
      throw new Error('[sheet-db] withContext() requires either actor or role in UserContext');
    }

    const normalised: NormalisedContext = {
      userId: context.userId,
      actor: actorValue,
      role: actorValue,
      actorSheetId: context.actorSheetId,
      targetRole: context.targetRole,
      targetSheetId: context.targetSheetId,
    };

    const newAdapter = Object.create(this) as SheetAdapter;
    newAdapter.context = normalised;
    newAdapter._pendingSchemaCheck = undefined;

    if (this.onSchemaMismatch && normalised.actorSheetId && normalised.role !== 'admin') {
      newAdapter._pendingSchemaCheck = newAdapter._doSchemaVersionCheck(normalised);
    }

    return newAdapter;
  }

  asActor(targetRole: string, targetSheetId: string): SheetAdapter {
    if (!this.context) {
      throw new PermissionError('Context required before calling asActor()', undefined);
    }
    // Pass actor: (not role:) so withContext does not emit a deprecation warning.
    return this.withContext({
      userId: this.context.userId,
      actor: this.context.actor,
      actorSheetId: this.context.actorSheetId,
      targetRole,
      targetSheetId,
    });
  }

  table(tableName: string): CRUDOperations {
    const schema = this.schemas.get(tableName);

    if (!schema) {
      throw new SchemaError(`Table ${tableName} is not registered`, tableName);
    }

    const spreadsheetId = this.resolveSpreadsheetId(schema);

    if (!this.hasPermission(schema)) {
      throw new PermissionError(`User does not have permission to access ${tableName}`, this.context?.role);
    }

    const fkResolver = this.createFKResolver();
    return new CRUDOperations(this.client, spreadsheetId, schema, fkResolver, this._pendingSchemaCheck);
  }

  async createUserSheet(
    userId: string,
    role: string,
    email: string,
    options?: CreateUserSheetOptions
  ): Promise<string> {
    // Resolve actor tokens: explicit > tokenStore > none (fall back to admin client)
    let actorTokens = options?.actorTokens;
    if (!actorTokens && this.tokenStore) {
      actorTokens = (await this.tokenStore.get(userId)) ?? undefined;
    }

    // Choose which client to use for spreadsheet creation
    const clientForCreate = actorTokens
      ? new SheetClient(this.credentials, actorTokens as unknown)
      : this.client;

    // Resolve Drive folder for this role (respects driveFolder config + sharedDriveId)
    const folderId = await this.resolveFolderForRole(role, clientForCreate);

    // Create the spreadsheet
    const sheetId = await clientForCreate.createSpreadsheet(`${role}-${userId}`, {
      folderId,
      sharedDriveId: this.sharedDriveId,
    });

    if (actorTokens) {
      // Sheet lives in actor's Drive — share with admin so admin can manage it
      if (process.env.SUPER_ADMIN_EMAIL) {
        await clientForCreate.shareWithUser(sheetId, process.env.SUPER_ADMIN_EMAIL, 'writer');
      }
    } else {
      // Sheet lives in admin's Drive — share with the actor and the admin email
      if (process.env.SUPER_ADMIN_EMAIL) {
        await this.client.shareWithUser(sheetId, process.env.SUPER_ADMIN_EMAIL, 'writer');
      }
      await this.client.shareWithUser(sheetId, email, 'writer');
    }

    const userTables = Array.from(this.schemas.values()).filter((s) => s.actor === role);

    for (const table of userTables) {
      await this.client.addSheet(sheetId, table.name);
      const headers = Object.keys(table.columns);
      await this.client.writeHeader(sheetId, table.name, headers);
    }

    const adminTable = this.table('users');
    await adminTable.create({
      user_id: userId,
      role,
      email,
      actor_sheet_id: sheetId,
      created_at: new Date().toISOString(),
      ...options?.extraFields,
    });

    return sheetId;
  }

  async upload(file: Buffer, options: UploadOptions): Promise<string> {
    if (!this.storage) {
      throw new SchemaError(
        'No storage adapter configured. Pass storage: new DriveStorageAdapter() to createSheetAdapter().'
      );
    }
    return this.storage.upload(file, options);
  }

  async deleteFile(url: string): Promise<void> {
    if (!this.storage) {
      throw new SchemaError(
        'No storage adapter configured. Pass storage: new DriveStorageAdapter() to createSheetAdapter().'
      );
    }
    return this.storage.delete(url);
  }

  async syncSchema(schema: TableSchema): Promise<void> {
    const spreadsheetId = this.resolveSpreadsheetId(schema);
    const sheetExists = await this.sheetExists(schema);

    if (!sheetExists) {
      await this.client.addSheet(spreadsheetId, schema.name);
    }

    const schemaHeaders = Object.keys(schema.columns);
    const rows = await this.client.getAllRows(spreadsheetId, schema.name);

    if (rows.length === 0) {
      await this.client.writeHeader(spreadsheetId, schema.name, schemaHeaders);
    } else {
      const existingHeaders = rows[0];
      const missingHeaders = schemaHeaders.filter((h) => !existingHeaders.includes(h));
      if (missingHeaders.length > 0) {
        await this.client.writeHeader(spreadsheetId, schema.name, [
          ...existingHeaders,
          ...missingHeaders,
        ]);
      }
    }
  }

  // ── Schema version tracking ───────────────────────────────────────────────

  async upsertSchemaVersion(
    actorSheetId: string,
    tableName: string,
    schemaHash: string,
    columnCount: number
  ): Promise<void> {
    try {
      await this._ensureSchemaVersionsSheet();
      const crud = this._svCrud();
      const existing = await crud.findOne({
        where: { actor_sheet_id: actorSheetId, table_name: tableName },
      });
      const synced_at = new Date().toISOString();
      if (existing) {
        await crud.update({
          where: { actor_sheet_id: actorSheetId, table_name: tableName },
          data: { schema_hash: schemaHash, synced_at, column_count: columnCount },
          skipFKValidation: true,
        });
      } else {
        await crud.create(
          { actor_sheet_id: actorSheetId, table_name: tableName, schema_hash: schemaHash, synced_at, column_count: columnCount },
          { skipFKValidation: true }
        );
      }
    } catch {
      // Silently ignore version tracking errors to not break CRUD operations
    }
  }

  async getSchemaVersion(
    actorSheetId: string,
    tableName: string
  ): Promise<{ schema_hash: string; synced_at: string; column_count: number } | null> {
    try {
      await this._ensureSchemaVersionsSheet();
      const crud = this._svCrud();
      const record = await crud.findOne({ where: { actor_sheet_id: actorSheetId, table_name: tableName } });
      if (!record) return null;
      return {
        schema_hash: record.schema_hash as string,
        synced_at: record.synced_at as string,
        column_count: record.column_count as number,
      };
    } catch {
      return null;
    }
  }

  // ── Internal helpers ──────────────────────────────────────────────────────

  private _svCrud(): CRUDOperations {
    return new CRUDOperations(this.client, this.adminSheetId, SCHEMA_VERSIONS_SCHEMA);
  }

  private async _ensureSchemaVersionsSheet(): Promise<void> {
    const sheets = await this.client.getSheetNames(this.adminSheetId);
    if (!sheets.includes('schema_versions')) {
      await this.client.addSheet(this.adminSheetId, 'schema_versions');
      await this.client.writeHeader(
        this.adminSheetId,
        'schema_versions',
        Object.keys(SCHEMA_VERSIONS_SCHEMA.columns)
      );
    }
  }

  private async _doSchemaVersionCheck(context: UserContext): Promise<void> {
    if (!context.actorSheetId) return;

    const roleSchemas = Array.from(this.schemas.values()).filter(
      (s) => s.actor === context.role && s.name !== 'schema_versions'
    );

    for (const schema of roleSchemas) {
      const currentHash = computeSchemaHash(schema);
      const stored = await this.getSchemaVersion(context.actorSheetId, schema.name);

      if (!stored || stored.schema_hash !== currentHash) {
        switch (this.onSchemaMismatch) {
          case 'warn':
            console.warn(
              `[sheet-db] Schema mismatch: table '${schema.name}' on sheet '${context.actorSheetId}' ` +
              `is outdated. Run 'sheet-db sync --all-users' to fix.`
            );
            break;

          case 'error':
            throw new SchemaMismatchError(schema.name, context.actorSheetId);

          case 'auto-sync':
            await this.syncSchema(schema);
            await this.upsertSchemaVersion(
              context.actorSheetId,
              schema.name,
              currentHash,
              Object.keys(schema.columns).length
            );
            break;
        }
      }
    }
  }

  private async resolveFolderForRole(role: string, client: SheetClient): Promise<string | undefined> {
    if (!this.driveFolder) return undefined;

    if (this._folderCache.has(role)) return this._folderCache.get(role)!;

    const rootId = await client.findOrCreateFolder(
      this.driveFolder.root,
      undefined,
      this.sharedDriveId
    );

    const subfolderName = this.driveFolder.subfolders?.[role] ?? role;
    const folderId = await client.findOrCreateFolder(subfolderName, rootId, this.sharedDriveId);

    this._folderCache.set(role, folderId);
    return folderId;
  }

  private createFKResolver(): FKResolver {
    return async (tableName: string, columnName: string, value: unknown): Promise<boolean> => {
      const refSchema = this.schemas.get(tableName);
      if (!refSchema) {
        throw new SchemaError(`Referenced table '${tableName}' is not registered`, tableName);
      }
      const refSpreadsheetId = this.resolveSpreadsheetId(refSchema);
      const refCrud = new CRUDOperations(this.client, refSpreadsheetId, refSchema);
      const row = await refCrud.findOne({ where: { [columnName]: value } });
      return row !== null;
    };
  }

  private detectCircularRefs(): void {
    const adj = new Map<string, Set<string>>();
    for (const [name, schema] of this.schemas) {
      const deps = new Set<string>();
      for (const col of Object.values(schema.columns)) {
        if (col.ref) {
          const [refTable] = col.ref.split('.');
          deps.add(refTable);
        }
      }
      adj.set(name, deps);
    }

    const visited = new Set<string>();
    const inStack = new Set<string>();

    const dfs = (node: string): boolean => {
      visited.add(node);
      inStack.add(node);

      for (const neighbor of adj.get(node) ?? new Set()) {
        if (!adj.has(neighbor)) continue;
        if (!visited.has(neighbor)) {
          if (dfs(neighbor)) return true;
        } else if (inStack.has(neighbor)) {
          return true;
        }
      }

      inStack.delete(node);
      return false;
    };

    for (const name of adj.keys()) {
      if (!visited.has(name)) {
        if (dfs(name)) {
          throw new SchemaError('Circular reference detected in schema definitions');
        }
      }
    }
  }

  private resolveSpreadsheetId(schema: TableSchema): string {
    if (schema.actor === 'admin') {
      return this.adminSheetId;
    }

    const isCrossActor = this.context?.targetRole && this.context.targetRole !== this.context?.role;

    if (isCrossActor && schema.actor === this.context?.targetRole) {
      if (!this.context?.targetSheetId) {
        throw new PermissionError(
          `targetSheetId required for cross-actor access to '${schema.actor}' tables`,
          this.context?.role
        );
      }
      return this.context.targetSheetId;
    }

    if (this.context?.actorSheetId) {
      return this.context.actorSheetId;
    }

    throw new PermissionError('Actor sheet ID not provided in context', this.context?.role);
  }

  private hasPermission(schema: TableSchema): boolean {
    if (!this.context) return false;

    if (this.context.role === 'admin') return true;

    // Same actor accessing their own tables
    if (schema.actor === this.context.role && !this.context.targetRole) return true;

    // Admin tables: non-admin cannot access unless it's the users table on create
    if (schema.actor === 'admin') return false;

    // Cross-actor: check permission matrix
    const targetRole = this.context.targetRole;
    if (!targetRole || targetRole === this.context.role) return schema.actor === this.context.role;

    if (schema.actor !== targetRole) return false;

    const perm = this.permissions?.[this.context.role];
    if (!perm) {
      throw new PermissionError(
        `'${this.context.role}' has no cross-actor permissions configured`,
        this.context.role
      );
    }

    if (!perm.canAccess.includes(targetRole)) {
      throw new PermissionError(
        `'${this.context.role}' cannot access '${targetRole}' sheets`,
        this.context.role
      );
    }

    if (perm.tables && !perm.tables.includes(schema.name)) {
      throw new PermissionError(
        `Table '${schema.name}' is not allowed for '${this.context.role}' → '${targetRole}' access`,
        this.context.role
      );
    }

    return true;
  }

  private async sheetExists(schema: TableSchema): Promise<boolean> {
    const spreadsheetId = this.resolveSpreadsheetId(schema);
    const sheetNames = await this.client.getSheetNames(spreadsheetId);
    return sheetNames.includes(schema.name);
  }

  getClient(): SheetClient {
    return this.client;
  }
}

export function createSheetAdapter(config: SheetAdapterConfig): SheetAdapter {
  return new SheetAdapter(config);
}
