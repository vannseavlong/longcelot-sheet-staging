import { SheetAdapter, SheetAdapterConfig } from '../../src/adapter/sheetAdapter';
import { defineTable } from '../../src/schema/defineTable';
import { string, number } from '../../src/schema/columnBuilder';
import { PermissionError } from '../../src/errors/PermissionError';

// Minimal stub for SheetClient so no real Google Sheets calls happen
// rowsBySheet accepts either object arrays (for findMany) or 2D string arrays (for update/delete)
function makeClient(rowsBySheet: Record<string, unknown[][]> = {}) {
  return {
    getSheetNames: jest.fn().mockResolvedValue(['schema_versions']),
    getAllRows: jest.fn().mockImplementation((_id: string, sheet: string) =>
      Promise.resolve(rowsBySheet[sheet] ?? [])
    ),
    writeHeader: jest.fn().mockResolvedValue(undefined),
    appendRow: jest.fn().mockResolvedValue(undefined),
    updateRow: jest.fn().mockResolvedValue(undefined),
    deleteRow: jest.fn().mockResolvedValue(undefined),
    addSheet: jest.fn().mockResolvedValue(undefined),
    createSpreadsheet: jest.fn().mockResolvedValue('new-sheet-id'),
    shareWithUser: jest.fn().mockResolvedValue(undefined),
  };
}

const teacherSchema = defineTable({
  name: 'teachers',
  actor: 'teacher',
  columns: { name: string().required() },
});

const scoreSchema = defineTable({
  name: 'scores',
  actor: 'student',
  columns: {
    student_id: string().required(),
    subject: string().required(),
    score: number().required(),
  },
});

const attendanceSchema = defineTable({
  name: 'attendance',
  actor: 'student',
  columns: {
    student_id: string().required(),
    date: string().required(),
    present: string().required(),
  },
});

const profileSchema = defineTable({
  name: 'profile',
  actor: 'student',
  columns: { bio: string() },
});

const baseConfig: Omit<SheetAdapterConfig, '_client'> = {
  adminSheetId: 'admin-sheet-id',
  credentials: { clientId: 'x', clientSecret: 'y', redirectUri: 'z' },
  tokens: {},
};

function makeAdapter(opts: {
  client?: ReturnType<typeof makeClient>;
  permissions?: SheetAdapterConfig['permissions'];
} = {}) {
  const client = opts.client ?? makeClient();
  const adapter = new SheetAdapter({
    ...baseConfig,
    permissions: opts.permissions,
    _client: client,
  } as unknown as SheetAdapterConfig);
  adapter.registerSchemas([teacherSchema, scoreSchema, attendanceSchema, profileSchema]);
  return { adapter, client };
}

// ── Same-actor access (existing behaviour) ────────────────────────────────────

describe('same-actor access', () => {
  it('allows a teacher to access their own tables', () => {
    const { adapter } = makeAdapter();
    const ctx = adapter.withContext({
      userId: 'teacher_001',
      role: 'teacher',
      actorSheetId: 'teacher-sheet-id',
    });
    expect(() => ctx.table('teachers')).not.toThrow();
  });

  it('blocks a teacher from accessing student tables without cross-actor context', () => {
    const { adapter } = makeAdapter({
      permissions: { teacher: { canAccess: ['student'], tables: ['scores'] } },
    });
    const ctx = adapter.withContext({
      userId: 'teacher_001',
      role: 'teacher',
      actorSheetId: 'teacher-sheet-id',
      // No targetRole / targetSheetId
    });
    expect(() => ctx.table('scores')).toThrow(PermissionError);
  });
});

// ── asActor() helper ──────────────────────────────────────────────────────────

describe('asActor() helper', () => {
  it('returns a new adapter with targetRole and targetSheetId set', () => {
    const { adapter } = makeAdapter({
      permissions: { teacher: { canAccess: ['student'] } },
    });
    const ctx = adapter.withContext({
      userId: 'teacher_001',
      role: 'teacher',
      actorSheetId: 'teacher-sheet-id',
    });
    const crossCtx = ctx.asActor('student', 'student-sheet-id');
    expect(() => crossCtx.table('scores')).not.toThrow();
  });

  it('throws PermissionError when called without a context', () => {
    const { adapter } = makeAdapter();
    expect(() => adapter.asActor('student', 'student-sheet-id')).toThrow(PermissionError);
  });
});

// ── Cross-actor with permission ───────────────────────────────────────────────

describe('cross-actor access with permission', () => {
  it('allows table() when role has full cross-actor access', () => {
    const { adapter } = makeAdapter({
      permissions: { teacher: { canAccess: ['student'] } },
    });
    const ctx = adapter.withContext({
      userId: 'teacher_001',
      role: 'teacher',
      actorSheetId: 'teacher-sheet-id',
      targetRole: 'student',
      targetSheetId: 'student-sheet-id',
    });
    expect(() => ctx.table('scores')).not.toThrow();
    expect(() => ctx.table('attendance')).not.toThrow();
    expect(() => ctx.table('profile')).not.toThrow();
  });

  it('allows only permitted tables when tables list is specified', () => {
    const { adapter } = makeAdapter({
      permissions: { teacher: { canAccess: ['student'], tables: ['scores', 'attendance'] } },
    });
    const ctx = adapter.withContext({
      userId: 'teacher_001',
      role: 'teacher',
      actorSheetId: 'teacher-sheet-id',
      targetRole: 'student',
      targetSheetId: 'student-sheet-id',
    });
    expect(() => ctx.table('scores')).not.toThrow();
    expect(() => ctx.table('attendance')).not.toThrow();
  });

  it('resolves cross-actor spreadsheetId to targetSheetId', () => {
    const client = makeClient();
    const { adapter } = makeAdapter({
      client,
      permissions: { teacher: { canAccess: ['student'] } },
    });
    const ctx = adapter.withContext({
      userId: 'teacher_001',
      role: 'teacher',
      actorSheetId: 'teacher-sheet-id',
      targetRole: 'student',
      targetSheetId: 'student-sheet-id',
    });
    ctx.table('scores');
    // Verify getAllRows would be called with the student sheet, not teacher sheet
    expect(client.getAllRows).not.toHaveBeenCalledWith('teacher-sheet-id', 'scores');
  });
});

// ── Cross-actor without permission ────────────────────────────────────────────

describe('cross-actor access without permission', () => {
  it('throws PermissionError when no permissions config exists for role', () => {
    const { adapter } = makeAdapter(); // no permissions
    const ctx = adapter.withContext({
      userId: 'teacher_001',
      role: 'teacher',
      actorSheetId: 'teacher-sheet-id',
      targetRole: 'student',
      targetSheetId: 'student-sheet-id',
    });
    expect(() => ctx.table('scores')).toThrow(PermissionError);
  });

  it('throws PermissionError when role is not in canAccess list', () => {
    const { adapter } = makeAdapter({
      permissions: { teacher: { canAccess: [] } },
    });
    const ctx = adapter.withContext({
      userId: 'teacher_001',
      role: 'teacher',
      actorSheetId: 'teacher-sheet-id',
      targetRole: 'student',
      targetSheetId: 'student-sheet-id',
    });
    expect(() => ctx.table('scores')).toThrow(PermissionError);
  });

  it('throws PermissionError for a table not in the allowed tables list', () => {
    const { adapter } = makeAdapter({
      permissions: { teacher: { canAccess: ['student'], tables: ['scores', 'attendance'] } },
    });
    const ctx = adapter.withContext({
      userId: 'teacher_001',
      role: 'teacher',
      actorSheetId: 'teacher-sheet-id',
      targetRole: 'student',
      targetSheetId: 'student-sheet-id',
    });
    expect(() => ctx.table('profile')).toThrow(PermissionError);
  });

  it('throws PermissionError when targetSheetId is missing for cross-actor', () => {
    const { adapter } = makeAdapter({
      permissions: { teacher: { canAccess: ['student'] } },
    });
    const ctx = adapter.withContext({
      userId: 'teacher_001',
      role: 'teacher',
      actorSheetId: 'teacher-sheet-id',
      targetRole: 'student',
      // targetSheetId missing
    });
    expect(() => ctx.table('scores')).toThrow(PermissionError);
  });
});

// ── Admin bypass ──────────────────────────────────────────────────────────────

describe('admin bypass', () => {
  it('admin can access any actor table without permissions config', () => {
    const { adapter } = makeAdapter(); // no permissions
    const ctx = adapter.withContext({
      userId: 'admin_001',
      role: 'admin',
      actorSheetId: 'admin-sheet-id',
    });
    // Admin context uses adminSheetId for student tables
    expect(() => ctx.table('scores')).not.toThrow();
    expect(() => ctx.table('attendance')).not.toThrow();
  });

  it('admin can access tables with targetSheetId override', () => {
    const { adapter } = makeAdapter();
    const ctx = adapter.withContext({
      userId: 'admin_001',
      role: 'admin',
      actorSheetId: 'admin-sheet-id',
      targetRole: 'student',
      targetSheetId: 'student-sheet-id',
    });
    expect(() => ctx.table('scores')).not.toThrow();
  });
});

// ── CRUD routing — operations hit the correct spreadsheetId ───────────────────

describe('CRUD routing to correct sheet', () => {
  function makeCrossActorCtx(client: ReturnType<typeof makeClient>) {
    const { adapter } = makeAdapter({
      client,
      permissions: { teacher: { canAccess: ['student'] } },
    });
    return adapter.withContext({
      userId: 'teacher_001',
      role: 'teacher',
      actorSheetId: 'teacher-sheet-id',
      targetRole: 'student',
      targetSheetId: 'student-sheet-id',
    });
  }

  it('findMany routes to targetSheetId, not actorSheetId', async () => {
    const client = makeClient({
      scores: [['_id', 'student_id', 'subject', 'score'], ['r1', 's1', 'Math', '90']],
    });
    const ctx = makeCrossActorCtx(client);
    await ctx.table('scores').findMany();
    expect(client.getAllRows).toHaveBeenCalledWith('student-sheet-id', 'scores');
    expect(client.getAllRows).not.toHaveBeenCalledWith('teacher-sheet-id', 'scores');
  });

  it('create routes to targetSheetId', async () => {
    const client = makeClient();
    const ctx = makeCrossActorCtx(client);
    await ctx.table('scores').create(
      { student_id: 's1', subject: 'Science', score: 88 },
      { skipFKValidation: true }
    );
    expect(client.appendRow).toHaveBeenCalledWith(
      'student-sheet-id',
      'scores',
      expect.any(Array)
    );
    expect(client.appendRow).not.toHaveBeenCalledWith(
      'teacher-sheet-id',
      'scores',
      expect.any(Array)
    );
  });

  it('update routes to targetSheetId', async () => {
    // getAllRows returns 2D array: row[0] = headers, row[1..] = data values
    const client = makeClient({
      scores: [
        ['_id', 'student_id', 'subject', 'score'],
        ['r1', 's1', 'Math', '90'],
      ],
    });
    const ctx = makeCrossActorCtx(client);
    await ctx.table('scores').update({
      where: { _id: 'r1' },
      data: { score: 95 },
      skipFKValidation: true,
    });
    expect(client.getAllRows).toHaveBeenCalledWith('student-sheet-id', 'scores');
    expect(client.updateRow).toHaveBeenCalledWith(
      'student-sheet-id',
      'scores',
      expect.any(Number),
      expect.any(Array)
    );
  });

  it('delete routes to targetSheetId', async () => {
    const client = makeClient({
      scores: [
        ['_id', 'student_id', 'subject', 'score'],
        ['r1', 's1', 'Math', '90'],
      ],
    });
    const ctx = makeCrossActorCtx(client);
    await ctx.table('scores').delete({ where: { _id: 'r1' } });
    expect(client.getAllRows).toHaveBeenCalledWith('student-sheet-id', 'scores');
    expect(client.deleteRow).toHaveBeenCalledWith('student-sheet-id', 'scores', expect.any(Number));
  });

  it('same-actor findMany routes to actorSheetId', async () => {
    const client = makeClient({
      teachers: [['_id', 'name'], ['r1', 'Ms Smith']],
    });
    const { adapter } = makeAdapter({ client });
    const ctx = adapter.withContext({
      userId: 'teacher_001',
      role: 'teacher',
      actorSheetId: 'teacher-sheet-id',
    });
    await ctx.table('teachers').findMany();
    expect(client.getAllRows).toHaveBeenCalledWith('teacher-sheet-id', 'teachers');
  });
});
