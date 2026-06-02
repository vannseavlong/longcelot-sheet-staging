import { SheetAdapter, SheetAdapterConfig } from '../../src/adapter/sheetAdapter';
import { defineTable } from '../../src/schema/defineTable';
import { string, number } from '../../src/schema/columnBuilder';

function makeClient(rowsBySheet: Record<string, string[][]> = {}, sheetNames: string[] = []) {
  return {
    getSheetNames: jest.fn().mockResolvedValue(sheetNames),
    getAllRows: jest.fn().mockImplementation((_id: string, sheet: string) =>
      Promise.resolve(rowsBySheet[sheet] ?? [])
    ),
    writeHeader: jest.fn().mockResolvedValue(undefined),
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

function makeAdapter(client: ReturnType<typeof makeClient>) {
  return new SheetAdapter({
    ...baseConfig,
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
});
