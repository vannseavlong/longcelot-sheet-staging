import { generatePrismaModel, generateSQLTable } from '../../src/cli/commands/migrate';
import { defineTable } from '../../src/schema/defineTable';
import { string, number, boolean, json } from '../../src/schema/columnBuilder';

// Phase 16.5 — DDL/schema export fidelity gaps: index(), enum(), default(), unique(), and the
// Phase 16.3 tenant_id column injection for non-admin schemas.

const indexedSchema = defineTable({
  name: 'products',
  actor: 'seller',
  columns: {
    product_id: string().primary(),
    sku: string().required().unique(),
    category: string().index(),
    status: string().enum(['active', 'inactive', 'draft']).default('active'),
    price: number().default(0),
    in_stock: boolean().default(true),
  },
});

const adminSchema = defineTable({
  name: 'settings',
  actor: 'admin',
  columns: { key: string().primary() },
});

const jsonDefaultSchema = defineTable({
  name: 'carts',
  actor: 'seller',
  columns: {
    cart_id: string().primary(),
    items: json().default([]),
  },
});

const numericEnumSchema = defineTable({
  name: 'orders',
  actor: 'seller',
  columns: {
    order_id: string().primary(),
    priority: number().enum([1, 2, 3]),
  },
});

describe('generateSQLTable() — Phase 16.5 fidelity', () => {
  it('emits a composite UNIQUE(tenant_id, col) for unique() columns on a tenant-scoped table, not a bare column UNIQUE', () => {
    // A bare column-level UNIQUE would enforce uniqueness globally across every tenant, but
    // SQLTableOperations.checkUniqueness() checks per-tenant (via a tenant-scoped findOne()) —
    // see FAQ.md #13. Caught by real-Postgres integration testing (Phase 16.2).
    const output = generateSQLTable(indexedSchema);
    expect(output).not.toMatch(/sku VARCHAR\(255\) NOT NULL UNIQUE/);
    expect(output).toContain('UNIQUE (tenant_id, sku)');
    const pkLine = output.split('\n').find((l) => l.includes('product_id'));
    expect(pkLine).not.toContain('UNIQUE');
  });

  it('emits a bare column-level UNIQUE for unique() columns on an admin (non-tenant-scoped) table', () => {
    const adminUniqueSchema = defineTable({
      name: 'admins',
      actor: 'admin',
      columns: { admin_id: string().primary(), email: string().required().unique() },
    });
    const output = generateSQLTable(adminUniqueSchema);
    expect(output).toMatch(/email VARCHAR\(255\) NOT NULL UNIQUE/);
    expect(output).not.toContain('UNIQUE (tenant_id');
  });

  it('emits DEFAULT for default() columns, quoted per type', () => {
    const output = generateSQLTable(indexedSchema);
    expect(output).toContain("DEFAULT 'active'");
    expect(output).toContain('DEFAULT 0');
    expect(output).toContain('DEFAULT TRUE');
  });

  it('emits CREATE INDEX for index() columns', () => {
    const output = generateSQLTable(indexedSchema);
    expect(output).toContain('CREATE INDEX idx_products_category ON products(category);');
  });

  it('emits CHECK (col IN (...)) for enum() columns', () => {
    const output = generateSQLTable(indexedSchema);
    expect(output).toContain("CHECK (status IN ('active', 'inactive', 'draft'))");
  });

  it('formats numeric enum values unquoted', () => {
    const output = generateSQLTable(numericEnumSchema);
    expect(output).toContain('CHECK (priority IN (1, 2, 3))');
  });

  it('injects a tenant_id column and index for non-admin schemas', () => {
    const output = generateSQLTable(indexedSchema);
    expect(output).toMatch(/tenant_id VARCHAR\(255\) NOT NULL/);
    expect(output).toContain('CREATE INDEX idx_products_tenant_id ON products(tenant_id);');
  });

  it('does not inject a tenant_id column for admin schemas', () => {
    const output = generateSQLTable(adminSchema);
    expect(output).not.toContain('tenant_id');
  });

  it('respects a custom tenantColumn option', () => {
    const output = generateSQLTable(indexedSchema, { tenantColumn: 'account_id' });
    expect(output).toContain('account_id VARCHAR(255) NOT NULL');
    expect(output).not.toContain('tenant_id');
  });

  it('uses CREATE TABLE IF NOT EXISTS for idempotent re-apply (CREATE INDEX has no such clause in MySQL)', () => {
    const output = generateSQLTable(indexedSchema);
    expect(output).toMatch(/^CREATE TABLE IF NOT EXISTS products \(/);
    expect(output).not.toContain('CREATE INDEX IF NOT EXISTS');
  });

  it('parenthesizes DEFAULT for json() columns — MySQL 8.0.13+ rejects a bare literal DEFAULT on JSON/BLOB/TEXT columns', () => {
    // A parenthesized literal default is also valid, equivalent syntax on Postgres, so this is
    // safe unconditionally. Found via real-MySQL integration testing (Phase 16.2) — see FAQ.md #13.
    const output = generateSQLTable(jsonDefaultSchema);
    expect(output).toContain("DEFAULT ('[]')");
  });
});

describe('generatePrismaModel() — Phase 16.5 fidelity', () => {
  it('emits @@index([col]) for index() columns', () => {
    const output = generatePrismaModel(indexedSchema);
    expect(output).toContain('@@index([category])');
  });

  it('emits a real enum block + typed field for string enum() columns', () => {
    const output = generatePrismaModel(indexedSchema);
    expect(output).toContain('enum ProductsStatusEnum {');
    expect(output).toContain('active');
    expect(output).toMatch(/status\s+ProductsStatusEnum/);
  });

  it('falls back to a doc-comment for non-string enum() values instead of a broken enum block', () => {
    const output = generatePrismaModel(numericEnumSchema);
    expect(output).not.toMatch(/^enum /m);
    expect(output).toContain('/// Allowed values: 1 | 2 | 3');
  });

  it('injects a tenant_id String field and index for non-admin schemas', () => {
    const output = generatePrismaModel(indexedSchema);
    expect(output).toMatch(/tenant_id\s+String/);
    expect(output).toContain('@@index([tenant_id])');
  });

  it('does not inject a tenant_id field for admin schemas', () => {
    const output = generatePrismaModel(adminSchema);
    expect(output).not.toContain('tenant_id');
  });

  it('emits a composite @@unique([tenant_id, col]) for unique() columns on a tenant-scoped table, not a bare field @unique', () => {
    // A bare field-level @unique would enforce uniqueness globally across every tenant at the
    // Prisma/DB level, but PrismaTableOperations.checkUniqueness() checks per-tenant — see
    // generateSQLTable()'s matching fix and FAQ.md #13. Found via real `prisma db push` plus a
    // cross-tenant duplicate-value integration test (Phase 16.2/16.4).
    const output = generatePrismaModel(indexedSchema);
    expect(output).not.toMatch(/sku\s+String.*@unique/);
    expect(output).toContain('@@unique([tenant_id, sku])');
  });

  it('emits a bare field-level @unique for unique() columns on an admin (non-tenant-scoped) table', () => {
    const adminUniqueSchema = defineTable({
      name: 'admins',
      actor: 'admin',
      columns: { admin_id: string().primary(), email: string().required().unique() },
    });
    const output = generatePrismaModel(adminUniqueSchema);
    expect(output).toMatch(/email\s+String.*@unique/);
    expect(output).not.toContain('@@unique(');
  });
});
