import { hasPermission, resolveNonAdminTenantKey, AccessControlContext } from '../../src/adapter/accessControl';
import { PermissionError } from '../../src/errors/PermissionError';
import { TableSchema } from '../../src/schema/types';

const teacherSchema: Pick<TableSchema, 'actor' | 'name'> = { actor: 'teacher', name: 'teachers' };
const scoreSchema: Pick<TableSchema, 'actor' | 'name'> = { actor: 'student', name: 'scores' };
const attendanceSchema: Pick<TableSchema, 'actor' | 'name'> = { actor: 'student', name: 'attendance' };
const profileSchema: Pick<TableSchema, 'actor' | 'name'> = { actor: 'student', name: 'profile' };

describe('accessControl.hasPermission — same-actor access', () => {
  it('allows a teacher to access their own tables', () => {
    const ctx: AccessControlContext = { role: 'teacher' };
    expect(hasPermission(teacherSchema, ctx, undefined)).toBe(true);
  });

  it('blocks a teacher from accessing student tables without cross-actor context', () => {
    const ctx: AccessControlContext = { role: 'teacher' };
    const permissions = { teacher: { canAccess: ['student'], tables: ['scores'] } };
    expect(() => hasPermission(scoreSchema, ctx, permissions)).not.toThrow();
    expect(hasPermission(scoreSchema, ctx, permissions)).toBe(false);
  });
});

describe('accessControl.hasPermission — cross-actor with permission', () => {
  it('allows when role has full cross-actor access', () => {
    const ctx: AccessControlContext = { role: 'teacher', targetActor: 'student' };
    const permissions = { teacher: { canAccess: ['student'] } };
    expect(hasPermission(scoreSchema, ctx, permissions)).toBe(true);
    expect(hasPermission(attendanceSchema, ctx, permissions)).toBe(true);
    expect(hasPermission(profileSchema, ctx, permissions)).toBe(true);
  });

  it('allows only permitted tables when tables list is specified', () => {
    const ctx: AccessControlContext = { role: 'teacher', targetActor: 'student' };
    const permissions = { teacher: { canAccess: ['student'], tables: ['scores', 'attendance'] } };
    expect(hasPermission(scoreSchema, ctx, permissions)).toBe(true);
    expect(hasPermission(attendanceSchema, ctx, permissions)).toBe(true);
    expect(() => hasPermission(profileSchema, ctx, permissions)).toThrow(PermissionError);
  });
});

describe('accessControl.hasPermission — cross-actor without permission', () => {
  it('throws PermissionError when no permissions config exists for role', () => {
    const ctx: AccessControlContext = { role: 'teacher', targetActor: 'student' };
    expect(() => hasPermission(scoreSchema, ctx, undefined)).toThrow(PermissionError);
  });

  it('throws PermissionError when role is not in canAccess list', () => {
    const ctx: AccessControlContext = { role: 'teacher', targetActor: 'student' };
    const permissions = { teacher: { canAccess: [] } };
    expect(() => hasPermission(scoreSchema, ctx, permissions)).toThrow(PermissionError);
  });

  it('throws PermissionError for a table not in the allowed tables list', () => {
    const ctx: AccessControlContext = { role: 'teacher', targetActor: 'student' };
    const permissions = { teacher: { canAccess: ['student'], tables: ['scores', 'attendance'] } };
    expect(() => hasPermission(profileSchema, ctx, permissions)).toThrow(PermissionError);
  });
});

describe('accessControl.hasPermission — admin bypass', () => {
  it('admin can access any actor table without permissions config', () => {
    const ctx: AccessControlContext = { role: 'admin' };
    expect(hasPermission(scoreSchema, ctx, undefined)).toBe(true);
    expect(hasPermission(attendanceSchema, ctx, undefined)).toBe(true);
  });

  it('admin bypasses even with a targetActor override', () => {
    const ctx: AccessControlContext = { role: 'admin', targetActor: 'student' };
    expect(hasPermission(scoreSchema, ctx, undefined)).toBe(true);
  });

  it('non-admin cannot access admin tables', () => {
    const ctx: AccessControlContext = { role: 'teacher' };
    const adminSchema: Pick<TableSchema, 'actor' | 'name'> = { actor: 'admin', name: 'users' };
    expect(hasPermission(adminSchema, ctx, undefined)).toBe(false);
  });

  it('returns false when context is undefined', () => {
    expect(hasPermission(scoreSchema, undefined, undefined)).toBe(false);
  });
});

describe('resolveNonAdminTenantKey', () => {
  it('resolves same-actor access to actorSheetId', () => {
    const ctx: AccessControlContext = { role: 'teacher', actorSheetId: 'teacher-sheet-id' };
    expect(resolveNonAdminTenantKey(teacherSchema, ctx)).toBe('teacher-sheet-id');
  });

  it('resolves cross-actor access to targetSheetId, not actorSheetId', () => {
    const ctx: AccessControlContext = {
      role: 'teacher',
      actorSheetId: 'teacher-sheet-id',
      targetActor: 'student',
      targetSheetId: 'student-sheet-id',
    };
    expect(resolveNonAdminTenantKey(scoreSchema, ctx)).toBe('student-sheet-id');
  });

  it('throws PermissionError when targetSheetId is missing for cross-actor', () => {
    const ctx: AccessControlContext = {
      role: 'teacher',
      actorSheetId: 'teacher-sheet-id',
      targetActor: 'student',
    };
    expect(() => resolveNonAdminTenantKey(scoreSchema, ctx)).toThrow(PermissionError);
  });

  it('throws PermissionError when actorSheetId is missing for same-actor access', () => {
    const ctx: AccessControlContext = { role: 'teacher' };
    expect(() => resolveNonAdminTenantKey(teacherSchema, ctx)).toThrow(PermissionError);
  });

  it('throws PermissionError when context is undefined', () => {
    expect(() => resolveNonAdminTenantKey(teacherSchema, undefined)).toThrow(PermissionError);
  });
});
