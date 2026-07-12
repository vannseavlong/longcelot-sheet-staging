import { SheetAdapter } from '../../src/adapter/sheetAdapter';
import { SheetClient } from '../../src/adapter/sheetClient';
import type { DatabaseAdapter, StorageClient } from '../../src/adapter/types';

/**
 * Compile-time-only assertions (Phase 16.1) — never invoked. Their sole purpose is to make
 * the TypeScript checker fail this file (and thus `pnpm test`) if SheetAdapter/SheetClient
 * ever stop structurally satisfying the DatabaseAdapter/StorageClient contracts, so a future
 * SQL adapter can rely on those contracts staying accurate without manual review.
 */
function _typeContractCheck(adapter: SheetAdapter, client: SheetClient): void {
  const asDatabaseAdapter: DatabaseAdapter = adapter;
  const asStorageClient: StorageClient = client;
  void asDatabaseAdapter;
  void asStorageClient;
}

describe('Phase 16.1 — DatabaseAdapter / StorageClient contracts', () => {
  it('is enforced at compile time (see _typeContractCheck above)', () => {
    expect(typeof _typeContractCheck).toBe('function');
  });
});
