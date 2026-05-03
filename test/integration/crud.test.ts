import { CRUDOperations } from '../../src/adapter/crud';
import { defineTable } from '../../src/schema/defineTable';
import { string, number, boolean } from '../../src/schema/columnBuilder';
import { MockSheetClient } from '../fixtures/mockSheetClient';

// ── Shared fixtures ──────────────────────────────────────────────────────────

const SHEET_ID = 'test-spreadsheet';

const productSchema = defineTable({
  name: 'products',
  actor: 'admin',
  timestamps: true,
  columns: {
    name: string().required().unique(),
    price: number().min(0),
    available: boolean().default(true),
    category: string().enum(['electronics', 'clothing', 'food']).default('electronics'),
  },
});

function makeCRUD() {
  const client = new MockSheetClient();
  // No pre-seeding: getHeaders() auto-creates the header row on first write
  const crud = new CRUDOperations(client as any, SHEET_ID, productSchema);
  return { crud, client };
}

// ── create ────────────────────────────────────────────────────────────────────

describe('CRUDOperations.create()', () => {
  it('inserts a row and returns the record with _id', async () => {
    const { crud } = makeCRUD();
    const record = await crud.create({ name: 'Laptop', price: 999 });

    expect(record._id).toBeDefined();
    expect(record.name).toBe('Laptop');
    expect(record.price).toBe(999);
  });

  it('applies column defaults', async () => {
    const { crud } = makeCRUD();
    const record = await crud.create({ name: 'Phone', price: 500 });

    expect(record.available).toBe(true);
    expect(record.category).toBe('electronics');
  });

  it('adds _created_at and _updated_at when timestamps: true', async () => {
    const { crud } = makeCRUD();
    const record = await crud.create({ name: 'Tablet', price: 299 });

    expect(record._created_at).toBeDefined();
    expect(record._updated_at).toBeDefined();
  });

  it('throws when a required column is missing', async () => {
    const { crud } = makeCRUD();
    await expect(crud.create({ price: 50 })).rejects.toThrow('name');
  });

  it('throws when an enum value is invalid', async () => {
    const { crud } = makeCRUD();
    await expect(crud.create({ name: 'Item', price: 10, category: 'toys' })).rejects.toThrow(
      'category'
    );
  });

  it('throws on unique constraint violation', async () => {
    const { crud } = makeCRUD();
    await crud.create({ name: 'Camera', price: 200 });
    await expect(crud.create({ name: 'Camera', price: 250 })).rejects.toThrow(
      "Unique constraint violation: column 'name' already has value 'Camera'"
    );
  });
});

// ── findMany / findOne ────────────────────────────────────────────────────────

describe('CRUDOperations.findMany()', () => {
  async function seedProducts() {
    const { crud, client } = makeCRUD();
    await crud.create({ name: 'Laptop', price: 999, category: 'electronics' });
    await crud.create({ name: 'T-Shirt', price: 25, category: 'clothing' });
    await crud.create({ name: 'Apple', price: 2, category: 'food' });
    return { crud, client };
  }

  it('returns all rows when no options passed', async () => {
    const { crud } = await seedProducts();
    const results = await crud.findMany();
    expect(results).toHaveLength(3);
  });

  it('filters by where clause', async () => {
    const { crud } = await seedProducts();
    const results = await crud.findMany({ where: { category: 'food' } });
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('Apple');
  });

  it('respects limit', async () => {
    const { crud } = await seedProducts();
    const results = await crud.findMany({ limit: 2 });
    expect(results).toHaveLength(2);
  });

  it('respects offset', async () => {
    const { crud } = await seedProducts();
    const results = await crud.findMany({ offset: 2 });
    expect(results).toHaveLength(1);
  });

  it('sorts ascending by field', async () => {
    const { crud } = await seedProducts();
    const results = await crud.findMany({ orderBy: 'price', order: 'asc' });
    expect(results[0].name).toBe('Apple');
    expect(results[2].name).toBe('Laptop');
  });

  it('sorts descending by field', async () => {
    const { crud } = await seedProducts();
    const results = await crud.findMany({ orderBy: 'price', order: 'desc' });
    expect(results[0].name).toBe('Laptop');
  });
});

describe('CRUDOperations.findOne()', () => {
  it('returns null when no match', async () => {
    const { crud } = makeCRUD();
    const result = await crud.findOne({ where: { name: 'ghost' } });
    expect(result).toBeNull();
  });

  it('returns the first matching record', async () => {
    const { crud } = makeCRUD();
    await crud.create({ name: 'Widget', price: 9 });
    const result = await crud.findOne({ where: { name: 'Widget' } });
    expect(result).not.toBeNull();
    expect(result!.price).toBe(9);
  });
});

// ── update ────────────────────────────────────────────────────────────────────

describe('CRUDOperations.update()', () => {
  it('updates matching rows and returns the count', async () => {
    const { crud } = makeCRUD();
    await crud.create({ name: 'Headphones', price: 80, category: 'electronics' });

    const count = await crud.update({
      where: { name: 'Headphones' },
      data: { price: 90 },
    });

    expect(count).toBe(1);
    const result = await crud.findOne({ where: { name: 'Headphones' } });
    expect(result!.price).toBe(90);
  });

  it('returns 0 when no rows match', async () => {
    const { crud } = makeCRUD();
    const count = await crud.update({ where: { name: 'ghost' }, data: { price: 1 } });
    expect(count).toBe(0);
  });

  it('throws unique violation when updating to duplicate value', async () => {
    const { crud } = makeCRUD();
    await crud.create({ name: 'Alpha', price: 10 });
    await crud.create({ name: 'Beta', price: 20 });

    await expect(
      crud.update({ where: { name: 'Beta' }, data: { name: 'Alpha' } })
    ).rejects.toThrow("Unique constraint violation: column 'name' already has value 'Alpha'");
  });
});

// ── delete ────────────────────────────────────────────────────────────────────

describe('CRUDOperations.delete()', () => {
  it('hard-deletes matching rows and returns count', async () => {
    const { crud } = makeCRUD();
    await crud.create({ name: 'Sock', price: 3 });
    await crud.create({ name: 'Hat', price: 15 });

    const count = await crud.delete({ where: { name: 'Sock' } });

    expect(count).toBe(1);
    const remaining = await crud.findMany();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].name).toBe('Hat');
  });

  it('returns 0 when no rows match', async () => {
    const { crud } = makeCRUD();
    const count = await crud.delete({ where: { name: 'ghost' } });
    expect(count).toBe(0);
  });
});

// ── soft delete ───────────────────────────────────────────────────────────────

describe('CRUDOperations soft delete', () => {
  const softSchema = defineTable({
    name: 'orders',
    actor: 'user',
    softDelete: true,
    columns: {
      ref: string().required(),
    },
  });

  it('sets _deleted_at instead of removing the row', async () => {
    const client = new MockSheetClient();
    const crud = new CRUDOperations(client as any, 'soft-sheet', softSchema);

    await crud.create({ ref: 'ORD-001' });
    const deleted = await crud.delete({ where: { ref: 'ORD-001' } });
    expect(deleted).toBe(1);

    const record = await crud.findOne({ where: { ref: 'ORD-001' } });
    expect(record!._deleted_at).not.toBeNull();
  });
});

// ── primary key behaviour ─────────────────────────────────────────────────────

describe('CRUDOperations primary key (string)', () => {
  const skuSchema = defineTable({
    name: 'skus',
    actor: 'admin',
    columns: {
      sku_id: string().primary(),
      label: string().required(),
    },
  });

  function makeCRUD() {
    const client = new MockSheetClient();
    return { crud: new CRUDOperations(client as any, 'pk-sheet', skuSchema), client };
  }

  it('auto-generates a nanoid for the string primary column when not supplied', async () => {
    const { crud } = makeCRUD();
    const record = await crud.create({ label: 'Widget' });

    expect(record.sku_id).toBeDefined();
    expect(typeof record.sku_id).toBe('string');
    expect(record.sku_id.length).toBeGreaterThan(0);
  });

  it('uses the supplied value when a string PK is provided', async () => {
    const { crud } = makeCRUD();
    const record = await crud.create({ sku_id: 'SKU-001', label: 'Widget' });

    expect(record.sku_id).toBe('SKU-001');
  });

  it('strips the PK column silently on update() — does not throw', async () => {
    const { crud } = makeCRUD();
    await crud.create({ sku_id: 'SKU-001', label: 'Widget' });

    await expect(
      crud.update({ where: { sku_id: 'SKU-001' }, data: { sku_id: 'CHANGED', label: 'Updated' } })
    ).resolves.toBe(1);

    const record = await crud.findOne({ where: { sku_id: 'SKU-001' } });
    expect(record!.sku_id).toBe('SKU-001');
    expect(record!.label).toBe('Updated');
  });

  it('PK value remains unchanged after update', async () => {
    const { crud } = makeCRUD();
    const created = await crud.create({ label: 'Original' });
    const originalPk = created.sku_id;

    await crud.update({ where: { sku_id: originalPk }, data: { sku_id: 'HACKED', label: 'Modified' } });

    const record = await crud.findOne({ where: { sku_id: originalPk } });
    expect(record!.sku_id).toBe(originalPk);
  });
});

describe('CRUDOperations primary key (number)', () => {
  const itemSchema = defineTable({
    name: 'items',
    actor: 'admin',
    columns: {
      item_id: number().primary(),
      name: string().required(),
    },
  });

  it('throws when number primary column is not supplied on create()', async () => {
    const client = new MockSheetClient();
    const crud = new CRUDOperations(client as any, 'num-pk-sheet', itemSchema);

    await expect(crud.create({ name: 'Widget' })).rejects.toThrow('item_id');
  });

  it('accepts a supplied number PK value on create()', async () => {
    const client = new MockSheetClient();
    const crud = new CRUDOperations(client as any, 'num-pk-sheet', itemSchema);

    const record = await crud.create({ item_id: 42, name: 'Widget' });
    expect(record.item_id).toBe(42);
  });
});
