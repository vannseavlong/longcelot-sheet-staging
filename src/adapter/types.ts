import type {
  UserContext,
  FindOptions,
  CreateOptions,
  UpdateOptions,
  UpsertOptions,
  DeleteOptions,
} from '../schema/types';
import type { ColumnValidationRule } from './sheetClient';

/**
 * CRUDOperations' public shape, extracted so a non-Sheets storage engine (Phase 16.2, e.g. a
 * Postgres/MySQL adapter) can back `adapter.table(name)` with its own implementation instead
 * of the Sheets-specific CRUDOperations class — see TODO.md Phase 16.
 */
export interface TableOperations {
  create(data: Record<string, unknown>, options?: CreateOptions): Promise<Record<string, unknown>>;
  createMany(records: Record<string, unknown>[], options?: CreateOptions): Promise<Record<string, unknown>[]>;
  findMany(options?: FindOptions): Promise<Record<string, unknown>[]>;
  findOne(options?: FindOptions): Promise<Record<string, unknown> | null>;
  update(options: UpdateOptions): Promise<number>;
  upsert(options: UpsertOptions): Promise<Record<string, unknown>>;
  delete(options: DeleteOptions): Promise<number>;
  count(options?: Pick<FindOptions, 'where' | 'includeDeleted'>): Promise<number>;
}

/**
 * SheetAdapter's public shape, extracted so a non-Sheets DatabaseAdapter (Phase 16.2) can be
 * swapped in behind `createSheetAdapter`'s call sites at production cutover without rewriting
 * application CRUD code — see TODO.md Phase 16.
 */
export interface DatabaseAdapter {
  withContext(context: UserContext): DatabaseAdapter;
  asActor(targetActor: string, targetSheetId: string): DatabaseAdapter;
  table(tableName: string): TableOperations;
}

/**
 * The subset of SheetClient that CRUDOperations actually depends on. Depending on this
 * interface instead of the concrete SheetClient class means a SQL-backed equivalent (Phase
 * 16.2) can either implement it directly to reuse CRUDOperations' validation/serialization
 * logic, or ignore it entirely behind its own TableOperations implementation.
 *
 * `extendValidation` is optional — it re-applies Sheets checkbox/dropdown validation ranges
 * (see FAQ.md #10) and has no equivalent concept in a SQL engine.
 */
export interface StorageClient {
  getAllRows(spreadsheetId: string, sheetName: string): Promise<string[][]>;
  appendRow(spreadsheetId: string, sheetName: string, values: string[]): Promise<number>;
  appendRows(spreadsheetId: string, sheetName: string, rows: string[][]): Promise<void>;
  updateRow(spreadsheetId: string, sheetName: string, rowIndex: number, values: string[]): Promise<void>;
  deleteRow(spreadsheetId: string, sheetName: string, rowIndex: number): Promise<void>;
  writeHeader(spreadsheetId: string, sheetName: string, headers: string[]): Promise<void>;
  extendValidation?(
    spreadsheetId: string,
    sheetName: string,
    rules: ColumnValidationRule[],
    dataRowCount: number
  ): Promise<void>;
}
