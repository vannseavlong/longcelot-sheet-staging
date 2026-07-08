import { SheetClient, columnIndexToA1Letter } from '../../src/adapter/sheetClient';

const FAKE_CREDENTIALS = { clientId: 'id', clientSecret: 'secret', redirectUri: 'http://localhost' };

function makeClientWithMockSheets(sheetId = 42, sheetTitle = 'orders') {
  const client = new SheetClient(FAKE_CREDENTIALS, {});
  const batchUpdate = jest.fn().mockResolvedValue(undefined);
  const get = jest.fn().mockResolvedValue({
    data: { sheets: [{ properties: { sheetId, title: sheetTitle } }] },
  });
  const update = jest.fn().mockResolvedValue({ data: {} });

  // Replace the private googleapis sheets client with a test double —
  // avoids mocking the whole googleapis module for one method's request shape.
  (client as unknown as { sheets: unknown }).sheets = {
    spreadsheets: { batchUpdate, get, values: { update } },
  };

  return { client, batchUpdate, get, update };
}

describe('columnIndexToA1Letter()', () => {
  it('converts single-letter indexes', () => {
    expect(columnIndexToA1Letter(0)).toBe('A');
    expect(columnIndexToA1Letter(25)).toBe('Z');
  });

  it('converts two-letter indexes past Z', () => {
    expect(columnIndexToA1Letter(26)).toBe('AA');
    expect(columnIndexToA1Letter(27)).toBe('AB');
    expect(columnIndexToA1Letter(51)).toBe('AZ');
    expect(columnIndexToA1Letter(52)).toBe('BA');
  });
});

describe('SheetClient.deleteSheet()', () => {
  it('sends a deleteSheet request for the resolved sheetId', async () => {
    const { client, batchUpdate } = makeClientWithMockSheets(42, 'orders');
    await client.deleteSheet('spreadsheet-id', 'orders');
    const { requests } = batchUpdate.mock.calls[0][0].requestBody;
    expect(requests).toEqual([{ deleteSheet: { sheetId: 42 } }]);
  });

  it('throws instead of silently deleting sheetId 0 when the tab is not found', async () => {
    const { client, batchUpdate } = makeClientWithMockSheets(42, 'orders');
    await expect(client.deleteSheet('spreadsheet-id', 'missing-tab')).rejects.toThrow(
      'Sheet tab "missing-tab" not found in spreadsheet spreadsheet-id'
    );
    expect(batchUpdate).not.toHaveBeenCalled();
  });

  it('correctly targets a tab whose real sheetId is 0', async () => {
    const { client, batchUpdate } = makeClientWithMockSheets(0, 'orders');
    await client.deleteSheet('spreadsheet-id', 'orders');
    const { requests } = batchUpdate.mock.calls[0][0].requestBody;
    expect(requests).toEqual([{ deleteSheet: { sheetId: 0 } }]);
  });
});

describe('SheetClient.deleteColumns()', () => {
  it('deletes multiple columns in descending index order within a single batchUpdate', async () => {
    const { client, batchUpdate } = makeClientWithMockSheets(42, 'orders');
    await client.deleteColumns('spreadsheet-id', 'orders', [1, 4, 2]);
    expect(batchUpdate).toHaveBeenCalledTimes(1);
    const { requests } = batchUpdate.mock.calls[0][0].requestBody;
    expect(requests.map((r: any) => r.deleteDimension.range.startIndex)).toEqual([4, 2, 1]);
    expect(requests[0].deleteDimension.range).toEqual({
      sheetId: 42,
      dimension: 'COLUMNS',
      startIndex: 4,
      endIndex: 5,
    });
  });

  it('is a no-op for an empty index array', async () => {
    const { client, batchUpdate, get } = makeClientWithMockSheets();
    await client.deleteColumns('spreadsheet-id', 'orders', []);
    expect(batchUpdate).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });

  it('throws when the tab is not found', async () => {
    const { client } = makeClientWithMockSheets(42, 'orders');
    await expect(client.deleteColumns('spreadsheet-id', 'missing-tab', [0])).rejects.toThrow(
      'Sheet tab "missing-tab" not found'
    );
  });
});

describe('SheetClient.updateHeaderCell()', () => {
  it('writes the new value to the correct A1 cell in row 1', async () => {
    const { client, update } = makeClientWithMockSheets(42, 'orders');
    await client.updateHeaderCell('spreadsheet-id', 'orders', 2, 'renamed_col');
    expect(update).toHaveBeenCalledWith({
      spreadsheetId: 'spreadsheet-id',
      range: 'orders!C1',
      valueInputOption: 'RAW',
      requestBody: { values: [['renamed_col']] },
    });
  });

  it('does not need to resolve a sheetId (values.update addresses by tab name)', async () => {
    const { client, get } = makeClientWithMockSheets();
    await client.updateHeaderCell('spreadsheet-id', 'orders', 0, 'x');
    expect(get).not.toHaveBeenCalled();
  });
});
