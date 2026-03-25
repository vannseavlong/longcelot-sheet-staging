# Roadmap & Release Plan

---

## Phase 2: Developer Experience & Integration

### Q1: Can Developer Skip OAuth2? (Clarification)
**Answer**: No. OAuth is the **primary and required** authentication method for this package.

**Why OAuth is required**:
- Google Sheets API requires OAuth2 for all read/write operations
- The package uses OAuth to access and manage user's personal sheets
- Without OAuth, the adapter cannot function

**What if developers have their own auth?**
- Developers can keep their existing authentication (JWT, sessions, etc.)
- OAuth is strictly for **backend-to-Google-Sheets communication**
- The developer maps their user identity to the sheet-db user context
- Their app's existing auth remains untouched

### Q2: After adding the package, what does a developer need to do?

**Step-by-step workflow**:

```bash
# 1. Add the package to an existing project
pnpm add longcelot-sheet-db

# 2. Initialize project (creates config and schemas directory)
npx sheet-db init

# 3. Set up environment variables in .env
GOOGLE_CLIENT_ID=your_client_id
GOOGLE_CLIENT_SECRET=your_client_secret
GOOGLE_REDIRECT_URI=http://localhost:3000/auth/callback
ADMIN_SHEET_ID=your_admin_sheet_id

# 4. Define schemas in schemas/ directory
#    (or use npx sheet-db generate <table-name>)

# 5. Sync schemas to Google Sheets
npx sheet-db sync

# 6. Use in your backend code
```

**Integration with existing backend**:
- Keep existing authentication (Express, NestJS, etc.)
- Add longcelot-sheet-db for data storage
- Map your app's user to sheet-db context
- No need to change existing auth flow

### Q3: How does sheet-db sync help developer see tables for all actors?

**Current behavior**:
- `sheet-db sync` only syncs schemas to the **admin sheet**
- Non-admin actor sheets need to be created at runtime when users register

**Development workflow**:
1. Define schemas for all actors in `schemas/` directory
2. Run `npx sheet-db sync` — this creates tables in admin sheet
3. When users register, `adapter.createUserSheet()` creates their personal sheet with all tables

**For development/testing**:
- Use `sheet-db mock-users` (planned) to generate test user sheets
- Manually create test users via the CLI or register through your app
- All actor sheets will have the same schema structure

**When schemas change**:
- Developer updates schema definitions
- Run `npx sheet-db sync` to update admin sheet
- **Challenge**: How to push changes to all existing user sheets? → **Q4**

### Q4: CLI for inserting test data to all actor sheets during development

- [ ] **Implement `sheet-db mock-users`**
  - Generate dummy user/actor Google Sheets for testing
  - Allow developers to inspect what real users see
  - Support generating multiple actors (student, teacher, etc.)

- [ ] **Enhance `sheet-db seed`**
  - Currently seeds data to admin sheet
  - **New**: `--all-actors` flag to distribute seed data across all actor types
  - Support defining seeds per actor type

- [ ] **Implement `sync --all-users`** (Phase 3)
  - Read all users from `users` table
  - Fetch all `actor_sheet_id`s
  - Push schema changes to every registered user sheet
  - Critical for schema migrations across all users

---

## Phase 3: Schema Syncing & Migrations

### Q5: Migration path to production database (MySQL, PostgreSQL, Prisma, Sequelize)

**Current state**: Documentation exists but needs enhancement

**Migration confidence level**: High

**Why migration is straightforward**:
1. Schema DSL is TypeScript-first and declarative
2. No business logic trapped in Google Sheets
3. All data is accessible via the adapter
4. Simple data types map directly to SQL

**What needs to be built**:

- [ ] **Implement `sheet-db export` command**
  - Export to SQL DDL (`CREATE TABLE` statements)
  - Export to Prisma schema (`schema.prisma`)
  - Export to Sequelize/TypeORM models

- [ ] **Create migration guide documentation**
  - Step-by-step migration process
  - Data export strategy
  - Code adapter swap instructions

**Migration workflow**:

```bash
# 1. Export schemas
npx sheet-db export --prisma --output ./prisma

# 2. Review generated schema.prisma

# 3. Export data from Sheets
#    (Developers write a simple script using the adapter)

# 4. Swap adapters in code
#    Before: createSheetAdapter({ ... })
#    After: createPrismaAdapter({ ... })
```

**Data export consideration**:
- Users need to write a small script to export data
- Package provides `adapter.table('x').findMany()` to fetch all data
- Developer writes to their production DB

---

## Phase 4: Role Permissions & Cross-Actor Operations

### Q6: How does role permission work with OAuth? How does teacher access student sheet?

**Current implementation**:
- Actor-based isolation: users can only access their own sheet
- Admin has access to admin sheet and can manage user registry
- Default: cross-actor access is **blocked**

**Permission model**:

| Actor | Can Access | Why |
|-------|------------|-----|
| admin | admin sheet, user registry | Central management |
| student | their own student sheet | Data isolation |
| teacher | their own teacher sheet | Data isolation |

**How teacher sees student data** (use cases):
1. **Teacher needs to view student grades/records**
   - Use case: A teacher grading students
   - Implementation: NOT through direct sheet access
   - Solution: Central admin proxy or shared table approach

2. **Cross-boundary access patterns**:

   **Option A: Shared Admin Table** (recommended)
   - Create shared tables in admin sheet (e.g., `teacher_student_map`)
   - Teacher queries through admin context
   - Admin enforces permission rules

   **Option B: Cross-Sheet Join** (future)
   - `adapter.join()` will query across actor sheets
   - Runs in backend memory (not direct sheet access)
   - Permission checks at application layer

   **Option C: Sheet Sharing** (Google Drive level)
   - Student shares their sheet with teacher
   - Teacher uses their OAuth to access
   - Complex; not recommended for MVP

- [ ] **Implement Cross-Actor CRUD Operations**

#### Detailed Implementation Plan

##### 1. Permission Matrix Configuration

Add permission matrix to `SheetAdapterConfig`:

```typescript
interface ActorPermission {
  canAccess: string[];      // Which actor sheets can be accessed (e.g., ["student"])
  tables?: string[];       // Optional: restrict to specific tables (e.g., ["scores", "attendance"])
}

interface SheetAdapterConfig {
  adminSheetId: string;
  credentials: { ... };
  tokens: any;
  permissions?: {
    [actor: string]: ActorPermission;  // e.g., { teacher: { canAccess: ["student"], tables: ["scores"] } }
  };
}
```

Configure in `sheet-db.config.ts`:

```typescript
export default {
  projectName: "school-app",
  actors: ["admin", "teacher", "student"],
  permissions: {
    teacher: {
      canAccess: ["student"],
      tables: ["scores", "attendance"],  // Only these tables, omit for all
    },
    student: {
      canAccess: [],  // Cannot access other sheets
    },
  },
};
```

##### 2. Extend UserContext

Add cross-actor context fields:

```typescript
interface UserContext {
  userId: string;
  role: string;
  actorSheetId?: string;
  // NEW: Cross-actor access fields
  targetRole?: string;      // The actor being accessed (e.g., "student")
  targetSheetId?: string;  // The sheet ID being accessed (e.g., "student-sheet-123")
}
```

##### 3. Update hasPermission()

```typescript
private hasPermission(schema: TableSchema): boolean {
  if (!this.context) return false;

  // Admin has full access
  if (this.context.role === 'admin') return true;

  // Current behavior: same actor can access their own sheet
  if (schema.actor === this.context.role) return true;

  // NEW: Check permission matrix for cross-actor access
  const permissions = this.config.permissions?.[this.context.role];
  if (!permissions) return false;

  // Check if role can access this actor's sheets
  if (!permissions.canAccess.includes(schema.actor)) return false;

  // Check if table is allowed (if tables specified)
  if (permissions.tables && !permissions.tables.includes(schema.name)) return false;

  return true;
}
```

##### 4. Update resolveSpreadsheetId()

```typescript
private resolveSpreadsheetId(schema: TableSchema): string {
  // Admin tables are always in admin sheet
  if (schema.actor === 'admin') {
    return this.adminSheetId;
  }

  // Cross-actor access: use targetSheetId if provided
  if (this.context?.targetSheetId) {
    return this.context.targetSheetId;
  }

  // Same actor: use their own sheet
  if (this.context?.actorSheetId) {
    return this.context.actorSheetId;
  }

  throw new PermissionError('Sheet ID not provided in context', this.context?.role);
}
```

##### 5. Full CRUD Operations Across Sheets

All CRUD operations work seamlessly once permission and sheet resolution are configured:

```typescript
// === CREATE: Teacher adds score to student sheet ===
const teacherContext = adapter.withContext({
  userId: "teacher_001",
  role: "teacher",
  actorSheetId: "teacher-sheet-id",
  targetRole: "student",
  targetSheetId: "student-sheet-id-123",
});

// Creates score record in student's sheet
await teacherContext.table("scores").create({
  student_id: "student_456",
  subject: "Mathematics",
  score: 95,
  graded_by: "teacher_001",
  graded_at: new Date().toISOString(),
});

// === READ: Teacher views student scores ===
const studentScores = await teacherContext.table("scores").findMany({
  where: { student_id: "student_456" },
});

// === UPDATE: Teacher corrects a score ===
await teacherContext.table("scores").update({
  where: { _id: "score_001" },
  data: { score: 98, updated_at: new Date().toISOString() },
});

// === DELETE: Teacher removes incorrect score ===
await teacherContext.table("scores").delete({
  where: { _id: "score_001" },
});
```

##### 6. Use Case: Teacher Inputting Student Scores

```
┌─────────────────────────────────────────────────────────────┐
│                    School App Flow                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. Student registers                                      │
│     → adapter.createUserSheet("student_123", "student")    │
│     → Creates "student_123" sheet with tables              │
│                                                             │
│  2. Teacher wants to input score for student               │
│     → App looks up student's sheet ID from admin users    │
│     → Creates context with targetSheetId                   │
│                                                             │
│  3. Teacher creates score entry                             │
│     → teacherContext.table("scores").create({...})         │
│     → Writes to student's sheet, not teacher's            │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

##### 7. Complete CRUD Examples

**Scenario 1: Teacher CRUD on Student Scores**

```typescript
// Setup: Teacher with permission to access student scores
const adapter = createSheetAdapter({
  adminSheetId: process.env.ADMIN_SHEET_ID,
  credentials: { clientId, clientSecret, redirectUri },
  tokens: oauthTokens,
  permissions: {
    teacher: {
      canAccess: ["student"],
      tables: ["scores", "attendance", "behavior"],
    },
  },
});

// Register schemas
adapter.registerSchemas([studentSchema, scoresSchema, teacherSchema]);

// === CREATE ===
const createScoreContext = adapter.withContext({
  userId: "teacher_001",
  role: "teacher",
  actorSheetId: "teacher_sheet_id",
  targetRole: "student",
  targetSheetId: "student_123_sheet_id", // From admin users table
});

// Teacher creates score in STUDENT's sheet
const newScore = await createScoreContext.table("scores").create({
  student_id: "student_123",
  subject: "Mathematics",
  score: 87,
  semester: "Spring 2026",
  graded_by: "teacher_001",
  graded_at: new Date().toISOString(),
});
// newScore._id = "score_xyz123"
// newScore is saved in student's sheet, NOT teacher's sheet

// === READ ===
// Teacher reads all scores for a specific student
const studentScores = await createScoreContext.table("scores").findMany({
  where: { student_id: "student_123" },
  orderBy: "graded_at",
  order: "desc",
});

// Teacher reads all scores across all their students
async function getAllMyStudentScores(teacherId: string) {
  // Get list of students assigned to this teacher
  const myStudents = await adapter.withContext({
    userId: teacherId,
    role: "teacher",
    actorSheetId: `${teacherId}_sheet`,
  }).table("teacher_students").findMany({
    where: { teacher_id: teacherId },
  });

  const allScores = [];
  for (const student of myStudents) {
    const ctx = adapter.withContext({
      userId: teacherId,
      role: "teacher",
      actorSheetId: `${teacherId}_sheet`,
      targetRole: "student",
      targetSheetId: student.actor_sheet_id,
    });
    const scores = await ctx.table("scores").findMany();
    allScores.push(...scores.map(s => ({
      ...s,
      student_name: student.name,
      student_email: student.email,
    })));
  }
  return allScores;
}

// === UPDATE ===
// Teacher updates a score
await createScoreContext.table("scores").update({
  where: { _id: "score_xyz123" },
  data: {
    score: 92,
    graded_by: "teacher_001",
    graded_at: new Date().toISOString(),
    is_extra_credit: true,
  },
});

// === DELETE ===
// Teacher deletes an incorrect score entry
await createScoreContext.table("scores").delete({
  where: { _id: "score_xyz123" },
});
```

**Scenario 2: Parent accessing Child's data**

```typescript
// Parent with permission to view student (child) data
const parentContext = adapter.withContext({
  userId: "parent_001",
  role: "parent",
  actorSheetId: "parent_sheet_id",
  targetRole: "student",
  targetSheetId: "child_456_sheet_id", // Link to child
});

// Parent views child's scores (READ only)
const childScores = await parentContext.table("scores").findMany({
  where: { student_id: "child_456" },
});

// Parent views child's attendance
const childAttendance = await parentContext.table("attendance").findMany({
  where: { student_id: "child_456" },
});

// Parent CANNOT create/update/delete (not in permissions)
try {
  await parentContext.table("scores").create({ ... }); // Should fail!
} catch (e) {
  // PermissionError: Table scores not allowed for parent role
}
```

**Scenario 3: Admin cross-actor access**

```typescript
// Admin can access any actor's sheet
const adminContext = adapter.withContext({
  userId: "admin_001",
  role: "admin",
  actorSheetId: "admin_sheet_id",
  targetRole: "student",
  targetSheetId: "any_student_sheet_id",
});

// Admin has automatic access (no permissions config needed)
const allStudentData = await adminContext.table("students").findMany();
const allTeacherData = await adminContext.table("teachers").findMany();
```

##### 8. Edge Cases & Security

```typescript
// Edge Case 1: Missing targetSheetId for cross-actor
const ctx = adapter.withContext({
  userId: "teacher_001",
  role: "teacher",
  actorSheetId: "teacher_sheet_id",
  targetRole: "student",
  // targetSheetId missing!
});
await ctx.table("scores").create({ ... });
// Should throw: PermissionError: targetSheetId required for cross-actor access

// Edge Case 2: Permission denied for table
const ctx2 = adapter.withContext({
  userId: "teacher_001",
  role: "teacher",
  actorSheetId: "teacher_sheet_id",
  targetRole: "student",
  targetSheetId: "student_sheet_id",
});
await ctx2.table("profile").create({ ... });
// Should throw: PermissionError: Table profile not allowed for teacher->student

// Edge Case 3: Role not in permission matrix
const ctx3 = adapter.withContext({
  userId: "student_001",
  role: "student",
  actorSheetId: "student_sheet_id",
  targetRole: "teacher",
  targetSheetId: "teacher_sheet_id",
});
await ctx3.table("schedule").findMany();
// Should throw: PermissionError: student cannot access teacher sheets

// Edge Case 4: Admin bypasses all checks
const adminCtx = adapter.withContext({
  userId: "admin_001",
  role: "admin",
  actorSheetId: "admin_sheet_id",
  // No targetRole/targetSheetId needed for admin
});
await adminCtx.table("students").findMany(); // Works!
await adminCtx.table("scores").findMany(); // Works!
```

##### 9. Helper Methods (Recommended)

```typescript
class SheetAdapter {
  // ...existing code...

  // Helper: Create cross-actor context more easily
  asActor(targetRole: string, targetSheetId: string): SheetAdapter {
    if (!this.context) {
      throw new Error("Context required");
    }
    return this.withContext({
      ...this.context,
      targetRole,
      targetSheetId,
    });
  }

  // Helper: Get all sheets an actor can access
  getAccessibleSheets(role: string): string[] {
    const perms = this.permissions?.[role];
    if (!perms) return [];
    return perms.canAccess;
  }

  // Helper: Check if table is accessible for cross-actor
  canAccessTable(role: string, tableName: string): boolean {
    const perms = this.permissions?.[role];
    if (!perms) return false;
    if (!perms.canAccess.length) return false;
    if (!perms.tables) return true; // All tables allowed
    return perms.tables.includes(tableName);
  }
}
```

##### 10. Implementation Checklist

- [ ] Add `ActorPermission` and `permissions` to `SheetAdapterConfig`
- [ ] Add `targetRole` and `targetSheetId` to `UserContext` type
- [ ] Update `hasPermission()` to check permission matrix
- [ ] Update `resolveSpreadsheetId()` to use `targetSheetId`
- [ ] Add validation: ensure targetSheetId provided when cross-actor
- [ ] Add validation: throw clear error when table not in allowed list
- [ ] Update TypeScript types in `src/schema/types.ts`
- [ ] Add `asActor()` helper method
- [ ] Add tests for all CRUD scenarios:
  - [ ] Same actor access (existing behavior)
  - [ ] Cross-actor with permission (CREATE/READ/UPDATE/DELETE)
  - [ ] Cross-actor without permission (should fail)
  - [ ] Cross-actor with wrong table (should fail)
  - [ ] Admin bypass (should always work)
- [ ] Document use cases in developerGuide.md

##### 8. Related: Cross-Actor Join Query (Future)

After cross-sheet CRUD is implemented, we can add join:

```typescript
// Future: adapter.join() for complex queries
const results = await adapter.withContext({
  userId: "teacher_001",
  role: "teacher",
  targetSheetId: "student-sheet-id-123",
}).join({
  from: "scores",
  to: "students",
  on: { from: "student_id", to: "student_id" },
  select: ["scores.*", "students.name", "students.email"],
});
```

### Q7: How to join tables across actor sheets?

**Current state**: Not implemented

**Planned implementation**:

- [ ] **Implement `adapter.join()` API**

```typescript
// Conceptual API (not yet implemented)
const results = await adapter.join({
  from: { table: 'enrollments', actor: 'student' },
  to: { table: 'students', actor: 'student', column: 'student_id' },
  where: { status: 'active' },
});
```

**Implementation approach**:
1. Execute parallel queries to both actor sheets
2. Perform in-memory join in JavaScript
3. Match on `ref()` column constraints
4. Return merged results

**Use cases**:
- Teacher viewing student enrollments + student details
- Parent viewing child's grades + class info
- Admin reporting across all actors

### Q8: Why do we need user_id if all user actors have sheet_id?

**Answer**: For future migration to production database

| Field | Purpose | Persists after migration |
|-------|---------|--------------------------|
| `sheet_id` | Physical storage location (Google Drive) | No — goes away |
| `user_id` | Logical domain identity | Yes — becomes PK in SQL |

**Why this matters**:
- `sheet_id` is tied to Google Sheets infrastructure
- When migrating to MySQL/PostgreSQL, `sheet_id` has no meaning
- `user_id` is your app's user identifier
- It survives the transition to any database

**Migration example**:
```sql
-- In SQL (PostgreSQL/MySQL)
CREATE TABLE users (
  user_id VARCHAR(255) PRIMARY KEY,  -- persists from sheet-db
  email VARCHAR(255),
  role VARCHAR(50),
  created_at TIMESTAMP
);
```

---

## Phase 5: Additional CLI Enhancements

### Q9: What other CLI commands are needed?

**Already implemented**:
- [x] `init` — Project scaffolding
- [x] `generate` — Schema generator
- [x] `sync` — Schema sync to Sheets
- [x] `validate` — Schema validation
- [x] `seed` — Load initial data
- [x] `doctor` — Diagnostics
- [x] `status` — Show project status

**Planned/Needed**:

- [ ] **`init --integrate`** — Integrate into existing project
  - Merge config without overwriting
  - Add to existing `.env`
  - Create `schemas/` without destroying existing code

- [ ] **`mock-users`** — Generate test user sheets
  - Create mock Google Sheets for development
  - Inspect data as different actors
  - Useful for manual testing

- [ ] **`sync --all-users`** — Bulk sync to all user sheets
  - Push schema updates to all registered users
  - Critical for schema changes

- [ ] **`export`** — Export to SQL/Prisma
  - Generate DDL statements
  - Generate Prisma schema
  - Migration documentation

- [ ] **`migrate`** — Data migration assistant
  - Export from Sheets to SQL
  - Map columns
  - Verify data integrity

---

## Summary of Planned Work

### High Priority (Phase 2) - Developer Experience
- [ ] `sheet-db mock-users` CLI - Generate test user sheets for development
- [ ] Enhance `sheet-db seed` with `--all-actors` - Distribute seed data across actor types
- [ ] Implement `init --integrate` - Integrate into existing project without overwriting
- [ ] Better developer documentation for OAuth flow

### High Priority (Phase 3) - Schema Syncing & Migrations
- [ ] `sheet-db export` - Export schemas to Prisma schema and SQL DDL
- [ ] Migration guide - Step-by-step guide for moving to production DB
- [ ] `sync --all-users` - Push schema changes to all registered user sheets

### High Priority (Phase 4) - Cross-Actor CRUD
- [ ] **Permission Matrix Configuration** - Add `permissions` to `SheetAdapterConfig`
- [ ] **UserContext Enhancement** - Add `targetRole` and `targetSheetId`
- [ ] **Update `hasPermission()`** - Check permission matrix for cross-actor access
- [ ] **Update `resolveSpreadsheetId()`** - Use `targetSheetId` when cross-actor
- [ ] **Add `asActor()` helper** - Convenience method for cross-actor context
- [ ] **Tests** - Cover all CRUD scenarios (create, read, update, delete)
- [ ] **Documentation** - Update developerGuide.md with cross-actor examples

### Medium Priority
- [ ] `adapter.join()` - Query across multiple actor sheets
- [ ] Permission matrix validation and error messages

### Lower Priority
- [ ] `sheet-db migrate` command
- [ ] Column encryption
- [ ] Audit logs
- [ ] Row-level permissions

---

## Documentation Updates Required

- [x] Update `README.md`:
  - [x] Clarify OAuth requirement (cannot skip)
  - [x] Add "After Installation" workflow section
  - [x] Clarify `user_id` vs `sheet_id` purpose
  - [x] Add migration section with export command plans

- [ ] Update `API.md`:
  - [ ] Add cross-actor operations documentation (when implemented)

- [x] Update `CHANGELOG.md`:
  - [x] Fix duplicate `[Unreleased]` sections
  - [x] Consolidate planned items

- [x] Update `Docs/architecture.md`:
  - [x] Add cross-actor join section
  - [x] Document permission model

- [x] Update `Docs/overview.md`:
  - [x] Add clarification on OAuth requirement
  - [x] Add roadmap items

- [x] Update `Docs/developerGuide.md`:
  - [x] OAuth configuration section
  - [x] Integration workflow section

- [x] Consolidate/remove duplicate docs:
  - [x] `Docs/apiReference.md` deleted (confirmed in git status)
  - [x] All API docs consolidated in root `API.md`

- [x] Update `CLAUDE.md`:
  - [x] Add roadmap items to "Next Session" section
  - [x] Document the Q&A findings

---

## Implementation Notes

### OAuth Flow
```
Developer App → longcelot-sheet-db → Google OAuth → Google Sheets API
                        ↑
                  Your app's user context
                  (maps to actorSheetId)
```

### Context Mapping
When developer has existing auth:
```typescript
// Developer maps their user to sheet-db context
const context = adapter.withContext({
  userId: developerUser.id,           // From their auth system
  role: developerUser.role,             // 'student', 'teacher', etc.
  actorSheetId: developerUser.sheetId, // From sheet-db user registry
});
```

### Migration Path
```
longcelot-sheet-db (dev/staging)
    ↓ (export schemas + data)
MySQL/PostgreSQL + Prisma/Sequelize (production)
```

---

_Last updated: 2026-03-24_