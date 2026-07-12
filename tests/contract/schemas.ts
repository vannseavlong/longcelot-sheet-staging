import { defineTable } from '../../src/schema/defineTable';
import { string, number } from '../../src/schema/columnBuilder';
import { ActorPermission } from '../../src/schema/types';

// Shared schema fixtures for the Phase 16.4 cross-adapter contract suite (tests/contract/
// runContractSuite.ts) — exercised identically against SheetAdapter (MockSheetClient) and the
// SQL adapters (real Postgres/MySQL) so behavioral parity is enforced by running the same test
// bodies, not by manual comparison.

export const productsSchema = defineTable({
  name: 'products',
  actor: 'seller',
  timestamps: true,
  softDelete: true,
  columns: {
    product_id: string().primary(),
    sku: string().required().unique(),
    price: number().required(),
    status: string().default('active'),
  },
});

export const reviewsSchema = defineTable({
  name: 'reviews',
  actor: 'seller',
  columns: {
    review_id: string().primary(),
    product_id: string().required().ref('products.product_id'),
    score: number().required(),
  },
});

export const notesSchema = defineTable({
  name: 'notes',
  actor: 'manager',
  columns: {
    note_id: string().primary(),
    text: string().required(),
  },
});

export const settingsSchema = defineTable({
  name: 'settings',
  actor: 'admin',
  columns: {
    setting_key: string().primary(),
    setting_value: string(),
  },
});

export const contractSchemas = [productsSchema, reviewsSchema, notesSchema, settingsSchema];

/** seller -> manager cross-actor access, scoped to the 'notes' table only — mirrors the
 *  teacher -> student fixture in tests/unit/crossActorPermissions.test.ts. */
export const contractPermissions: Record<string, ActorPermission> = {
  seller: { canAccess: ['manager'], tables: ['notes'] },
};
