import { resolveRunDriver } from '../../src/cli/commands/migrate-data';

// Phase 16.7 — `lsdb migrate-data --run` flag validation.

describe('resolveRunDriver()', () => {
  const ORIGINAL_ENV = process.env;
  let exitSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.DATABASE_URL;
    exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('resolves an explicit connectionString + driver', () => {
    const result = resolveRunDriver({ connectionString: 'postgres://x/y', driver: 'postgres' });
    expect(result).toEqual({ connectionString: 'postgres://x/y', driver: 'postgres' });
  });

  it('falls back to $DATABASE_URL when --connection-string is omitted', () => {
    process.env.DATABASE_URL = 'mysql://x/y';
    const result = resolveRunDriver({ driver: 'mysql' });
    expect(result.connectionString).toBe('mysql://x/y');
  });

  it('infers the driver from the connection string when --driver is omitted', () => {
    const result = resolveRunDriver({ connectionString: 'mysql://x/y' });
    expect(result.driver).toBe('mysql');
  });

  it('exits with an error when no connection string is available', () => {
    expect(() => resolveRunDriver({})).toThrow('process.exit called');
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('--connection-string or $DATABASE_URL'));
  });

  it('exits with an error when the driver cannot be inferred and is not passed explicitly', () => {
    expect(() => resolveRunDriver({ connectionString: 'mongodb://x/y' })).toThrow('process.exit called');
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('--run only supports --driver postgres|mysql'));
  });
});
