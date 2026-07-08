import fs from 'fs';
import os from 'os';
import path from 'path';
import { removeColumnLine, renameColumnKey } from '../../src/utils/schemaFileMutator';

function writeTempSchema(content: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lsdb-schema-mutator-'));
  const filePath = path.join(dir, 'bookings.ts');
  fs.writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

const SIMPLE_SCHEMA = `import { defineTable, string, number, boolean } from 'longcelot-sheet-db';

export default defineTable({
  name: 'bookings',
  actor: 'user',
  columns: {
    booking_id: string().primary(),
    service: string().required(),
    price: number().min(0),
    confirmed: boolean().default(false),
  },
});
`;

const LAST_PROPERTY_NO_COMMA = `import { defineTable, string } from 'longcelot-sheet-db';

export default defineTable({
  name: 'bookings',
  actor: 'user',
  columns: {
    booking_id: string().primary(),
    notes: string()
  },
});
`;

const MULTILINE_COLUMN = `import { defineTable, string, json } from 'longcelot-sheet-db';

export default defineTable({
  name: 'bookings',
  actor: 'user',
  columns: {
    booking_id: string().primary(),
    metadata: json().default({
      foo: 1,
    }),
  },
});
`;

describe('removeColumnLine()', () => {
  it('removes a single-line column entry and preserves the rest', () => {
    const filePath = writeTempSchema(SIMPLE_SCHEMA);
    const result = removeColumnLine(filePath, 'price');
    expect(result).toEqual({ ok: true });
    const updated = fs.readFileSync(filePath, 'utf-8');
    expect(updated).not.toContain('price: number()');
    expect(updated).toContain('service: string().required(),');
    expect(updated).toContain('confirmed: boolean().default(false),');
  });

  it('removes the last property even without a trailing comma', () => {
    const filePath = writeTempSchema(LAST_PROPERTY_NO_COMMA);
    const result = removeColumnLine(filePath, 'notes');
    expect(result).toEqual({ ok: true });
    const updated = fs.readFileSync(filePath, 'utf-8');
    expect(updated).not.toContain('notes');
    expect(updated).toContain('booking_id: string().primary(),');
  });

  it('refuses to remove a reserved column', () => {
    const filePath = writeTempSchema(SIMPLE_SCHEMA);
    const result = removeColumnLine(filePath, '_id');
    expect(result.ok).toBe(false);
    expect((result as { reason: string }).reason).toContain('reserved');
    expect(fs.readFileSync(filePath, 'utf-8')).toBe(SIMPLE_SCHEMA);
  });

  it('returns ok:false when the column is not found, without touching the file', () => {
    const filePath = writeTempSchema(SIMPLE_SCHEMA);
    const result = removeColumnLine(filePath, 'nonexistent');
    expect(result.ok).toBe(false);
    expect((result as { reason: string }).reason).toContain('not found');
    expect(fs.readFileSync(filePath, 'utf-8')).toBe(SIMPLE_SCHEMA);
  });

  it('refuses to remove a column whose definition spans multiple lines', () => {
    const filePath = writeTempSchema(MULTILINE_COLUMN);
    const result = removeColumnLine(filePath, 'metadata');
    expect(result.ok).toBe(false);
    expect((result as { reason: string }).reason).toContain('spans multiple lines');
    expect(fs.readFileSync(filePath, 'utf-8')).toBe(MULTILINE_COLUMN);
  });
});

describe('renameColumnKey()', () => {
  it('renames the key while preserving the rest of the line', () => {
    const filePath = writeTempSchema(SIMPLE_SCHEMA);
    const result = renameColumnKey(filePath, 'price', 'unit_price');
    expect(result).toEqual({ ok: true });
    const updated = fs.readFileSync(filePath, 'utf-8');
    expect(updated).toContain('unit_price: number().min(0),');
    expect(updated).not.toContain('    price: number()');
  });

  it('renames the opening line of a multi-line column definition without breaking it', () => {
    const filePath = writeTempSchema(MULTILINE_COLUMN);
    const result = renameColumnKey(filePath, 'metadata', 'extra_data');
    expect(result).toEqual({ ok: true });
    const updated = fs.readFileSync(filePath, 'utf-8');
    expect(updated).toContain('extra_data: json().default({');
    expect(updated).toContain('foo: 1,');
  });

  it('refuses to rename a reserved column', () => {
    const filePath = writeTempSchema(SIMPLE_SCHEMA);
    const result = renameColumnKey(filePath, '_id', 'identifier');
    expect(result.ok).toBe(false);
    expect((result as { reason: string }).reason).toContain('reserved');
  });

  it('refuses to rename into a reserved column name', () => {
    const filePath = writeTempSchema(SIMPLE_SCHEMA);
    const result = renameColumnKey(filePath, 'price', '_id');
    expect(result.ok).toBe(false);
    expect((result as { reason: string }).reason).toContain('reserved');
  });

  it('returns ok:false when the old column is not found', () => {
    const filePath = writeTempSchema(SIMPLE_SCHEMA);
    const result = renameColumnKey(filePath, 'nonexistent', 'whatever');
    expect(result.ok).toBe(false);
    expect((result as { reason: string }).reason).toContain('not found');
  });
});
