# FAQ — longcelot-sheet-db

Answers to architectural, design, and integration questions collected during development and real-world usage.

---

## Table of Contents

1. [Authentication & OAuth](#1-authentication--oauth)
2. [Actors vs RBAC Roles](#2-actors-vs-rbac-roles)
3. [Security Model](#3-security-model)
4. [Schema Design — Primary Keys & Foreign Keys](#4-schema-design--primary-keys--foreign-keys)
5. [Schema Versioning & Keeping User Sheets in Sync](#5-schema-versioning--keeping-user-sheets-in-sync)
6. [Multi-Role Users & Role Promotion](#6-multi-role-users--role-promotion)
7. [Cross-Actor Access](#7-cross-actor-access)
8. [Migration to Production](#8-migration-to-production)
9. [Developer Workflow & CLI](#9-developer-workflow--cli)
10. [Sheet Formatting & Data Validation](#10-sheet-formatting--data-validation)
11. [Google Sheets API Rate Limits & Read Caching](#11-google-sheets-api-rate-limits--read-caching)
12. [Dropping & Renaming Schema Elements](#12-dropping--renaming-schema-elements)

---

## 1. Authentication & OAuth

### Can I skip Google OAuth2?

No. OAuth2 is required because the Google Sheets API requires it for all read/write operations. There is no API key or service account shortcut built into this package.

### My app already has its own auth (JWT, sessions). Does adding this package break it?

No. OAuth in lsdb is strictly for **backend-to-Google-Sheets communication**. Your app's own authentication is completely untouched. You just map your authenticated user to a lsdb context when you need to access data:

```typescript
app.get('/courses', async (req, res) => {
  const user = req.user; // from your JWT / session
  const ctx = adapter.withContext({
    userId: user.id,
    actor: user.actorType,       // 'teacher', 'student', 'parent', etc.
    actorSheetId: user.sheetId,  // stored in admin users table
  });
  res.json(await ctx.table('courses').findMany());
});
```

### There are two different OAuth flows in the package — what does each one do?

| Flow | Who triggers it | Scopes | Purpose |
|---|---|---|---|
| **Admin Sheets token** | You, once, at project setup | `spreadsheets`, `drive.file` | Backend reads/writes all Google Sheets via Sheets API |
| **User login token** | Each end user at login (Google Sign-In) | `openid email profile` | Proves who the user is — no sheet access whatsoever |

The user login token is discarded after identity is confirmed. Your app issues its own JWT (via NextAuth or similar). The admin Sheets token is what actually touches the data on every CRUD call.

### Does the admin OAuth token expire? How is rotation handled?

Yes — Google access tokens expire in **1 hour**. The `googleapis` library handles rotation automatically:

```
Your API call → googleapis OAuth2Client
                    ↓
           access_token expired?  yes
                    ↓
           use refresh_token → silently get new access_token
                    ↓
           Google Sheets API call succeeds
```

The `refresh_token` is long-lived and does not expire unless explicitly revoked by the user in their Google account settings. You never handle this manually.

### When a student or teacher logs in with Google OAuth, do they use the admin token to access their own sheet?

Yes — in the default setup, **every CRUD call from every user goes through the admin OAuth token**. Here is why:

- `createUserSheet()` creates each user's personal sheet **inside the admin's Google Drive**
- The admin account owns those sheets, so the admin token has full access to all of them
- The user's Google login token has `openid email profile` scopes only — it has zero access to Google Sheets API

The user's token is used exactly once: to verify their identity at login. After that your backend issues them a JWT and the Google token is no longer needed.

**Exception:** If you use `actorTokens` in `createUserSheet()`, the sheet is created in the user's own Google Drive instead. In that case you need to store and manage the user's tokens via `TokenStore` and the adapter will use them for that user's sheet operations.

---

## 2. Actors vs RBAC Roles

### What is an "actor"? How is it different from an application role?

| Concept | Controls | Dynamic? | Defined where |
|---|---|---|---|
| **Actor** | *Where* data is stored — which Google Sheet, which table schemas apply | No — fixed at deploy time in `lsdb.config.ts` | Config file |
| **App RBAC role** | *What* a user is allowed to do (grade students, approve enrollment, view reports) | Yes — rows in your `roles` / `role_permissions` table | Your app's DB layer |

**Wrong mental model:** actor = permission level
**Correct mental model:** actor = storage domain / data namespace

Example for a school management app:
```
Actor "admin"   → one central sheet (users registry, class schedules, enrollment records)
Actor "teacher" → one personal sheet per teacher (their classes, grade books, lesson plans)
Actor "student" → one personal sheet per student (their grades, attendance, assignments)
Actor "parent"  → one personal sheet per parent (their children's info, communications)
```

The fact that the admin panel has sub-roles like registrar / librarian / coordinator is irrelevant to lsdb. Those are RBAC roles — stored in a `roles` table inside the admin sheet and enforced in your middleware. Lsdb just stores and retrieves the rows.

### I read this exact FAQ entry and still modeled RBAC sub-roles as separate actors. Why?

This happened in practice: a team modeled three admin-portal sub-roles (`operation`, `finance`, `marketing`) as three separate actors — each with its own `DEV_*_SHEET_ID` and `lsdb.config.ts` entry — instead of as rows in a `roles`/`role_permissions` table inside one `admin` actor. They had already read this FAQ section before writing the code.

The root cause wasn't the docs — it was the field name. Every actor-config entry and every `withContext()` call read `role: 'operation'`, which looks exactly like an RBAC role assignment at the moment of writing the code. Autocomplete and type hints show the field name, not the prose explaining what it means.

The fix: the field itself no longer says `role` anywhere in the actor-identity path —

| Location | Old (deprecated alias, still works + warns) | Current |
|---|---|---|
| `ActorConfig` (`lsdb.config.ts`) | `role: string` | `name: string` |
| `UserContext` (`withContext()`) | `role: string` | `actor: string` |
| `UserContext` cross-actor target | `targetRole: string` | `targetActor: string` |

If you're tempted to add a new actor whose name looks like an RBAC sub-role (`operation`, `finance`, `viewer`, `editor`...), that's the signal to stop and build a `roles` table inside an existing actor instead.

### My system needs dynamic roles at runtime. Can I create actor schemas dynamically?

No. Actor schemas are static TypeScript files compiled at build time. You cannot add a new table schema while the app is running.

Dynamic permissions belong entirely in your application layer:

```typescript
// roles table in admin sheet: role_id | user_id | role_name | permissions
// Admin panel sub-roles: registrar, librarian, coordinator
function requirePermission(permission: string) {
  return async (req, res, next) => {
    const ctx = adapter.withContext({ userId: 'system', actor: 'admin', actorSheetId: ADMIN_SHEET_ID });
    const userRole = await ctx.table('roles').findOne({ where: { user_id: req.user.id } });
    if (!userRole?.permissions?.includes(permission)) return res.status(403).json({ error: 'Forbidden' });
    next();
  };
}
```

Lsdb stores and retrieves the `roles` table data. Your app enforces it.

### Why do we need `user_id` if every user already has a `sheet_id`?

| Field | Purpose | Survives migration to SQL? |
|---|---|---|
| `sheet_id` | Physical storage location in Google Drive | No — meaningless outside Google Sheets |
| `user_id` | Logical domain identity — your app's true primary key | Yes — becomes `PRIMARY KEY` in your SQL tables |

When you migrate to PostgreSQL or MySQL, `sheet_id` is simply not included in the export. `user_id` ties your entire system together across all tables and services and survives the transition to any database.

---

## 3. Security Model

### All admin-type users (admin, registrar, librarian) share one central sheet. If a registrar gets the Sheet ID, can they see all admin data?

**Only if the Google Sheet is shared with their personal Google account — and it should never be.**

The admin sheet is private on Google Drive. Only the Google account that owns it (your service account or admin Gmail) can open it. A registrar who pastes the Sheet ID into their browser sees a "You need access" page — the same as knowing a private file URL without credentials.

Your staff interact with the system exclusively through your web app. The Sheet ID and admin OAuth token never appear in any client-side code.

The threat model is identical to any backend database: if someone gets your database password they can read your DB. The protection is the same: secure your credentials, never expose them client-side.

### Can I enforce that a librarian cannot see registrar data, even within my own backend?

Lsdb does **not** provide row-level or column-level security within a sheet. All admin-actor data lives in one sheet. Your options:

| Option | Trade-off |
|---|---|
| Enforce RBAC in your API layer (recommended for staging) | All sub-roles see the same sheet but your API only returns what their role allows |
| Split `admin` into multiple actors (`admin-registrar`, `admin-library`) | Each gets its own sheet — more isolation, more complexity, not the intended design |
| Column encryption before writing sensitive values | Protects data at rest but adds read/write complexity |
| Graduate to a production database (PostgreSQL RLS) | First-class row/column-level security — the right answer for production |

For a staging or MVP environment, enforcing RBAC at the API layer is the right call. The full isolation concern belongs to production.

### How do I enforce RBAC between registrar, librarian, and admin users in my API?

```typescript
// Your middleware reads a roles table from the admin sheet
app.get('/api/grades', requireRole(['admin', 'registrar']), async (req, res) => {
  const ctx = adapter.withContext({ userId: 'system', actor: 'admin', actorSheetId: ADMIN_SHEET_ID });
  res.json(await ctx.table('grades').findMany());
});

app.post('/api/enrollments/assign', requireRole(['admin', 'registrar']), async (req, res) => {
  // Only admin and registrar reach here
});
```

Lsdb provides the data storage. Your Express / NestJS / Next.js middleware provides the access control.

---

## 4. Schema Design — Primary Keys & Foreign Keys

### How does `primary()` work?

- Only one `primary()` column allowed per table — throws `SchemaError` if violated
- For `string()` columns: auto-generates a nanoid on `create()` if no value supplied
- For `number()` columns: developer must supply the value
- Implicitly `required()` + `unique()` — no need to chain them explicitly
- On `update()`: PK column is silently stripped from the data (readonly)

```typescript
columns: {
  enrollment_id: string().primary(), // auto-generated nanoid on create
  score_no:      number().primary(), // developer must supply
}
```

### How does `ref()` work for foreign key validation?

```typescript
columns: {
  user_id: string().ref('users.user_id'), // FK — validated against users table
}
```

On `create()` and `update()`, lsdb reads the referenced table and checks the value exists. Throws `ValidationError` if not:

```
FK violation: users.user_id 'u_999' does not exist
```

Rules:
- Both the referenced table and column must be registered on the same adapter instance
- Circular references are detected at `registerSchema()` time (throws `SchemaError`)
- Skip per-call for bulk seeding: `table.create(data, { skipFKValidation: true })`

---

## 5. Schema Versioning & Keeping User Sheets in Sync

### How do I ensure all registered user sheets get the latest schema after I update it?

Two-layer guarantee:

**Layer 1 — Runtime detection via schema hash**

On every `withContext()` call for a non-admin user, lsdb computes a SHA-256 hash of the current schema and compares it against the hash stored in the built-in `schema_versions` admin table. Configure the mismatch behaviour:

```typescript
createSheetAdapter({ onSchemaMismatch: 'warn' })      // log to stderr, continue (default)
createSheetAdapter({ onSchemaMismatch: 'error' })     // throw SchemaMismatchError
createSheetAdapter({ onSchemaMismatch: 'auto-sync' }) // sync the actor sheet before proceeding
```

**Layer 2 — Bulk push via CLI**

```bash
npx lsdb sync --all-users           # push schema changes to every registered user sheet
npx lsdb sync --all-users --dry-run # preview what would change without writing
```

Reads all `actor_sheet_id` values from the admin `users` table, diffs row-1 headers against the current schema, appends any missing columns (additive only — never deletes existing data), and updates `schema_versions` records. Uses exponential backoff (1s → 32s) to handle Google Sheets API rate limits.

### How should I structure `.env` for multiple actor types?

One `DEV_*_SHEET_ID` per non-admin actor for local development:

```env
ADMIN_SHEET_ID=1ABC...
DEV_TEACHER_SHEET_ID=1DEF...
DEV_STUDENT_SHEET_ID=1GHI...
DEV_PARENT_SHEET_ID=1JKL...
```

```typescript
// lsdb.config.ts
actors: [
  { name: 'admin',   sheetIdEnv: 'ADMIN_SHEET_ID' },
  { name: 'teacher', sheetIdEnv: 'DEV_TEACHER_SHEET_ID' },
  { name: 'student', sheetIdEnv: 'DEV_STUDENT_SHEET_ID' },
  { name: 'parent',  sheetIdEnv: 'DEV_PARENT_SHEET_ID' },
]
```

`lsdb init` scaffolds all of these automatically based on the actors you define. In production the `DEV_*` vars are not set — each registered user gets their own personal sheet via `createUserSheet()`.

### What is the dev vs production data model difference?

| | Development | Production |
|---|---|---|
| Actor sheets | One shared sheet per actor type (`DEV_STUDENT_SHEET_ID` used by all students) | One personal sheet per registered user (via `createUserSheet()`) |
| Data isolation | All dev users share one sheet | Each user's data is physically isolated |
| Bugs visible | Only shared-sheet bugs appear | Per-user isolation bugs become visible |

Use `lsdb mock-users` to create separate actor sheets locally that mirror the production topology for more realistic testing.

---

## 6. Multi-Role Users & Role Promotion

### What if a user has multiple roles? (e.g., someone is both a teacher and a parent)

The current design assumes one actor per user. For multi-role users you need to call `createUserSheet()` once per actor type they belong to and store both `actor_sheet_id` values in the admin `users` table (as separate rows or additional columns). When accessing data, switch context based on which actor domain you need.

This is not a built-in feature — it requires application-level logic.

### What if a user gets promoted from one role to another? (e.g., student → teacher)

This is a real constraint of the per-actor-sheet model. Options:

| Option | What happens | When to use |
|---|---|---|
| Leave both sheets | Old sheet stays (data preserved). New sheet created for new actor. | Old data is still needed for historical records |
| Archive the old row | Soft-delete old `users` row, create new one for the new actor | Old data becomes a historical record |
| Don't model it as separate actors | Store all these users in one actor with a `role` column | When role changes are frequent business events |

If role promotion is a common business event in your system, reconsider whether the two role types truly need separate actor sheets or whether they should just be an RBAC role column within the same actor.

---

## 7. Cross-Actor Access

### How does cross-actor access work? (e.g., teacher accessing student data)

Configure a permission matrix when creating the adapter, then use `asActor()` to switch target:

```typescript
const adapter = createSheetAdapter({
  permissions: {
    teacher: {
      canAccess: ['student'],
      tables: ['scores', 'attendance'], // omit to allow all tables
    },
  },
});

const teacherCtx = adapter.withContext({
  userId: 'teacher_001',
  actor: 'teacher',
  actorSheetId: 'teacher-sheet-id',
});

// Switch to student's sheet — asActor() sets targetActor under the hood
const studentCtx = teacherCtx.asActor('student', 'student-sheet-id-123');
await studentCtx.table('scores').create({ student_id: 'stu_456', score: 95 });
const scores = await studentCtx.table('scores').findMany({ where: { student_id: 'stu_456' } });
```

Permission rules:

| Scenario | Result |
|---|---|
| Same actor access | Always allowed |
| Admin access | Bypasses all permission checks |
| Cross-actor — role in `canAccess` list | Allowed |
| Cross-actor — role not in `permissions` | `PermissionError` |
| Cross-actor — table not in `tables` list | `PermissionError` |
| Cross-actor — `targetSheetId` missing | `PermissionError` |

### Can I join tables across actor sheets?

Not yet — planned as `adapter.join()`:

```typescript
// Future API — not yet implemented
const results = await adapter
  .withContext({ userId: 'teacher_001', actor: 'teacher', actorSheetId: '...' })
  .join({
    from: 'scores',
    to: 'students',
    on: { from: 'student_id', to: 'student_id' },
    select: ['scores.*', 'students.name', 'students.email'],
  });
```

The implementation will run parallel queries to both actor sheets and perform an in-memory join in JavaScript.

---

## 8. Migration to Production

### What is the migration path from Google Sheets to a production database?

```
longcelot-sheet-db (dev/staging)
    ↓  npx lsdb migrate --prisma / --sql
    ↓  npx lsdb migrate-data --all-users
MySQL / PostgreSQL + Prisma / Sequelize (production)
```

Every schema maps cleanly to SQL tables. The code swap is minimal:
1. Replace `createSheetAdapter` with your SQL adapter
2. Update CRUD calls (same method names — `create`, `findMany`, `update`, `delete`)
3. No business logic is trapped in Google Sheets

### Which migrate command do I need?

| Goal | Command |
|---|---|
| Copy table structure only (DDL / schema) | `lsdb migrate --prisma` or `lsdb migrate --sql` |
| Copy structure + admin sheet row data | `lsdb migrate-data` |
| Copy structure + all user-sheet row data | `lsdb migrate-data --all-users` |
| Preview export plan without writing files | Add `--dry-run` to either command |

### Why is the schema/DDL export command called `migrate` and the row-data one `migrate-data`?

In standard tooling (Prisma Migrate, Rails, Flyway, Liquibase), "migrate" means schema-only DDL changes — so `migrate` is the command that emits Prisma/SQL schema, and `migrate-data` is the (separately named, separately run) command that moves row data. This package briefly used `export`/`export-data` naming instead; that turned out to be more confusing precisely *because* "migrate" already has an established meaning in the ecosystem this package is meant to hand off to. `lsdb export` and `lsdb export-data` still work as deprecated aliases but emit a deprecation warning.

---

## 9. Developer Workflow & CLI

### After installing the package, what do I need to do?

```bash
# 1. Initialise project (creates config + schemas directory + .env)
npx lsdb init

# 2. Fill in Google OAuth credentials in .env
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=http://localhost:3000/auth/callback
ADMIN_SHEET_ID=...

# 3. Define your schemas in schemas/ directory, or use the interactive generator
npx lsdb generate enrollments

# 4. Sync schemas to Google Sheets (creates tabs and headers)
npx lsdb sync

# 5. Use the adapter in your backend code
```

### How does `lsdb sync` work for multiple actors?

`sync` iterates every actor defined in `lsdb.config.ts` and prints a status table:

```
Actor   │ Sheet ID                   │ Tables │ Status
────────┼────────────────────────────┼────────┼────────────
admin   │ 1ABCyourAdminSheetId       │ 3      │ ✅ synced
teacher │ 1DEFyourTeacherSheetId     │ 5      │ ✅ synced
student │ 1GHIyourStudentSheetId     │ 6      │ ✅ synced
parent  │ (not set)                  │ 2      │ ⚠ skipped
```

Actors whose `DEV_*_SHEET_ID` env var is not set are skipped with a warning (non-fatal). Sync is additive — it creates missing tabs and appends missing column headers but never deletes existing data.

### What CLI commands are available?

| Command | What it does |
|---|---|
| `lsdb init` | Scaffold config, `.env`, schemas directory |
| `lsdb init --integrate` | Merge into existing project without overwriting files |
| `lsdb generate <name>` | Interactive schema generator |
| `lsdb sync` | Sync all actor schemas to Google Sheets |
| `lsdb sync --all-users` | Also push schema changes to every registered user sheet |
| `lsdb sync --all-users --dry-run` | Preview `--all-users` changes without applying |
| `lsdb sync --token-file <path>` | CI/CD: load pre-stored tokens file, skip interactive OAuth |
| `lsdb validate` | Validate all schema files for errors |
| `lsdb seed <file>` | Seed data from a JS/TS file |
| `lsdb seed <file> --skip-existing` | Skip rows where a unique column already matches |
| `lsdb seed <file> --upsert` | Update on unique conflict instead of throwing |
| `lsdb seed <file> --all-actors` | Distribute seed data to all registered user sheets |
| `lsdb mock-users [count]` | Create mock Google Sheets for dev/testing (default: 3) |
| `lsdb migrate --prisma` | Export schemas to `schema.prisma` |
| `lsdb migrate --sql` | Export schemas to SQL `CREATE TABLE` DDL |
| `lsdb migrate-data` | Generate data export script (admin sheet) |
| `lsdb migrate-data --all-users` | Generate data export script (admin + all user sheets) |
| `lsdb migrate-data --all-users --dry-run` | Preview export plan without writing files |
| `lsdb drop-table [names...]` | Delete table schema file(s) + Google Sheet tab(s) — interactive if no names given |
| `lsdb drop-column [table] [cols...]` | Delete column(s) from a table's schema file + live sheet |
| `lsdb rename-column [table] [old] [new]` | Rename a column in place — schema file + sheet header, data preserved |
| `lsdb erdiagram [--output <file>] [--yes]` | Generate a Mermaid ER diagram (`ER-DIAGRAM.md`) of tables and `ref()` relationships |
| `lsdb doctor` | Health check: env vars, config, OAuth tokens, schema directory |
| `lsdb status` | Show actors, env var values, OAuth state, all registered tables |

### How do I use `lsdb sync` in a CI/CD pipeline without interactive OAuth?

```bash
# Store tokens as a CI secret, inject at build time
echo "$LSDB_TOKENS" > /tmp/tokens.json
npx lsdb sync --token-file /tmp/tokens.json
```

The `--token-file` flag loads a pre-stored tokens JSON file and skips the interactive browser OAuth prompt entirely.

---

## 10. Sheet Formatting & Data Validation

### Does lsdb do anything to make the raw Google Sheet readable, or is it just plain cell writes?

Every tab created or extended by `sync` / `syncSchema()` / `createUserSheet()` is formatted automatically — no config needed:

- **Auto-fit columns** — header and data columns are resized to fit their content, so long values (emails, JSON-array columns, long enum strings) aren't visually truncated.
- **Header row styling** — a light fill color is applied to row 1, and the header row is frozen by default so it stays visible while scrolling.
- **Data validation dropdowns** — `boolean()` columns get a dropdown restricted to `TRUE`/`FALSE` (or `1`/`0`, configurable — see below); `string().enum([...])` columns get a dropdown restricted to the declared values. Both use the same `ONE_OF_LIST` mechanism, deliberately — see the incident write-up below for why.

This runs whenever headers are written (new tab creation, or new columns appended by `sync`) — not on every no-op sync, to avoid unnecessary Google Sheets API calls.

### Can I customize the header color or freeze the first column too?

Yes, via `sheetStyle` on `createSheetAdapter()`:

```typescript
const adapter = createSheetAdapter({
  // ...
  sheetStyle: {
    headerColor: '#E8F0FE',   // optional — this is also the built-in default
    freezeHeader: true,       // default: true
    freezeFirstColumn: false, // default: false
  },
});
```

Auto-fit column width and boolean/enum data validation are always applied and can't be turned off — they have no downside to leaving on. The `boolean()` value pair itself *is* configurable — see the next section.

### If I manually type an invalid value into a dropdown-restricted cell anyway, what happens?

The Sheets-native dropdown is a UI guard, not a hard constraint — `setDataValidation` is applied with `strict: true`, which makes Google Sheets reject the edit with an in-cell warning. It does not replace SDK-level validation: `create()`/`update()` calls through the adapter still validate `enum()`/`boolean()` values independently, since the dropdown only protects against *manual* edits made directly in the spreadsheet UI.

### Why did `findMany()` return ~1000 rows full of `null` after syncing a `boolean()`/`enum()` column? (incident write-up)

This was a real bug (fixed — see CHANGELOG.md "Phase 11"), not expected behavior. Root cause: `setDataValidation` was applied with no `endRowIndex`, which the Sheets API treats as unbounded — it extends to the tab's full default grid (1000 rows for a fresh tab). Every `boolean()`/`enum()` column then got checkbox/dropdown formatting on all 1000 rows, not just the rows holding real data.

The second-order effect is what made this expensive: a `values.get` range read trims to the last cell with *any* content, and Sheets counts a formatted-but-empty cell as content. So every subsequent read of that tab dragged in every formatted row as a row of `null`s — `_id: null` included — bloating a 2-row response into 1001 rows.

Two independent fixes, both now shipped:
- The validation range is bounded to existing data rows + a 200-row buffer instead of the unbounded default, so newly-synced tabs don't balloon to 1000 formatted rows in the first place.
- `findMany()`/`update()`/`count()`/`delete()` now filter out any row with an empty `_id` before returning it, regardless of cause — this protects sheets that were already synced under the old buggy behavior, with no re-sync required.

If you're on an older version and can't upgrade immediately, the safe workaround is to filter `_id == null` rows out of `findMany()` results in your own code before using them.

### After the fix above, why did checkbox/dropdown UI stop appearing past row ~200 on a table that only ever called `create()`?

Follow-up to the incident above, not a separate bug. The 200-row buffer bounds the validation range *at the moment `lsdb sync` last ran* — it's a one-time snapshot of `dataRowCount + 200`, not something `create()` was originally aware of or kept extending. A table that grows from 5 rows to 250 rows over weeks of normal app usage, with no schema changes in between, gets validation UI through row ~205 and plain cells for every row after that — silent, since reads/writes through the SDK are unaffected either way; it only shows up if someone opens the raw sheet.

Fixed: `create()` now self-heals. Every 100 rows (half the 200-row buffer, so coverage can't run out between checks) it re-extends the validated range another 200 rows via the new `SheetClient.extendValidation()`, using the row number the Sheets API's own append response already tells it — no extra read required to know "how many rows are there now." It's skipped entirely for schemas with no `boolean()`/`enum()` columns, and it's deliberately scoped to `create()` only: bulk inserts via `createMany()` (seeding, migrations) still expect a manual `lsdb sync` afterward, the same as before.

### Why does `boolean()` use a dropdown instead of a real checkbox? Wasn't the checkbox nicer?

This closes the actual root cause of the phantom-rows incident above, specifically for `boolean()` columns. Google Sheets' native checkbox validation (condition type `BOOLEAN`) isn't just a rendering choice — applying it to a range sets every *blank* cell in that range to a real, stored `FALSE`. That's different from `ONE_OF_LIST` (what `enum()` already used): an unselected dropdown cell stays genuinely empty until something is written to it. So a row with literally nothing in it was never "empty" once `boolean()` formatting reached it — one cell in that row already held `FALSE`. `enum()`-only tables were never susceptible to this on their own.

`boolean()` now uses `ONE_OF_LIST` too, rendered as a dropdown of `'TRUE'`/`'FALSE'` text instead of a checkbox glyph. The bounded-range and defensive-`_id`-filter fixes from the incident above are still in place — this closes one more contributing cause, it doesn't replace them.

```typescript
// Project-wide default (falls back to 'TRUE_FALSE'):
createSheetAdapter({
  sheetStyle: { booleanFormat: '1_0' }, // or 'TRUE_FALSE'
});

// Per-column override, takes priority over the project-wide default:
columns: {
  legacy_flag: boolean({ format: '1_0' }), // this table's external system expects 1/0
  active: boolean(),                       // uses the project-wide default
}
```

Existing sheets are unaffected at the data level — already-written cells already hold literal `TRUE`/`FALSE` text underneath the old checkbox widget, and `deserializeRow()` accepts both `'TRUE'` and `'1'` as true regardless of which format is currently configured, so rows written before and after a format change both read back correctly. The only visible change is cosmetic: a dropdown showing text instead of a checkbox tick, starting from the next `lsdb sync`.

### Why did a `date()` column read back as unparseable, wrapped in literal quote characters? (incident write-up)

This was a real bug (fixed in `longcelot-sheet-db@0.1.31` — see CHANGELOG.md), not expected behavior. A downstream app called `create()` with a native `Date` instance for a `date()` column (e.g. `schedule_date: new Date(payload.scheduleStartDate)`) instead of pre-converting it with `.toISOString()`. `serializeValue()` had no special case for `Date` — `typeof value === 'object'` is true for a `Date`, so it fell straight into the generic `JSON.stringify(value)` branch meant for plain objects/arrays. `JSON.stringify()` on a `Date` calls its `.toJSON()` method, which returns the ISO string, but `JSON.stringify` still wraps *any* string result in a literal pair of `"` characters — so the cell ended up holding the 28-character text `"2026-07-14T03:00:00.000Z"`, quotes included, instead of the 24-character ISO string.

The second-order effect is what made this a crash, not just a cosmetic wart: every consumer that read that cell back and called `new Date(cellValue)` — the exact pattern used everywhere else in this package for `_created_at`/`_updated_at` — got an Invalid Date, because `new Date('"2026-07-14T03:00:00.000Z"')` (with the quote characters as part of the string) does not parse. One downstream admin dashboard piped that straight into a date-formatting call with no guard, which throws on an invalid date and — with no error boundary — took down the entire page render.

Two independent fixes, both now shipped:
- `serializeValue()` now checks `value instanceof Date` *before* the generic object branch and normalizes it with `.toISOString()` — a `Date` and an ISO string passed to `create()`/`update()` now produce byte-identical cell text.
- `deserializeRow()` gained a `case 'date'` that strips a wrapping quote pair if present and re-parses the result, so **rows already corrupted by the old behavior self-heal automatically on the next read** — no backfill script or manual sheet edit needed. If the cell still isn't a parseable date after unwrapping (e.g. someone hand-typed garbage into the sheet), it's returned unwrapped and unchanged rather than silently discarded.

If you're on an older version and can't upgrade immediately, the safe workaround on the write side is the same discipline `_created_at`/`_updated_at` already use internally: always call `.toISOString()` yourself before passing a value into a `date()` column, never pass a raw `Date` instance.

---

## 11. Google Sheets API Rate Limits & Read Caching

### Why did our backend start throwing `429 RESOURCE_EXHAUSTED` / "Read requests per minute per user" errors? (incident write-up)

This was a real incident, not expected behavior at normal usage. Root cause: `SheetClient.getAllRows()` had **zero caching** — every `findMany()`, `findOne()`, `count()`, `update()`, and `delete()` call issued a brand-new `values.get` request for the entire tab (`A:ZZ`), no matter how recently the same tab had just been read.

Two things made this compound quickly under real traffic:

1. **A single logical operation can call `getAllRows()` several times.** `checkUniqueness()` calls `findOne()` once per `unique()` column, and `create()`/`update()` each call it independently — a table with 3 unique columns did 3+ full-tab reads for one `create()` call.
2. **Concurrent requests don't share anything.** Multiple users (or multiple admin-portal tabs) hitting the same catalog endpoint (e.g. a roles/permissions matrix loaded on every request) each triggered their own full read, with no coordination between them.

Google's default Sheets API quota is **60 read requests per minute per user** (project-level default; some projects are provisioned lower). A handful of concurrent admin users browsing a few list pages is enough to blow through that in seconds — and by the time gaxios's built-in retry (3 attempts with backoff) gives up, that's a sign of sustained overuse, not a transient blip.

### How is this fixed?

`SheetClient` now has a built-in in-memory read cache (default: enabled, 2-second TTL):

- Repeated `getAllRows()` calls for the same `spreadsheetId` + tab within the TTL window return the cached result instead of hitting the API again.
- Concurrent calls for the same tab — even before the first one resolves — share a single in-flight request instead of each firing their own.
- Every write (`appendRow`, `appendRows`, `updateRow`, `deleteRow`, `writeHeader` — and therefore `create()`, `update()`, `delete()`, `createMany()`, `syncSchema()` at the adapter level) invalidates that tab's cache entry, so a read immediately after a write through the same adapter instance always sees fresh data.
- A failed read (e.g. the 429 itself) is never cached — the next call retries against the API rather than being stuck replaying an error.

```typescript
const adapter = createSheetAdapter({
  // ...
  cache: { ttlMs: 5000 }, // widen the window further for read-heavy dashboards
});
```

See [`SheetReadCacheConfig`](./API.md#sheetreadcacheconfig) in API.md for the full option shape.

### Can I turn the cache off? Should I?

You can (`cache: { enabled: false }`), but there's no real reason to — the cache only ever serves data that came from this same process's own reads, and every write path invalidates it automatically, so it never masks your own writes. The only staleness window is for changes made *outside* this adapter instance (a human editing the sheet directly, or a second server process sharing the same spreadsheet) — bounded by `ttlMs`, default 2 seconds. If that staleness window is a real problem for a specific table, call `adapter.getClient().invalidateCache(spreadsheetId, sheetName)` after the external change instead of disabling the cache globally.

### The cache smooths out bursts, but is Google Sheets the right backing store for a busier production admin panel?

The cache buys real headroom (it can turn N reads within a burst into 1 API call), but it's still a per-process, best-effort layer, not a substitute for a real database's read scalability. If you're consistently near quota even with caching — many concurrent staff users, or dashboards that poll frequently — that's a signal you're past the intended use case for lsdb (staging/MVP/internal tools) and it's time to look at [migrating to a production database](#8-migration-to-production). In the meantime, also consider: requesting a Sheets API quota increase in Google Cloud Console, reducing frontend polling/refetch frequency (e.g. React Query `staleTime`), and batching multiple table reads behind a single request handler rather than issuing them from several separate endpoints.

---

## 12. Dropping & Renaming Schema Elements

### `sync` never deletes anything. How do I remove a table or column I no longer need?

`sync`/`syncSchema()` is deliberately additive-only — see [§5](#5-schema-versioning--keeping-user-sheets-in-sync) and [§9](#9-developer-workflow--cli): it creates missing tabs and appends missing columns, but never removes or renames anything, so it can never silently lose data on its own. That's a feature, not a gap — but it means deleting a table/column from the schema file alone does nothing to the live sheet.

Use the dedicated commands instead, each of which touches the schema file *and* the live Google Sheet together, with a confirmation prompt and `--dry-run`:

```bash
npx lsdb drop-table bookings                     # deletes the schema file + the sheet tab
npx lsdb drop-column bookings notes               # deletes the column from schema file + sheet
npx lsdb rename-column bookings notes remarks     # renames in place — data preserved
```

All three accept `--all-users` to also apply the change to every registered user's personal sheet (same `actor_sheet_id` lookup from the admin `users` table that `sync --all-users` and `migrate-data --all-users` use), `--yes` to skip the confirmation prompt for scripting, and `--token-file` for CI.

### Why does `rename-column` edit the header cell in place instead of dropping the old column and adding the new one?

Drop-and-re-add would work syntactically (schema file ends up correct either way) but it's a real data-loss trap: deleting a Google Sheets column deletes every value in it, and there's no way to "re-add" that data under the new name afterward — it's already gone. `rename-column` instead resolves the column's current position in the sheet's live header row and overwrites just that one header cell (`SheetClient.updateHeaderCell()`), leaving every data row completely untouched. This is the whole point of having a dedicated rename command rather than telling developers to "drop it and add a new one" — the naive approach is the one that loses data, especially painful if it happens across every registered user's sheet on the next `--all-users` run.

### If I rename or drop a column that another table's `ref()` points at, does lsdb fix that for me?

No — this is a real limitation, not an oversight. `ref('table.column')` is a plain string embedded in a *different* schema file (`.ref('bookings.notes')` inside, say, `schemas/user/comments.ts`). `rename-column`/`drop-column`/`drop-table` scan every loaded schema for a matching `ref()` and print a warning listing which other tables are affected, but they don't rewrite those strings automatically — editing another table's schema file as a side effect of an unrelated command felt more surprising than helpful, and `ref()` values are also used for genuinely intentional FK relationships you may want to review by hand anyway. Treat the warning as a checklist: go update those `ref()` calls yourself, then re-run `lsdb sync` (or the app will start throwing `SchemaError: Referenced table 'X' is not registered`-style FK validation failures against the old name).

### Can I drop a table's primary key column, or the auto-generated `_id`/`_created_at`/`_updated_at`/`_deleted_at` columns?

No, both are blocked on purpose. The reserved columns (`_id`, `_created_at`, `_updated_at`, `_deleted_at`) are managed entirely by `defineTable()` — see [Schema Definition](./skills/schema/SKILL.md) — and were never meant to be hand-edited. The primary key is blocked from `drop-column` specifically (renaming it is fine) because dropping a table's identity column is a strictly bigger operation than removing a regular column; if you actually want to get rid of the whole data domain, `drop-table` is the explicit way to say that.

### Does `drop-column`/`rename-column` know which column is which if `sync` appended new columns out of order?

Yes — they resolve each column's position from the sheet's *current* header row (a fresh read via `getAllRows()`) rather than from the schema file's declared column order. Those two orders can genuinely differ: `syncSchema()` appends newly-added columns to the end of the header row rather than reordering existing ones, so a schema file's top-to-bottom column order is not guaranteed to match what's actually in row 1 of the sheet. Resolving live, per sheet, per run avoids deleting or renaming the wrong column when file order and sheet order have drifted apart.
