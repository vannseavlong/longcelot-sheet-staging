import { SheetClient } from '../../src/adapter/sheetClient';

const FAKE_CREDENTIALS = { clientId: 'id', clientSecret: 'secret', redirectUri: 'http://localhost' };

function makeClientWithMockValues(cacheConfig?: { enabled?: boolean; ttlMs?: number }) {
  const client = new SheetClient(FAKE_CREDENTIALS, {}, cacheConfig);
  const get = jest.fn().mockResolvedValue({ data: { values: [['_id', 'name'], ['1', 'a']] } });
  const append = jest.fn().mockResolvedValue({ data: { updates: { updatedRange: 'orders!A2:B2' } } });
  const update = jest.fn().mockResolvedValue({ data: {} });
  const batchUpdate = jest.fn().mockResolvedValue(undefined);

  (client as unknown as { sheets: unknown }).sheets = {
    spreadsheets: {
      values: { get, append, update },
      batchUpdate,
      get: jest.fn().mockResolvedValue({ data: { sheets: [{ properties: { sheetId: 1, title: 'orders' } }] } }),
    },
  };

  return { client, get, append, update, batchUpdate };
}

describe('SheetClient read cache', () => {
  it('serves repeated getAllRows() calls for the same tab from cache within the TTL', async () => {
    const { client, get } = makeClientWithMockValues();

    await client.getAllRows('sheet-id', 'orders');
    await client.getAllRows('sheet-id', 'orders');
    await client.getAllRows('sheet-id', 'orders');

    expect(get).toHaveBeenCalledTimes(1);
  });

  it('de-duplicates concurrent getAllRows() calls into a single API request', async () => {
    const { client, get } = makeClientWithMockValues();

    const [a, b, c] = await Promise.all([
      client.getAllRows('sheet-id', 'orders'),
      client.getAllRows('sheet-id', 'orders'),
      client.getAllRows('sheet-id', 'orders'),
    ]);

    expect(get).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it('keeps separate cache entries per spreadsheetId + sheetName', async () => {
    const { client, get } = makeClientWithMockValues();

    await client.getAllRows('sheet-id', 'orders');
    await client.getAllRows('sheet-id', 'customers');
    await client.getAllRows('other-sheet-id', 'orders');

    expect(get).toHaveBeenCalledTimes(3);
  });

  it('refetches once the TTL has expired', async () => {
    jest.useFakeTimers();
    try {
      const { client, get } = makeClientWithMockValues({ ttlMs: 1000 });

      await client.getAllRows('sheet-id', 'orders');
      jest.advanceTimersByTime(1001);
      await client.getAllRows('sheet-id', 'orders');

      expect(get).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it('bypasses the cache entirely when disabled', async () => {
    const { client, get } = makeClientWithMockValues({ enabled: false });

    await client.getAllRows('sheet-id', 'orders');
    await client.getAllRows('sheet-id', 'orders');

    expect(get).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['appendRow', (c: SheetClient) => c.appendRow('sheet-id', 'orders', ['1', 'a'])],
    ['appendRows', (c: SheetClient) => c.appendRows('sheet-id', 'orders', [['1', 'a']])],
    ['updateRow', (c: SheetClient) => c.updateRow('sheet-id', 'orders', 2, ['1', 'b'])],
    ['deleteRow', (c: SheetClient) => c.deleteRow('sheet-id', 'orders', 2)],
    ['writeHeader', (c: SheetClient) => c.writeHeader('sheet-id', 'orders', ['_id', 'name'])],
  ])('%s invalidates the read cache for that tab', async (_name, performWrite) => {
    const { client, get } = makeClientWithMockValues();

    await client.getAllRows('sheet-id', 'orders');
    await performWrite(client);
    await client.getAllRows('sheet-id', 'orders');

    expect(get).toHaveBeenCalledTimes(2);
  });

  it('invalidateCache() forces the next read to be fresh', async () => {
    const { client, get } = makeClientWithMockValues();

    await client.getAllRows('sheet-id', 'orders');
    client.invalidateCache('sheet-id', 'orders');
    await client.getAllRows('sheet-id', 'orders');

    expect(get).toHaveBeenCalledTimes(2);
  });

  it('a failed read does not poison the cache — the next call retries', async () => {
    const client = new SheetClient(FAKE_CREDENTIALS, {});
    const get = jest.fn()
      .mockRejectedValueOnce(new Error('429 quota exceeded'))
      .mockResolvedValueOnce({ data: { values: [['_id'], ['1']] } });

    (client as unknown as { sheets: unknown }).sheets = { spreadsheets: { values: { get } } };

    await expect(client.getAllRows('sheet-id', 'orders')).rejects.toThrow('429 quota exceeded');
    await expect(client.getAllRows('sheet-id', 'orders')).resolves.toEqual([['_id'], ['1']]);
    expect(get).toHaveBeenCalledTimes(2);
  });
});
