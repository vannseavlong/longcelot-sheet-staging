import { createDatabaseAdapter } from '../../src/adapter/createDatabaseAdapter';
import { SheetAdapter } from '../../src/adapter/sheetAdapter';
import { SQLAdapterBase } from '../../src/adapter/sql/sqlAdapterBase';
import { SchemaError } from '../../src/errors/SchemaError';

// A minimal fake satisfying pg's/mysql2's pool shape (has a `.query()` method) — passing it via
// `pool:` skips the lazy require('pg')/require('mysql2/promise') entirely, so these tests don't
// need a real database or driver package installed at runtime.
function fakePool() {
  return { query: jest.fn().mockResolvedValue({ rows: [] }) };
}

describe('createDatabaseAdapter()', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.DB_DRIVER;
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.GOOGLE_REDIRECT_URI;
    delete process.env.ADMIN_SHEET_ID;
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('defaults to the sheets driver when explicit sheets config is provided', () => {
    const adapter = createDatabaseAdapter({
      sheets: {
        adminSheetId: 'admin-id',
        credentials: { clientId: 'x', clientSecret: 'y', redirectUri: 'z' },
        tokens: {},
      },
    });
    expect(adapter).toBeInstanceOf(SheetAdapter);
  });

  it('throws a clear SchemaError for driver sheets when no config/env vars are available', () => {
    expect(() => createDatabaseAdapter({ driver: 'sheets' })).toThrow(SchemaError);
    expect(() => createDatabaseAdapter({ driver: 'sheets' })).toThrow(/GOOGLE_CLIENT_ID/);
  });

  it('constructs a Postgres adapter when driver is postgres', () => {
    const adapter = createDatabaseAdapter({ driver: 'postgres', postgres: { pool: fakePool() } });
    expect(adapter).toBeInstanceOf(SQLAdapterBase);
  });

  it('constructs a MySQL adapter when driver is mysql', () => {
    const adapter = createDatabaseAdapter({ driver: 'mysql', mysql: { pool: fakePool() } });
    expect(adapter).toBeInstanceOf(SQLAdapterBase);
  });

  it('reads the driver from $DB_DRIVER when not passed explicitly', () => {
    process.env.DB_DRIVER = 'postgres';
    const adapter = createDatabaseAdapter({ postgres: { pool: fakePool() } });
    expect(adapter).toBeInstanceOf(SQLAdapterBase);
  });

  it('explicit driver config takes priority over $DB_DRIVER', () => {
    process.env.DB_DRIVER = 'mysql';
    const adapter = createDatabaseAdapter({ driver: 'postgres', postgres: { pool: fakePool() } });
    expect(adapter).toBeInstanceOf(SQLAdapterBase);
  });

  it('throws SchemaError for an unknown driver', () => {
    expect(() => createDatabaseAdapter({ driver: 'oracle' as unknown as 'postgres' })).toThrow(SchemaError);
  });
});
