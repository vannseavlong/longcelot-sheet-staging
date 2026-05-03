import { SheetClient } from './sheetClient';
import { CRUDOperations } from './crud';
import { TableSchema, UserContext, FKResolver } from '../schema/types';
import { PermissionError } from '../errors/PermissionError';
import { SchemaError } from '../errors/SchemaError';

export interface SheetAdapterConfig {
  adminSheetId: string;
  credentials: {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
  };
  tokens: any;
}

export class SheetAdapter {
  private client: SheetClient;
  private adminSheetId: string;
  private schemas: Map<string, TableSchema> = new Map();
  private context?: UserContext;

  constructor(config: SheetAdapterConfig) {
    this.client = new SheetClient(config.credentials, config.tokens);
    this.adminSheetId = config.adminSheetId;
  }

  registerSchema(schema: TableSchema): void {
    this.schemas.set(schema.name, schema);
    this.detectCircularRefs();
  }

  registerSchemas(schemas: TableSchema[]): void {
    schemas.forEach((schema) => this.registerSchema(schema));
  }

  withContext(context: UserContext): SheetAdapter {
    const newAdapter = Object.create(this);
    newAdapter.context = context;
    return newAdapter;
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
    return new CRUDOperations(this.client, spreadsheetId, schema, fkResolver);
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
    const sheetExists = await this.sheetExists(schema);

    if (!sheetExists) {
      const spreadsheetId = this.resolveSpreadsheetId(schema);
      await this.client.addSheet(spreadsheetId, schema.name);
    }

    const headers = Object.keys(schema.columns);
    const spreadsheetId = this.resolveSpreadsheetId(schema);
    const existingSheets = await this.client.getSheetNames(spreadsheetId);

    if (existingSheets.includes(schema.name)) {
      const rows = await this.client.getAllRows(spreadsheetId, schema.name);
      if (rows.length === 0) {
        await this.client.writeHeader(spreadsheetId, schema.name, headers);
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

    if (this.context?.actorSheetId) {
      return this.context.actorSheetId;
    }

    throw new PermissionError('Actor sheet ID not provided in context', this.context?.role);
  }

  private hasPermission(schema: TableSchema): boolean {
    if (!this.context) {
      return false;
    }

    if (this.context.role === 'admin') {
      return true;
    }

    if (schema.actor === this.context.role) {
      return true;
    }

    if (schema.actor === 'admin') {
      return false;
    }

    return false;
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
