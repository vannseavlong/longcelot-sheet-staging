import { generateMigrationScript } from '../../src/cli/commands/migrate';
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

// ── generateMigrationScript ───────────────────────────────────────────────────

describe('generateMigrationScript()', () => {
  it('includes the longcelot-sheet-db require statement', () => {
    const script = generateMigrationScript([usersSchema]);
    expect(script).toContain("require('longcelot-sheet-db')");
  });

  it('includes the insertRow stub function', () => {
    const script = generateMigrationScript([usersSchema]);
    expect(script).toContain('async function insertRow(tableName, row)');
  });

  it('includes dotenv config call', () => {
    const script = generateMigrationScript([usersSchema]);
    expect(script).toContain("require('dotenv').config()");
  });

  it('generates a findMany call for each schema', () => {
    const script = generateMigrationScript([usersSchema, bookingsSchema]);
    expect(script).toContain("ctx.table('users').findMany({})");
    expect(script).toContain("ctx.table('bookings').findMany({})");
  });

  it('generates an insertRow call inside the loop for each schema', () => {
    const script = generateMigrationScript([usersSchema, bookingsSchema]);
    expect(script).toContain("await insertRow('users', row)");
    expect(script).toContain("await insertRow('bookings', row)");
  });

  it('uses the correct actor role in each context', () => {
    const script = generateMigrationScript([usersSchema, bookingsSchema]);
    expect(script).toContain("role: 'admin'");
    expect(script).toContain("role: 'user'");
  });

  it('wraps each table in a try/catch', () => {
    const script = generateMigrationScript([usersSchema]);
    expect(script).toContain('try {');
    expect(script).toContain('} catch (err) {');
  });

  it('ends with migrate().catch(console.error)', () => {
    const script = generateMigrationScript([usersSchema]);
    expect(script).toContain('migrate().catch(console.error)');
  });

  it('handles an empty schema array gracefully', () => {
    const script = generateMigrationScript([]);
    expect(script).toContain('async function migrate()');
    expect(script).toContain('Migration complete.');
    expect(script).not.toContain("table('");
  });

  it('includes a comment indicating the table name and actor for each table', () => {
    const script = generateMigrationScript([usersSchema, bookingsSchema]);
    expect(script).toContain('users (actor: admin)');
    expect(script).toContain('bookings (actor: user)');
  });

  it('produces valid JavaScript (no syntax-breaking content)', () => {
    const script = generateMigrationScript([usersSchema, bookingsSchema]);
    expect(() => new Function(script)).not.toThrow();
  });
});
