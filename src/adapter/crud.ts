import { nanoid } from 'nanoid';
import { VALIDATION_CHECK_INTERVAL } from './sheetClient';
import type { StorageClient, TableOperations } from './types';
import {
  TableSchema,
  ColumnDefinition,
  BooleanFormat,
  FindOptions,
  UpdateOptions,
  DeleteOptions,
  CreateOptions,
  UpsertOptions,
  FKResolver,
} from '../schema/types';
import { ValidationError } from '../errors/ValidationError';
import { buildValidationRules } from '../utils/validationRules';

export class CRUDOperations implements TableOperations {
  constructor(
    private client: StorageClient,
    private spreadsheetId: string,
    private schema: TableSchema,
    private fkResolver?: FKResolver,
    private preFlight?: Promise<void>,
    private defaultBooleanFormat: BooleanFormat = 'TRUE_FALSE'
  ) {}

  async create(data: Record<string, unknown>, options: CreateOptions = {}): Promise<Record<string, unknown>> {
    if (this.preFlight) await this.preFlight;
    let incoming = { ...data };

    // Auto-generate string PK if not supplied
    if (this.schema.pkColumn) {
      const pkDef = this.schema.columns[this.schema.pkColumn];
      if (pkDef?.type === 'string' && (incoming[this.schema.pkColumn] === undefined || incoming[this.schema.pkColumn] === null)) {
        incoming[this.schema.pkColumn] = nanoid();
      }
    }

    // Generate _id before validation so the required-_id check always passes
    const dataWithId = { _id: nanoid(), ...incoming };
    const validated = this.validateAndApplyDefaults(dataWithId, 'create');

    if (!options.skipFKValidation) {
      await this.validateForeignKeys(validated);
    }

    await this.checkUniqueness(validated, null);

    if (this.schema.timestamps) {
      const now = new Date().toISOString();
      validated._created_at = now;
      validated._updated_at = now;
    }

    const headers = await this.getHeaders();
    const values = headers.map((header) => this.serializeValue(validated[header], this.schema.columns[header]));

    const rowNumber = await this.client.appendRow(this.spreadsheetId, this.schema.name, values);
    await this.maybeExtendValidation(headers, rowNumber);

    return validated;
  }

  async findMany(options: FindOptions = {}): Promise<Record<string, unknown>[]> {
    if (this.preFlight) await this.preFlight;
    const { headers, rows } = await this.getDataRows();

    if (rows.length === 0) return [];

    let results = rows.map(({ values }) => this.deserializeRow(headers, values));

    if (this.schema.softDelete && !options.includeDeleted) {
      results = results.filter((item) => item._deleted_at === null || item._deleted_at === undefined);
    }

    if (options.where) {
      results = results.filter((item) => this.matchesWhere(item, options.where!));
    }

    if (options.orderBy) {
      const order = options.order || 'asc';
      results.sort((a, b) => {
        const cmp = this.compareOrderValues(a[options.orderBy!], b[options.orderBy!]);
        return order === 'asc' ? cmp : -cmp;
      });
    }

    if (options.offset) {
      results = results.slice(options.offset);
    }

    if (options.limit) {
      results = results.slice(0, options.limit);
    }

    return results;
  }

  async findOne(options: FindOptions = {}): Promise<Record<string, unknown> | null> {
    const results = await this.findMany({ ...options, limit: 1 });
    return results[0] || null;
  }

  async update(options: UpdateOptions): Promise<number> {
    if (this.preFlight) await this.preFlight;
    const { headers, rows } = await this.getDataRows();

    if (rows.length === 0) return 0;

    let updated = 0;

    for (const { values: rowValues, rowNumber } of rows) {
      const item = this.deserializeRow(headers, rowValues);

      if (this.matchesWhere(item, options.where)) {
        // Strip pkColumn silently — PK is readonly on update
        const updateData = { ...options.data };
        if (this.schema.pkColumn && this.schema.pkColumn in updateData) {
          delete updateData[this.schema.pkColumn];
        }

        const validated = this.validateAndApplyDefaults(updateData, 'update');

        if (!options.skipFKValidation) {
          await this.validateForeignKeys(validated);
        }

        await this.checkUniqueness(validated, item._id as string);

        if (this.schema.timestamps) {
          validated._updated_at = new Date().toISOString();
        }

        const merged = { ...item, ...validated };
        const values = headers.map((header) => this.serializeValue(merged[header], this.schema.columns[header]));

        await this.client.updateRow(this.spreadsheetId, this.schema.name, rowNumber, values);
        updated++;
      }
    }

    return updated;
  }

  async upsert(options: UpsertOptions): Promise<Record<string, unknown>> {
    if (this.preFlight) await this.preFlight;
    const existing = await this.findOne({ where: options.where });
    if (existing) {
      await this.update({
        where: options.where,
        data: options.data,
        skipFKValidation: options.skipFKValidation,
      });
      return { ...existing, ...options.data };
    }
    return await this.create({ ...options.where, ...options.data }, { skipFKValidation: options.skipFKValidation });
  }

  async createMany(records: Record<string, unknown>[], options: CreateOptions = {}): Promise<Record<string, unknown>[]> {
    if (this.preFlight) await this.preFlight;
    if (records.length === 0) return [];

    const results: Record<string, unknown>[] = [];
    const headers = await this.getHeaders();

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
        validated._created_at = now;
        validated._updated_at = now;
      }

      results.push(validated);
    }

    // Batch all rows into a single append call
    const rows = results.map((validated) =>
      headers.map((header) => this.serializeValue(validated[header], this.schema.columns[header]))
    );

    await this.client.appendRows(this.spreadsheetId, this.schema.name, rows);

    return results;
  }

  async count(options: Pick<FindOptions, 'where' | 'includeDeleted'> = {}): Promise<number> {
    if (this.preFlight) await this.preFlight;
    const { headers, rows } = await this.getDataRows();
    if (rows.length === 0) return 0;

    let count = 0;
    for (const { values } of rows) {
      const item = this.deserializeRow(headers, values);
      if (this.schema.softDelete && !options.includeDeleted && item._deleted_at != null) continue;
      if (options.where && !this.matchesWhere(item, options.where)) continue;
      count++;
    }
    return count;
  }

  async delete(options: DeleteOptions): Promise<number> {
    if (this.preFlight) await this.preFlight;
    if (this.schema.softDelete) {
      return await this.update({
        where: options.where,
        data: { _deleted_at: new Date().toISOString() },
        skipFKValidation: true,
      });
    }

    const { headers, rows } = await this.getDataRows();

    if (rows.length === 0) return 0;

    let deleted = 0;

    for (let i = rows.length - 1; i >= 0; i--) {
      const { values, rowNumber } = rows[i];
      const item = this.deserializeRow(headers, values);

      if (this.matchesWhere(item, options.where)) {
        await this.client.deleteRow(this.spreadsheetId, this.schema.name, rowNumber);
        deleted++;
      }
    }

    return deleted;
  }

  /**
   * Reads all rows and filters out phantom rows — sheet cells that have
   * formatting/validation applied (e.g. a checkbox dropdown past the real data,
   * see FAQ.md #10) but were never actually written by create()/createMany().
   * A real row always has a non-empty `_id`; anything else is grid noise, not a record.
   */
  private async getDataRows(): Promise<{
    headers: string[];
    rows: Array<{ values: string[]; rowNumber: number }>;
  }> {
    const allRows = await this.client.getAllRows(this.spreadsheetId, this.schema.name);
    if (allRows.length === 0) return { headers: [], rows: [] };

    const headers = allRows[0];
    const idIndex = headers.indexOf('_id');

    const rows = allRows
      .slice(1)
      .map((values, i) => ({ values, rowNumber: i + 2 }))
      .filter(({ values }) => idIndex === -1 || (values[idIndex] !== undefined && values[idIndex] !== ''));

    return { headers, rows };
  }

  /**
   * The validated range applied by sync/formatSheet() only covers data rows that existed
   * at sync time plus a fixed buffer (see FAQ.md #10) — it doesn't grow on its own as rows
   * are appended via create() between syncs. Every VALIDATION_CHECK_INTERVAL rows, re-extend
   * the range by one more buffer's worth so checkbox/dropdown UI keeps pace with real growth
   * without re-checking (let alone re-extending) on every single insert.
   */
  private async maybeExtendValidation(headers: string[], rowNumber: number): Promise<void> {
    if (rowNumber % VALIDATION_CHECK_INTERVAL !== 0) return;
    const rules = buildValidationRules(headers, this.schema.columns, this.defaultBooleanFormat);
    if (rules.length === 0) return;
    await this.client.extendValidation?.(this.spreadsheetId, this.schema.name, rules, rowNumber - 1);
  }

  private async getHeaders(): Promise<string[]> {
    const rows = await this.client.getAllRows(this.spreadsheetId, this.schema.name);

    if (rows.length > 0) {
      return rows[0];
    }

    const headers = Object.keys(this.schema.columns);
    await this.client.writeHeader(this.spreadsheetId, this.schema.name, headers);
    return headers;
  }

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
        throw new ValidationError(
          `FK violation: ${refTable}.${refColumn} '${value}' does not exist`,
          columnName
        );
      }
    }
  }

  private serializeValue(value: unknown, column?: ColumnDefinition): string {
    if (value === null || value === undefined) return '';
    if (typeof value === 'boolean') {
      const format = column?.booleanFormat ?? this.defaultBooleanFormat;
      const [trueValue, falseValue] = format === '1_0' ? ['1', '0'] : ['TRUE', 'FALSE'];
      return value ? trueValue : falseValue;
    }
    // A raw Date must never reach the generic JSON.stringify() branch below —
    // JSON.stringify(date) produces a *quoted* ISO string ('"2026-01-01T00:00:00.000Z"'),
    // and that literal quote pair gets written into the cell as text, corrupting every
    // later `new Date(cellValue)` read. date()-typed columns already store a plain ISO
    // string elsewhere (_created_at/_updated_at are written as `new Date().toISOString()`,
    // never a Date instance) — normalize any Date the same way regardless of which
    // column it's headed for, so passing a Date instead of remembering .toISOString()
    // is safe rather than a silent data-corruption footgun.
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  }

  private deserializeRow(headers: string[], row: string[]): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    headers.forEach((header, index) => {
      const column = this.schema.columns[header];
      const value = row[index];

      if (!column) {
        result[header] = value;
        return;
      }

      if (value === '' || value === null || value === undefined) {
        result[header] = null;
        return;
      }

      switch (column.type) {
        case 'number':
          result[header] = Number(value);
          break;
        case 'boolean':
          // Accept both configured formats regardless of which one is active — a sheet's history
          // may mix 'TRUE'/'FALSE' and '1'/'0' rows across a booleanFormat change (see FAQ.md #10).
          result[header] = value === 'TRUE' || value === '1';
          break;
        case 'json':
          try {
            result[header] = JSON.parse(value);
          } catch {
            result[header] = value;
          }
          break;
        case 'date':
          result[header] = this.cleanDateValue(value);
          break;
        default:
          result[header] = value;
      }
    });

    return result;
  }

  /**
   * Normalizes a date() cell back to a clean ISO string. Also defends against rows
   * written before the serializeValue() fix above (or by any other writer that passed
   * a raw Date object through the generic JSON.stringify() path) — those cells carry a
   * literal quote pair around the ISO string, which `new Date(value)` on the consuming
   * end fails to parse. Falls back to the unwrapped raw value, unchanged, if it still
   * doesn't parse as a valid date rather than discarding whatever was actually stored.
   */
  private cleanDateValue(value: string): string {
    const unwrapped = value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;
    const parsed = new Date(unwrapped);
    return isNaN(parsed.getTime()) ? unwrapped : parsed.toISOString();
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

  private matchesWhere(item: Record<string, unknown>, where: Record<string, unknown>): boolean {
    for (const [key, value] of Object.entries(where)) {
      if (item[key] !== value) {
        return false;
      }
    }
    return true;
  }

  // Compares numerically when both sides parse cleanly as numbers (e.g. a `sort` column),
  // otherwise falls back to string comparison so text columns sort as before.
  private compareOrderValues(a: unknown, b: unknown): number {
    if (a === b) return 0;

    const aNum = this.toOrderNumber(a);
    const bNum = this.toOrderNumber(b);
    if (aNum !== null && bNum !== null) return aNum - bNum;

    const aStr = String(a ?? '');
    const bStr = String(b ?? '');
    return aStr > bStr ? 1 : aStr < bStr ? -1 : 0;
  }

  private toOrderNumber(value: unknown): number | null {
    if (typeof value === 'number') return value;
    if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) return Number(value);
    return null;
  }
}
