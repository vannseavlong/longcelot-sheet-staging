# Roadmap & Release Plan

---

## Phase 1: Core Correctness (PK & FK Modifiers)

### Q: How should primary() and ref() work at runtime?

**primary() — auto-generation**

- Only one primary() column allowed per table (SchemaError if violated)
- If column is string(), auto-generate a nanoid value on create() if none supplied
- If column is number(), developer must supply the value
- Implicitly required() + unique() — no need to chain them
- On update(), PK column is readonly — strip it silently from data

**ref('table.column') — FK validation**

- On create() and update(), read the referenced table and check the value exists
- Throw ValidationError if referenced row does not exist, with message: "FK violation: {table}.{column} '{value}' does not exist"
- Both the referenced table and column must be registered in the same adapter instance
- Skip-able per-call via: options: { skipFKValidation: true } (for bulk seed operations)
- Circular references detected at registerSchema() time — throw SchemaError

Implementation checklist:

- [x] Add pkColumn field to TableSchema after defineTable() validates only one primary() exists
- [x] Update CRUDOperations.create(): if pkColumn is string, auto-generate nanoid if not supplied
- [x] Update CRUDOperations.update(): strip pkColumn from data silently (readonly)
- [x] Add resolveForeignKeys() helper in SheetAdapter
- [x] Call resolveForeignKeys() at start of create() and update() unless skipFKValidation is set
- [x] Update export command to emit @id + @relation (Prisma) and PRIMARY KEY + FOREIGN KEY (SQL)
- [x] Tests: PK auto-gen, PK readonly on update, FK pass, FK fail, skipFKValidation, circular ref

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

- [x] **Implement `sheet-db mock-users`**
  - Generate dummy user/actor Google Sheets for testing
  - Allow developers to inspect what real users see
  - Support generating multiple actors (student, teacher, etc.)

- [x] **Enhance `sheet-db seed`**
  - Currently seeds data to admin sheet
  - **New**: `--all-actors` flag to distribute seed data across all actor types
  - Support defining seeds per actor type

- [x] **Implement `sync --all-users`** (Phase 3)
  - Read all users from `users` table
  - Fetch all `actor_sheet_id`s
  - Push schema changes to every registered user sheet
  - Critical for schema migrations across all users

---

### Q10: How should the .env file handle multiple actor sheet IDs?

**Answer**: Add one `DEV_*_SHEET_ID` per actor type in `.env` for local development:

```env
ADMIN_SHEET_ID=1ABC...
DEV_STUDENT_SHEET_ID=1DEF...
DEV_TEACHER_SHEET_ID=1GHI...
```

The `sheet-db.config.ts` actors array should map each role to its env var:

```ts
actors: [
  { role: "admin", sheetIdEnv: "ADMIN_SHEET_ID" },
  { role: "student", sheetIdEnv: "DEV_STUDENT_SHEET_ID" },
  { role: "teacher", sheetIdEnv: "DEV_TEACHER_SHEET_ID" },
];
```

The `init` command must scaffold these env vars automatically.
The `sync` command must iterate ALL actors (not just admin) and print a per-actor status table showing: Actor | Sheet ID | Tables | Status (✅ synced / ⚠ skipped).
The admin `users` table must have an `actor_sheet_id` column.

Implementation checklist:

- [x] Update actors config shape in sheet-db.config.ts DSL
- [x] Update init to scaffold DEV\_\*\_SHEET_ID per actor
- [x] Update sync to iterate all actors and print per-actor status table
- [x] Ensure admin users table schema includes actor_sheet_id column

---

### Q11: How do we ensure all user actor sheets always have the latest schema?

**Answer**: Two-layer guarantee:

**Layer 1 — Schema Version Hash (runtime detection)**

- On every `withContext()` call, compute a hash of the schema definition
- Compare against the hash stored in the admin `schema_versions` table for that actor sheet
- Configurable behaviour on mismatch via `onSchemaMismatch` in `sheet-db.config.ts`:
  - `'warn'` → log warning and continue
  - `'error'` → throw SchemaMismatchError
  - `'auto-sync'` → sync the actor sheet before proceeding

**Layer 2 — sync --all-users (bulk fix)**

- Reads all `actor_sheet_id` values from admin `users` table
- For each user sheet, detects and appends missing columns/tables (additive only — never deletes)
- Updates `schema_versions` table after each successful sync
- Supports `--dry-run` to preview without applying
- Handles Google Sheets API rate limits with exponential backoff

New built-in admin table: **schema_versions**
Columns: `schema_version_id` (PK), `actor_sheet_id`, `table_name`, `schema_hash`, `synced_at`, `column_count`

Implementation checklist:

- [x] Schema hash computation utility
- [x] schema_versions table scaffolded by init
- [x] Mismatch detection in withContext()
- [x] onSchemaMismatch config option
- [x] sync --all-users command
- [x] Exponential backoff for rate limits
- [x] --dry-run flag
- [x] Tests: mismatch detection, auto-sync trigger, bulk sync

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

- [x] **Implement `sheet-db export` command**
  - Export to SQL DDL (`CREATE TABLE` statements)
  - Export to Prisma schema (`schema.prisma`)
  - Export to Sequelize/TypeORM models

- [x] **Create migration guide documentation**
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

| Actor   | Can Access                 | Why                |
| ------- | -------------------------- | ------------------ |
| admin   | admin sheet, user registry | Central management |
| student | their own student sheet    | Data isolation     |
| teacher | their own teacher sheet    | Data isolation     |

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
      tables: ["scores", "attendance"], // Only these tables, omit for all
    },
    student: {
      canAccess: [], // Cannot access other sheets
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
  targetRole?: string; // The actor being accessed (e.g., "student")
  targetSheetId?: string; // The sheet ID being accessed (e.g., "student-sheet-123")
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
  const myStudents = await adapter
    .withContext({
      userId: teacherId,
      role: "teacher",
      actorSheetId: `${teacherId}_sheet`,
    })
    .table("teacher_students")
    .findMany({
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
    allScores.push(
      ...scores.map((s) => ({
        ...s,
        student_name: student.name,
        student_email: student.email,
      })),
    );
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

- [x] Add `ActorPermission` and `permissions` to `SheetAdapterConfig`
- [x] Add `targetRole` and `targetSheetId` to `UserContext` type
- [x] Update `hasPermission()` to check permission matrix
- [x] Update `resolveSpreadsheetId()` to use `targetSheetId`
- [x] Add validation: ensure targetSheetId provided when cross-actor
- [x] Add validation: throw clear error when table not in allowed list
- [x] Update TypeScript types in `src/schema/types.ts`
- [x] Add `asActor()` helper method
- [x] Add tests for all CRUD scenarios:
  - [x] Same actor access (existing behavior)
  - [x] Cross-actor with permission (CREATE/READ/UPDATE/DELETE)
  - [x] Cross-actor without permission (should fail)
  - [x] Cross-actor with wrong table (should fail)
  - [x] Admin bypass (should always work)
- [x] Document use cases in developerGuide.md

##### 8. Related: Cross-Actor Join Query (Future)

After cross-sheet CRUD is implemented, we can add join:

```typescript
// Future: adapter.join() for complex queries
const results = await adapter
  .withContext({
    userId: "teacher_001",
    role: "teacher",
    targetSheetId: "student-sheet-id-123",
  })
  .join({
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
  from: { table: "enrollments", actor: "student" },
  to: { table: "students", actor: "student", column: "student_id" },
  where: { status: "active" },
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

| Field      | Purpose                                  | Persists after migration |
| ---------- | ---------------------------------------- | ------------------------ |
| `sheet_id` | Physical storage location (Google Drive) | No — goes away           |
| `user_id`  | Logical domain identity                  | Yes — becomes PK in SQL  |

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

- [x] **`init --integrate`** — Integrate into existing project
  - Merge config without overwriting
  - Add to existing `.env`
  - Create `schemas/` without destroying existing code

- [x] **`mock-users`** — Generate test user sheets
  - Create mock Google Sheets for development
  - Inspect data as different actors
  - Useful for manual testing

- [x] **`sync --all-users`** — Bulk sync to all user sheets
  - Push schema updates to all registered users
  - Critical for schema changes

- [x] **`export`** — Export to SQL/Prisma
  - Generate DDL statements
  - Generate Prisma schema
  - Migration documentation

- [x] **`migrate`** — Data migration assistant
  - Generates `migrate.js` script with `insertRow()` stub
  - Supports `--table`, `--output`, `--dry-run`
  - Developer replaces stub with real DB client

---

## Summary of Planned Work

### High Priority (Phase 1) - Core Correctness

- [x] PK auto-generation for string primary() columns (nanoid)
- [x] PK readonly enforcement on update() — strip silently
- [x] FK validation via ref() on create() and update()
- [x] SchemaError on duplicate primary() or circular ref()
- [x] skipFKValidation option for bulk seed operations
- [x] Export command: emit @id + @relation (Prisma) and PRIMARY KEY + FOREIGN KEY (SQL)
- [x] Tests: PK auto-gen, PK readonly, FK pass/fail, skipFKValidation, circular ref

### High Priority (Phase 2) - Developer Experience

- [x] `sheet-db mock-users` CLI - Generate test user sheets for development
- [x] Enhance `sheet-db seed` with `--all-actors` - Distribute seed data across actor types
- [x] Implement `init --integrate` - Integrate into existing project without overwriting
- [x] Multi-actor .env scaffolding - DEV\_\*\_SHEET_ID per actor type
- [x] Update actors config shape in sheet-db.config.ts DSL
- [x] Update sync to iterate all actors and print per-actor status table
- [x] Ensure admin users table schema includes actor_sheet_id column
- [ ] Better developer documentation for OAuth flow (lower priority)

### High Priority (Phase 3) - Schema Syncing & Migrations

- [x] `sheet-db export` - Export schemas to Prisma schema and SQL DDL
- [x] Migration guide - Step-by-step guide for moving to production DB
- [x] `sync --all-users` - Push schema changes to all registered user sheets
- [x] Schema version hash utility for runtime mismatch detection
- [x] schema_versions admin table scaffolded by init
- [x] onSchemaMismatch config option ('warn' | 'error' | 'auto-sync')
- [x] Mismatch detection in withContext()
- [x] Exponential backoff for Google Sheets API rate limits in bulk sync
- [x] --dry-run flag for sync --all-users
- [x] Tests: mismatch detection, auto-sync trigger, bulk sync

### High Priority (Phase 4) - Cross-Actor CRUD

- [x] **Permission Matrix Configuration** - Add `permissions` to `SheetAdapterConfig`
- [x] **UserContext Enhancement** - Add `targetRole` and `targetSheetId`
- [x] **Update `hasPermission()`** - Check permission matrix for cross-actor access
- [x] **Update `resolveSpreadsheetId()`** - Use `targetSheetId` when cross-actor
- [x] **Add `asActor()` helper** - Convenience method for cross-actor context
- [x] **Tests** - Cover all CRUD scenarios (create, read, update, delete)
- [x] **Documentation** - Update developerGuide.md with cross-actor examples

### Medium Priority

- [ ] `adapter.join()` - Query across multiple actor sheets
- [ ] Permission matrix validation and error messages

### Lower Priority

- [x] `sheet-db migrate` command (generates migration script with insertRow() stub)
- [ ] Column encryption
- [ ] Audit logs
- [ ] Row-level permissions

### Phase 9 — CLI Naming, Docs Alignment & Dev/Prod Parity (2026-06-21)

- [x] 9.1 Rename `migrate` → `export-data` (keep deprecated alias); update CLI, README
- [x] 9.3 Add "Which export command do I need?" decision table to README
- [x] 9.4 Add `export-data --all-users [--dry-run]` — aggregate all user-sheet data for bulk SQL migration
- [x] 9.5 Rename `withContext({ role })` → `withContext({ actor })` with deprecation alias; add "Actors vs Roles" section to README
- [x] 9.6 Document dev/prod parity gap in README
- [ ] 9.1 Update `CHANGELOG.md` with breaking change note for `migrate` rename
- [ ] 9.2 Align API.md on `export --prisma/--sql` (remove contradictions vs README)
- [ ] 9.3 Mirror decision table in API.md under "Migration scenarios"
- [ ] 9.5 Update `API.md` `UserContext` type definition + update `Docs/architecture.md`

---

## Documentation Updates Required

- [x] Update `README.md`:
  - [x] Clarify OAuth requirement (cannot skip)
  - [x] Add "After Installation" workflow section
  - [x] Clarify `user_id` vs `sheet_id` purpose
  - [x] Add migration section with export command plans

- [x] Update `API.md`:
  - [x] Add cross-actor operations documentation
  - [x] Update all CLI command docs (mock-users, sync --all-users, seed --all-actors, export, migrate)
  - [x] Update type definitions (ActorPermission, ActorConfig, SchemaMismatchBehaviour, UserContext)

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
  userId: developerUser.id, // From their auth system
  role: developerUser.role, // 'student', 'teacher', etc.
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

_Last updated: 2026-06-02_

---

## Phase 6: Developer-Reported Improvements (bEasy feedback)

Discovered while building the bEasy admin portal. Severity ratings from developer feedback.

### 6.1 OAuth — Identity Scopes & User Login (Critical)

**Problem**: `createOAuthManager` default scopes (`spreadsheets`, `drive.file`) never return an `id_token`, so `verifyToken()` always throws `"The verifyIdToken method requires an ID Token"`.

- [x] `getAuthUrl()` already accepts optional `scopes[]` — document this clearly
- [x] Add `createLoginOAuthManager({ clientId, clientSecret, redirectUri })` — pre-configured with `openid email profile` + Sheets scopes, ready for Google Sign-In

### 6.2 Auth Route Helpers (High)

**Problem**: No Express route helper for the common `GET /auth/google` → callback → JWT pattern. Every project reimplements it.

- [x] Export `createAuthRouter(options)` that wires `GET /auth/google` and `GET /auth/callback`
- [x] Accept `onUser` callback so developer controls user lookup/shape
- [x] `registrationPolicy` option: `'login-only'` (admin/manager) vs `'open'` (user can sign up)
- [ ] Add NestJS guard / middleware variant (future)

### 6.3 Seed Duplicate Handling (High)

**Problem**: Running `sheet-db seed` twice throws unique constraint violations. No upsert or skip behaviour.

- [x] `--skip-existing` flag: skip rows where a unique column already matches
- [x] `--upsert` flag: update existing row on unique conflict instead of throwing
- [x] Dynamic seed file — accept `export default async function(env)` in addition to plain object

### 6.4 `upsert()` CRUD method (Medium)

**Problem**: No way to insert-or-update without manual `findOne()` + branch logic.

- [x] `table.upsert({ where, data })` — insert if not found, update if exists
- [x] Export `UpsertOptions` type

### 6.5 `createMany()` Bulk Insert (Medium)

**Problem**: Seeding N rows = N API calls (300–700 ms each). No batch insert.

- [x] `table.createMany(rows[])` — batch into a single `values.append` call
- [x] Returns array of created records with auto-generated `_id`s

### 6.6 `count()` Aggregate (Low)

**Problem**: Counting rows requires loading entire sheet with `findMany()` then checking `.length`.

- [x] `table.count({ where? })` — returns number of matching rows efficiently

### 6.7 Dynamic Seed File Format (Low)

**Problem**: Seed file is a static `Record<string, unknown[]>`. No clean way to pass env vars or CLI args.

- [x] Accept `export default async function(env: NodeJS.ProcessEnv): Promise<Record<string, unknown[]>>` as seed file export
- [x] Fall back to plain object export for backward compatibility

### 6.8 CI-Friendly Sync (Medium)

**Problem**: `sheet-db sync` requires interactive OAuth browser flow — blocks CI/CD pipelines and Docker builds.

- [x] `--token-file <path>` flag: inject pre-stored tokens file (skips interactive prompt)
- [ ] Document service account alternative (future)

### 6.9 Role-Differentiated Auth (High)

**Problem**: No built-in way to restrict certain roles to login-only while allowing others to self-register.

- [x] `registrationPolicy` in `createAuthRouter`:
  - `'open'` — any authenticated user can trigger user creation (default)
  - `'login-only'` — user must already exist in the sheet; throws if not found
  - `'invite-only'` — user must exist with `status: 'invited'` (future)

---

## Phase 7: Bug Fixes (post-release)

### 7.1 `sync` does not add new columns to existing tables (Critical)

**Problem**: `syncSchema()` only writes headers when creating a brand-new tab (`rows.length === 0`). For tabs that already exist with data, running `sync` after adding columns to the schema does nothing — the new column headers are never appended. The CLI still reports "✅ synced", giving a false impression the sheet is current.

**Reproduction:**
1. Run `sync` on a fresh project — columns created correctly ✓
2. Add a new column to any existing schema
3. Run `sync` again — output says "✅ synced" but new column header is **not** in the sheet ✗

**Fix**: In `syncSchema()`, read the current row-1 headers, diff against the schema column list, and append any missing headers to the right of existing ones. Purely additive — consistent with the "never deletes data" guarantee.

- [x] Fix `syncSchema()` in `SheetAdapter` to diff row-1 headers and append missing columns
- [x] Tests: new tab (all headers written), existing tab no changes (no-op), existing tab with missing columns (appended), existing tab with data rows (data preserved)

### 7.2 `mock-users` throws `PermissionError` unconditionally (Critical)

**Problem**: `mockUsersCommand` calls `adapter.createUserSheet()` on the raw adapter — no context is set. Inside `createUserSheet`, `this.table('users')` calls `hasPermission()` which immediately returns `false` when `this.context` is `undefined`. The command can never create a single user.

**Fix**: Call `adapter.withContext({ userId: 'mock-cli', role: 'admin', actorSheetId })` and invoke `createUserSheet` on the resulting admin-context adapter.

- [x] Fix `mock-users.ts`: derive `adminSheetId` from config/env and call `createUserSheet` on an admin-context adapter

### 7.3 `createUserSheet` inserts an incomplete row into the `users` table (High)

**Problem**: `createUserSheet` hard-codes exactly 5 fields (`user_id`, `role`, `email`, `actor_sheet_id`, `created_at`). Projects with additional required columns on the `users` schema get either a `ValidationError` on create or permanent empty cells for those columns.

**Fix**: Add optional `extraFields?: Record<string, unknown>` parameter to `createUserSheet` that is spread into the `create()` call.

- [x] Add `extraFields?` param to `createUserSheet` in `sheetAdapter.ts` and merge it into the `create()` call

### 7.4 `schemasDir` config option is parsed but never applied to schema lookup path (High)

**Problem**: Both `loadSchemasForActor` in `sync.ts` and the schema-load loop in `mock-users.ts` always resolve schemas from `process.cwd()/schemas/{role}`. The `schemasDir` field from `sheet-db.config.ts` is never read, so projects that store schemas under `src/schemas/` or any non-default location always get "No schemas found."

**Fix**: Read `config.schemasDir` and use `path.resolve(process.cwd(), config.schemasDir)` as the root when set; fall back to the default `schemas/` directory otherwise.

- [x] Add `schemasDir?: string` to `SheetDBConfig` in `types.ts`
- [x] Update `loadSchemasForActor` in `sync.ts` to accept and apply the schemas root path
- [x] Apply same fix to the schema-load loop in `mock-users.ts`

---

## Phase 8: Drive Architecture & File Upload (bEasy feedback — 2026-06-19)

Architectural gaps discovered while building a real app on top of the package. Affects every project using `createUserSheet`, Google Drive organisation, or file uploads.

### 8.1 Actor-owned sheets — sheets should live in the actor's Drive, not the admin's (High)

**Problem**: `createUserSheet()` always uses admin OAuth tokens, so every user sheet is created inside the **admin's Google Drive**. The admin's 15 GB quota is consumed by all users, and one expired admin token brings the entire backend down.

**Requested behaviour**: Pass `actorTokens` (the tokens returned from the actor's own Google login) to `createUserSheet`. The package creates the spreadsheet in the actor's Drive using those tokens, then shares with the admin. Actor bears their own storage cost; admin only holds the `actor_sheet_id` reference.

API change — `createUserSheet` now accepts an options object instead of a positional `extraFields`:

```ts
await adapter.createUserSheet(userId, role, email, {
  actorTokens: { access_token, refresh_token, expiry_date },
  extraFields: { full_name: 'Alice', auth_provider: 'google' },
})
```

Implementation checklist:

- [x] Define `OAuthTokens` interface in `types.ts`
- [x] Define `CreateUserSheetOptions` interface (`actorTokens?`, `extraFields?`) in `types.ts`
- [x] Add `credentials` field to `SheetAdapter` (needed to instantiate actor `SheetClient`)
- [x] Update `createUserSheet` signature: 4th param becomes `options?: CreateUserSheetOptions`
- [x] When `actorTokens` provided: create `actorClient = new SheetClient(credentials, actorTokens)`, call `actorClient.createSpreadsheet(...)`, share with admin via `actorClient.shareWithUser`
- [x] When no `actorTokens`: fall back to current admin-client behaviour (backward compatible)
- [x] Tests: actor-owned sheet uses actor client, admin fallback still works, extraFields still passed through

---

### 8.2 Folder and subfolder organisation for Drive (Medium)

**Problem**: Every sheet lands at the root of the owning Drive with no grouping. 20 users across 3 roles = a dumped Drive root with no visual structure.

**Requested behaviour**: `driveFolder` config in `SheetAdapterConfig` specifies a root folder name and per-role subfolder names. The package creates the folders if they don't exist, then passes the folder ID as `parents` when creating sheets.

```ts
// sheet-db.config.ts
driveFolder: {
  root: 'bEasy Staging',
  subfolders: { admin: 'Admin Data', seller: 'Sellers', cleaner: 'Cleaners' },
}
```

Result:
```
My Drive/
└── bEasy Staging/
    ├── Admin Data/  (admin sheet)
    ├── Sellers/     (seller-* sheets)
    └── Cleaners/    (cleaner-* sheets)
```

Implementation checklist:

- [x] Define `DriveFolderConfig` interface (`root: string`, `subfolders?: Record<string, string>`) in `types.ts`
- [x] Add `driveFolder?: DriveFolderConfig` to `SheetAdapterConfig`
- [x] Add `findOrCreateFolder(name, parentId?, sharedDriveId?)` to `SheetClient` using Drive API `files.create` with `mimeType: 'application/vnd.google-apps.folder'`
- [x] Change `SheetClient.createSpreadsheet` to use Drive `files.create` with `parents` and `supportsAllDrives` support
- [x] Add `_folderCache: Map<string, string>` to `SheetAdapter`
- [x] Add `resolveFolderForRole(role, client)` helper: resolves root folder, then role subfolder, caches result
- [x] Call `resolveFolderForRole` in `createUserSheet` before creating the spreadsheet
- [x] `mock-users` and `sync` respect `driveFolder` when configured
- [x] Tests: folder is created when `driveFolder` configured, subsequent calls use cache, no folder created when config omitted

---

### 8.3 Pluggable file upload — `StorageAdapter` interface + built-in `DriveStorageAdapter` (High)

**Problem**: No built-in file upload pattern. Every project stores URLs in `string()` columns but with no consistency and no way to upload through the SDK.

**Requested behaviour**: `StorageAdapter` interface + built-in `DriveStorageAdapter`. User passes `storage` to `createSheetAdapter`; swapping providers (S3, GCS, Cloudinary) requires only changing the `storage` value — no other code changes.

```ts
// Built-in Drive upload
const adapter = createSheetAdapter({
  ...,
  storage: new DriveStorageAdapter({ folder: 'uploads' }),
})

const url = await adapter.upload(buffer, {
  filename: 'product.jpg',
  mimeType: 'image/jpeg',
  folder: 'uploads/products',  // optional override
  public: true,
})
// url: 'https://drive.google.com/uc?id=FILE_ID'

// Delete
await adapter.deleteFile(url)
```

`DriveStorageAdapter` is injected with the adapter's own `SheetClient` at construction time — caller does not repeat credentials.

Implementation checklist:

- [x] Define `UploadOptions` interface (`filename`, `mimeType`, `folder?`, `public?`) in `types.ts`
- [x] Define `StorageAdapter` interface (`upload(Buffer, UploadOptions): Promise<string>`, `delete(url): Promise<void>`) in `types.ts`
- [x] Add `uploadFile(buffer, filename, mimeType, folderId?, makePublic?)` to `SheetClient` using Drive API `files.create` with multipart upload
- [x] Add `deleteFile(fileId)` to `SheetClient`
- [x] Create `src/adapter/driveStorageAdapter.ts` — `DriveStorageAdapter` class implementing `StorageAdapter`
- [x] `DriveStorageAdapter` exposes `_setClient(client)` for adapter injection (avoids repeating credentials)
- [x] Add `storage?: StorageAdapter` to `SheetAdapterConfig`
- [x] In `SheetAdapter` constructor: inject `this.client` into `DriveStorageAdapter` if `_setClient` is present
- [x] Add `adapter.upload(file, options)` — delegates to `this.storage.upload()`; throws `SchemaError` if no storage configured
- [x] Add `adapter.deleteFile(url)` — delegates to `this.storage.delete()`
- [x] Export `DriveStorageAdapter` and `StorageAdapter`, `UploadOptions` from `src/index.ts`
- [x] Tests: upload delegates to storageAdapter, deleteFile delegates, throws when no storage configured

---

### 8.4 Per-actor token lifecycle — `TokenStore` interface (High)

**Problem**: Single `.sheet-db-tokens.json` for all calls. One expired token = full outage. No hook for per-user token rotation.

**Requested behaviour**: `TokenStore` interface. Caller provides a store (Redis, DB, file-per-actor). Adapter calls `tokenStore.get(userId)` in `createUserSheet` as a fallback when `actorTokens` is not passed directly — useful when the caller can't pass tokens at call-site but has stored them after the login flow.

```ts
const adapter = createSheetAdapter({
  ...,
  tokenStore: myDatabaseTokenStore,
})
```

Implementation checklist:

- [x] Define `TokenStore` interface (`get(actorId): Promise<OAuthTokens | null>`, `set(actorId, tokens): Promise<void>`) in `types.ts`
- [x] Add `tokenStore?: TokenStore` to `SheetAdapterConfig`
- [x] Store `tokenStore` reference in `SheetAdapter`
- [x] In `createUserSheet`: if `actorTokens` not provided and `tokenStore` is configured, call `await tokenStore.get(userId)` as fallback
- [x] Export `TokenStore` and `OAuthTokens` from `src/index.ts`
- [x] Tests: tokenStore.get called when no actorTokens passed, actorTokens takes priority over tokenStore

---

### 8.5 Shared Drive (Google Workspace) support (Medium)

**Problem**: `spreadsheets.create` with no `supportsAllDrives` fails on Google Workspace Shared Drives. Teams can't use Shared Drives for centralised staging data.

**Requested behaviour**: Optional `sharedDriveId` in `SheetAdapterConfig`. All sheet creation passes `supportsAllDrives: true` and places sheets in the Shared Drive root (or Drive folder when `driveFolder` is also set).

```ts
const adapter = createSheetAdapter({
  ...,
  sharedDriveId: process.env.SHARED_DRIVE_ID,
})
```

Implementation checklist:

- [x] Add `sharedDriveId?: string` to `SheetAdapterConfig`
- [x] Store `sharedDriveId` in `SheetAdapter`
- [x] Pass `sharedDriveId` to `createSpreadsheet` → Drive `files.create` uses `supportsAllDrives: true` and sets `parents: [sharedDriveId]` when no folder configured
- [x] Pass `sharedDriveId` to `findOrCreateFolder` for folder lookup in Shared Drive
- [x] Tests: sharedDriveId passed through to client createSpreadsheet call

---

### Summary table

| # | Feature | Impact | Complexity | Status |
|---|---------|--------|------------|--------|
| 8.1 | Actor-owned sheets | High | High | [ ] |
| 8.2 | Drive folder organisation | Medium | Low | [ ] |
| 8.3 | Pluggable file upload (DriveStorageAdapter) | High | Medium | [ ] |
| 8.4 | TokenStore per-actor lifecycle | High | Medium | [ ] |
| 8.5 | Shared Drive support | Medium | Low | [ ] |

---

## Phase 9: CLI Naming, Docs Alignment & Dev/Prod Parity (bEasy feedback — 2026-06-21)

Discovered while wiring the bEasy RBAC system end-to-end and evaluating the production migration story.

---

### 9.1 `migrate` command is misnamed — rename to `export-data` (High)

**Problem**: `sheet-db migrate` generates a script that reads row data and stubs an `insertRow()` call. In the industry, "migrate" universally means schema changes only (DDL). Every developer coming from Prisma Migrate, Rails, Flyway, or Liquibase will expect DDL output, not a data copy script. Moving row data is called ETL, data export, or data import — not migration.

**Fix**: Rename the command. Keep both capabilities but with names that reflect what they do.

| Current | Renamed to | What it does |
|---|---|---|
| `sheet-db migrate` | `sheet-db export-data` | Generates script that reads row data from Sheets and stubs target DB inserts |
| `sheet-db export --prisma/--sql` | Keep as-is | Exports table structure (DDL / Prisma schema) |

Implementation checklist:

- [x] Rename `migrate` command file to `export-data.ts` in `src/cli/`
- [x] Update CLI entry point to register `export-data` instead of `migrate`
- [x] Keep `migrate` as a deprecated alias with a warning: `"migrate is deprecated — use export-data instead"`
- [x] Update `README.md` migration section to use `export-data`
- [x] Update `--help` output for the renamed command
- [x] Tests: renamed command runs, deprecated alias emits warning
- [ ] Update `API.md` command reference (rename section, update examples)
- [ ] Update `CHANGELOG.md` with breaking change note

---

### 9.2 README and API.md contradict each other on `export --prisma/--sql` (Medium)

**Problem**: `README.md` marks `export --prisma` and `export --sql` as "coming soon". `API.md` documents them as fully available with examples. A developer reading README thinks the feature doesn't exist and looks for a workaround.

**Fix**: Align both documents to reflect actual implementation state.

Implementation checklist:

- [x] Audit `README.md` Migration Path section — remove all "coming soon" markers for already-implemented commands
- [ ] Audit `API.md` — confirm `export --prisma` and `export --sql` examples match actual CLI behaviour
- [ ] Add a single source-of-truth note in `README.md`: "For full command reference, see [API.md](./API.md)"
- [ ] If any `export` sub-flags are genuinely unimplemented, mark them `[planned]` consistently in both files

---

### 9.3 No clear docs distinction between schema-only vs schema+data export (High)

**Problem**: The "Migration Path" section mixes schema export and data export under one heading. Projects going to production fall into two camps — those that want structure only and those that need to carry their staging data forward — but the docs don't guide either path clearly.

**Fix**: Add a decision table / decision tree to `README.md`.

Implementation checklist:

- [x] Add "Which export command do I need?" section to `README.md` with a decision table
- [x] Add brief prose explaining the two migration profiles (structure-only vs full data carry-over)
- [ ] Mirror the same table in `API.md` under a "Migration scenarios" sub-section

---

### 9.4 `export-data --all-users` missing — blocks full multi-user data migration (High)

**Problem**: `sheet-db migrate` (data export) only covers the admin sheet. In the per-user-sheet model, staging data is spread across individual actor sheets (`actor_sheet_id`). There is no automated way to gather all user data for a bulk insert into a production SQL DB.

**Fix**: Add `--all-users` flag to `export-data`.

```bash
sheet-db export-data                    # admin sheet only (current behaviour)
sheet-db export-data --all-users        # admin + all registered user sheets
sheet-db export-data --all-users --dry-run  # preview without writing
```

Implementation checklist:

- [x] Add `--all-users` flag to the (renamed) `export-data` command
- [x] On `--all-users`: read all rows from admin `users` table to collect `actor_sheet_id` values
- [x] For each actor sheet, read all registered tables and collect rows
- [x] Generated script aggregates rows per user, annotated with `user_id` FK so target DB associations are correct
- [x] `--dry-run`: print summary of what would be exported (N users, N tables, N rows) without writing the script
- [x] Tests: admin-only export, all-users export, dry-run output
- [ ] Handle Google Sheets API rate limits with exponential backoff in generated script (optional hardening)

---

### 9.5 Actor vs Role conceptual conflation in docs and API (High)

**Problem**: The package uses `role:` as the actor identifier in `withContext()`, but application-level RBAC roles are also called "roles". Developers building RBAC naturally reach for the package's `role` field expecting it to be dynamic — it isn't, which is only discovered after building around it.

| Concept | What it controls | Dynamic? |
|---|---|---|
| **Actor** | WHERE data is stored (which Google Sheet / table schemas) | No — defined in config at deploy time |
| **App RBAC Role** | WHAT a user can do (read orders, edit products) | Yes — rows in `roles` + `role_permissions` tables |

**Fix**: Rename the API field and add explanatory docs.

Implementation checklist:

- [x] Rename `withContext({ role })` → `withContext({ actor })` in `UserContext` type (with backward-compatible `role` alias + deprecation warning at runtime)
- [x] Update all internal references to `context.role` → `context.actor` (via NormalisedContext)
- [x] Add "Actors vs Application Roles" section to `README.md` explaining the distinction
- [x] Update all `withContext` examples in README to use `actor:` instead of `role:`
- [x] Tests: both `actor` and deprecated `role` field work; deprecation warning logged when `role` used
- [ ] Add the same section to `Docs/architecture.md`
- [ ] Update `API.md` type definitions (`UserContext`) to reflect rename

---

### 9.6 Dev/prod parity gap — one shared dev sheet vs per-user prod sheets (Medium)

**Problem**: `sheet-db.config.ts` maps each actor type to one env var (`DEV_OPERATION_SHEET_ID`). All operation users in dev share one sheet. But `createUserSheet()` creates individual sheets per user in production. Bugs that only appear with isolated sheets (data isolation, schema version per user) are invisible in dev.

**Fix**: Document the gap explicitly and optionally add a multi-sheet dev mode.

Implementation checklist:

- [x] Add "Dev vs Production data model" section to `README.md` explaining the difference
- [ ] In `mock-users` output, print a note: "Note: dev uses shared actor sheets. Production creates one sheet per user via createUserSheet()."
- [ ] (Optional) Add `--multi-sheet` flag to `mock-users` that creates N separate actor sheets (one per mock user) to simulate production topology
- [ ] Tests (if `--multi-sheet` implemented): N sheets created, each with correct schema headers

---

### Summary table

| # | Issue | Type | Impact |
|---|-------|------|--------|
| 9.1 | `migrate` misnamed — rename to `export-data` | Naming / UX | High |
| 9.2 | README and API.md contradict on `export --prisma/--sql` | Docs bug | Medium |
| 9.3 | No clear schema-only vs schema+data export guidance | Docs / UX | High |
| 9.4 | `export-data --all-users` missing | Missing feature | High |
| 9.5 | Actor vs Role conceptual conflation | Docs / API naming | High |
| 9.6 | Dev/prod parity gap (shared dev sheet vs per-user prod) | Architecture / DX | Medium |

_Last updated: 2026-06-21_
