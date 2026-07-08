import { generateMigrateDataScript } from '../../src/cli/commands/migrate-data';
import { generateExportDataScript } from '../../src/cli/commands/export-data';
import { defineTable } from '../../src/schema/defineTable';
import { string, number, boolean } from '../../src/schema/columnBuilder';

// ── Fixtures ──────────────────────────────────────────────────────────────────

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

// ── generateMigrateDataScript (admin-only) ────────────────────────────────────

describe('generateMigrateDataScript()', () => {
  it('includes the longcelot-sheet-db require statement', () => {
    const script = generateMigrateDataScript([usersSchema]);
    expect(script).toContain("require('longcelot-sheet-db')");
  });

  it('includes the insertRow stub function', () => {
    const script = generateMigrateDataScript([usersSchema]);
    expect(script).toContain('async function insertRow(tableName, row, userId)');
  });

  it('includes dotenv config call', () => {
    const script = generateMigrateDataScript([usersSchema]);
    expect(script).toContain("require('dotenv').config()");
  });

  it('registers all schemas inline', () => {
    const script = generateMigrateDataScript([usersSchema, bookingsSchema]);
    expect(script).toContain('adapter.registerSchemas(schemas)');
    expect(script).toContain('"name":"users"');
    expect(script).toContain('"name":"bookings"');
  });

  it('generates a findMany call for each schema', () => {
    const script = generateMigrateDataScript([usersSchema, bookingsSchema]);
    expect(script).toContain("adminCtx.table('users').findMany({})");
  });

  it('generates an insertRow call inside the loop for each admin schema', () => {
    const script = generateMigrateDataScript([usersSchema]);
    expect(script).toContain("await insertRow('users', row)");
  });

  it('uses actor: in generated withContext calls (new API)', () => {
    const script = generateMigrateDataScript([usersSchema]);
    expect(script).toContain("actor: 'admin'");
    expect(script).not.toContain("role: 'admin'");
  });

  it('wraps each table in a try/catch', () => {
    const script = generateMigrateDataScript([usersSchema]);
    expect(script).toContain('try {');
    expect(script).toContain('} catch (err) {');
  });

  it('ends with migrateData().catch(console.error)', () => {
    const script = generateMigrateDataScript([usersSchema]);
    expect(script).toContain('migrateData().catch(console.error)');
  });

  it('handles an empty schema array gracefully', () => {
    const script = generateMigrateDataScript([]);
    expect(script).toContain('async function migrateData()');
    expect(script).toContain('Data export complete.');
    expect(script).not.toContain("table('");
  });

  it('produces valid JavaScript (no syntax-breaking content)', () => {
    const script = generateMigrateDataScript([usersSchema, bookingsSchema]);
    expect(() => new Function(script)).not.toThrow();
  });

  it('includes a hint to use --all-users when user schemas are present but flag not set', () => {
    const script = generateMigrateDataScript([usersSchema, bookingsSchema], false);
    expect(script).toContain('--all-users');
  });

  it('header comment references lsdb migrate-data', () => {
    const script = generateMigrateDataScript([usersSchema]);
    expect(script).toContain('lsdb migrate-data');
    expect(script).not.toContain('lsdb export-data');
  });
});

// ── generateMigrateDataScript (--all-users) ───────────────────────────────────

describe('generateMigrateDataScript() with allUsers=true', () => {
  it('includes ROLE_TABLES map with non-admin role entries', () => {
    const script = generateMigrateDataScript([usersSchema, bookingsSchema, productsSchema], true);
    expect(script).toContain('ROLE_TABLES');
    expect(script).toContain('"user"');
    expect(script).toContain('"seller"');
  });

  it('includes per-user loop that reads from admin users table', () => {
    const script = generateMigrateDataScript([usersSchema, bookingsSchema], true);
    expect(script).toContain("table('users').findMany({})");
    expect(script).toContain('for (const user of users)');
  });

  it('creates a per-user withContext using actor: field', () => {
    const script = generateMigrateDataScript([usersSchema, bookingsSchema], true);
    expect(script).toContain('actor: user.role');
    expect(script).toContain('actorSheetId: user.actor_sheet_id');
  });

  it('passes userId to insertRow for user-sheet rows', () => {
    const script = generateMigrateDataScript([usersSchema, bookingsSchema], true);
    expect(script).toContain('await insertRow(tableName, row, user.user_id)');
  });

  it('produces valid JavaScript with --all-users content', () => {
    const script = generateMigrateDataScript([usersSchema, bookingsSchema, productsSchema], true);
    expect(() => new Function(script)).not.toThrow();
  });

  it('header comment reflects --all-users flag', () => {
    const script = generateMigrateDataScript([usersSchema], true);
    expect(script).toContain('lsdb migrate-data --all-users');
  });
});

// ── generateExportDataScript (deprecated alias, export-data.ts) ──────────────

describe('generateExportDataScript() — deprecated alias', () => {
  it('delegates to generateMigrateDataScript and includes the same content', () => {
    const script = generateExportDataScript([usersSchema]);
    expect(script).toContain("require('longcelot-sheet-db')");
    expect(script).toContain('async function insertRow(tableName, row, userId)');
    expect(script).toContain('adapter.registerSchemas(schemas)');
  });

  it('produces output identical to calling generateMigrateDataScript directly', () => {
    expect(generateExportDataScript([usersSchema, bookingsSchema], true)).toBe(
      generateMigrateDataScript([usersSchema, bookingsSchema], true)
    );
  });
});
