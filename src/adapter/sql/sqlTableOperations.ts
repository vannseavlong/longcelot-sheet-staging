import { nanoid } from 'nanoid';
import {
  TableSchema,
  ColumnDefinition,
  FindOptions,
  UpdateOptions,
  DeleteOptions,
  CreateOptions,
  UpsertOptions,
  FKResolver,
} from '../../schema/types';
import { ValidationError } from '../../errors/ValidationError';
import type { TableOperations } from '../types';
import { SQLConnection } from './connection';
import { SQLDialect } from './dialect';
import { buildSelect, buildCount, buildInsert, buildInsertMany, buildUpdate, buildDelete, TenantScope } from './queryBuilder';
import { translateNativeError } from './errorTranslation';

const SOFT_DELETE_COLUMN = '_deleted_at';

/**
 * The SQL-backed equivalent of CRUDOperations (src/adapter/crud.ts) — same validation/defaults/
 * FK/soft-delete/uniqueness/timestamps semantics (Phase 16.2 decision 2), but pushes
 * where/orderBy/limit/offset/tenant-scoping/soft-delete into real SQL via queryBuilder.ts
 * instead of Sheets' full-scan-then-filter-in-JS approach. Deliberately duplicates
 * CRUDOperations' validation logic rather than sharing it yet — see TODO.md Phase 16.2.
 */
export class SQLTableOperations implements TableOperations {
  constructor(
    private connection: SQLConnection,
    private dialect: SQLDialect,
    private schema: TableSchema,
    private tenant: TenantScope | undefined,
    private fkResolver?: FKResolver
  ) {}

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

    const row = this.serializeRow(validated);
    if (this.tenant) row[this.tenant.column] = this.tenant.value;

    const { text, params } = buildInsert(this.dialect, this.schema.name, row);
    await this.execute(text, params);

    return validated;
  }

  async createMany(records: Record<string, unknown>[], options: CreateOptions = {}): Promise<Record<string, unknown>[]> {
    if (records.length === 0) return [];

    const results: Record<string, unknown>[] = [];
    const rowsToInsert: Record<string, unknown>[] = [];

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
      const row = this.serializeRow(validated);
      if (this.tenant) row[this.tenant.column] = this.tenant.value;
      rowsToInsert.push(row);
    }

    const { text, params } = buildInsertMany(this.dialect, this.schema.name, rowsToInsert);
    await this.execute(text, params);

    return results;
  }

  async findMany(options: FindOptions = {}): Promise<Record<string, unknown>[]> {
    const { text, params } = buildSelect(this.dialect, this.schema.name, {
      where: options.where,
      tenant: this.tenant,
      softDeleteColumn: this.schema.softDelete ? SOFT_DELETE_COLUMN : undefined,
      includeDeleted: options.includeDeleted,
      orderBy: options.orderBy,
      order: options.order,
      limit: options.limit,
      offset: options.offset,
    });
    const result = await this.connection.query(text, params);
    return result.rows.map((row) => this.deserializeRow(row));
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

    // Find matching rows first so per-row uniqueness exclusion (checkUniqueness) matches
    // CRUDOperations.update()'s row-by-row semantics, even though the write below is one
    // statement covering every matched row.
    const { text: selectText, params: selectParams } = buildSelect(this.dialect, this.schema.name, {
      where: options.where,
      tenant: this.tenant,
    });
    const matched = await this.connection.query(selectText, selectParams);
    if (matched.rows.length === 0) return 0;

    for (const row of matched.rows) {
      await this.checkUniqueness(validated, String(row._id));
    }

    if (this.schema.timestamps) {
      validated._updated_at = new Date().toISOString();
    }

    const setRow = this.serializeRow(validated);
    const { text, params } = buildUpdate(this.dialect, this.schema.name, setRow, options.where, this.tenant);
    await this.execute(text, params);

    return matched.rows.length;
  }

  async upsert(options: UpsertOptions): Promise<Record<string, unknown>> {
    const existing = await this.findOne({ where: options.where });
    if (existing) {
      // A caller upserting from a full row snapshot (e.g. lsdb migrate-data's Sheets → SQL
      // cutover, which upserts the exact row it read from Sheets, `_id`/`_created_at` included)
      // has no intention of actually rewriting readonly/system columns on an already-existing
      // row — they should just keep their current values, the same as if the caller had never
      // mentioned them. update() correctly rejects readonly columns in its payload (a normal API
      // consumer should never be able to rewrite `_created_at`), so strip them here rather than
      // relaxing that check — the upsert-into-existing-row path is the one place a full-row
      // payload naturally includes fields it doesn't mean to change.
      const updateData = { ...options.data };
      for (const columnName of Object.keys(this.schema.columns)) {
        if (this.schema.columns[columnName].readonly) delete updateData[columnName];
      }
      await this.update({
        where: options.where,
        data: updateData,
        skipFKValidation: options.skipFKValidation,
      });
      return { ...existing, ...updateData };
    }
    return await this.create({ ...options.where, ...options.data }, { skipFKValidation: options.skipFKValidation });
  }

  async count(options: Pick<FindOptions, 'where' | 'includeDeleted'> = {}): Promise<number> {
    const { text, params } = buildCount(this.dialect, this.schema.name, {
      where: options.where,
      tenant: this.tenant,
      softDeleteColumn: this.schema.softDelete ? SOFT_DELETE_COLUMN : undefined,
      includeDeleted: options.includeDeleted,
    });
    const result = await this.connection.query(text, params);
    return Number(result.rows[0]?.count ?? 0);
  }

  async delete(options: DeleteOptions): Promise<number> {
    if (this.schema.softDelete) {
      return await this.update({
        where: options.where,
        data: { _deleted_at: new Date().toISOString() },
        skipFKValidation: true,
      });
    }

    const { text: selectText, params: selectParams } = buildSelect(this.dialect, this.schema.name, {
      where: options.where,
      tenant: this.tenant,
    });
    const matched = await this.connection.query(selectText, selectParams);
    if (matched.rows.length === 0) return 0;

    const { text, params } = buildDelete(this.dialect, this.schema.name, options.where, this.tenant);
    await this.execute(text, params);
    return matched.rows.length;
  }

  private async execute(text: string, params: unknown[]): Promise<void> {
    try {
      await this.connection.query(text, params);
    } catch (err) {
      throw translateNativeError(err, this.dialect) ?? err;
    }
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

  // ── Serialization ─────────────────────────────────────────────────────────────────────

  private serializeRow(data: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      // buildInsert()/buildUpdate() build their column list straight from this row's keys, with
      // no schema awareness of their own — a stray key that isn't a declared column (e.g. a
      // legacy/leftover Sheets column migrate-data read verbatim off a real spreadsheet row)
      // would otherwise reach the database as a literal column reference and fail with a native
      // "column ... does not exist" (found via a real F2 cutover run — see FAQ.md §13). Every
      // column this table actually has, including the system ones, is a real entry in
      // this.schema.columns (defineTable() injects _id/_created_at/_updated_at/_deleted_at into
      // it directly), so this only ever drops keys that were never part of the schema.
      if (!(key in this.schema.columns)) continue;
      result[key] = this.serializeValue(value, this.schema.columns[key]);
    }
    return result;
  }

  private serializeValue(value: unknown, column?: ColumnDefinition): unknown {
    if (value === null || value === undefined) return null;
    if (value instanceof Date) return this.toSQLDateTime(value);
    if (column?.type === 'date' && typeof value === 'string') return this.toSQLDateTime(value);
    if (column?.type === 'json') {
      return typeof value === 'string' ? value : JSON.stringify(value);
    }
    // Booleans/numbers/strings pass through as native JS values — dialect.booleanLiteral()
    // coerces booleans at the query-builder layer, and real SQL columns hold native
    // numeric/text types (unlike Sheets, where every cell is a serialized string).
    return value;
  }

  /**
   * MySQL's DATETIME/TIMESTAMP columns reject ISO 8601's 'T'/'Z' separators outright
   * (ER_TRUNCATED_WRONG_VALUE) — found via real-MySQL integration testing (Phase 16.2). The
   * space-separated 'YYYY-MM-DD HH:MM:SS.sss' form is accepted by both Postgres and MySQL, so
   * every date value is normalized to it before being sent, regardless of target dialect.
   */
  private toSQLDateTime(value: Date | string): string {
    const date = value instanceof Date ? value : new Date(value);
    return date.toISOString().replace('T', ' ').replace('Z', '');
  }

  private deserializeRow(row: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, rawValue] of Object.entries(row)) {
      if (this.tenant && key === this.tenant.column) continue; // implementation-only column

      const column = this.schema.columns[key];
      if (rawValue === null || rawValue === undefined) {
        result[key] = null;
        continue;
      }
      if (!column) {
        result[key] = rawValue;
        continue;
      }

      switch (column.type) {
        case 'number':
          result[key] = typeof rawValue === 'number' ? rawValue : Number(rawValue);
          break;
        case 'boolean':
          result[key] = rawValue === true || rawValue === 1 || rawValue === '1';
          break;
        case 'json':
          result[key] = typeof rawValue === 'string' ? this.tryParseJSON(rawValue) : rawValue;
          break;
        case 'date':
          result[key] = rawValue instanceof Date ? rawValue.toISOString() : this.cleanDateValue(String(rawValue));
          break;
        default:
          result[key] = rawValue;
      }
    }
    return result;
  }

  private tryParseJSON(value: string): unknown {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }

  private cleanDateValue(value: string): string {
    const parsed = new Date(value);
    return isNaN(parsed.getTime()) ? value : parsed.toISOString();
  }
}
