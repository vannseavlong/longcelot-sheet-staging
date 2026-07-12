import {
  inferDriverFromConnectionString,
  splitSQLStatements,
  isAlreadyExistsError,
} from '../../src/cli/commands/migrate';

// Phase 16.7 — `lsdb migrate --apply` helpers.

describe('inferDriverFromConnectionString()', () => {
  it('infers postgres from a postgres:// URL', () => {
    expect(inferDriverFromConnectionString('postgres://user:pass@host:5432/db')).toBe('postgres');
  });

  it('infers postgres from a postgresql:// URL', () => {
    expect(inferDriverFromConnectionString('postgresql://user:pass@host:5432/db')).toBe('postgres');
  });

  it('infers mysql from a mysql:// URL', () => {
    expect(inferDriverFromConnectionString('mysql://user:pass@host:3306/db')).toBe('mysql');
  });

  it('returns undefined for an unrecognized scheme', () => {
    expect(inferDriverFromConnectionString('mongodb://host/db')).toBeUndefined();
  });
});

describe('splitSQLStatements()', () => {
  it('splits a CREATE TABLE + multiple CREATE INDEX block into separate statements', () => {
    const ddl = [
      'CREATE TABLE IF NOT EXISTS products (',
      '  id VARCHAR(255) NOT NULL,',
      '  PRIMARY KEY (id)',
      ');',
      '',
      'CREATE INDEX idx_products_sku ON products(sku);',
      'CREATE INDEX idx_products_tenant_id ON products(tenant_id);',
      '',
    ].join('\n');

    const statements = splitSQLStatements(ddl);
    expect(statements).toHaveLength(3);
    expect(statements[0]).toMatch(/^CREATE TABLE IF NOT EXISTS products \(/);
    expect(statements[0]).toMatch(/\);$/);
    expect(statements[1]).toBe('CREATE INDEX idx_products_sku ON products(sku);');
    expect(statements[2]).toBe('CREATE INDEX idx_products_tenant_id ON products(tenant_id);');
  });

  it('drops empty fragments from leading/trailing whitespace', () => {
    expect(splitSQLStatements('  \n\n  ')).toEqual([]);
  });

  it('returns a single statement for DDL with no index lines', () => {
    const ddl = 'CREATE TABLE IF NOT EXISTS settings (\n  id VARCHAR(255) NOT NULL,\n  PRIMARY KEY (id)\n);\n';
    expect(splitSQLStatements(ddl)).toHaveLength(1);
  });
});

describe('isAlreadyExistsError()', () => {
  it('recognizes Postgres duplicate_table (42P07) as already-exists', () => {
    expect(isAlreadyExistsError({ code: '42P07' }, 'postgres')).toBe(true);
  });

  it('does not treat an unrelated Postgres error code as already-exists', () => {
    expect(isAlreadyExistsError({ code: '23505' }, 'postgres')).toBe(false);
  });

  it('recognizes MySQL ER_DUP_KEYNAME as already-exists', () => {
    expect(isAlreadyExistsError({ code: 'ER_DUP_KEYNAME' }, 'mysql')).toBe(true);
  });

  it('does not treat an unrelated MySQL error code as already-exists', () => {
    expect(isAlreadyExistsError({ code: 'ER_DUP_ENTRY' }, 'mysql')).toBe(false);
  });

  it('returns false for a non-object error', () => {
    expect(isAlreadyExistsError('boom', 'postgres')).toBe(false);
    expect(isAlreadyExistsError(undefined, 'mysql')).toBe(false);
  });
});
