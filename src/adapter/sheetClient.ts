import { google, sheets_v4, drive_v3 } from 'googleapis';
import { OAuth2Client, Credentials } from 'google-auth-library';
import { Readable } from 'stream';
import { SheetReadCacheConfig } from '../schema/types';
import type { StorageClient } from './types';

const DEFAULT_CACHE_TTL_MS = 2000;

/** Max tabs per values.batchGet request — keeps the `ranges=` query string well under URL length limits. */
export const BATCH_GET_CHUNK_SIZE = 50;

export type ShareRole = 'reader' | 'commenter' | 'writer';

/**
 * getAllRows()'s read cache + in-flight de-duplication, held outside SheetClient so several
 * clients (the admin client and per-actor clients, see `actorClientForCrud`) can share one:
 * a write through any client then invalidates the tab for all of them.
 */
export class SheetReadCache {
  /** Cached rows keyed by `${spreadsheetId}::${sheetName}`, valid until expiresAt. */
  readonly entries = new Map<string, { data: string[][]; expiresAt: number }>();
  /** Collapses concurrent reads of the same key into a single API request. */
  readonly inFlight = new Map<string, Promise<string[][]>>();
  /**
   * Bumped by invalidate(). A read only stores its result if the key's generation is unchanged
   * since the read started — otherwise a read that was in flight when a write landed would put
   * pre-write data back into the cache after the write's invalidation.
   */
  private readonly generations = new Map<string, number>();

  generation(key: string): number {
    return this.generations.get(key) ?? 0;
  }

  invalidate(key: string): void {
    this.entries.delete(key);
    this.inFlight.delete(key);
    this.generations.set(key, this.generation(key) + 1);
  }
}

function isBadRequest(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { code?: unknown; status?: unknown; response?: { status?: unknown } };
  return e.code === 400 || e.code === '400' || e.status === 400 || e.response?.status === 400;
}

export interface CreateSpreadsheetOptions {
  /** Place the spreadsheet inside this Drive folder ID. */
  folderId?: string;
  /** When set, enables supportsAllDrives for Shared Drive placement. */
  sharedDriveId?: string;
}

/**
 * boolean() columns use ONE_OF_LIST too (not a dedicated BOOLEAN type/condition) — see
 * buildValidationRules() in src/utils/validationRules.ts for why that's deliberate.
 */
export interface ColumnValidationRule {
  columnIndex: number;
  type: 'ONE_OF_LIST';
  values: (string | number | boolean)[];
}

export interface SheetFormattingOptions {
  /** Total number of header columns — used for fill/auto-resize ranges. */
  columnCount: number;
  headerColor?: string;
  freezeHeader?: boolean;
  freezeFirstColumn?: boolean;
  validations?: ColumnValidationRule[];
  /** Number of existing data rows (excluding header) — bounds the validation range. Default: 0. */
  dataRowCount?: number;
}

/**
 * Extra rows past the current data range to pre-apply boolean/enum validation to,
 * so a handful of new rows still get checkbox/dropdown UI before the next sync.
 * Left unbounded (the GridRange default), validation extends to the sheet's full
 * 1000-row default grid, and Sheets API reads then treat every one of those
 * formatted-but-empty rows as "has content" — see FAQ.md #10.
 */
export const VALIDATION_ROW_BUFFER = 200;

/**
 * How often CRUDOperations.create() re-checks whether the validated range needs
 * extending as rows are appended between syncs (see FAQ.md #10 follow-up). Must be
 * at most half of VALIDATION_ROW_BUFFER so coverage never runs out between checks:
 * a check at row R extends coverage to R + VALIDATION_ROW_BUFFER; the next check at
 * R + VALIDATION_CHECK_INTERVAL must still land inside that window.
 */
export const VALIDATION_CHECK_INTERVAL = VALIDATION_ROW_BUFFER / 2;

function hexToRgb(hex: string): { red: number; green: number; blue: number } {
  const normalized = hex.replace('#', '');
  const r = parseInt(normalized.substring(0, 2), 16);
  const g = parseInt(normalized.substring(2, 4), 16);
  const b = parseInt(normalized.substring(4, 6), 16);
  return { red: r / 255, green: g / 255, blue: b / 255 };
}

/** Extracts the 1-based row number from an `updatedRange` like `"Sheet1!A12:G12"`. */
function parseRowNumber(updatedRange: string | undefined | null): number {
  const match = updatedRange?.match(/![A-Za-z]+(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
}

/** Converts a 0-based column index to A1 column letters (0 -> 'A', 25 -> 'Z', 26 -> 'AA'). */
export function columnIndexToA1Letter(index: number): string {
  let n = index + 1;
  let letters = '';
  while (n > 0) {
    const remainder = (n - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

export class SheetClient implements StorageClient {
  private sheets: sheets_v4.Sheets;
  private drive: drive_v3.Drive;
  private auth: OAuth2Client;
  private cacheEnabled: boolean;
  private cacheTtlMs: number;
  private readCache: SheetReadCache;

  constructor(
    credentials: { clientId: string; clientSecret: string; redirectUri: string },
    tokens: unknown,
    cacheConfig?: SheetReadCacheConfig,
    /** Share one read cache between several clients — see SheetReadCache. Defaults to a private one. */
    readCache?: SheetReadCache
  ) {
    this.auth = new google.auth.OAuth2(
      credentials.clientId,
      credentials.clientSecret,
      credentials.redirectUri
    );
    this.auth.setCredentials(tokens as Credentials);
    this.sheets = google.sheets({ version: 'v4', auth: this.auth });
    this.drive = google.drive({ version: 'v3', auth: this.auth });
    this.cacheEnabled = cacheConfig?.enabled ?? true;
    this.cacheTtlMs = cacheConfig?.ttlMs ?? DEFAULT_CACHE_TTL_MS;
    this.readCache = readCache ?? new SheetReadCache();
  }

  getReadCache(): SheetReadCache {
    return this.readCache;
  }

  /**
   * Called with the new credentials whenever googleapis refreshes this client's access token
   * (only the changed fields — e.g. no refresh_token), so callers can persist them.
   */
  onTokensRefreshed(listener: (tokens: Credentials) => void): void {
    this.auth.on('tokens', listener);
  }

  async createSpreadsheet(title: string, options?: CreateSpreadsheetOptions): Promise<string> {
    const supportsAllDrives = !!(options?.sharedDriveId || options?.folderId);
    const parents = options?.folderId
      ? [options.folderId]
      : options?.sharedDriveId
      ? [options.sharedDriveId]
      : undefined;

    const response = await this.drive.files.create({
      supportsAllDrives,
      requestBody: {
        name: title,
        mimeType: 'application/vnd.google-apps.spreadsheet',
        ...(parents ? { parents } : {}),
      },
      fields: 'id',
    });
    return response.data.id!;
  }

  async findOrCreateFolder(name: string, parentId?: string, sharedDriveId?: string): Promise<string> {
    const escapedName = name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    let q = `name='${escapedName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
    if (parentId) q += ` and '${parentId}' in parents`;

    const listParams: drive_v3.Params$Resource$Files$List = {
      q,
      fields: 'files(id)',
      pageSize: 1,
    };

    if (sharedDriveId) {
      listParams.corpora = 'drive';
      listParams.driveId = sharedDriveId;
      listParams.includeItemsFromAllDrives = true;
      listParams.supportsAllDrives = true;
    }

    const found = await this.drive.files.list(listParams);
    if (found.data.files && found.data.files.length > 0) {
      return found.data.files[0].id!;
    }

    const createParents = parentId
      ? [parentId]
      : sharedDriveId
      ? [sharedDriveId]
      : undefined;

    const created = await this.drive.files.create({
      supportsAllDrives: !!sharedDriveId,
      requestBody: {
        name,
        mimeType: 'application/vnd.google-apps.folder',
        ...(createParents ? { parents: createParents } : {}),
      },
      fields: 'id',
    });
    return created.data.id!;
  }

  async uploadFile(
    buffer: Buffer,
    filename: string,
    mimeType: string,
    folderId?: string,
    makePublic?: boolean
  ): Promise<string> {
    const readable = new Readable();
    readable.push(buffer);
    readable.push(null);

    const response = await this.drive.files.create({
      requestBody: {
        name: filename,
        ...(folderId ? { parents: [folderId] } : {}),
      },
      media: {
        mimeType,
        body: readable,
      },
      fields: 'id',
    });

    const fileId = response.data.id!;

    if (makePublic) {
      await this.drive.permissions.create({
        fileId,
        requestBody: { type: 'anyone', role: 'reader' },
      });
    }

    return fileId;
  }

  async deleteFile(fileId: string): Promise<void> {
    await this.drive.files.delete({ fileId });
  }

  async addSheet(spreadsheetId: string, sheetName: string): Promise<void> {
    await this.sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            addSheet: {
              properties: { title: sheetName },
            },
          },
        ],
      },
    });
  }

  async getSheetNames(spreadsheetId: string): Promise<string[]> {
    const response = await this.sheets.spreadsheets.get({ spreadsheetId });
    return response.data.sheets?.map((sheet) => sheet.properties?.title || '') || [];
  }

  async writeHeader(spreadsheetId: string, sheetName: string, headers: string[]): Promise<void> {
    await this.sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetName}!A1`,
      valueInputOption: 'RAW',
      requestBody: {
        values: [headers],
      },
    });
    this.invalidateCache(spreadsheetId, sheetName);
  }

  /**
   * Applies header fill color, frozen rows/columns, auto-fit column widths, and
   * boolean/enum data validation dropdowns in a single batchUpdate call.
   */
  async formatSheet(
    spreadsheetId: string,
    sheetName: string,
    options: SheetFormattingOptions
  ): Promise<void> {
    const sheetId = await this.getSheetId(spreadsheetId, sheetName);
    const requests: sheets_v4.Schema$Request[] = [];

    if (options.headerColor) {
      requests.push({
        repeatCell: {
          range: {
            sheetId,
            startRowIndex: 0,
            endRowIndex: 1,
            startColumnIndex: 0,
            endColumnIndex: options.columnCount,
          },
          cell: {
            userEnteredFormat: { backgroundColor: hexToRgb(options.headerColor) },
          },
          fields: 'userEnteredFormat.backgroundColor',
        },
      });
    }

    if (options.freezeHeader || options.freezeFirstColumn) {
      const fields: string[] = [];
      const gridProperties: sheets_v4.Schema$GridProperties = {};
      if (options.freezeHeader) {
        gridProperties.frozenRowCount = 1;
        fields.push('gridProperties.frozenRowCount');
      }
      if (options.freezeFirstColumn) {
        gridProperties.frozenColumnCount = 1;
        fields.push('gridProperties.frozenColumnCount');
      }
      requests.push({
        updateSheetProperties: {
          properties: { sheetId, gridProperties },
          fields: fields.join(','),
        },
      });
    }

    requests.push({
      autoResizeDimensions: {
        dimensions: {
          sheetId,
          dimension: 'COLUMNS',
          startIndex: 0,
          endIndex: options.columnCount,
        },
      },
    });

    const validationEndRowIndex = 1 + (options.dataRowCount ?? 0) + VALIDATION_ROW_BUFFER;
    requests.push(...this.buildValidationRequests(sheetId, options.validations ?? [], validationEndRowIndex));

    await this.sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests },
    });
  }

  /**
   * Re-applies boolean/enum validation rules bounded to `dataRowCount + VALIDATION_ROW_BUFFER`,
   * without touching header color/freeze/auto-resize. Called by CRUDOperations.create() as rows
   * are appended between syncs, so the validated range keeps pace with real row growth instead
   * of only catching up the next time `lsdb sync` runs — see FAQ.md #10 follow-up.
   */
  async extendValidation(
    spreadsheetId: string,
    sheetName: string,
    validations: ColumnValidationRule[],
    dataRowCount: number
  ): Promise<void> {
    if (validations.length === 0) return;
    const sheetId = await this.getSheetId(spreadsheetId, sheetName);
    const endRowIndex = 1 + dataRowCount + VALIDATION_ROW_BUFFER;
    const requests = this.buildValidationRequests(sheetId, validations, endRowIndex);
    await this.sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests },
    });
  }

  private buildValidationRequests(
    sheetId: number,
    validations: ColumnValidationRule[],
    endRowIndex: number
  ): sheets_v4.Schema$Request[] {
    return validations.map((rule) => ({
      setDataValidation: {
        range: {
          sheetId,
          startRowIndex: 1,
          endRowIndex,
          startColumnIndex: rule.columnIndex,
          endColumnIndex: rule.columnIndex + 1,
        },
        rule: {
          condition: {
            type: 'ONE_OF_LIST',
            values: rule.values.map((v) => ({ userEnteredValue: String(v) })),
          },
          strict: true,
          showCustomUi: true,
        },
      },
    }));
  }

  /** Returns the 1-based sheet row number the new row was written to (parsed from the API's updatedRange, no extra read). */
  async appendRow(spreadsheetId: string, sheetName: string, values: string[]): Promise<number> {
    const response = await this.sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${sheetName}!A:A`,
      valueInputOption: 'RAW',
      requestBody: {
        values: [values],
      },
    });
    this.invalidateCache(spreadsheetId, sheetName);
    return parseRowNumber(response.data.updates?.updatedRange);
  }

  async appendRows(spreadsheetId: string, sheetName: string, rows: string[][]): Promise<void> {
    if (rows.length === 0) return;
    await this.sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${sheetName}!A:A`,
      valueInputOption: 'RAW',
      requestBody: {
        values: rows,
      },
    });
    this.invalidateCache(spreadsheetId, sheetName);
  }

  /**
   * Reads the full `A:ZZ` range for a tab. Every findMany()/findOne()/count()/update()/delete()
   * call funnels through here, so a single request handler that touches a table more than once
   * (e.g. checkUniqueness() calling findOne() per unique column) — or concurrent requests
   * from different users hitting the same catalog table — used to mean one Sheets API read per
   * call. That's what exhausts Google's default per-user read quota under any real concurrency.
   * A short-TTL cache plus in-flight de-duplication collapses those into a single API call;
   * see FAQ.md #11 for the incident and CacheConfig for tuning/disabling it.
   */
  async getAllRows(spreadsheetId: string, sheetName: string): Promise<string[][]> {
    if (!this.cacheEnabled) return this._fetchAllRows(spreadsheetId, sheetName);

    const key = this._cacheKey(spreadsheetId, sheetName);
    const cached = this.readCache.entries.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.data;

    const inFlight = this.readCache.inFlight.get(key);
    if (inFlight) return inFlight;

    return this._trackRead(key, this._fetchAllRows(spreadsheetId, sheetName));
  }

  /**
   * Reads several tabs of one spreadsheet with a single `values.batchGet` request (one request
   * against the per-user read quota instead of one per tab) and caches each tab under the same key
   * getAllRows() uses, so later findMany()/findOne() calls on those tabs are cache hits. Tabs that
   * are already cached are skipped; tabs already being fetched are awaited rather than re-requested,
   * and a getAllRows() issued while the batch is in flight joins it.
   *
   * If any requested tab doesn't exist Google rejects the whole batch with a 400 — the batch then
   * falls back to one values.get per tab, so the existing tabs still load. Rejects with the first
   * per-tab error (after every other tab has settled and been cached).
   */
  async getAllRowsBatch(spreadsheetId: string, sheetNames: string[]): Promise<Map<string, string[][]>> {
    const names = Array.from(new Set(sheetNames));
    const pending = new Map<string, Promise<string[][]>>();
    const missing: string[] = [];

    for (const name of names) {
      const key = this._cacheKey(spreadsheetId, name);
      const cached = this.cacheEnabled ? this.readCache.entries.get(key) : undefined;
      const inFlight = this.cacheEnabled ? this.readCache.inFlight.get(key) : undefined;
      if (cached && cached.expiresAt > Date.now()) pending.set(name, Promise.resolve(cached.data));
      else if (inFlight) pending.set(name, inFlight);
      else missing.push(name);
    }

    for (let i = 0; i < missing.length; i += BATCH_GET_CHUNK_SIZE) {
      const chunk = missing.slice(i, i + BATCH_GET_CHUNK_SIZE);
      const batch = this._batchGetRows(spreadsheetId, chunk);
      chunk.forEach((name, index) => {
        const perTab = batch.then(
          (all) => all[index],
          (err: unknown) => {
            if (isBadRequest(err)) return this._fetchAllRows(spreadsheetId, name);
            throw err;
          }
        );
        pending.set(
          name,
          this.cacheEnabled ? this._trackRead(this._cacheKey(spreadsheetId, name), perTab) : perTab
        );
      });
    }

    const settled = await Promise.allSettled(names.map((name) => pending.get(name)!));
    const result = new Map<string, string[][]>();
    for (let i = 0; i < names.length; i++) {
      const outcome = settled[i];
      if (outcome.status === 'rejected') throw outcome.reason;
      result.set(names[i], outcome.value);
    }
    return result;
  }

  /** Whether getAllRows() results are cached — prefetching is pointless when they aren't. */
  isCacheEnabled(): boolean {
    return this.cacheEnabled;
  }

  /**
   * Registers `fetch` as the in-flight read for `key` and caches its result when it settles —
   * unless the tab was invalidated (written to) while the read was in flight, in which case the
   * possibly pre-write data is returned to this caller but not cached.
   */
  private _trackRead(key: string, fetch: Promise<string[][]>): Promise<string[][]> {
    const generation = this.readCache.generation(key);
    const clearInFlight = () => {
      if (this.readCache.inFlight.get(key) === promise) this.readCache.inFlight.delete(key);
    };
    const promise: Promise<string[][]> = fetch.then(
      (data) => {
        clearInFlight();
        if (this.readCache.generation(key) === generation) {
          this.readCache.entries.set(key, { data, expiresAt: Date.now() + this.cacheTtlMs });
        }
        return data;
      },
      (err: unknown) => {
        clearInFlight();
        throw err;
      }
    );
    this.readCache.inFlight.set(key, promise);
    return promise;
  }

  private async _batchGetRows(spreadsheetId: string, sheetNames: string[]): Promise<string[][][]> {
    const response = await this.sheets.spreadsheets.values.batchGet({
      spreadsheetId,
      ranges: sheetNames.map((name) => `${name}!A:ZZ`),
    });
    const valueRanges = response.data.valueRanges ?? [];
    return sheetNames.map((_name, index) => (valueRanges[index]?.values as string[][] | undefined) ?? []);
  }

  private async _fetchAllRows(spreadsheetId: string, sheetName: string): Promise<string[][]> {
    const response = await this.sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!A:ZZ`,
    });
    return response.data.values || [];
  }

  private _cacheKey(spreadsheetId: string, sheetName: string): string {
    return `${spreadsheetId}::${sheetName}`;
  }

  /** Drops the cached read (if any) for a tab. Called automatically after every write; also exposed for callers that write to a sheet outside this client (e.g. a human editing it directly) and need to force the next read to be fresh. */
  invalidateCache(spreadsheetId: string, sheetName: string): void {
    this.readCache.invalidate(this._cacheKey(spreadsheetId, sheetName));
  }

  async updateRow(spreadsheetId: string, sheetName: string, rowIndex: number, values: string[]): Promise<void> {
    await this.sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetName}!A${rowIndex}`,
      valueInputOption: 'RAW',
      requestBody: {
        values: [values],
      },
    });
    this.invalidateCache(spreadsheetId, sheetName);
  }

  async deleteRow(spreadsheetId: string, sheetName: string, rowIndex: number): Promise<void> {
    const sheetId = await this.getSheetId(spreadsheetId, sheetName);
    await this.sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            deleteDimension: {
              range: {
                sheetId,
                dimension: 'ROWS',
                startIndex: rowIndex - 1,
                endIndex: rowIndex,
              },
            },
          },
        ],
      },
    });
    this.invalidateCache(spreadsheetId, sheetName);
  }

  async shareWithUser(spreadsheetId: string, email: string, role: ShareRole = 'writer'): Promise<void> {
    await this.drive.permissions.create({
      fileId: spreadsheetId,
      requestBody: {
        type: 'user',
        role,
        emailAddress: email,
      },
    });
  }

  /**
   * Deletes an entire tab. Unlike the private getSheetId() used elsewhere (which falls back to
   * sheetId 0 when a title isn't found — fine for formatting calls, not for a delete), this
   * throws if the tab doesn't exist so callers can distinguish "already gone" from "about to
   * delete the wrong tab."
   */
  async deleteSheet(spreadsheetId: string, sheetName: string): Promise<void> {
    const sheetId = await this.getSheetIdStrict(spreadsheetId, sheetName);
    await this.sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{ deleteSheet: { sheetId } }],
      },
    });
    this.invalidateCache(spreadsheetId, sheetName);
  }

  /**
   * Deletes one or more columns from a tab in a single batchUpdate. `columnIndexes` may be
   * given in any order — they're sorted descending internally so earlier deletions don't shift
   * the indexes of later ones within the same batch.
   */
  async deleteColumns(spreadsheetId: string, sheetName: string, columnIndexes: number[]): Promise<void> {
    if (columnIndexes.length === 0) return;
    const sheetId = await this.getSheetIdStrict(spreadsheetId, sheetName);
    const descending = [...columnIndexes].sort((a, b) => b - a);
    const requests: sheets_v4.Schema$Request[] = descending.map((columnIndex) => ({
      deleteDimension: {
        range: {
          sheetId,
          dimension: 'COLUMNS',
          startIndex: columnIndex,
          endIndex: columnIndex + 1,
        },
      },
    }));
    await this.sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests },
    });
    this.invalidateCache(spreadsheetId, sheetName);
  }

  /**
   * Overwrites a single header cell in place — used for column rename so existing data rows
   * are left untouched (unlike a drop + re-add, which would lose every value in that column).
   */
  async updateHeaderCell(spreadsheetId: string, sheetName: string, columnIndex: number, value: string): Promise<void> {
    const column = columnIndexToA1Letter(columnIndex);
    await this.sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetName}!${column}1`,
      valueInputOption: 'RAW',
      requestBody: {
        values: [[value]],
      },
    });
    this.invalidateCache(spreadsheetId, sheetName);
  }

  private async getSheetId(spreadsheetId: string, sheetName: string): Promise<number> {
    const response = await this.sheets.spreadsheets.get({ spreadsheetId });
    const sheet = response.data.sheets?.find((s) => s.properties?.title === sheetName);
    return sheet?.properties?.sheetId || 0;
  }

  private async getSheetIdStrict(spreadsheetId: string, sheetName: string): Promise<number> {
    const response = await this.sheets.spreadsheets.get({ spreadsheetId });
    const sheet = response.data.sheets?.find((s) => s.properties?.title === sheetName);
    const sheetId = sheet?.properties?.sheetId;
    if (sheetId === undefined || sheetId === null) {
      throw new Error(`Sheet tab "${sheetName}" not found in spreadsheet ${spreadsheetId}`);
    }
    return sheetId;
  }
}
