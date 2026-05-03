import { defineTable } from '../../src/schema/defineTable';
import { string, number, boolean, date, json } from '../../src/schema/columnBuilder';
import { SchemaError } from '../../src/errors/SchemaError';

describe('defineTable()', () => {
  it('returns a schema with the correct name and actor', () => {
    const schema = defineTable({
      name: 'bookings',
      actor: 'user',
      columns: {
        service: string().required(),
      },
    });

    expect(schema.name).toBe('bookings');
    expect(schema.actor).toBe('user');
  });

  it('auto-adds _id column', () => {
    const schema = defineTable({
      name: 'test',
      actor: 'user',
      columns: { title: string() },
    });

    expect(schema.columns._id).toBeDefined();
    expect(schema.columns._id.type).toBe('string');
    expect(schema.columns._id.required).toBe(true);
    expect(schema.columns._id.unique).toBe(true);
  });

  it('adds _created_at and _updated_at when timestamps: true', () => {
    const schema = defineTable({
      name: 'test',
      actor: 'user',
      timestamps: true,
      columns: { title: string() },
    });

    expect(schema.columns._created_at).toBeDefined();
    expect(schema.columns._updated_at).toBeDefined();
    expect(schema.columns._created_at.type).toBe('date');
    expect(schema.columns._updated_at.type).toBe('date');
  });

  it('does NOT add timestamp columns when timestamps is omitted', () => {
    const schema = defineTable({
      name: 'test',
      actor: 'user',
      columns: { title: string() },
    });

    expect(schema.columns._created_at).toBeUndefined();
    expect(schema.columns._updated_at).toBeUndefined();
  });

  it('adds _deleted_at when softDelete: true', () => {
    const schema = defineTable({
      name: 'test',
      actor: 'user',
      softDelete: true,
      columns: { title: string() },
    });

    expect(schema.columns._deleted_at).toBeDefined();
    expect(schema.columns._deleted_at.type).toBe('date');
  });

  it('converts ColumnBuilder instances to ColumnDefinition', () => {
    const schema = defineTable({
      name: 'products',
      actor: 'admin',
      columns: {
        name: string().required().max(100),
        price: number().min(0),
        available: boolean().default(true),
        expires: date(),
        meta: json(),
      },
    });

    expect(schema.columns.name.type).toBe('string');
    expect(schema.columns.name.required).toBe(true);
    expect(schema.columns.name.max).toBe(100);

    expect(schema.columns.price.type).toBe('number');
    expect(schema.columns.price.min).toBe(0);

    expect(schema.columns.available.type).toBe('boolean');
    expect(schema.columns.available.default).toBe(true);

    expect(schema.columns.expires.type).toBe('date');
    expect(schema.columns.meta.type).toBe('json');
  });

  it('stores enum values on a column', () => {
    const schema = defineTable({
      name: 'orders',
      actor: 'user',
      columns: {
        status: string().enum(['pending', 'confirmed', 'cancelled']).default('pending'),
      },
    });

    expect(schema.columns.status.enum).toEqual(['pending', 'confirmed', 'cancelled']);
    expect(schema.columns.status.default).toBe('pending');
  });

  it('marks primary columns as unique and required', () => {
    const schema = defineTable({
      name: 'items',
      actor: 'user',
      columns: {
        item_code: string().primary(),
      },
    });

    expect(schema.columns.item_code.primary).toBe(true);
    expect(schema.columns.item_code.unique).toBe(true);
    expect(schema.columns.item_code.required).toBe(true);
  });

  it('sets pkColumn when one primary() column is defined', () => {
    const schema = defineTable({
      name: 'orders',
      actor: 'user',
      columns: {
        order_code: string().primary(),
        total: number(),
      },
    });

    expect(schema.pkColumn).toBe('order_code');
  });

  it('pkColumn is undefined when no primary() column is defined', () => {
    const schema = defineTable({
      name: 'notes',
      actor: 'user',
      columns: {
        body: string().required(),
      },
    });

    expect(schema.pkColumn).toBeUndefined();
  });

  it('throws SchemaError when multiple primary() columns are defined', () => {
    expect(() =>
      defineTable({
        name: 'bad',
        actor: 'user',
        columns: {
          code_a: string().primary(),
          code_b: number().primary(),
        },
      })
    ).toThrow(SchemaError);
  });
});
