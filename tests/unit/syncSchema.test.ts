import { SheetAdapter, SheetAdapterConfig } from '../../src/adapter/sheetAdapter';
import { defineTable } from '../../src/schema/defineTable';
import { string, number, boolean } from '../../src/schema/columnBuilder';

function makeClient(rowsBySheet: Record<string, string[][]> = {}, sheetNames: string[] = []) {
  return {
    getSheetNames: jest.fn().mockResolvedValue(sheetNames),
    getAllRows: jest.fn().mockImplementation((_id: string, sheet: string) =>
      Promise.resolve(rowsBySheet[sheet] ?? [])
    ),
    writeHeader: jest.fn().mockResolvedValue(undefined),
    formatSheet: jest.fn().mockResolvedValue(undefined),
    appendRow: jest.fn().mockResolvedValue(undefined),
    appendRows: jest.fn().mockResolvedValue(undefined),
    updateRow: jest.fn().mockResolvedValue(undefined),
    deleteRow: jest.fn().mockResolvedValue(undefined),
    addSheet: jest.fn().mockResolvedValue(undefined),
    createSpreadsheet: jest.fn().mockResolvedValue('new-sheet-id'),
    shareWithUser: jest.fn().mockResolvedValue(undefined),
  };
}

const baseConfig: Omit<SheetAdapterConfig, '_client'> = {
  adminSheetId: 'admin-sheet-id',
  credentials: { clientId: 'x', clientSecret: 'y', redirectUri: 'z' },
  tokens: {},
};

function makeAdapter(
  client: ReturnType<typeof makeClient>,
  extra: Partial<SheetAdapterConfig> = {}
) {
  return new SheetAdapter({
    ...baseConfig,
    ...extra,
    _client: client,
  } as unknown as SheetAdapterConfig);
}

const usersSchema = defineTable({
  name: 'users',
  actor: 'admin',
  columns: {
    name: string().required(),
    email: string().required(),
  },
});

const usersSchemaWithNewCol = defineTable({
  name: 'users',
  actor: 'admin',
  columns: {
    name: string().required(),
    email: string().required(),
    phone: string(),
    age: number(),
  },
});

const ordersSchema = defineTable({
  name: 'orders',
  actor: 'admin',
  columns: {
    status: string().enum(['pending', 'shipped']),
    paid: boolean(),
  },
});

describe('syncSchema()', () => {
  describe('new tab (tab does not exist)', () => {
    it('creates the tab and writes all schema headers', async () => {
      const client = makeClient({}, []);
      const adapter = makeAdapter(client);
      adapter.registerSchemas([usersSchema]);

      await adapter.syncSchema(usersSchema);

      expect(client.addSheet).toHaveBeenCalledWith('admin-sheet-id', 'users');
      expect(client.writeHeader).toHaveBeenCalledWith(
        'admin-sheet-id',
        'users',
        expect.arrayContaining(['_id', 'name', 'email'])
      );
    });
  });

  describe('existing tab — all columns already present', () => {
    it('does not call writeHeader when headers are already in sync', async () => {
      const existingHeaders = ['_id', 'name', 'email'];
      const client = makeClient(
        { users: [existingHeaders, ['u1', 'Alice', 'alice@example.com']] },
        ['users']
      );
      const adapter = makeAdapter(client);
      adapter.registerSchemas([usersSchema]);

      await adapter.syncSchema(usersSchema);

      expect(client.addSheet).not.toHaveBeenCalled();
      expect(client.writeHeader).not.toHaveBeenCalled();
    });
  });

  describe('existing tab — schema has new columns', () => {
    it('appends missing headers to the end of the existing header row', async () => {
      const existingHeaders = ['_id', 'name', 'email'];
      const client = makeClient(
        { users: [existingHeaders, ['u1', 'Alice', 'alice@example.com']] },
        ['users']
      );
      const adapter = makeAdapter(client);
      adapter.registerSchemas([usersSchemaWithNewCol]);

      await adapter.syncSchema(usersSchemaWithNewCol);

      expect(client.addSheet).not.toHaveBeenCalled();
      expect(client.writeHeader).toHaveBeenCalledWith('admin-sheet-id', 'users', [
        '_id',
        'name',
        'email',
        'phone',
        'age',
      ]);
    });

    it('preserves existing header order and only appends missing ones', async () => {
      // Sheet has email before name (custom order) — existing order must be preserved
      const existingHeaders = ['_id', 'email', 'name'];
      const client = makeClient(
        { users: [existingHeaders, ['u1', 'alice@example.com', 'Alice']] },
        ['users']
      );
      const adapter = makeAdapter(client);
      adapter.registerSchemas([usersSchemaWithNewCol]);

      await adapter.syncSchema(usersSchemaWithNewCol);

      const [, , newHeaders] = client.writeHeader.mock.calls[0];
      expect(newHeaders).toEqual(['_id', 'email', 'name', 'phone', 'age']);
    });

    it('does not duplicate a header that already exists', async () => {
      // Simulate sheet with one of the new columns already present
      const existingHeaders = ['_id', 'name', 'email', 'phone'];
      const client = makeClient(
        { users: [existingHeaders] },
        ['users']
      );
      const adapter = makeAdapter(client);
      adapter.registerSchemas([usersSchemaWithNewCol]);

      await adapter.syncSchema(usersSchemaWithNewCol);

      expect(client.writeHeader).toHaveBeenCalledWith('admin-sheet-id', 'users', [
        '_id',
        'name',
        'email',
        'phone',
        'age',
      ]);
      // phone must not appear twice
      const written: string[] = client.writeHeader.mock.calls[0][2];
      expect(written.filter((h) => h === 'phone')).toHaveLength(1);
    });
  });

  describe('existing tab — header row only (no data rows)', () => {
    it('appends missing columns even when the tab has no data rows yet', async () => {
      const client = makeClient(
        { users: [['_id', 'name', 'email']] },
        ['users']
      );
      const adapter = makeAdapter(client);
      adapter.registerSchemas([usersSchemaWithNewCol]);

      await adapter.syncSchema(usersSchemaWithNewCol);

      expect(client.writeHeader).toHaveBeenCalledWith('admin-sheet-id', 'users', [
        '_id',
        'name',
        'email',
        'phone',
        'age',
      ]);
    });
  });

  describe('sheet formatting (8/9/10 — auto-resize, header style, validation dropdowns)', () => {
    it('formats the sheet with default style after writing headers on a new tab', async () => {
      const client = makeClient({}, []);
      const adapter = makeAdapter(client);
      adapter.registerSchemas([usersSchema]);

      await adapter.syncSchema(usersSchema);

      expect(client.formatSheet).toHaveBeenCalledWith('admin-sheet-id', 'users', {
        columnCount: 3, // name, email, _id
        headerColor: '#E8F0FE',
        freezeHeader: true,
        freezeFirstColumn: false,
        validations: [],
        dataRowCount: 0,
      });
    });

    it('does not format the sheet when headers are already in sync (no-op)', async () => {
      const existingHeaders = ['_id', 'name', 'email'];
      const client = makeClient(
        { users: [existingHeaders, ['u1', 'Alice', 'alice@example.com']] },
        ['users']
      );
      const adapter = makeAdapter(client);
      adapter.registerSchemas([usersSchema]);

      await adapter.syncSchema(usersSchema);

      expect(client.formatSheet).not.toHaveBeenCalled();
    });

    it('re-formats with the full header set when new columns are appended', async () => {
      const existingHeaders = ['_id', 'name', 'email'];
      const client = makeClient(
        { users: [existingHeaders, ['u1', 'Alice', 'alice@example.com']] },
        ['users']
      );
      const adapter = makeAdapter(client);
      adapter.registerSchemas([usersSchemaWithNewCol]);

      await adapter.syncSchema(usersSchemaWithNewCol);

      expect(client.formatSheet).toHaveBeenCalledWith('admin-sheet-id', 'users', {
        columnCount: 5, // name, email, phone, age, _id
        headerColor: '#E8F0FE',
        freezeHeader: true,
        freezeFirstColumn: false,
        validations: [],
        dataRowCount: 1, // one existing data row: u1/Alice/alice@example.com
      });
    });

    it('builds ONE_OF_LIST validation rules for both boolean() and enum() columns', async () => {
      const client = makeClient({}, []);
      const adapter = makeAdapter(client);
      adapter.registerSchemas([ordersSchema]);

      await adapter.syncSchema(ordersSchema);

      const [, , options] = client.formatSheet.mock.calls[0];
      // headers: status, paid, _id (defineTable appends _id last)
      // boolean() uses ONE_OF_LIST too (not a native checkbox) — see FAQ.md #10
      expect(options.validations).toEqual([
        { columnIndex: 0, type: 'ONE_OF_LIST', values: ['pending', 'shipped'] },
        { columnIndex: 1, type: 'ONE_OF_LIST', values: ['TRUE', 'FALSE'] },
      ]);
    });

    it('uses the project-wide sheetStyle.booleanFormat default for boolean() columns', async () => {
      const client = makeClient({}, []);
      const adapter = makeAdapter(client, { sheetStyle: { booleanFormat: '1_0' } });
      adapter.registerSchemas([ordersSchema]);

      await adapter.syncSchema(ordersSchema);

      const [, , options] = client.formatSheet.mock.calls[0];
      const booleanRule = options.validations.find((v: any) => v.columnIndex === 1);
      expect(booleanRule).toEqual({ columnIndex: 1, type: 'ONE_OF_LIST', values: ['1', '0'] });
    });

    it('lets a per-column boolean({ format }) override the project-wide default', async () => {
      const mixedSchema = defineTable({
        name: 'mixed',
        actor: 'admin',
        columns: {
          legacy_flag: boolean({ format: '1_0' }),
          active: boolean(), // no override -> falls back to project default
        },
      });
      const client = makeClient({}, []);
      const adapter = makeAdapter(client, { sheetStyle: { booleanFormat: 'TRUE_FALSE' } });
      adapter.registerSchemas([mixedSchema]);

      await adapter.syncSchema(mixedSchema);

      const [, , options] = client.formatSheet.mock.calls[0];
      expect(options.validations).toEqual([
        { columnIndex: 0, type: 'ONE_OF_LIST', values: ['1', '0'] }, // legacy_flag override
        { columnIndex: 1, type: 'ONE_OF_LIST', values: ['TRUE', 'FALSE'] }, // active, project default
      ]);
    });

    it('honours sheetStyle overrides from SheetAdapterConfig', async () => {
      const client = makeClient({}, []);
      const adapter = makeAdapter(client, {
        sheetStyle: { headerColor: '#FFCC00', freezeHeader: false, freezeFirstColumn: true },
      });
      adapter.registerSchemas([usersSchema]);

      await adapter.syncSchema(usersSchema);

      const [, , options] = client.formatSheet.mock.calls[0];
      expect(options.headerColor).toBe('#FFCC00');
      expect(options.freezeHeader).toBe(false);
      expect(options.freezeFirstColumn).toBe(true);
    });
  });
});
