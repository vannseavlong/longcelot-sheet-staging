import { nanoid } from 'nanoid';
import { SheetAdapter, SheetAdapterConfig } from '../../src/adapter/sheetAdapter';
import { MockSheetClient } from '../../test/fixtures/mockSheetClient';
import { runContractSuite, ContractSuiteFactory } from './runContractSuite';
import { contractSchemas, contractPermissions } from './schemas';

const baseConfig: Omit<SheetAdapterConfig, '_client'> = {
  adminSheetId: 'admin-sheet-id',
  credentials: { clientId: 'x', clientSecret: 'y', redirectUri: 'z' },
  tokens: {},
  permissions: contractPermissions,
};

const factory: ContractSuiteFactory = {
  createAdapter() {
    const client = new MockSheetClient();
    const adapter = new SheetAdapter({ ...baseConfig, _client: client } as unknown as SheetAdapterConfig);
    adapter.registerSchemas(contractSchemas);
    return adapter;
  },
  uniqueId() {
    return nanoid(8);
  },
};

runContractSuite('SheetAdapter (MockSheetClient)', factory);
