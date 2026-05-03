import { CRUDOperations } from '../../src/adapter/crud';
import { SheetAdapter } from '../../src/adapter/sheetAdapter';
import { defineTable } from '../../src/schema/defineTable';
import { string, number } from '../../src/schema/columnBuilder';
import { MockSheetClient } from '../fixtures/mockSheetClient';
import { ValidationError } from '../../src/errors/ValidationError';
import { SchemaError } from '../../src/errors/SchemaError';
import { FKResolver } from '../../src/schema/types';

// ── Shared schemas ────────────────────────────────────────────────────────────

const SHEET_ID = 'fk-test-sheet';

const categorySchema = defineTable({
  name: 'categories',
  actor: 'admin',
  columns: {
    name: string().required(),
  },
});

const productSchema = defineTable({
  name: 'products',
  actor: 'admin',
  columns: {
    name: string().required(),
    category_id: string().ref('categories._id'),
  },
});

const tagSchema = defineTable({
  name: 'tags',
  actor: 'admin',
  columns: {
    label: string().required(),
    product_id: string().ref('products._id'),
  },
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeSetup() {
  const client = new MockSheetClient();

  const catCrud = new CRUDOperations(client as any, SHEET_ID, categorySchema);

  const fkResolver: FKResolver = async (tableName, columnName, value) => {
    if (tableName === 'categories') {
      const row = await catCrud.findOne({ where: { [columnName]: value } });
      return row !== null;
    }
    return false;
  };

  const prodCrud = new CRUDOperations(client as any, SHEET_ID, productSchema, fkResolver);

  return { client, catCrud, prodCrud };
}

// ── FK validation — create() ──────────────────────────────────────────────────

describe('FK validation on create()', () => {
  it('passes when referenced value exists', async () => {
    const { catCrud, prodCrud } = makeSetup();
    const cat = await catCrud.create({ name: 'Electronics' });

    await expect(
      prodCrud.create({ name: 'Laptop', category_id: cat._id })
    ).resolves.toMatchObject({ name: 'Laptop', category_id: cat._id });
  });

  it('throws ValidationError when referenced value does not exist', async () => {
    const { prodCrud } = makeSetup();

    await expect(
      prodCrud.create({ name: 'Laptop', category_id: 'nonexistent-id' })
    ).rejects.toThrow(ValidationError);
  });

  it('throws with correct FK violation message', async () => {
    const { prodCrud } = makeSetup();

    await expect(
      prodCrud.create({ name: 'Laptop', category_id: 'ghost-id' })
    ).rejects.toThrow("FK violation: categories._id 'ghost-id' does not exist");
  });

  it('skips FK check when skipFKValidation is true', async () => {
    const { prodCrud } = makeSetup();

    await expect(
      prodCrud.create({ name: 'Laptop', category_id: 'any-nonexistent-id' }, { skipFKValidation: true })
    ).resolves.toBeDefined();
  });

  it('does not run FK validation when fkResolver is not provided', async () => {
    const client = new MockSheetClient();
    const crud = new CRUDOperations(client as any, SHEET_ID, productSchema);

    await expect(
      crud.create({ name: 'Laptop', category_id: 'any-id' })
    ).resolves.toBeDefined();
  });

  it('allows null FK column (no reference check needed)', async () => {
    const { prodCrud } = makeSetup();

    await expect(
      prodCrud.create({ name: 'Uncategorised' })
    ).resolves.toMatchObject({ name: 'Uncategorised' });
  });
});

// ── FK validation — update() ──────────────────────────────────────────────────

describe('FK validation on update()', () => {
  it('passes when updated FK value exists', async () => {
    const { catCrud, prodCrud } = makeSetup();
    const cat1 = await catCrud.create({ name: 'Electronics' });
    const cat2 = await catCrud.create({ name: 'Clothing' });
    await prodCrud.create({ name: 'Laptop', category_id: cat1._id });

    await expect(
      prodCrud.update({ where: { name: 'Laptop' }, data: { category_id: cat2._id } })
    ).resolves.toBe(1);
  });

  it('throws ValidationError when updated FK value does not exist', async () => {
    const { catCrud, prodCrud } = makeSetup();
    const cat = await catCrud.create({ name: 'Electronics' });
    await prodCrud.create({ name: 'Laptop', category_id: cat._id });

    await expect(
      prodCrud.update({ where: { name: 'Laptop' }, data: { category_id: 'bad-id' } })
    ).rejects.toThrow(ValidationError);
  });

  it('skips FK check on update when skipFKValidation is true', async () => {
    const { catCrud, prodCrud } = makeSetup();
    const cat = await catCrud.create({ name: 'Electronics' });
    await prodCrud.create({ name: 'Laptop', category_id: cat._id });

    await expect(
      prodCrud.update({
        where: { name: 'Laptop' },
        data: { category_id: 'nonexistent-id' },
        skipFKValidation: true,
      })
    ).resolves.toBe(1);
  });
});

// ── Circular reference detection ──────────────────────────────────────────────

describe('Circular reference detection at registerSchema() time', () => {
  function makeAdapter() {
    return new SheetAdapter({
      adminSheetId: 'mock-admin-id',
      credentials: { clientId: 'x', clientSecret: 'x', redirectUri: 'x' },
      tokens: {},
    });
  }

  it('does not throw when schemas have no circular refs', () => {
    const adapter = makeAdapter();

    expect(() => {
      adapter.registerSchema(categorySchema);
      adapter.registerSchema(productSchema);
    }).not.toThrow();
  });

  it('throws SchemaError when two schemas reference each other (direct cycle)', () => {
    const adapter = makeAdapter();

    const tableA = defineTable({
      name: 'table_a',
      actor: 'admin',
      columns: { b_id: string().ref('table_b._id') },
    });

    const tableB = defineTable({
      name: 'table_b',
      actor: 'admin',
      columns: { a_id: string().ref('table_a._id') },
    });

    adapter.registerSchema(tableA);
    expect(() => adapter.registerSchema(tableB)).toThrow(SchemaError);
  });

  it('throws SchemaError on longer cycle (A → B → C → A)', () => {
    const adapter = makeAdapter();

    const tableA = defineTable({
      name: 'cycle_a',
      actor: 'admin',
      columns: { b_id: string().ref('cycle_b._id') },
    });
    const tableB = defineTable({
      name: 'cycle_b',
      actor: 'admin',
      columns: { c_id: string().ref('cycle_c._id') },
    });
    const tableC = defineTable({
      name: 'cycle_c',
      actor: 'admin',
      columns: { a_id: string().ref('cycle_a._id') },
    });

    adapter.registerSchema(tableA);
    adapter.registerSchema(tableB);
    expect(() => adapter.registerSchema(tableC)).toThrow(SchemaError);
  });

  it('does not throw when a schema refs an unregistered table', () => {
    const adapter = makeAdapter();

    const tableX = defineTable({
      name: 'table_x',
      actor: 'admin',
      columns: { unknown_id: string().ref('not_registered._id') },
    });

    expect(() => adapter.registerSchema(tableX)).not.toThrow();
  });

  it('registerSchemas() throws on first cycle encountered', () => {
    const adapter = makeAdapter();

    const tableA = defineTable({
      name: 'rs_a',
      actor: 'admin',
      columns: { b_id: string().ref('rs_b._id') },
    });
    const tableB = defineTable({
      name: 'rs_b',
      actor: 'admin',
      columns: { a_id: string().ref('rs_a._id') },
    });

    expect(() => adapter.registerSchemas([tableA, tableB])).toThrow(SchemaError);
  });
});

// ── Multiple FK columns ───────────────────────────────────────────────────────

describe('Multiple FK columns in one table', () => {
  const authorSchema = defineTable({
    name: 'authors',
    actor: 'admin',
    columns: { name: string().required() },
  });

  const publisherSchema = defineTable({
    name: 'publishers',
    actor: 'admin',
    columns: { name: string().required() },
  });

  const bookSchema = defineTable({
    name: 'books',
    actor: 'admin',
    columns: {
      title: string().required(),
      author_id: string().ref('authors._id'),
      publisher_id: string().ref('publishers._id'),
    },
  });

  function makeMultiFKSetup() {
    const client = new MockSheetClient();
    const authorCrud = new CRUDOperations(client as any, SHEET_ID, authorSchema);
    const publisherCrud = new CRUDOperations(client as any, SHEET_ID, publisherSchema);

    const fkResolver: FKResolver = async (tableName, columnName, value) => {
      if (tableName === 'authors') {
        return (await authorCrud.findOne({ where: { [columnName]: value } })) !== null;
      }
      if (tableName === 'publishers') {
        return (await publisherCrud.findOne({ where: { [columnName]: value } })) !== null;
      }
      return false;
    };

    const bookCrud = new CRUDOperations(client as any, SHEET_ID, bookSchema, fkResolver);
    return { authorCrud, publisherCrud, bookCrud };
  }

  it('passes when both FK values exist', async () => {
    const { authorCrud, publisherCrud, bookCrud } = makeMultiFKSetup();
    const author = await authorCrud.create({ name: 'Author' });
    const publisher = await publisherCrud.create({ name: 'Publisher' });

    await expect(
      bookCrud.create({ title: 'My Book', author_id: author._id, publisher_id: publisher._id })
    ).resolves.toMatchObject({ title: 'My Book' });
  });

  it('fails when one of the FK values does not exist', async () => {
    const { authorCrud, bookCrud } = makeMultiFKSetup();
    const author = await authorCrud.create({ name: 'Author' });

    await expect(
      bookCrud.create({ title: 'My Book', author_id: author._id, publisher_id: 'bad-pub-id' })
    ).rejects.toThrow(ValidationError);
  });
});
