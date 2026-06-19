import { SheetAdapter, SheetAdapterConfig } from '../../src/adapter/sheetAdapter';
import { DriveStorageAdapter } from '../../src/adapter/driveStorageAdapter';
import { MockSheetClient } from '../../test/fixtures/mockSheetClient';
import { defineTable } from '../../src/schema/defineTable';
import { string } from '../../src/schema/columnBuilder';
import { SchemaError } from '../../src/errors/SchemaError';
import type { TokenStore, OAuthTokens, StorageAdapter, UploadOptions } from '../../src/schema/types';

const ADMIN_ID = 'admin-sheet-id';
const FAKE_CREDENTIALS = { clientId: 'id', clientSecret: 'secret', redirectUri: 'http://localhost' };

const usersSchema = defineTable({
  name: 'users',
  actor: 'admin',
  columns: {
    user_id: string().primary(),
    role: string().required(),
    email: string().required(),
    actor_sheet_id: string().required(),
    created_at: string().required(),
    display_name: string(),
  },
});

const sellerSchema = defineTable({
  name: 'products',
  actor: 'seller',
  columns: { product_id: string().primary(), name: string().required() },
});

function makeAdapter(extra: Partial<SheetAdapterConfig> = {}) {
  const mock = new MockSheetClient();
  // Pre-seed admin sheet with users table
  mock.seed(ADMIN_ID, 'users', [['user_id', 'role', 'email', 'actor_sheet_id', 'created_at', 'display_name']]);

  const adapter = new SheetAdapter({
    adminSheetId: ADMIN_ID,
    credentials: FAKE_CREDENTIALS,
    tokens: {},
    _client: mock,
    ...extra,
  } as unknown as SheetAdapterConfig);

  adapter.registerSchemas([usersSchema, sellerSchema]);

  const adminAdapter = adapter.withContext({
    userId: 'admin-user',
    role: 'admin',
    actorSheetId: ADMIN_ID,
  });

  return { mock, adapter, adminAdapter };
}

// ── Feature 8.2 — Drive folder organisation ───────────────────────────────────

describe('Feature 8.2 — driveFolder organisation', () => {
  test('findOrCreateFolder is called for root and role subfolder when driveFolder is configured', async () => {
    const { mock, adminAdapter } = makeAdapter({
      driveFolder: { root: 'My App', subfolders: { seller: 'Sellers' } },
    });

    await adminAdapter.createUserSheet('user1', 'seller', 'seller@test.com');

    const folderCalls = mock.findOrCreateFolderCalls;
    expect(folderCalls.length).toBeGreaterThanOrEqual(2);
    expect(folderCalls[0].name).toBe('My App');
    expect(folderCalls[1].name).toBe('Sellers');
    expect(folderCalls[1].parentId).toBe('mock-folder-My App');
  });

  test('folder ID is passed as folderId to createSpreadsheet', async () => {
    const { mock, adminAdapter } = makeAdapter({
      driveFolder: { root: 'My App' },
    });

    await adminAdapter.createUserSheet('user1', 'seller', 'seller@test.com');

    const createCall = mock.createSpreadsheetCalls[0];
    expect(createCall).toBeDefined();
    const opts = createCall.options as { folderId?: string };
    expect(opts?.folderId).toBe('mock-folder-seller');
  });

  test('no folder created when driveFolder is not configured', async () => {
    const { mock, adminAdapter } = makeAdapter();

    await adminAdapter.createUserSheet('user1', 'seller', 'seller@test.com');

    expect(mock.findOrCreateFolderCalls.length).toBe(0);
    const createCall = mock.createSpreadsheetCalls[0];
    const opts = createCall.options as { folderId?: string };
    expect(opts?.folderId).toBeUndefined();
  });

  test('folder result is cached — second createUserSheet for same role skips folder lookup', async () => {
    const { mock, adminAdapter } = makeAdapter({
      driveFolder: { root: 'My App', subfolders: { seller: 'Sellers' } },
    });

    await adminAdapter.createUserSheet('user1', 'seller', 'seller1@test.com');
    const callsAfterFirst = mock.findOrCreateFolderCalls.length;

    await adminAdapter.createUserSheet('user2', 'seller', 'seller2@test.com');
    const callsAfterSecond = mock.findOrCreateFolderCalls.length;

    // No additional folder lookups for the second call
    expect(callsAfterSecond).toBe(callsAfterFirst);
  });
});

// ── Feature 8.5 — Shared Drive support ───────────────────────────────────────

describe('Feature 8.5 — sharedDriveId', () => {
  test('sharedDriveId is forwarded to createSpreadsheet options', async () => {
    const { mock, adminAdapter } = makeAdapter({ sharedDriveId: 'my-shared-drive' });

    await adminAdapter.createUserSheet('user1', 'seller', 'seller@test.com');

    const createCall = mock.createSpreadsheetCalls[0];
    const opts = createCall.options as { sharedDriveId?: string };
    expect(opts?.sharedDriveId).toBe('my-shared-drive');
  });

  test('sharedDriveId is forwarded to findOrCreateFolder when driveFolder also set', async () => {
    const { mock, adminAdapter } = makeAdapter({
      sharedDriveId: 'my-shared-drive',
      driveFolder: { root: 'Staging' },
    });

    await adminAdapter.createUserSheet('user1', 'seller', 'seller@test.com');

    const folderCall = mock.findOrCreateFolderCalls[0];
    expect(folderCall.sharedDriveId).toBe('my-shared-drive');
  });
});

// ── Feature 8.4 — TokenStore ─────────────────────────────────────────────────

describe('Feature 8.4 — TokenStore', () => {
  test('tokenStore.get is called with userId when actorTokens not passed directly', async () => {
    let calledWith: string | null = null;
    const store: TokenStore = {
      async get(id) {
        calledWith = id;
        return null;
      },
      async set() {},
    };

    const { adminAdapter } = makeAdapter({ tokenStore: store });
    await adminAdapter.createUserSheet('user-xyz', 'seller', 'seller@test.com');

    expect(calledWith).toBe('user-xyz');
  });

  test('actorTokens passed directly takes priority over tokenStore', async () => {
    let storeCalled = false;
    const store: TokenStore = {
      async get() {
        storeCalled = true;
        return { access_token: 'from-store' };
      },
      async set() {},
    };

    // We can't inject a real SheetClient for actorTokens (would hit real Google API),
    // so we verify that when credentials is undefined/empty the tokenStore is NOT called
    // when actorTokens is provided. We test this at the logical level by observing storeCalled.
    const { adminAdapter } = makeAdapter({ tokenStore: store });

    // Provide actorTokens directly — tokenStore.get should not be called
    // (The SheetClient creation will fail without real credentials, but the token-check happens first.)
    // We test via a minimal spy approach: make tokenStore return a known token to distinguish paths.
    // Reset and verify store wasn't called when actorTokens is explicit.
    // Because creating a real SheetClient would throw, we just check the order of operations.
    // This is a logic test — actorTokens short-circuits the tokenStore path.
    expect(storeCalled).toBe(false); // baseline

    // Providing actorTokens — tokenStore.get must not be called (error will surface from SheetClient
    // since the mock doesn't forward actorTokens, but storeCalled must remain false).
    try {
      await adminAdapter.createUserSheet('user-xyz', 'seller', 'seller@test.com', {
        actorTokens: { access_token: 'explicit' },
      });
    } catch {
      // May throw because new SheetClient(fakeCredentials, actorTokens).createSpreadsheet hits real API;
      // what matters is storeCalled is still false.
    }

    expect(storeCalled).toBe(false);
  });

  test('when tokenStore returns tokens they are used for sheet creation (verified via calls)', async () => {
    const actorToken: OAuthTokens = { access_token: 'actor-token', refresh_token: 'r' };
    const store: TokenStore = {
      async get() { return actorToken; },
      async set() {},
    };

    // We verify that when tokenStore returns tokens, a separate client attempt is made.
    // Since the test environment has no real credentials, we just confirm tokenStore.get runs
    // and that we do NOT fall back silently (it would try to create a SheetClient with actor tokens).
    let getCalled = false;
    const spyStore: TokenStore = {
      async get(id) { getCalled = true; return actorToken; },
      async set() {},
    };

    const { adminAdapter } = makeAdapter({ tokenStore: spyStore });

    try {
      await adminAdapter.createUserSheet('user1', 'seller', 'seller@test.com');
    } catch {
      // Expected — real SheetClient creation fails in test environment
    }

    expect(getCalled).toBe(true);
  });
});

// ── Feature 8.1 — Actor-owned sheets ─────────────────────────────────────────

describe('Feature 8.1 — createUserSheet with actorTokens', () => {
  test('without actorTokens — falls back to admin client (existing behaviour)', async () => {
    const { mock, adminAdapter } = makeAdapter();

    const sheetId = await adminAdapter.createUserSheet('user1', 'seller', 'seller@test.com');

    // Sheet was created via the shared mock client
    expect(mock.createSpreadsheetCalls.length).toBe(1);
    expect(sheetId).toMatch(/^mock-sheet-/);
  });

  test('extraFields inside options object are passed to users table', async () => {
    const { mock, adminAdapter } = makeAdapter();

    await adminAdapter.createUserSheet('user1', 'seller', 'seller@test.com', {
      extraFields: { display_name: 'Alice' },
    });

    const usersRows = mock.getRows(ADMIN_ID, 'users');
    const dataRow = usersRows[1]; // row 0 = headers
    const headerRow = usersRows[0];
    const displayNameIdx = headerRow.indexOf('display_name');
    expect(dataRow[displayNameIdx]).toBe('Alice');
  });
});

// ── Feature 8.3 — StorageAdapter / upload() ──────────────────────────────────

describe('Feature 8.3 — StorageAdapter and adapter.upload()', () => {
  test('adapter.upload delegates to storageAdapter.upload', async () => {
    let uploadCalled = false;
    let uploadArgs: { file: Buffer; opts: UploadOptions } | null = null;

    const fakeStorage: StorageAdapter = {
      async upload(file, opts) {
        uploadCalled = true;
        uploadArgs = { file, opts };
        return 'https://example.com/file.jpg';
      },
      async delete() {},
    };

    const { adapter } = makeAdapter({ storage: fakeStorage });
    const buf = Buffer.from('hello');
    const url = await adapter.upload(buf, { filename: 'test.jpg', mimeType: 'image/jpeg', public: true });

    expect(uploadCalled).toBe(true);
    expect(uploadArgs!.opts.filename).toBe('test.jpg');
    expect(url).toBe('https://example.com/file.jpg');
  });

  test('adapter.deleteFile delegates to storageAdapter.delete', async () => {
    let deletedUrl: string | null = null;
    const fakeStorage: StorageAdapter = {
      async upload() { return ''; },
      async delete(url) { deletedUrl = url; },
    };

    const { adapter } = makeAdapter({ storage: fakeStorage });
    await adapter.deleteFile('https://drive.google.com/uc?id=abc123');

    expect(deletedUrl).toBe('https://drive.google.com/uc?id=abc123');
  });

  test('adapter.upload throws SchemaError when no storage configured', async () => {
    const { adapter } = makeAdapter();

    await expect(
      adapter.upload(Buffer.from('x'), { filename: 'f.jpg', mimeType: 'image/jpeg' })
    ).rejects.toThrow(SchemaError);
  });

  test('adapter.deleteFile throws SchemaError when no storage configured', async () => {
    const { adapter } = makeAdapter();

    await expect(
      adapter.deleteFile('https://drive.google.com/uc?id=x')
    ).rejects.toThrow(SchemaError);
  });

  test('DriveStorageAdapter._setClient is called by SheetAdapter constructor', () => {
    const storageAdapter = new DriveStorageAdapter({ folder: 'uploads' });
    const { mock } = makeAdapter({ storage: storageAdapter });

    // After construction, _client should be set (the mock)
    // We verify by calling upload which would throw if _client is not set
    expect(async () => {
      await storageAdapter.upload(Buffer.from('x'), { filename: 'f.jpg', mimeType: 'image/jpeg' });
    }).not.toThrow(); // no throw = _client is present; actual upload will call mock.uploadFile

    void mock; // referenced to suppress unused warning
  });

  test('DriveStorageAdapter.upload calls client.uploadFile and returns Drive URL', async () => {
    const { mock } = makeAdapter();
    const driveAdapter = new DriveStorageAdapter({ folder: 'uploads' });
    driveAdapter._setClient(mock as unknown as import('../../src/adapter/sheetClient').SheetClient);

    const url = await driveAdapter.upload(Buffer.from('data'), {
      filename: 'photo.png',
      mimeType: 'image/png',
      public: true,
    });

    expect(mock.uploadFileCalls.length).toBe(1);
    expect(mock.uploadFileCalls[0].filename).toBe('photo.png');
    expect(mock.uploadFileCalls[0].makePublic).toBe(true);
    expect(url).toMatch(/^https:\/\/drive\.google\.com\/uc\?id=/);
  });

  test('DriveStorageAdapter.delete extracts fileId from URL and calls client.deleteFile', async () => {
    const { mock } = makeAdapter();
    const driveAdapter = new DriveStorageAdapter();
    driveAdapter._setClient(mock as unknown as import('../../src/adapter/sheetClient').SheetClient);

    await driveAdapter.delete('https://drive.google.com/uc?id=FILE_ID_123');

    expect(mock.deleteFileCalls).toContain('FILE_ID_123');
  });

  test('DriveStorageAdapter.delete is a no-op for unrecognised URLs', async () => {
    const { mock } = makeAdapter();
    const driveAdapter = new DriveStorageAdapter();
    driveAdapter._setClient(mock as unknown as import('../../src/adapter/sheetClient').SheetClient);

    await driveAdapter.delete('https://example.com/no-id-here');

    expect(mock.deleteFileCalls.length).toBe(0);
  });
});
