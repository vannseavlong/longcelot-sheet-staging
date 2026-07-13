import { nanoid } from 'nanoid';
import {
  TableSchema,
  FindOptions,
  UpdateOptions,
  DeleteOptions,
  CreateOptions,
  UpsertOptions,
  UserContext,
  ActorPermission,
  FKResolver,
} from '../../schema/types';
import { ValidationError } from '../../errors/ValidationError';
import { PermissionError } from '../../errors/PermissionError';
import { SchemaError } from '../../errors/SchemaError';
import type { DatabaseAdapter, TableOperations } from '../types';
import { hasPermission, resolveNonAdminTenantKey, AccessControlContext } from '../accessControl';
import { toPrismaModelName, buildPrismaFieldMap, PrismaFieldMap } from '../../utils/prismaNaming';

const SOFT_DELETE_COLUMN = '_deleted_at';

export interface PrismaAdapterConfig {
  /**
   * An already-constructed, already-`prisma generate`'d PrismaClient instance from the consumer's
   * own project. Typed `unknown` deliberately — this package doesn't know the consumer's
   * generated client shape, and doesn't perform schema.prisma generation or `prisma generate`
   * itself (see TODO.md Phase 16.2 decision — avoids in-process codegen fragility). Run
   * `lsdb migrate --prisma` to get schema.prisma, then `prisma generate` as a normal build step.
   */
  client: unknown;
  /** Column injected into every non-admin table to scope rows to a tenant. Default: 'tenant_id'. */
  tenantColumn?: string;
  permissions?: Record<string, ActorPermission>;
}

interface PrismaModelDelegate {
  create(args: { data: Record<string, unknown> }): Promise<Record<string, unknown>>;
  createMany(args: { data: Record<string, unknown>[] }): Promise<{ count: number }>;
  findMany(args?: Record<string, unknown>): Promise<Record<string, unknown>[]>;
  findFirst(args?: Record<string, unknown>): Promise<Record<string, unknown> | null>;
  updateMany(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<{ count: number }>;
  deleteMany(args: { where: Record<string, unknown> }): Promise<{ count: number }>;
  count(args?: Record<string, unknown>): Promise<number>;
}

function getModelDelegate(client: unknown, schema: TableSchema): PrismaModelDelegate {
  const modelName = toPrismaModelName(schema.name);
  const record = client as Record<string, unknown>;
  const delegate = record[modelName];
  if (!delegate || typeof delegate !== 'object') {
    throw new SchemaError(
      `Prisma client has no model '${modelName}' for table '${schema.name}'. Run 'lsdb migrate --prisma' ` +
        `and 'prisma generate' after adding or renaming this table.`,
      schema.name
    );
  }
  return delegate as PrismaModelDelegate;
}

/** Prisma's own error codes for constraint violations — https://www.prisma.io/docs/orm/reference/error-reference */
function translatePrismaError(err: unknown): ValidationError | null {
  const code = typeof err === 'object' && err !== null && 'code' in err ? String((err as { code: unknown }).code) : undefined;
  const detail =
    typeof err === 'object' && err !== null && 'message' in err ? String((err as { message: unknown }).message) : 'constraint violation';
  if (code === 'P2002') return new ValidationError(`Unique constraint violation: ${detail}`);
  if (code === 'P2003') return new ValidationError(`FK violation: ${detail}`);
  return null;
}

/**
 * Tenant-scoped equivalent of createSQLFKResolver() (fkResolver.ts) and
 * SheetAdapter.createFKResolver() — resolves the referenced table's *actual* actor from the
 * schema registry (not the calling table's) to decide whether the check needs tenant scoping at
 * all, and reuses resolveNonAdminTenantKey() so a same-actor FK stays inside one tenant's data
 * instead of checking globally. See FAQ.md #13 — getting this wrong is a cross-tenant leak.
 */
function createPrismaFKResolver(
  client: unknown,
  schemas: Map<string, TableSchema>,
  tenantColumn: string,
  context: AccessControlContext | undefined
): FKResolver {
  return async (tableName: string, columnName: string, value: unknown): Promise<boolean> => {
    const refSchema = schemas.get(tableName);
    if (!refSchema) {
      throw new SchemaError(`Referenced table '${tableName}' is not registered`, tableName);
    }

    // `columnName` is a raw column name (e.g. could be `_id`) — translate to the referenced
    // model's actual Prisma field name (see toPrismaFieldName()).
    const refFieldName = buildPrismaFieldMap(refSchema).toField[columnName] ?? columnName;
    const where: Record<string, unknown> = { [refFieldName]: value };
    if (refSchema.actor !== 'admin') {
      where[tenantColumn] = resolveNonAdminTenantKey(refSchema, context);
    }

    const row = await getModelDelegate(client, refSchema).findFirst({ where });
    return row !== null;
  };
}

/**
 * TableOperations backed by a consumer-provided PrismaClient. Same validation/defaults/FK/
 * soft-delete/uniqueness/timestamps semantics as CRUDOperations and SQLTableOperations — see
 * TODO.md Phase 16.2. Deliberately its own copy of the validation logic rather than a shared
 * module yet, matching SQLTableOperations' documented first-pass tradeoff.
 */
class PrismaTableOperations implements TableOperations {
  private fieldMap: PrismaFieldMap;

  constructor(
    private client: unknown,
    private schema: TableSchema,
    private tenantColumn: string,
    private tenantValue: string | undefined,
    private fkResolver?: FKResolver
  ) {
    this.fieldMap = buildPrismaFieldMap(schema);
  }

  private get delegate(): PrismaModelDelegate {
    return getModelDelegate(this.client, this.schema);
  }

  /**
   * Drops any key that isn't a declared column on this schema before it reaches
   * toFieldKeys()/the Prisma delegate — a stray key (e.g. a legacy/leftover Sheets column
   * migrate-data read verbatim off a real spreadsheet row) would otherwise hit Prisma's
   * "Unknown argument" error, the Prisma-side equivalent of the raw SQL adapters' native "column
   * ... does not exist" (found via a real F2 cutover run — see FAQ.md §13, and the matching fix
   * in SQLTableOperations.serializeRow()). Every column this table actually has, including the
   * system ones, is a real entry in this.schema.columns. Only ever applied to a data payload
   * (create/createMany/update), never to a where clause — the tenant/soft-delete keys buildWhere()
   * adds aren't schema columns and must pass through untouched there.
   */
  private filterKnownColumns(data: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      if (key in this.schema.columns) result[key] = value;
    }
    return result;
  }

  /** Raw column names (e.g. `_id`) -> Prisma Client field names (e.g. `id`) — see toPrismaFieldName(). */
  private toFieldKeys(obj: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[this.fieldMap.toField[key] ?? key] = value;
    }
    return result;
  }

  /** Prisma Client field names -> raw column names — the inverse of toFieldKeys(). */
  private toRawKeys(obj: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[this.fieldMap.toRaw[key] ?? key] = value;
    }
    return result;
  }

  async create(data: Record<string, unknown>, options: CreateOptions = {}): Promise<Record<string, unknown>> {
    let incoming = { ...data };

    if (this.schema.pkColumn) {
      const pkDef = this.schema.columns[this.schema.pkColumn];
      if (pkDef?.type === 'string' && (incoming[this.schema.pkColumn] === undefined || incoming[this.schema.pkColumn] === null)) {
        incoming[this.schema.pkColumn] = nanoid();
      }
    }

    const dataWithId = { _id: nanoid(), ...incoming };
    const validated = this.validateAndApplyDefaults(dataWithId, 'create');

    if (!options.skipFKValidation) {
      await this.validateForeignKeys(validated);
    }

    await this.checkUniqueness(validated, null);

    if (this.schema.timestamps) {
      const now = new Date().toISOString();
      // Preserve a caller-supplied timestamp when present (e.g. lsdb migrate-data upserting the
      // exact _created_at/_updated_at it read from the Sheets source, to keep migrated rows'
      // original history intact) — only default to "now" for the normal create() path, which
      // never supplies these itself.
      if (validated._created_at === undefined || validated._created_at === null) validated._created_at = now;
      if (validated._updated_at === undefined || validated._updated_at === null) validated._updated_at = now;
    }

    const row = { ...validated };
    if (this.tenantValue !== undefined) row[this.tenantColumn] = this.tenantValue;

    try {
      await this.delegate.create({ data: this.toFieldKeys(this.filterKnownColumns(row)) });
    } catch (err) {
      throw translatePrismaError(err) ?? err;
    }

    return validated;
  }

  async createMany(records: Record<string, unknown>[], options: CreateOptions = {}): Promise<Record<string, unknown>[]> {
    if (records.length === 0) return [];

    const results: Record<string, unknown>[] = [];
    const rows: Record<string, unknown>[] = [];

    for (const data of records) {
      let incoming = { ...data };

      if (this.schema.pkColumn) {
        const pkDef = this.schema.columns[this.schema.pkColumn];
        if (pkDef?.type === 'string' && (incoming[this.schema.pkColumn] === undefined || incoming[this.schema.pkColumn] === null)) {
          incoming[this.schema.pkColumn] = nanoid();
        }
      }

      const dataWithId = { _id: nanoid(), ...incoming };
      const validated = this.validateAndApplyDefaults(dataWithId, 'create');

      if (!options.skipFKValidation) {
        await this.validateForeignKeys(validated);
      }

      await this.checkUniqueness(validated, null);

      if (this.schema.timestamps) {
        const now = new Date().toISOString();
        // See create()'s matching comment — preserve a caller-supplied timestamp when present.
        if (validated._created_at === undefined || validated._created_at === null) validated._created_at = now;
        if (validated._updated_at === undefined || validated._updated_at === null) validated._updated_at = now;
      }

      results.push(validated);
      const row = { ...validated };
      if (this.tenantValue !== undefined) row[this.tenantColumn] = this.tenantValue;
      rows.push(row);
    }

    // Prisma's createMany() doesn't return created rows on most databases — every value was
    // already computed app-side above (matches CRUDOperations/SQLTableOperations), so `results`
    // is returned directly rather than relying on Prisma to echo them back.
    try {
      await this.delegate.createMany({ data: rows.map((row) => this.toFieldKeys(this.filterKnownColumns(row))) });
    } catch (err) {
      throw translatePrismaError(err) ?? err;
    }

    return results;
  }

  async findMany(options: FindOptions = {}): Promise<Record<string, unknown>[]> {
    const where = this.toFieldKeys(this.buildWhere(options.where, options.includeDeleted));
    const args: Record<string, unknown> = { where };
    if (options.orderBy) {
      const orderField = this.fieldMap.toField[options.orderBy] ?? options.orderBy;
      args.orderBy = { [orderField]: options.order === 'desc' ? 'desc' : 'asc' };
    }
    if (options.offset) args.skip = options.offset;
    if (options.limit) args.take = options.limit;

    const rows = await this.delegate.findMany(args);
    return rows.map((row) => this.stripTenantColumn(this.toRawKeys(row)));
  }

  async findOne(options: FindOptions = {}): Promise<Record<string, unknown> | null> {
    const results = await this.findMany({ ...options, limit: 1 });
    return results[0] || null;
  }

  async update(options: UpdateOptions): Promise<number> {
    const updateData = { ...options.data };
    if (this.schema.pkColumn && this.schema.pkColumn in updateData) {
      delete updateData[this.schema.pkColumn];
    }

    const validated = this.validateAndApplyDefaults(updateData, 'update');

    if (!options.skipFKValidation) {
      await this.validateForeignKeys(validated);
    }

    const where = this.toFieldKeys(this.buildWhere(options.where, true));
    const matched = await this.delegate.findMany({ where });
    if (matched.length === 0) return 0;

    for (const row of matched) {
      await this.checkUniqueness(validated, String(this.toRawKeys(row)._id));
    }

    if (this.schema.timestamps) {
      validated._updated_at = new Date().toISOString();
    }

    try {
      const result = await this.delegate.updateMany({ where, data: this.toFieldKeys(this.filterKnownColumns(validated)) });
      return result.count;
    } catch (err) {
      throw translatePrismaError(err) ?? err;
    }
  }

  async upsert(options: UpsertOptions): Promise<Record<string, unknown>> {
    const existing = await this.findOne({ where: options.where });
    if (existing) {
      // See the matching fix in SQLTableOperations.upsert() (FAQ.md §13): a caller upserting from
      // a full row snapshot has no intention of rewriting readonly/system columns on an
      // already-existing row, so strip them before calling update() rather than relaxing its
      // readonly check.
      const updateData = { ...options.data };
      for (const columnName of Object.keys(this.schema.columns)) {
        if (this.schema.columns[columnName].readonly) delete updateData[columnName];
      }
      await this.update({ where: options.where, data: updateData, skipFKValidation: options.skipFKValidation });
      return { ...existing, ...updateData };
    }
    return await this.create({ ...options.where, ...options.data }, { skipFKValidation: options.skipFKValidation });
  }

  async count(options: Pick<FindOptions, 'where' | 'includeDeleted'> = {}): Promise<number> {
    const where = this.toFieldKeys(this.buildWhere(options.where, options.includeDeleted));
    return this.delegate.count({ where });
  }

  async delete(options: DeleteOptions): Promise<number> {
    if (this.schema.softDelete) {
      return await this.update({
        where: options.where,
        data: { _deleted_at: new Date().toISOString() },
        skipFKValidation: true,
      });
    }

    const where = this.toFieldKeys(this.buildWhere(options.where, true));
    const result = await this.delegate.deleteMany({ where });
    return result.count;
  }

  private buildWhere(where: Record<string, unknown> | undefined, includeDeleted: boolean | undefined): Record<string, unknown> {
    const clause: Record<string, unknown> = {};
    if (this.tenantValue !== undefined) clause[this.tenantColumn] = this.tenantValue;
    if (this.schema.softDelete && !includeDeleted) clause[SOFT_DELETE_COLUMN] = null;
    if (where) Object.assign(clause, where);
    return clause;
  }

  private stripTenantColumn(row: Record<string, unknown>): Record<string, unknown> {
    if (this.tenantValue === undefined) return row;
    const rest = { ...row };
    delete rest[this.tenantColumn];
    return rest;
  }

  // ── Validation (ported from CRUDOperations — same messages, same semantics) ─────────────

  private validateAndApplyDefaults(data: Record<string, unknown>, mode: 'create' | 'update'): Record<string, unknown> {
    const result: Record<string, unknown> = { ...data };

    for (const [columnName, column] of Object.entries(this.schema.columns)) {
      const value = result[columnName];

      if (column.readonly && mode === 'update' && columnName in data) {
        throw new ValidationError(`Column ${columnName} is readonly`, columnName);
      }

      if (value === undefined || value === null) {
        if (column.default !== undefined && mode === 'create') {
          result[columnName] = column.default;
        } else if (column.required && mode === 'create') {
          throw new ValidationError(`Column ${columnName} is required`, columnName);
        }
        continue;
      }

      if (column.enum && !column.enum.includes(value as string | number | boolean)) {
        throw new ValidationError(`Column ${columnName} must be one of: ${column.enum.join(', ')}`, columnName);
      }

      if (column.min !== undefined) {
        if (typeof value === 'string' && value.length < column.min) {
          throw new ValidationError(`Column ${columnName} must be at least ${column.min} characters`, columnName);
        }
        if (typeof value === 'number' && value < column.min) {
          throw new ValidationError(`Column ${columnName} must be at least ${column.min}`, columnName);
        }
      }

      if (column.max !== undefined) {
        if (typeof value === 'string' && value.length > column.max) {
          throw new ValidationError(`Column ${columnName} must be at most ${column.max} characters`, columnName);
        }
        if (typeof value === 'number' && value > column.max) {
          throw new ValidationError(`Column ${columnName} must be at most ${column.max}`, columnName);
        }
      }

      if (column.pattern && typeof value === 'string' && !column.pattern.test(value)) {
        throw new ValidationError(`Column ${columnName} does not match required pattern`, columnName);
      }
    }

    return result;
  }

  private async validateForeignKeys(data: Record<string, unknown>): Promise<void> {
    if (!this.fkResolver) return;

    for (const [columnName, column] of Object.entries(this.schema.columns)) {
      if (!column.ref) continue;
      const value = data[columnName];
      if (value === undefined || value === null) continue;

      const [refTable, refColumn] = column.ref.split('.');
      const exists = await this.fkResolver(refTable, refColumn, value);
      if (!exists) {
        throw new ValidationError(`FK violation: ${refTable}.${refColumn} '${value}' does not exist`, columnName);
      }
    }
  }

  private async checkUniqueness(data: Record<string, unknown>, excludeId: string | null): Promise<void> {
    for (const [columnName, column] of Object.entries(this.schema.columns)) {
      if (!column.unique) continue;
      const value = data[columnName];
      if (value === undefined || value === null) continue;

      const existing = await this.findOne({ where: { [columnName]: value } });
      if (existing && existing._id !== excludeId) {
        throw new ValidationError(
          `Unique constraint violation: column '${columnName}' already has value '${value}'`,
          columnName
        );
      }
    }
  }
}

interface NormalisedContext extends AccessControlContext {
  userId: string;
  actor: string;
}

export class PrismaAdapterBase implements DatabaseAdapter {
  private schemas: Map<string, TableSchema> = new Map();
  private context?: NormalisedContext;

  constructor(
    private client: unknown,
    private tenantColumn: string,
    private permissions?: Record<string, ActorPermission>
  ) {}

  registerSchema(schema: TableSchema): void {
    this.schemas.set(schema.name, schema);
  }

  registerSchemas(schemas: TableSchema[]): void {
    schemas.forEach((schema) => this.registerSchema(schema));
  }

  withContext(context: UserContext): PrismaAdapterBase {
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

    const newAdapter = Object.create(this) as PrismaAdapterBase;
    newAdapter.context = normalised;
    return newAdapter;
  }

  asActor(targetActor: string, targetSheetId: string): PrismaAdapterBase {
    if (!this.context) {
      throw new PermissionError('Context required before calling asActor()', undefined);
    }
    return this.withContext({
      userId: this.context.userId,
      actor: this.context.actor,
      actorSheetId: this.context.actorSheetId,
      targetActor,
      targetSheetId,
    });
  }

  table(tableName: string): PrismaTableOperations {
    const schema = this.schemas.get(tableName);
    if (!schema) {
      throw new SchemaError(`Table ${tableName} is not registered`, tableName);
    }

    if (!hasPermission(schema, this.context, this.permissions)) {
      throw new PermissionError(`User does not have permission to access ${tableName}`, this.context?.role);
    }

    const tenantValue =
      schema.actor === 'admin' ? undefined : resolveNonAdminTenantKey(schema, this.context);
    const fkResolver = createPrismaFKResolver(this.client, this.schemas, this.tenantColumn, this.context);

    return new PrismaTableOperations(this.client, schema, this.tenantColumn, tenantValue, fkResolver);
  }
}

/**
 * Wraps a consumer-provided PrismaClient to implement DatabaseAdapter — see PrismaAdapterConfig
 * for why this package doesn't generate/`prisma generate` a client itself (Phase 16.2).
 */
export function createPrismaAdapter(config: PrismaAdapterConfig): PrismaAdapterBase {
  return new PrismaAdapterBase(config.client, config.tenantColumn ?? 'tenant_id', config.permissions);
}
