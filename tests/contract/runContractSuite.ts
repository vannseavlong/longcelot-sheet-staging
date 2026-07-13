import type { DatabaseAdapter } from '../../src/adapter/types';
import { ValidationError } from '../../src/errors/ValidationError';
import { PermissionError } from '../../src/errors/PermissionError';
import { productsSchema } from './schemas';

export interface ContractSuiteFactory {
  /** Returns a fresh adapter instance with tests/contract/schemas.ts's contractSchemas already registered. */
  createAdapter(): DatabaseAdapter;
  /**
   * Generates a fresh unique string per call, used as a tenant/sheet id and as a data-uniqueness
   * suffix, so tests never collide with each other or with leftover rows from a previous run
   * against a real database with no per-test cleanup.
   */
  uniqueId(): string;
}

/**
 * One behavioral spec, run once per adapter implementation (Phase 16.4) — CRUD, upsert,
 * createMany, count, soft-delete, timestamps, uniqueness, FK validation, and the cross-actor
 * permission matrix, mirroring tests/unit/crossActorPermissions.test.ts's case list. Invoked by
 * tests/contract/sheetAdapter.contract.test.ts (always runs, MockSheetClient-backed) and
 * test/integration/sql/postgres.contract.test.ts (opt-in, real Postgres-backed) so the same test
 * bodies enforce parity instead of a hand comparison — see TODO.md Phase 16.4.
 */
export function runContractSuite(label: string, factory: ContractSuiteFactory): void {
  describe(`DatabaseAdapter contract — ${label}`, () => {
    // IMPORTANT: every test that needs more than one tenant/actor view must derive them all
    // from a single `factory.createAdapter()` call — each call spins up an independent backing
    // store (a fresh MockSheetClient, a fresh connection, etc.), so two separate
    // createAdapter() calls never see each other's data. That's not tenant isolation, it's two
    // unrelated databases, and makes any cross-tenant assertion pass vacuously.
    function sellerContext(adapter: DatabaseAdapter, tenantId: string) {
      return adapter.withContext({ userId: `seller-${tenantId}`, actor: 'seller', actorSheetId: tenantId });
    }

    it('create() auto-generates _id, applies default() and timestamps', async () => {
      const id = factory.uniqueId();
      const ctx = sellerContext(factory.createAdapter(), id);
      const created = await ctx.table('products').create({ sku: `SKU-${id}`, price: 10 });

      expect(typeof created._id).toBe('string');
      expect((created._id as string).length).toBeGreaterThan(0);
      expect(created.status).toBe('active');
      expect(created._created_at).toBeTruthy();
      expect(created._updated_at).toBeTruthy();
    });

    it('create() preserves a caller-supplied _created_at/_updated_at instead of always stamping "now" — incident: F2 migrate-data cutover', async () => {
      // lsdb migrate-data creates each row with the exact _created_at/_updated_at it read from
      // the Sheets source, to keep migrated data's original history intact. create() previously
      // stamped both to `now()` unconditionally, silently discarding the real creation date of
      // every freshly-migrated row.
      const id = factory.uniqueId();
      const ctx = sellerContext(factory.createAdapter(), id);
      const originalCreatedAt = '2020-01-01T00:00:00.000Z';

      const created = await ctx.table('products').create({
        sku: `TS-${id}`,
        price: 10,
        _created_at: originalCreatedAt,
        _updated_at: originalCreatedAt,
      });

      expect(created._created_at).toBe(originalCreatedAt);
      expect(created._updated_at).toBe(originalCreatedAt);
    });

    it('findOne()/findMany() read back created rows, scoped to the creating tenant', async () => {
      const adapter = factory.createAdapter();
      const idA = factory.uniqueId();
      const idB = factory.uniqueId();
      const ctx = sellerContext(adapter, idA);
      const created = await ctx.table('products').create({ sku: `SKU-${idA}`, price: 5 });

      const found = await ctx.table('products').findOne({ where: { _id: created._id as string } });
      expect(found?.sku).toBe(`SKU-${idA}`);

      const otherTenant = sellerContext(adapter, idB);
      const notFound = await otherTenant.table('products').findOne({ where: { sku: `SKU-${idA}` } });
      expect(notFound).toBeNull();
    });

    it('update() applies a partial patch and default() is not reapplied on update', async () => {
      const id = factory.uniqueId();
      const ctx = sellerContext(factory.createAdapter(), id);
      const created = await ctx.table('products').create({ sku: `SKU-${id}`, price: 5, status: 'custom' });

      const count = await ctx.table('products').update({ where: { _id: created._id as string }, data: { price: 20 } });
      expect(count).toBe(1);

      const updated = await ctx.table('products').findOne({ where: { _id: created._id as string } });
      expect(updated?.price).toBe(20);
      // status was explicitly 'custom' at create time and omitted from the update patch — a
      // defaulted column omitted from update() must be left alone, not reset to default() (11.2).
      expect(updated?.status).toBe('custom');
    });

    it('update() silently strips the pkColumn (readonly)', async () => {
      const id = factory.uniqueId();
      const ctx = sellerContext(factory.createAdapter(), id);
      const created = await ctx.table('products').create({ sku: `SKU-${id}`, price: 5 });

      await ctx.table('products').update({
        where: { _id: created._id as string },
        data: { product_id: 'should-not-apply' },
      });
      const updated = await ctx.table('products').findOne({ where: { _id: created._id as string } });
      expect(updated?.product_id).not.toBe('should-not-apply');
    });

    it('createMany() batches inserts and returns every created record', async () => {
      const id = factory.uniqueId();
      const ctx = sellerContext(factory.createAdapter(), id);
      const created = await ctx.table('products').createMany([
        { sku: `BULK-${id}-1`, price: 1 },
        { sku: `BULK-${id}-2`, price: 2 },
      ]);
      expect(created).toHaveLength(2);
      expect(created.map((r) => r.sku).sort()).toEqual([`BULK-${id}-1`, `BULK-${id}-2`]);
    });

    it('count() reflects a where filter scoped to the tenant', async () => {
      const id = factory.uniqueId();
      const ctx = sellerContext(factory.createAdapter(), id);
      await ctx.table('products').createMany([
        { sku: `CNT-${id}-1`, price: 1, status: 'countme' },
        { sku: `CNT-${id}-2`, price: 2, status: 'countme' },
        { sku: `CNT-${id}-3`, price: 3, status: 'other' },
      ]);
      const count = await ctx.table('products').count({ where: { status: 'countme' } });
      expect(count).toBe(2);
    });

    it('create() silently drops a stray key that is not a declared column, instead of erroring — incident: F2 migrate-data cutover', async () => {
      // migrate-data upserts the exact row it reads back from Sheets — and a real Sheet tab can
      // carry a leftover/legacy column that predates the current schema (found live: a
      // `categories` row with a stray column not in categories.ts at all). The SQL/Prisma
      // adapters used to build the column list straight from the payload's own keys with no
      // schema awareness, so a stray key reached the database as a literal column reference and
      // failed with a native "column ... does not exist" (or Prisma's "Unknown argument").
      const id = factory.uniqueId();
      const ctx = sellerContext(factory.createAdapter(), id);

      const created = await ctx.table('products').create({
        sku: `STRAY-${id}`,
        price: 1,
        this_column_does_not_exist_anywhere: 'leftover sheet data',
      } as Record<string, unknown>);

      expect(created.price).toBe(1);
      const found = await ctx.table('products').findOne({ where: { sku: `STRAY-${id}` } });
      expect(found?.price).toBe(1);
    });

    it('upsert() creates when no row matches, then updates on the next call', async () => {
      const id = factory.uniqueId();
      const ctx = sellerContext(factory.createAdapter(), id);

      const created = await ctx.table('products').upsert({ where: { sku: `UPS-${id}` }, data: { price: 1 } });
      expect(created.price).toBe(1);

      const updated = await ctx.table('products').upsert({ where: { sku: `UPS-${id}` }, data: { price: 99 } });
      expect(updated.price).toBe(99);

      const count = await ctx.table('products').count({ where: { sku: `UPS-${id}` } });
      expect(count).toBe(1);
    });

    it('upsert() on an existing row tolerates a full row payload (readonly _id/_created_at/_updated_at included) instead of throwing — incident: F2 migrate-data cutover', async () => {
      // lsdb migrate-data upserts the exact row it read back from Sheets — `_id`/`_created_at`/
      // `_updated_at` included — so a rerun against an already-migrated row hit upsert()'s
      // existing-row branch, which forwarded the full payload straight to update(). update()
      // correctly rejects readonly columns in its payload, so this threw `Column _created_at is
      // readonly` on every idempotent rerun instead of just refreshing the non-readonly fields.
      const id = factory.uniqueId();
      const ctx = sellerContext(factory.createAdapter(), id);

      const created = await ctx.table('products').upsert({ where: { sku: `RO-${id}` }, data: { price: 1 } });

      await expect(
        ctx.table('products').upsert({ where: { sku: `RO-${id}` }, data: { ...created, price: 2 } })
      ).resolves.not.toThrow();

      const refetched = await ctx.table('products').findOne({ where: { sku: `RO-${id}` } });
      expect(refetched?.price).toBe(2);
      expect(refetched?._id).toBe(created._id);
      expect(refetched?._created_at).toBe(created._created_at);
    });

    it('upsert() against an already soft-deleted row updates it instead of throwing a duplicate-key error — incident: F2 migrate-data cutover', async () => {
      // migrate-data re-reads a soft-deleted row (via includeDeleted: true, itself a fix for a
      // separate incident) and upserts it every rerun, same as any other row. upsert()'s own
      // existence check (findOne()) didn't pass includeDeleted, so it couldn't see an
      // already-soft-deleted target row, concluded the row didn't exist yet, and took the
      // create() branch — which then failed with a native unique-constraint violation, since the
      // row was very much still there, just hidden by the default soft-delete filter.
      const id = factory.uniqueId();
      const ctx = sellerContext(factory.createAdapter(), id);

      const created = await ctx.table('products').create({ sku: `SD-${id}`, price: 1 });
      await ctx.table('products').delete({ where: { _id: created._id as string } });

      await expect(
        ctx.table('products').upsert({ where: { _id: created._id as string }, data: { ...created, price: 2 } })
      ).resolves.not.toThrow();

      const stillDeleted = await ctx.table('products').findOne({
        where: { _id: created._id as string },
        includeDeleted: true,
      });
      expect(stillDeleted?._id).toBe(created._id);
      expect(stillDeleted?.price).toBe(2);
      expect(stillDeleted?._deleted_at).toBeTruthy();
    });

    it('unique() throws ValidationError on a duplicate value within the same tenant', async () => {
      const id = factory.uniqueId();
      const ctx = sellerContext(factory.createAdapter(), id);
      await ctx.table('products').create({ sku: `DUP-${id}`, price: 1 });

      await expect(ctx.table('products').create({ sku: `DUP-${id}`, price: 2 })).rejects.toThrow(ValidationError);
    });

    it('unique() does not collide across different tenants', async () => {
      const adapter = factory.createAdapter();
      const idA = factory.uniqueId();
      const idB = factory.uniqueId();
      const skuA = `CROSS-${idA}`;
      await sellerContext(adapter, idA).table('products').create({ sku: skuA, price: 1 });

      await expect(sellerContext(adapter, idB).table('products').create({ sku: skuA, price: 2 })).resolves.toBeTruthy();
    });

    it('ref() FK validation passes for a same-tenant reference and fails for a cross-tenant one', async () => {
      const adapter = factory.createAdapter();
      const idA = factory.uniqueId();
      const idB = factory.uniqueId();
      const product = await sellerContext(adapter, idA).table('products').create({ sku: `FK-${idA}`, price: 1 });

      const review = await sellerContext(adapter, idA)
        .table('reviews')
        .create({ product_id: product.product_id as string, score: 5 });
      expect(review.score).toBe(5);

      await expect(
        sellerContext(adapter, idB).table('reviews').create({ product_id: product.product_id as string, score: 1 })
      ).rejects.toThrow(ValidationError);
    });

    // `skipFKValidation` is deliberately NOT a universal cross-adapter guarantee: it skips the
    // app-level pre-check (validateForeignKeys) on every adapter, but on a SQL adapter the
    // database's own FOREIGN KEY constraint (Phase 16.5) still enforces referential integrity
    // underneath — a documented strengthening over Sheets, not a bug (see FAQ.md #13). Sheets'
    // actual bypass behavior is covered in test/integration/fk.test.ts.
    it('skipFKValidation skips the app-level pre-check (a valid same-tenant reference still succeeds)', async () => {
      const adapter = factory.createAdapter();
      const id = factory.uniqueId();
      const product = await sellerContext(adapter, id).table('products').create({ sku: `SKIP-${id}`, price: 1 });
      const review = await sellerContext(adapter, id)
        .table('reviews')
        .create({ product_id: product.product_id as string, score: 3 }, { skipFKValidation: true });
      expect(review.score).toBe(3);
    });

    it('soft-delete excludes the row from findOne()/count() by default and includes it with includeDeleted', async () => {
      const id = factory.uniqueId();
      const ctx = sellerContext(factory.createAdapter(), id);
      const created = await ctx.table('products').create({ sku: `DEL-${id}`, price: 1 });

      const deletedCount = await ctx.table('products').delete({ where: { _id: created._id as string } });
      expect(deletedCount).toBe(1);

      const gone = await ctx.table('products').findOne({ where: { _id: created._id as string } });
      expect(gone).toBeNull();

      const stillThere = await ctx
        .table('products')
        .findOne({ where: { _id: created._id as string }, includeDeleted: true });
      expect(stillThere).not.toBeNull();
    });

    // ── Cross-actor permission matrix (mirrors crossActorPermissions.test.ts) ────────────────

    it('same-actor access is allowed without a permission matrix entry', () => {
      const ctx = sellerContext(factory.createAdapter(), factory.uniqueId());
      expect(() => ctx.table('products')).not.toThrow();
    });

    it('admin bypasses the permission matrix entirely', async () => {
      const adapter = factory.createAdapter();
      const ctx = adapter.withContext({ userId: 'admin-1', actor: 'admin', actorSheetId: 'admin' });
      await expect(
        ctx.table('settings').create({ setting_key: `k-${factory.uniqueId()}`, setting_value: 'v' })
      ).resolves.toBeTruthy();
    });

    it('non-admin cannot access admin tables', () => {
      const ctx = sellerContext(factory.createAdapter(), factory.uniqueId());
      expect(() => ctx.table('settings')).toThrow(PermissionError);
    });

    it('cross-actor access with a matching permission entry and target table succeeds', async () => {
      const id = factory.uniqueId();
      const adapter = factory.createAdapter();
      const managerCtx = adapter.withContext({ userId: 'mgr-1', actor: 'manager', actorSheetId: `mgr-${id}` });
      await managerCtx.table('notes').create({ note_id: `n-${id}`, text: 'hello' });

      const sellerCtx = sellerContext(adapter, `sel-${id}`).asActor('manager', `mgr-${id}`);
      const notes = await sellerCtx.table('notes').findMany();
      expect(notes.length).toBeGreaterThan(0);
    });

    it('cross-actor access to a table outside the permission matrix throws PermissionError', () => {
      const id = factory.uniqueId();
      const adapter = factory.createAdapter();
      const sellerCtx = sellerContext(adapter, `sel-${id}`).asActor('admin', 'admin');
      expect(() => sellerCtx.table('settings')).toThrow(PermissionError);
    });

    it('cross-actor access without any permission matrix configured throws PermissionError', () => {
      // productsSchema.actor is 'seller' with no configured cross-actor permissions targeting it.
      const id = factory.uniqueId();
      const adapter = factory.createAdapter();
      const managerCtx = adapter
        .withContext({ userId: 'mgr-1', actor: 'manager', actorSheetId: `mgr-${id}` })
        .asActor('seller', `sel-${id}`);
      expect(() => managerCtx.table(productsSchema.name)).toThrow(PermissionError);
    });
  });
}
