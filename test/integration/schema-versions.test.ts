import { SheetAdapter, SheetAdapterConfig } from '../../src/adapter/sheetAdapter';
import { defineTable } from '../../src/schema/defineTable';
import { string, number } from '../../src/schema/columnBuilder';
import { MockSheetClient } from '../fixtures/mockSheetClient';
import { computeSchemaHash } from '../../src/utils/schemaHash';
import { SchemaMismatchError } from '../../src/errors/SchemaMismatchError';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const ADMIN_SHEET = 'admin-sheet-id';
const USER_SHEET  = 'user-sheet-id';

const courseSchema = defineTable({
  name: 'courses',
  actor: 'student',
  columns: {
    title: string().required(),
    credits: number(),
  },
});

const courseSchemaV2 = defineTable({
  name: 'courses',
  actor: 'student',
  columns: {
    title: string().required(),
    credits: number(),
    instructor: string(),   // new column → different hash
  },
});

function makeAdapter(
  client: MockSheetClient,
  onSchemaMismatch?: SheetAdapterConfig['onSchemaMismatch']
): SheetAdapter {
  return new SheetAdapter({
    adminSheetId: ADMIN_SHEET,
    credentials: { clientId: '', clientSecret: '', redirectUri: '' },
    tokens: {},
    onSchemaMismatch,
    _client: client,
  } as unknown as SheetAdapterConfig);
}

// ── computeSchemaHash ─────────────────────────────────────────────────────────

describe('computeSchemaHash()', () => {
  it('returns a deterministic 64-char hex string', () => {
    const hash = computeSchemaHash(courseSchema);
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]+$/);
    expect(computeSchemaHash(courseSchema)).toBe(hash);
  });

  it('changes when a column is added', () => {
    const h1 = computeSchemaHash(courseSchema);
    const h2 = computeSchemaHash(courseSchemaV2);
    expect(h1).not.toBe(h2);
  });

  it('is the same regardless of column definition order in source', () => {
    const a = defineTable({ name: 'x', actor: 'y', columns: { b: string(), a: number() } });
    const b = defineTable({ name: 'x', actor: 'y', columns: { a: number(), b: string() } });
    expect(computeSchemaHash(a)).toBe(computeSchemaHash(b));
  });
});

// ── SchemaMismatchError ───────────────────────────────────────────────────────

describe('SchemaMismatchError', () => {
  it('has the correct name and message', () => {
    const err = new SchemaMismatchError('courses', USER_SHEET);
    expect(err.name).toBe('SchemaMismatchError');
    expect(err.tableName).toBe('courses');
    expect(err.actorSheetId).toBe(USER_SHEET);
    expect(err.message).toContain('courses');
    expect(err.message).toContain(USER_SHEET);
  });

  it('is an instance of Error', () => {
    expect(new SchemaMismatchError('t', 's')).toBeInstanceOf(Error);
  });
});

// ── upsertSchemaVersion / getSchemaVersion ────────────────────────────────────

describe('SchemaAdapter schema version tracking', () => {
  it('returns null when no version is stored', async () => {
    const client = new MockSheetClient();
    client.seed(ADMIN_SHEET, 'schema_versions', []);
    const adapter = makeAdapter(client);
    const result = await adapter.getSchemaVersion(USER_SHEET, 'courses');
    expect(result).toBeNull();
  });

  it('stores and retrieves a schema version', async () => {
    const client = new MockSheetClient();
    client.seed(ADMIN_SHEET, 'schema_versions', []);
    const adapter = makeAdapter(client);
    const hash = computeSchemaHash(courseSchema);

    await adapter.upsertSchemaVersion(USER_SHEET, 'courses', hash, 2);
    const stored = await adapter.getSchemaVersion(USER_SHEET, 'courses');

    expect(stored).not.toBeNull();
    expect(stored!.schema_hash).toBe(hash);
    expect(stored!.column_count).toBe(2);
  });

  it('updates an existing version record', async () => {
    const client = new MockSheetClient();
    client.seed(ADMIN_SHEET, 'schema_versions', []);
    const adapter = makeAdapter(client);

    const hashV1 = computeSchemaHash(courseSchema);
    const hashV2 = computeSchemaHash(courseSchemaV2);

    await adapter.upsertSchemaVersion(USER_SHEET, 'courses', hashV1, 2);
    await adapter.upsertSchemaVersion(USER_SHEET, 'courses', hashV2, 3);

    const stored = await adapter.getSchemaVersion(USER_SHEET, 'courses');
    expect(stored!.schema_hash).toBe(hashV2);
    expect(stored!.column_count).toBe(3);
  });
});

// ── Mismatch detection ────────────────────────────────────────────────────────

describe('onSchemaMismatch: warn', () => {
  it('logs a warning but does not throw when schema is outdated', async () => {
    const client = new MockSheetClient();
    client.seed(ADMIN_SHEET, 'schema_versions', []);
    // Student sheet has 'courses' tab
    client.seed(USER_SHEET, 'courses', [
      ['title', 'credits', '_id', '_created_at', '_updated_at'],
    ]);

    const adapter = makeAdapter(client, 'warn');
    adapter.registerSchema(courseSchemaV2); // v2 schema registered

    // Store v1 hash → mismatch
    const hashV1 = computeSchemaHash(courseSchema);
    await adapter.upsertSchemaVersion(USER_SHEET, 'courses', hashV1, 2);

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const ctx = adapter.withContext({ userId: 'u1', actor: 'student', actorSheetId: USER_SHEET });
    await ctx.table('courses').findMany();

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Schema mismatch'));
    warnSpy.mockRestore();
  });
});

describe('onSchemaMismatch: error', () => {
  it('throws SchemaMismatchError when schema is outdated', async () => {
    const client = new MockSheetClient();
    client.seed(ADMIN_SHEET, 'schema_versions', []);
    client.seed(USER_SHEET, 'courses', [['title', 'credits', '_id']]);

    const adapter = makeAdapter(client, 'error');
    adapter.registerSchema(courseSchemaV2);

    const hashV1 = computeSchemaHash(courseSchema);
    await adapter.upsertSchemaVersion(USER_SHEET, 'courses', hashV1, 2);

    const ctx = adapter.withContext({ userId: 'u1', actor: 'student', actorSheetId: USER_SHEET });
    await expect(ctx.table('courses').findMany()).rejects.toBeInstanceOf(SchemaMismatchError);
  });

  it('does NOT throw when schema hash matches', async () => {
    const client = new MockSheetClient();
    client.seed(ADMIN_SHEET, 'schema_versions', []);
    client.seed(USER_SHEET, 'courses', [['title', 'credits', 'instructor', '_id']]);

    const adapter = makeAdapter(client, 'error');
    adapter.registerSchema(courseSchemaV2);

    const currentHash = computeSchemaHash(courseSchemaV2);
    await adapter.upsertSchemaVersion(USER_SHEET, 'courses', currentHash, 3);

    const ctx = adapter.withContext({ userId: 'u1', actor: 'student', actorSheetId: USER_SHEET });
    await expect(ctx.table('courses').findMany()).resolves.toBeDefined();
  });

  it('treats missing version record as a mismatch', async () => {
    const client = new MockSheetClient();
    client.seed(ADMIN_SHEET, 'schema_versions', []);
    client.seed(USER_SHEET, 'courses', [['title', 'credits', '_id']]);

    const adapter = makeAdapter(client, 'error');
    adapter.registerSchema(courseSchema);
    // No version stored at all

    const ctx = adapter.withContext({ userId: 'u1', actor: 'student', actorSheetId: USER_SHEET });
    await expect(ctx.table('courses').findMany()).rejects.toBeInstanceOf(SchemaMismatchError);
  });
});

describe('onSchemaMismatch: auto-sync', () => {
  it('syncs the schema and updates schema_versions before the CRUD operation proceeds', async () => {
    const client = new MockSheetClient();
    client.seed(ADMIN_SHEET, 'schema_versions', []);
    // Student sheet exists but headers are v1
    client.seed(USER_SHEET, 'courses', [['title', 'credits', '_id']]);

    const adapter = makeAdapter(client, 'auto-sync');
    adapter.registerSchema(courseSchemaV2);

    // Store v1 hash → triggers auto-sync
    const hashV1 = computeSchemaHash(courseSchema);
    await adapter.upsertSchemaVersion(USER_SHEET, 'courses', hashV1, 2);

    const ctx = adapter.withContext({ userId: 'u1', actor: 'student', actorSheetId: USER_SHEET });
    // Should not throw — auto-sync handles it
    await expect(ctx.table('courses').findMany()).resolves.toBeDefined();

    // Version record should be updated to v2 hash
    const stored = await adapter.getSchemaVersion(USER_SHEET, 'courses');
    expect(stored!.schema_hash).toBe(computeSchemaHash(courseSchemaV2));
  });

  it('does not perform a sync when hash matches', async () => {
    const client = new MockSheetClient();
    client.seed(ADMIN_SHEET, 'schema_versions', []);
    client.seed(USER_SHEET, 'courses', [['title', 'credits', 'instructor', '_id']]);

    const adapter = makeAdapter(client, 'auto-sync');
    adapter.registerSchema(courseSchemaV2);

    const currentHash = computeSchemaHash(courseSchemaV2);
    await adapter.upsertSchemaVersion(USER_SHEET, 'courses', currentHash, 3);

    const addSheetSpy = jest.spyOn(client, 'addSheet');
    const ctx = adapter.withContext({ userId: 'u1', actor: 'student', actorSheetId: USER_SHEET });
    await ctx.table('courses').findMany();

    // syncSchema was not triggered — no addSheet calls for 'courses'
    expect(addSheetSpy).not.toHaveBeenCalledWith(USER_SHEET, 'courses');
    addSheetSpy.mockRestore();
  });
});

// ── Admin role bypass ─────────────────────────────────────────────────────────

describe('Admin role bypasses schema version checks', () => {
  it('never checks schema versions for admin context', async () => {
    const client = new MockSheetClient();
    client.seed(ADMIN_SHEET, 'schema_versions', []);

    const usersSchema = defineTable({
      name: 'users',
      actor: 'admin',
      columns: { email: string().required() },
    });
    client.seed(ADMIN_SHEET, 'users', [['email', '_id']]);

    const adapter = makeAdapter(client, 'error');
    adapter.registerSchema(usersSchema);
    // No version stored → if check ran for admin, it would throw
    // But admin bypasses the check entirely

    const ctx = adapter.withContext({ userId: 'admin1', actor: 'admin', actorSheetId: ADMIN_SHEET });
    await expect(ctx.table('users').findMany()).resolves.toBeDefined();
  });
});

// ── Shared promise (check runs only once per context) ─────────────────────────

describe('Schema check promise is shared across table() calls', () => {
  it('the check runs once per withContext() call, not per table() call', async () => {
    const client = new MockSheetClient();
    client.seed(ADMIN_SHEET, 'schema_versions', []);
    client.seed(USER_SHEET, 'courses', [['title', 'credits', '_id']]);

    const adapter = makeAdapter(client, 'warn');
    adapter.registerSchema(courseSchema); // register v1

    // Store the current (v1) hash — no mismatch
    const hashV1 = computeSchemaHash(courseSchema);
    await adapter.upsertSchemaVersion(USER_SHEET, 'courses', hashV1, 2);

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const ctx = adapter.withContext({ userId: 'u1', actor: 'student', actorSheetId: USER_SHEET });
    // Both calls share the same pre-flight Promise
    await ctx.table('courses').findMany();
    await ctx.table('courses').findMany();

    // No mismatch → no warning fired
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
