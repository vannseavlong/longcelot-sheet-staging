---
name: permissions
description: Configure and use cross-actor access in longcelot-sheet-db. Use when one role needs to read or write another role's sheet (e.g., teacher accessing student data, admin auditing user sheets), when setting up a permission matrix in SheetAdapterConfig, when using asActor() to switch context, or when understanding how hasPermission() and resolveSpreadsheetId() enforce boundaries.
license: MIT
metadata:
  package: longcelot-sheet-db
  version: "0.1.15"
---

# longcelot-sheet-db — Cross-Actor Permissions

By default, every actor can only access their own sheet. Cross-actor access (e.g., a teacher writing to a student's sheet) requires two things:

1. A **permissions matrix** in `SheetAdapterConfig`
2. A **target context** (`targetRole` + `targetSheetId`) in `withContext()`

Admin is exempt — it bypasses all permission checks automatically.

---

## 1. Configure the Permission Matrix

```typescript
import { createSheetAdapter } from 'longcelot-sheet-db';

const adapter = createSheetAdapter({
  adminSheetId: process.env.ADMIN_SHEET_ID!,
  credentials: { clientId, clientSecret, redirectUri },
  tokens: oauthTokens,
  permissions: {
    teacher: {
      canAccess: ['student'],              // roles this actor can access
      tables: ['scores', 'attendance'],    // omit to allow all tables for this actor
    },
    parent: {
      canAccess: ['student'],
      tables: ['scores'],                  // read-only enforced via allowedOperations (future)
    },
  },
});
```

### ActorPermission type

```typescript
interface ActorPermission {
  canAccess: string[];          // which actor roles can be accessed
  tables?: string[];            // optional: restrict to specific tables (omit = all)
  allowedOperations?: Array<'create' | 'read' | 'update' | 'delete'>; // planned
}
```

---

## 2. Create a Cross-Actor Context

Pass `targetRole` and `targetSheetId` in `withContext()`:

```typescript
const ctx = adapter.withContext({
  userId: 'teacher_001',
  role: 'teacher',
  actorSheetId: 'teacher-sheet-id',   // teacher's own sheet
  targetRole: 'student',              // the role being accessed
  targetSheetId: 'student-sheet-id',  // the specific student's sheet
});
```

Or use the `asActor()` shorthand on an existing context:

```typescript
const teacherCtx = adapter.withContext({
  userId: 'teacher_001',
  role: 'teacher',
  actorSheetId: 'teacher-sheet-id',
});

const crossCtx = teacherCtx.asActor('student', 'student-sheet-id');
```

---

## 3. Full CRUD Across Actor Sheets

All four operations route to the **target** sheet once context is set:

```typescript
// CREATE — teacher writes a score into the student's sheet
await crossCtx.table('scores').create({
  student_id: 'student_123',
  subject: 'Mathematics',
  score: 95,
  graded_by: 'teacher_001',
  graded_at: new Date().toISOString(),
});

// READ — teacher reads scores from the student's sheet
const scores = await crossCtx.table('scores').findMany({
  where: { student_id: 'student_123' },
  orderBy: 'graded_at',
  order: 'desc',
});

// UPDATE — teacher corrects a score
await crossCtx.table('scores').update({
  where: { _id: 'score_xyz' },
  data: { score: 98, graded_at: new Date().toISOString() },
});

// DELETE — teacher removes an erroneous entry
await crossCtx.table('scores').delete({ where: { _id: 'score_xyz' } });
```

---

## 4. Admin Bypass

Admin actors bypass the permission matrix entirely. No `targetRole`/`targetSheetId` configuration needed:

```typescript
const adminCtx = adapter.withContext({
  userId: 'admin_001',
  role: 'admin',
  actorSheetId: process.env.ADMIN_SHEET_ID!,
  // optionally add targetSheetId to access a specific user sheet
  targetRole: 'student',
  targetSheetId: 'any-student-sheet-id',
});

// Admin always has access
await adminCtx.table('scores').findMany();
await adminCtx.table('profile').findMany();
```

---

## 5. Fetching `targetSheetId` at Runtime

The target sheet ID must come from your admin `users` table, not be hardcoded:

```typescript
// Look up the student's sheet ID first
const adminCtx = adapter.withContext({
  userId: 'teacher_001',
  role: 'admin',
  actorSheetId: process.env.ADMIN_SHEET_ID!,
});

const student = await adminCtx.table('users').findOne({
  where: { user_id: 'student_123' },
});

// Then switch to cross-actor context
const crossCtx = teacherCtx.asActor('student', student!.actor_sheet_id as string);
```

---

## 6. Aggregating Data Across Multiple Sheets

```typescript
async function getAllStudentScores(teacherId: string, teacherSheetId: string) {
  const teacherCtx = adapter.withContext({
    userId: teacherId,
    role: 'teacher',
    actorSheetId: teacherSheetId,
  });

  // Get the teacher's student list
  const students = await teacherCtx.table('teacher_students').findMany({
    where: { teacher_id: teacherId },
  });

  const allScores = [];
  for (const student of students) {
    const scores = await teacherCtx
      .asActor('student', student.actor_sheet_id as string)
      .table('scores')
      .findMany();

    allScores.push(...scores.map((s) => ({
      ...s,
      student_name: student.name,
      student_email: student.email,
    })));
  }

  return allScores;
}
```

---

## 7. Permission Enforcement Rules

| Scenario | Result |
|---|---|
| Same role accessing own tables | ✅ Always allowed |
| Admin role | ✅ Always allowed (bypasses all checks) |
| Cross-actor, no `permissions` configured for the caller | `PermissionError: 'teacher' has no cross-actor permissions configured` |
| Cross-actor, role not in `canAccess` list | `PermissionError: 'teacher' cannot access 'student' sheets` |
| Cross-actor, table not in allowed `tables` list | `PermissionError: Table 'profile' is not allowed for 'teacher' → 'student' access` |
| `targetRole` set but `targetSheetId` missing | `PermissionError: targetSheetId required for cross-actor access` |
| Non-admin accessing admin tables | `PermissionError` (always blocked) |

---

## Common Mistakes

- **Hardcoding `targetSheetId`** — Always fetch it from the admin `users` table at request time. Sheet IDs can change if users reconnect their accounts.
- **Not registering the target table's schema** — If `scores` is a `student` table, it must be registered via `adapter.registerSchemas()` even when accessed by a teacher context.
- **Setting `targetRole` without `targetSheetId`** — Both fields are required together. Missing `targetSheetId` always throws a `PermissionError`.
- **Expecting `tables: []` to block all tables** — An empty array means the key is present but empty; the runtime checks `perm.tables && !perm.tables.includes(schema.name)`. Pass `tables: ['allowedTable']` with at least one entry, or omit `tables` entirely to allow all tables for that `canAccess` pair.
- **Admin context accessing non-admin tables** — Admin always goes to `adminSheetId`. To access a user sheet as admin, you must still pass `targetSheetId` (admin bypasses permission checks but still needs the sheet ID to know where to read/write).
