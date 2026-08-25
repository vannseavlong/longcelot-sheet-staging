import { filterSchemasByTable } from '../../src/cli/lib/filterSchemasByTable';
import { defineTable } from '../../src/schema/defineTable';
import { string, number, boolean } from '../../src/schema/columnBuilder';

// Canonical-location coverage for the shared `--table` filter used by both `migrate-data` and
// `sync`. `tests/unit/migrate-data.test.ts` covers the same behavior through migrate-data.ts's
// re-export, unmodified since before the extraction — proof the move is behavior-preserving,
// matching the project's established convention for shared-helper extractions (see accessControl.ts,
// Phase 16.3).

const usersSchema = defineTable({
  name: 'users',
  actor: 'admin',
  columns: {
    user_id: string().primary(),
    email: string().required(),
    role: string().required(),
  },
});

const bookingsSchema = defineTable({
  name: 'bookings',
  actor: 'user',
  columns: {
    booking_id: string().primary(),
    price: number().required(),
    confirmed: boolean().default(false),
  },
});

const productsSchema = defineTable({
  name: 'products',
  actor: 'seller',
  columns: {
    product_id: string().primary(),
    name: string().required(),
    price: number().required(),
  },
});

describe('filterSchemasByTable()', () => {
  const allSchemas = [usersSchema, bookingsSchema, productsSchema];

  let exitSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('returns all schemas unchanged when --table is omitted', () => {
    expect(filterSchemasByTable(allSchemas, undefined)).toEqual(allSchemas);
  });

  it('restricts to a single table by name', () => {
    const result = filterSchemasByTable(allSchemas, 'bookings');
    expect(result).toEqual([bookingsSchema]);
  });

  it('restricts to multiple tables via a comma-separated list, useful for sync --table on large schemas', () => {
    const result = filterSchemasByTable(allSchemas, 'bookings,products');
    expect(result.map((s) => s.name)).toEqual(['bookings', 'products']);
  });

  it('trims whitespace around comma-separated names', () => {
    const result = filterSchemasByTable(allSchemas, ' bookings , products ');
    expect(result.map((s) => s.name)).toEqual(['bookings', 'products']);
  });

  it('preserves each schema\'s actor, so a caller can still bucket the filtered result per actor', () => {
    const result = filterSchemasByTable(allSchemas, 'bookings,products');
    expect(result.map((s) => s.actor)).toEqual(['user', 'seller']);
  });

  it('exits with an error listing every unmatched table name', () => {
    expect(() => filterSchemasByTable(allSchemas, 'users,nope,alsonope')).toThrow('process.exit called');
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('nope, alsonope'));
    expect(errorSpy).not.toHaveBeenCalledWith(expect.stringContaining('users'));
  });

  it('exits with an error when the single requested table is not found', () => {
    expect(() => filterSchemasByTable(allSchemas, 'ghost')).toThrow('process.exit called');
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('ghost'));
  });
});
