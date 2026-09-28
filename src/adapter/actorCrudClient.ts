import type { Credentials } from 'google-auth-library';
import { SheetClient, SheetReadCache, type ColumnValidationRule } from './sheetClient';
import type { StorageClient } from './types';
import type { DriveCredentials } from './driveTenancy';
import type { OAuthTokens, SheetReadCacheConfig, TokenStore } from '../schema/types';
import { ActorAuthError } from '../errors/ActorAuthError';

const DEFAULT_MAX_CACHED_CLIENTS = 100;

function isInvalidGrant(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { message?: unknown; response?: { data?: { error?: unknown } } };
  return (
    e.response?.data?.error === 'invalid_grant' ||
    (typeof e.message === 'string' && e.message.includes('invalid_grant'))
  );
}

/**
 * Per-actor SheetClients for `actorClientForCrud` (so each actor's table operations count against
 * their own Sheets API quota instead of the admin's), resolved from `tokenStore` and kept in a
 * small LRU keyed by userId. Every client shares the admin client's SheetReadCache, so a write
 * through any client (e.g. an admin cross-actor write into a user's sheet) invalidates the tab
 * for all of them. Actors without stored tokens aren't cached — they're re-checked on each call,
 * so tokens stored later are picked up without a restart.
 */
export class ActorClientPool {
  private readonly clients = new Map<string, Promise<SheetClient | null>>();
  private readonly maxClients: number;

  constructor(
    private readonly credentials: DriveCredentials,
    private readonly cacheConfig: SheetReadCacheConfig | undefined,
    private readonly tokenStore: TokenStore,
    private readonly readCache: SheetReadCache | undefined,
    maxClients?: number
  ) {
    this.maxClients = maxClients ?? DEFAULT_MAX_CACHED_CLIENTS;
  }

  /** The actor's own client, or null when the tokenStore has no tokens for them. */
  get(userId: string): Promise<SheetClient | null> {
    const existing = this.clients.get(userId);
    if (existing) {
      // Re-insert to mark as most recently used.
      this.clients.delete(userId);
      this.clients.set(userId, existing);
      return existing;
    }

    const resolved = this.create(userId).then(
      (client) => {
        if (!client) this.clients.delete(userId);
        return client;
      },
      (err: unknown) => {
        this.clients.delete(userId);
        throw err;
      }
    );
    this.clients.set(userId, resolved);
    if (this.clients.size > this.maxClients) {
      const oldest = this.clients.keys().next().value;
      if (oldest !== undefined) this.clients.delete(oldest);
    }
    return resolved;
  }

  evict(userId: string): void {
    this.clients.delete(userId);
  }

  private async create(userId: string): Promise<SheetClient | null> {
    const tokens = await this.tokenStore.get(userId);
    if (!tokens) return null;

    const client = new SheetClient(this.credentials, tokens, this.cacheConfig, this.readCache);
    // googleapis refreshes expired access tokens in memory only — persist them so a restart
    // doesn't start from the stale access token. The event carries only changed fields.
    let latest: OAuthTokens = tokens;
    client.onTokensRefreshed((refreshed: Credentials) => {
      latest = { ...latest, ...refreshed };
      this.tokenStore.set(userId, latest).catch((err: unknown) => {
        console.warn(`[lsdb] Failed to persist refreshed tokens for actor '${userId}': ${err}`);
      });
    });
    return client;
  }
}

/**
 * StorageClient that runs each call on the actor's own client when the pool has one, and on the
 * admin client otherwise. An `invalid_grant` from the actor's client evicts it and either raises
 * ActorAuthError or (onAuthError: 'fallback-admin') retries the call on the admin client — safe
 * to retry because invalid_grant is raised by the token refresh, before the request is sent.
 */
export class ActorRoutedStorageClient implements StorageClient {
  constructor(
    private readonly pool: ActorClientPool,
    private readonly userId: string,
    private readonly adminClient: StorageClient,
    private readonly onAuthError: 'throw' | 'fallback-admin'
  ) {}

  private async run<T>(op: (client: StorageClient) => Promise<T>): Promise<T> {
    const actorClient = await this.pool.get(this.userId);
    if (!actorClient) return op(this.adminClient);
    try {
      return await op(actorClient);
    } catch (err) {
      if (!isInvalidGrant(err)) throw err;
      this.pool.evict(this.userId);
      if (this.onAuthError === 'fallback-admin') return op(this.adminClient);
      throw new ActorAuthError(this.userId, err);
    }
  }

  getAllRows(spreadsheetId: string, sheetName: string): Promise<string[][]> {
    return this.run((c) => c.getAllRows(spreadsheetId, sheetName));
  }

  getAllRowsBatch(spreadsheetId: string, sheetNames: string[]): Promise<Map<string, string[][]>> {
    return this.run(async (c) => {
      if (c.getAllRowsBatch) return c.getAllRowsBatch(spreadsheetId, sheetNames);
      const rows = await Promise.all(sheetNames.map((name) => c.getAllRows(spreadsheetId, name)));
      return new Map(sheetNames.map((name, i) => [name, rows[i]]));
    });
  }

  appendRow(spreadsheetId: string, sheetName: string, values: string[]): Promise<number> {
    return this.run((c) => c.appendRow(spreadsheetId, sheetName, values));
  }

  appendRows(spreadsheetId: string, sheetName: string, rows: string[][]): Promise<void> {
    return this.run((c) => c.appendRows(spreadsheetId, sheetName, rows));
  }

  updateRow(spreadsheetId: string, sheetName: string, rowIndex: number, values: string[]): Promise<void> {
    return this.run((c) => c.updateRow(spreadsheetId, sheetName, rowIndex, values));
  }

  deleteRow(spreadsheetId: string, sheetName: string, rowIndex: number): Promise<void> {
    return this.run((c) => c.deleteRow(spreadsheetId, sheetName, rowIndex));
  }

  writeHeader(spreadsheetId: string, sheetName: string, headers: string[]): Promise<void> {
    return this.run((c) => c.writeHeader(spreadsheetId, sheetName, headers));
  }

  async extendValidation(
    spreadsheetId: string,
    sheetName: string,
    rules: ColumnValidationRule[],
    dataRowCount: number
  ): Promise<void> {
    await this.run(async (c) => {
      await c.extendValidation?.(spreadsheetId, sheetName, rules, dataRowCount);
    });
  }
}
