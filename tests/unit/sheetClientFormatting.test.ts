import { SheetClient } from '../../src/adapter/sheetClient';

const FAKE_CREDENTIALS = { clientId: 'id', clientSecret: 'secret', redirectUri: 'http://localhost' };

function makeClientWithMockSheets(sheetId = 42, sheetTitle = 'orders') {
  const client = new SheetClient(FAKE_CREDENTIALS, {});
  const batchUpdate = jest.fn().mockResolvedValue(undefined);
  const get = jest.fn().mockResolvedValue({
    data: { sheets: [{ properties: { sheetId, title: sheetTitle } }] },
  });

  // Replace the private googleapis sheets client with a test double —
  // avoids mocking the whole googleapis module for one method's request shape.
  (client as unknown as { sheets: unknown }).sheets = {
    spreadsheets: { batchUpdate, get },
  };

  return { client, batchUpdate, get };
}

describe('SheetClient.formatSheet()', () => {
  it('includes a repeatCell request with the header color converted to RGB', async () => {
    const { client, batchUpdate } = makeClientWithMockSheets();

    await client.formatSheet('sheet-id', 'orders', {
      columnCount: 5,
      headerColor: '#E8F0FE',
    });

    const { requests } = batchUpdate.mock.calls[0][0].requestBody;
    const repeatCell = requests.find((r: any) => r.repeatCell);
    expect(repeatCell.repeatCell.range).toEqual({
      sheetId: 42,
      startRowIndex: 0,
      endRowIndex: 1,
      startColumnIndex: 0,
      endColumnIndex: 5,
    });
    expect(repeatCell.repeatCell.cell.userEnteredFormat.backgroundColor).toEqual({
      red: 0xe8 / 255,
      green: 0xf0 / 255,
      blue: 0xfe / 255,
    });
  });

  it('omits the repeatCell request when no headerColor is given', async () => {
    const { client, batchUpdate } = makeClientWithMockSheets();
    await client.formatSheet('sheet-id', 'orders', { columnCount: 3 });
    const { requests } = batchUpdate.mock.calls[0][0].requestBody;
    expect(requests.find((r: any) => r.repeatCell)).toBeUndefined();
  });

  it('freezes the header row and first column when requested', async () => {
    const { client, batchUpdate } = makeClientWithMockSheets();

    await client.formatSheet('sheet-id', 'orders', {
      columnCount: 3,
      freezeHeader: true,
      freezeFirstColumn: true,
    });

    const { requests } = batchUpdate.mock.calls[0][0].requestBody;
    const freeze = requests.find((r: any) => r.updateSheetProperties);
    expect(freeze.updateSheetProperties.properties.gridProperties).toEqual({
      frozenRowCount: 1,
      frozenColumnCount: 1,
    });
    expect(freeze.updateSheetProperties.fields).toBe(
      'gridProperties.frozenRowCount,gridProperties.frozenColumnCount'
    );
  });

  it('always requests autoResizeDimensions for the header column range', async () => {
    const { client, batchUpdate } = makeClientWithMockSheets();
    await client.formatSheet('sheet-id', 'orders', { columnCount: 7 });
    const { requests } = batchUpdate.mock.calls[0][0].requestBody;
    const resize = requests.find((r: any) => r.autoResizeDimensions);
    expect(resize.autoResizeDimensions.dimensions).toEqual({
      sheetId: 42,
      dimension: 'COLUMNS',
      startIndex: 0,
      endIndex: 7,
    });
  });

  it('builds a BOOLEAN data validation rule for boolean columns', async () => {
    const { client, batchUpdate } = makeClientWithMockSheets();
    await client.formatSheet('sheet-id', 'orders', {
      columnCount: 3,
      validations: [{ columnIndex: 2, type: 'BOOLEAN' }],
    });
    const { requests } = batchUpdate.mock.calls[0][0].requestBody;
    const validation = requests.find((r: any) => r.setDataValidation);
    expect(validation.setDataValidation.range).toEqual({
      sheetId: 42,
      startRowIndex: 1,
      startColumnIndex: 2,
      endColumnIndex: 3,
    });
    expect(validation.setDataValidation.rule.condition).toEqual({ type: 'BOOLEAN' });
  });

  it('builds a ONE_OF_LIST data validation rule for enum columns', async () => {
    const { client, batchUpdate } = makeClientWithMockSheets();
    await client.formatSheet('sheet-id', 'orders', {
      columnCount: 3,
      validations: [{ columnIndex: 1, type: 'ONE_OF_LIST', values: ['active', 'inactive'] }],
    });
    const { requests } = batchUpdate.mock.calls[0][0].requestBody;
    const validation = requests.find((r: any) => r.setDataValidation);
    expect(validation.setDataValidation.rule.condition).toEqual({
      type: 'ONE_OF_LIST',
      values: [{ userEnteredValue: 'active' }, { userEnteredValue: 'inactive' }],
    });
  });
});
