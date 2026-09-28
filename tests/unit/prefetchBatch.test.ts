import { SheetClient } from '../../src/adapter/sheetClient';
import { SheetAdapter, SheetAdapterConfig } from '../../src/adapter/sheetAdapter';
import { SQLAdapterBase } from '../../src/adapter/sql/sqlAdapterBase';
import { PostgresDialect } from '../../src/adapter/sql/dialect';
import { defineTable } from '../../src/schema/defineTable';
import { string } from '../../src/schema/columnBuilder';
import { PermissionError } from '../../src/errors/PermissionError';

const FAKE_CREDENTIALS = { clientId: 'id', clientSecret: 'secret', redirectUri: 'http://localhost' };
const ADMIN_ID = 'admin-sheet';
const USER_SHEET = 'user-sheet';
const TABS = ['projects', 'tasks', 'members', 'statuses', 'labels'];

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

/** Fake `sheets` API backed by an in-memory store; batchGet 400s if any range names a missing tab, like Google does. */
function fakeSheetsApi(store: Record<string, Record<string, string[][]>>) {
  const tabOf = (range: string) => range.split('!')[0];
  const get = jest.fn(async ({ spreadsheetId, range }: { spreadsheetId: string; range: string }) => {
    const rows = store[spreadsheetId]?.[tabOf(range)];
    if (!rows) throw Object.assign(new Error(`Unable to parse range: ${range}`), { code: 400 });
    return { data: { values: rows.length ? rows : undefined } };
  });
  const batchGet = jest.fn(async ({ spreadsheetId, ranges }: { spreadsheetId: string; ranges: string[] }) => {
    const valueRanges = ranges.map((range) => {
      const rows = store[spreadsheetId]?.[tabOf(range)];
      if (!rows) throw Object.assign(new Error(`Unable to parse range: ${range}`), { code: 400 });
      return { range, values: rows.length ? rows : undefined };
    });
    return { data: { valueRanges } };
  });
  const update = jest.fn().mockResolvedValue({ data: {} });
  return { api: { spreadsheets: { values: { get, batchGet, update } } }, get, batchGet, update };
}

function makeClient(store: Record<string, Record<string, string[][]>>, cacheConfig?: { enabled?: boolean }) {
  const client = new SheetClient(FAKE_CREDENTIALS, {}, cacheConfig);
  const fake = fakeSheetsApi(store);
  (client as unknown as { sheets: unknown }).sheets = fake.api;
  return { client, ...fake };
}

function tabStore(tabs: string[]): Record<string, string[][]> {
  return Object.fromEntries(tabs.map((t) => [t, [['_id', 'name'], [`${t}-1`, t]]]));
}

describe('SheetClient.getAllRowsBatch()', () => {
  it('fetches every uncached tab in one values.batchGet and serves later getAllRows() from cache', async () => {
    const { client, get, batchGet } = makeClient({ s: tabStore(TABS) });

    const result = await client.getAllRowsBatch('s', TABS);
    for (const tab of TABS) await client.getAllRows('s', tab);

    expect(batchGet).toHaveBeenCalledTimes(1);
    expect(get).not.toHaveBeenCalled();
    expect(result.get('tasks')).toEqual([['_id', 'name'], ['tasks-1', 'tasks']]);
  });

  it('only requests tabs that are not already cached', async () => {
    const { client, batchGet } = makeClient({ s: tabStore(TABS) });

    await client.getAllRows('s', 'projects');
    await client.getAllRows('s', 'tasks');
    await client.getAllRowsBatch('s', TABS);

    expect(batchGet).toHaveBeenCalledTimes(1);
    expect(batchGet.mock.calls[0][0].ranges).toEqual(['members!A:ZZ', 'statuses!A:ZZ', 'labels!A:ZZ']);
  });

  it('defaults an empty tab (no `values` in the response) to []', async () => {
    const { client } = makeClient({ s: { empty: [] } });
    const result = await client.getAllRowsBatch('s', ['empty']);
    expect(result.get('empty')).toEqual([]);
  });

  it('a concurrent getAllRows() on a tab inside an in-flight batch joins it instead of issuing values.get', async () => {
    const { client, get, batchGet } = makeClient({ s: tabStore(TABS) });

    const [batch, single] = await Promise.all([
      client.getAllRowsBatch('s', TABS),
      client.getAllRows('s', 'tasks'),
    ]);

    expect(batchGet).toHaveBeenCalledTimes(1);
    expect(get).not.toHaveBeenCalled();
    expect(single).toBe(batch.get('tasks'));
  });

  it('a batch waits on a tab that is already being fetched instead of re-requesting it', async () => {
    const { client, get, batchGet } = makeClient({ s: tabStore(TABS) });

    await Promise.all([client.getAllRows('s', 'projects'), client.getAllRowsBatch('s', ['projects', 'tasks'])]);

    expect(get).toHaveBeenCalledTimes(1);
    expect(batchGet.mock.calls[0][0].ranges).toEqual(['tasks!A:ZZ']);
  });

  it('falls back to per-tab reads when one tab is missing — the existing tabs still load and get cached', async () => {
    const { client, get, batchGet } = makeClient({ s: tabStore(['projects', 'tasks']) });

    await expect(client.getAllRowsBatch('s', ['projects', 'nope', 'tasks'])).rejects.toThrow('Unable to parse range');

    expect(batchGet).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledTimes(3);
    get.mockClear();
    await client.getAllRows('s', 'projects');
    await client.getAllRows('s', 'tasks');
    expect(get).not.toHaveBeenCalled();
  });

  it('does not fall back on non-400 errors (e.g. 429) — the error propagates', async () => {
    const { client, get, batchGet } = makeClient({ s: tabStore(TABS) });
    batchGet.mockRejectedValueOnce(Object.assign(new Error('Quota exceeded'), { code: 429 }));

    await expect(client.getAllRowsBatch('s', ['projects', 'tasks'])).rejects.toThrow('Quota exceeded');
    expect(get).not.toHaveBeenCalled();
  });

  it('splits more than 50 tabs into several batchGet calls', async () => {
    const many = Array.from({ length: 120 }, (_, i) => `t${i}`);
    const { client, batchGet } = makeClient({ s: tabStore(many) });

    await client.getAllRowsBatch('s', many);

    expect(batchGet.mock.calls.map((c) => c[0].ranges.length)).toEqual([50, 50, 20]);
  });

  it('a write during an in-flight batch is not overwritten by the batch’s pre-write data', async () => {
    const { client, get, batchGet } = makeClient({ s: tabStore(TABS) });
    const gate = deferred<void>();
    const original = batchGet.getMockImplementation()!;
    batchGet.mockImplementationOnce(async (args) => {
      await gate.promise;
      return original(args);
    });

    const batch = client.getAllRowsBatch('s', ['projects', 'tasks']);
    await client.updateRow('s', 'tasks', 2, ['tasks-1', 'renamed']);
    gate.resolve();
    await batch;

    await client.getAllRows('s', 'tasks');
    await client.getAllRows('s', 'projects');
    // tasks was invalidated mid-flight, so it's re-read; projects was cached by the batch.
    expect(get).toHaveBeenCalledTimes(1);
    expect(get.mock.calls[0][0].range).toBe('tasks!A:ZZ');
  });

  it('the same write-race guard applies to plain getAllRows()', async () => {
    const { client, get } = makeClient({ s: tabStore(TABS) });
    const gate = deferred<void>();
    const original = get.getMockImplementation()!;
    get.mockImplementationOnce(async (args) => {
      await gate.promise;
      return original(args);
    });

    const read = client.getAllRows('s', 'tasks');
    await client.updateRow('s', 'tasks', 2, ['tasks-1', 'renamed']);
    gate.resolve();
    await read;
    await client.getAllRows('s', 'tasks');

    expect(get).toHaveBeenCalledTimes(2);
  });
});

// ── SheetAdapter.prefetch() ───────────────────────────────────────────────

const adminUsers = defineTable({ name: 'users', actor: 'admin', columns: { user_id: string().primary(), name: string() } });
const adminTeams = defineTable({ name: 'teams', actor: 'admin', columns: { team_id: string().primary(), name: string() } });
const userTables = TABS.map((name) =>
  defineTable({ name, actor: 'user', columns: { [`${name}_id`]: string().primary(), name: string() } })
);

function makeAdapter(cache?: { enabled?: boolean }) {
  const rows = (t: string) => [['_id', `${t}_id`, 'name'], [`${t}-1`, 'id-1', t]];
  const store = {
    [ADMIN_ID]: { users: rows('user'), teams: rows('team') },
    [USER_SHEET]: Object.fromEntries(TABS.map((t) => [t, rows(t)])),
  };
  const { client, get, batchGet } = makeClient(store, cache);
  const adapter = new SheetAdapter({
    adminSheetId: ADMIN_ID,
    credentials: FAKE_CREDENTIALS,
    tokens: {},
    cache,
    _client: client,
  } as unknown as SheetAdapterConfig);
  adapter.registerSchemas([adminUsers, adminTeams, ...userTables]);
  const userCtx = adapter.withContext({ userId: 'u1', actor: 'user', actorSheetId: USER_SHEET });
  const adminCtx = adapter.withContext({ userId: 'a1', actor: 'admin', actorSheetId: ADMIN_ID });
  return { userCtx, adminCtx, get, batchGet };
}

describe('SheetAdapter.prefetch()', () => {
  it('5 tables, cold cache → exactly 1 batchGet and 0 values.get; later findMany() → 0 API calls', async () => {
    const { userCtx, get, batchGet } = makeAdapter();

    await userCtx.prefetch(TABS);
    for (const tab of TABS) {
      const found = await userCtx.table(tab).findMany();
      expect(found).toHaveLength(1);
    }

    expect(batchGet).toHaveBeenCalledTimes(1);
    expect(get).not.toHaveBeenCalled();
  });

  it('issues one batchGet per spreadsheet when tables span several', async () => {
    const { adminCtx, batchGet } = makeAdapter();

    await adminCtx.prefetch(['users', 'teams']);
    await adminCtx.asActor('user', USER_SHEET).prefetch(['projects', 'tasks']);

    expect(batchGet).toHaveBeenCalledTimes(2);
    expect(batchGet.mock.calls.map((c) => c[0].spreadsheetId)).toEqual([ADMIN_ID, USER_SHEET]);
  });

  it('enforces the same permission check as table()', async () => {
    const { userCtx, batchGet } = makeAdapter();
    await expect(userCtx.prefetch(['users'])).rejects.toThrow(PermissionError);
    expect(batchGet).not.toHaveBeenCalled();
  });

  it('cache.enabled: false → makes no API calls', async () => {
    const { userCtx, get, batchGet } = makeAdapter({ enabled: false });
    await userCtx.prefetch(TABS);
    expect(batchGet).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });
});

describe('SQL adapters — prefetch()', () => {
  it('resolves without issuing any queries', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [] });
    const adapter = new SQLAdapterBase({ query }, PostgresDialect);
    adapter.registerSchemas(userTables);

    await adapter.withContext({ userId: 'u1', actor: 'user', actorSheetId: 'tenant-1' }).prefetch(TABS);

    expect(query).not.toHaveBeenCalled();
  });
});
