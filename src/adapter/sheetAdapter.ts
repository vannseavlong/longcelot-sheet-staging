import { SheetClient } from './sheetClient';
import { CRUDOperations } from './crud';
import { TableSchema, UserContext, FKResolver, SchemaMismatchBehaviour, ActorPermission } from '../schema/types';
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
}

export class SheetAdapter {
  private client: SheetClient;
  private adminSheetId: string;
  private schemas: Map<string, TableSchema> = new Map();
  private context?: UserContext;
  private onSchemaMismatch?: SchemaMismatchBehaviour;
  private permissions?: Record<string, ActorPermission>;
  /** Pending schema version check promise set by withContext() */
  private _pendingSchemaCheck?: Promise<void>;

  constructor(config: SheetAdapterConfig) {
    // Allow test injection via _client (cast through unknown for type safety)
    this.client = (config as unknown as Record<string, unknown>)._client as SheetClient
      ?? new SheetClient(config.credentials, config.tokens);
    this.adminSheetId = config.adminSheetId;
    this.onSchemaMismatch = config.onSchemaMismatch;
    this.permissions = config.permissions;
  }

  registerSchema(schema: TableSchema): void {
    this.schemas.set(schema.name, schema);
    this.detectCircularRefs();
  }

  registerSchemas(schemas: TableSchema[]): void {
    schemas.forEach((schema) => this.registerSchema(schema));
  }

  withContext(context: UserContext): SheetAdapter {
    const newAdapter = Object.create(this) as SheetAdapter;
    newAdapter.context = context;
    newAdapter._pendingSchemaCheck = undefined;

    if (this.onSchemaMismatch && context.actorSheetId && context.role !== 'admin') {
      newAdapter._pendingSchemaCheck = newAdapter._doSchemaVersionCheck(context);
    }

    return newAdapter;
  }

  asActor(targetRole: string, targetSheetId: string): SheetAdapter {
    if (!this.context) {
      throw new PermissionError('Context required before calling asActor()', undefined);
    }
    return this.withContext({ ...this.context, targetRole, targetSheetId });
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

  async createUserSheet(userId: string, role: string, email: string): Promise<string> {
    const sheetId = await this.client.createSpreadsheet(`${role}-${userId}`);

    await this.client.shareWithUser(sheetId, process.env.SUPER_ADMIN_EMAIL!, 'writer');
    await this.client.shareWithUser(sheetId, email, 'writer');

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
    });

    return sheetId;
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
