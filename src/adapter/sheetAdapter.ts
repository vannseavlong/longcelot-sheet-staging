import { SheetClient } from './sheetClient';
import { CRUDOperations } from './crud';
import type { DatabaseAdapter } from './types';
import { hasPermission as accessControlHasPermission, resolveNonAdminTenantKey } from './accessControl';
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
  SheetStyleConfig,
  SheetReadCacheConfig,
} from '../schema/types';

const DEFAULT_HEADER_COLOR = '#E8F0FE';

// Internal context type — always has both actor and role set (normalised by withContext).
interface NormalisedContext {
  userId: string;
  actor: string;
  role: string;
  actorSheetId?: string;
  targetActor?: string;
  targetSheetId?: string;
}
import { PermissionError } from '../errors/PermissionError';
import { SchemaError } from '../errors/SchemaError';
import { SchemaMismatchError } from '../errors/SchemaMismatchError';
import { computeSchemaHash } from '../utils/schemaHash';
import { buildValidationRules } from '../utils/validationRules';
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
  /** Header fill color, frozen rows/columns. Auto-resize and boolean/enum dropdowns are always applied. */
  sheetStyle?: SheetStyleConfig;
  /** In-memory read cache for values.get() calls — smooths out Sheets API read-quota (429) errors. Enabled by default with a 2s TTL. */
  cache?: SheetReadCacheConfig;
}

export class SheetAdapter implements DatabaseAdapter {
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
  private sheetStyle: Required<SheetStyleConfig>;
  private cacheConfig?: SheetReadCacheConfig;
  /** Cached Drive folder IDs: role -> folderId */
  private _folderCache = new Map<string, string>();
  /** Pending schema version check promise set by withContext() */
  private _pendingSchemaCheck?: Promise<void>;

  constructor(config: SheetAdapterConfig) {
    // Allow test injection via _client (cast through unknown for type safety)
    this.cacheConfig = config.cache;
    this.client = (config as unknown as Record<string, unknown>)._client as SheetClient
      ?? new SheetClient(config.credentials, config.tokens, this.cacheConfig);
    this.credentials = config.credentials;
    this.adminSheetId = config.adminSheetId;
    this.onSchemaMismatch = config.onSchemaMismatch;
    this.permissions = config.permissions;
    this.driveFolder = config.driveFolder;
    this.sharedDriveId = config.sharedDriveId;
    this.tokenStore = config.tokenStore;
    this.storage = config.storage;
    this.sheetStyle = {
      headerColor: config.sheetStyle?.headerColor ?? DEFAULT_HEADER_COLOR,
      freezeHeader: config.sheetStyle?.freezeHeader ?? true,
      freezeFirstColumn: config.sheetStyle?.freezeFirstColumn ?? false,
      booleanFormat: config.sheetStyle?.booleanFormat ?? 'TRUE_FALSE',
    };

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
        '[lsdb] UserContext.role is deprecated — use actor instead. ' +
        'See: https://github.com/longcelot/sheet-db#actors-vs-application-roles'
      );
      actorValue = context.role;
    } else {
      throw new Error('[lsdb] withContext() requires either actor or role in UserContext');
    }

    // Normalise targetActor/targetRole: prefer `targetActor`, fall back to deprecated `targetRole`.
    let targetActorValue: string | undefined;
    if (context.targetActor) {
      targetActorValue = context.targetActor;
    } else if (context.targetRole) {
      console.warn(
        '[lsdb] UserContext.targetRole is deprecated — use targetActor instead. ' +
        'See: https://github.com/longcelot/sheet-db#actors-vs-application-roles'
      );
      targetActorValue = context.targetRole;
    }

    const normalised: NormalisedContext = {
      userId: context.userId,
      actor: actorValue,
      role: actorValue,
      actorSheetId: context.actorSheetId,
      targetActor: targetActorValue,
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

  asActor(targetActor: string, targetSheetId: string): SheetAdapter {
    if (!this.context) {
      throw new PermissionError('Context required before calling asActor()', undefined);
    }
    // Pass actor:/targetActor: (not role:/targetRole:) so withContext does not emit deprecation warnings.
    return this.withContext({
      userId: this.context.userId,
      actor: this.context.actor,
      actorSheetId: this.context.actorSheetId,
      targetActor,
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
    return new CRUDOperations(
      this.client,
      spreadsheetId,
      schema,
      fkResolver,
      this._pendingSchemaCheck,
      this.sheetStyle.booleanFormat
    );
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
      ? new SheetClient(this.credentials, actorTokens as unknown, this.cacheConfig)
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
      await this._applySheetFormatting(sheetId, table, headers);
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
      await this._applySheetFormatting(spreadsheetId, schema, schemaHeaders);
    } else {
      const existingHeaders = rows[0];
      const missingHeaders = schemaHeaders.filter((h) => !existingHeaders.includes(h));
      if (missingHeaders.length > 0) {
        const finalHeaders = [...existingHeaders, ...missingHeaders];
        await this.client.writeHeader(spreadsheetId, schema.name, finalHeaders);
        await this._applySheetFormatting(spreadsheetId, schema, finalHeaders, rows.length - 1);
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

  private async _applySheetFormatting(
    spreadsheetId: string,
    schema: TableSchema,
    headers: string[],
    dataRowCount = 0
  ): Promise<void> {
    await this.client.formatSheet(spreadsheetId, schema.name, {
      columnCount: headers.length,
      headerColor: this.sheetStyle.headerColor,
      freezeHeader: this.sheetStyle.freezeHeader,
      freezeFirstColumn: this.sheetStyle.freezeFirstColumn,
      validations: buildValidationRules(headers, schema.columns, this.sheetStyle.booleanFormat),
      dataRowCount,
    });
  }

  private _svCrud(): CRUDOperations {
    return new CRUDOperations(this.client, this.adminSheetId, SCHEMA_VERSIONS_SCHEMA);
  }

  private async _ensureSchemaVersionsSheet(): Promise<void> {
    const sheets = await this.client.getSheetNames(this.adminSheetId);
    if (!sheets.includes('schema_versions')) {
      await this.client.addSheet(this.adminSheetId, 'schema_versions');
      const headers = Object.keys(SCHEMA_VERSIONS_SCHEMA.columns);
      await this.client.writeHeader(this.adminSheetId, 'schema_versions', headers);
      await this._applySheetFormatting(this.adminSheetId, SCHEMA_VERSIONS_SCHEMA, headers);
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
              `[lsdb] Schema mismatch: table '${schema.name}' on sheet '${context.actorSheetId}' ` +
              `is outdated. Run 'lsdb sync --all-users' to fix.`
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
    return resolveNonAdminTenantKey(schema, this.context);
  }

  private hasPermission(schema: TableSchema): boolean {
    return accessControlHasPermission(schema, this.context, this.permissions);
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
