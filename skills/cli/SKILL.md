---
name: cli
description: Use the longcelot-sheet-db CLI (lsdb). Use when running lsdb init, generate, sync, validate, seed, mock-users, doctor, status, migrate, migrate-data, drop-table, drop-column, or rename-column commands — or when scaffolding a new project, generating schema files, syncing schemas to Google Sheets (including CI-friendly --token-file), seeding with --skip-existing or --upsert, diagnosing configuration issues, exporting schemas to Prisma/SQL, pushing schema changes to all user sheets, or removing/renaming a table or column safely (schema file + live sheet together).
license: MIT
metadata:
  package: longcelot-sheet-db
  version: "0.1.29"
---

# longcelot-sheet-db — CLI Reference (`lsdb`)

All commands are available as `lsdb <command>` (global install) or via:

```bash
npx lsdb <command>
pnpm dlx lsdb <command>
yarn dlx lsdb <command>
bunx lsdb <command>
```

---

## init — Scaffold a new project

```bash
npx lsdb init
npx lsdb init --integrate   # merge into existing project without overwriting
```

**What it creates:**
- `lsdb.config.ts` — Project configuration (project name, actors with env var mapping)
- `.env` — Environment variable template (one `DEV_*_SHEET_ID` per actor)
- `schemas/` — Schemas directory with default admin schemas (`users`, `credentials`, `schema_versions`)

Run `init` **once** when first adding the package. Use `--integrate` to add it to an existing project without overwriting existing files.

---

## generate — Interactive schema generator

```bash
npx lsdb generate bookings
```

Launches an interactive prompt to define columns (name, type, modifiers). Writes a new schema file to `schemas/<actor>/`.

---

## sync — Sync schemas to Google Sheets

```bash
npx lsdb sync                          # sync all actor sheets
npx lsdb sync --all-users              # also push to all registered user sheets
npx lsdb sync --all-users --dry-run    # preview --all-users changes without writing
npx lsdb sync --token-file /tmp/t.json # CI/CD: load tokens from file, skip OAuth prompt
```

**What it does:**
1. Loads all schemas from `schemas/`
2. Validates environment variables
3. **Auth**: reads `.lsdb-tokens.json`, refreshes if stale, prompts for browser auth if absent
4. Calls `syncSchema()` for every schema — creates missing tabs and adds missing headers
5. Prints a per-actor status table:

```
Actor      │ Sheet ID                   │ Tables   │ Status
───────────┼────────────────────────────┼──────────┼────────────
admin      │ 1ABCyourAdminSheetId       │ 3        │ ✅ synced
student    │ 1DEFyourStudentSheetId     │ 5        │ ✅ synced
teacher    │ (not set)                  │ 4        │ ⚠ skipped
```

**`--all-users`** — reads all rows from admin `users` table and pushes schema changes to every registered user sheet. Uses exponential backoff (1 s → 32 s) to handle Google Sheets API rate limits.

**`--token-file <path>`** — CI/CD-friendly. Load a pre-stored tokens JSON instead of the interactive browser prompt:

```bash
# GitHub Actions example
echo "$LSDB_TOKENS" > /tmp/tokens.json
npx lsdb sync --token-file /tmp/tokens.json
```

> `.lsdb-tokens.json` is written to the project root on first interactive auth. Add it to `.gitignore`. Never commit OAuth tokens.

---

## validate — Validate all schemas

```bash
npx lsdb validate
```

Checks all schema files in `schemas/` for:
- Duplicate table names within the same actor
- Invalid column modifiers
- Unknown actor references (actor not listed in `lsdb.config.ts`)
- Missing required schema fields (`name`, `actor`, `columns`)

Use in CI to catch schema problems before `sync`.

---

## seed — Load initial/test data

```bash
npx lsdb seed <seed-file>
npx lsdb seed seeds/admin.ts --skip-existing   # skip on unique conflict (idempotent)
npx lsdb seed seeds/admin.ts --upsert          # update on unique conflict
npx lsdb seed seeds/users.ts --all-actors      # distribute data across all user sheets
```

### Seed file formats

**Static (plain object):**

```typescript
// seeds/admin.ts
export default {
  users: [
    { email: 'admin@example.com', role: 'admin', status: 'active' },
  ],
}
```

**Dynamic (function — receives `process.env`):**

```typescript
// seeds/admin.ts
export default async function(env: NodeJS.ProcessEnv) {
  return {
    users: [
      { email: env.SUPER_ADMIN_EMAIL, role: 'admin', status: 'active' },
    ],
  }
}
```

Use the dynamic form when seed data depends on environment variables or CLI arguments.

**Flags:**

| Flag | Effect |
|---|---|
| `--skip-existing` | Skip rows where a unique column already matches — no error, no overwrite |
| `--upsert` | Update existing row on unique conflict instead of throwing |
| `--all-actors` | Distribute seed data across all registered user sheets (reads from admin `users` table) |

---

## mock-users — Create test user sheets

```bash
npx lsdb mock-users
npx lsdb mock-users 5   # create 5 mock users
```

Generates mock Google Sheets for development/testing. Lets you inspect what real users see without registering real accounts.

---

## doctor — Diagnostics and health checks

```bash
npx lsdb doctor
```

Checks:
- All required environment variables are set
- Google OAuth credentials are valid
- `lsdb.config.ts` structure is correct
- `.lsdb-tokens.json` exists and is readable

Run `doctor` first when debugging mysterious adapter errors.

---

## status — Show project status

```bash
npx lsdb status
```

Displays registered tables, actors, sheet IDs, schema counts, and token info.

---

## migrate — Export schemas to SQL/Prisma

```bash
npx lsdb migrate --prisma --output ./prisma    # generate schema.prisma
npx lsdb migrate --sql --output ./migrations   # generate CREATE TABLE DDL
```

Exports all table schemas to a target format. Use as a starting point when migrating from Google Sheets to a production database. For the full migration guide see `skills/migrations/SKILL.md`.

> Deprecated alias: `lsdb export` still works but emits a deprecation warning.

---

## migrate-data — Generate data migration script

```bash
npx lsdb migrate-data
npx lsdb migrate-data --table users --output ./scripts
npx lsdb migrate-data --all-users              # also export every registered user sheet
npx lsdb migrate-data --dry-run                # preview plan without writing files
```

Generates a `migrate-data.js` script with `insertRow()` stubs. Replace the stubs with your production DB client to transfer data row-by-row.

> Deprecated alias: `lsdb export-data` still works but emits a deprecation warning.

---

## drop-table — Delete a table's schema file + Google Sheet tab

```bash
npx lsdb drop-table bookings
npx lsdb drop-table bookings old_notifications --all-users
npx lsdb drop-table                            # interactive checkbox over every table
npx lsdb drop-table --dry-run
```

`sync` never deletes anything on its own (see `skills/migrations/SKILL.md`) — this is the explicit way to remove a table from both the schema file and the live sheet. Deletes the schema file, then the corresponding Google Sheet tab (and, with `--all-users`, the tab in every registered user's personal sheet). Prints a plan and asks for confirmation first (`--yes` to skip). Warns if another table's `ref()` points at the one being dropped.

---

## drop-column — Delete column(s) from a table

```bash
npx lsdb drop-column bookings notes
npx lsdb drop-column bookings                  # interactive checkbox over that table's columns
npx lsdb drop-column                           # interactive: pick table, then columns
npx lsdb drop-column bookings notes --all-users --yes
```

Removes column(s) from the schema file and deletes the matching column(s) — and all data in them — from the live Google Sheet. Resolves each column's *current* position from the sheet's header row, not the schema file's declared order (`sync` appends new columns at the end, so they can differ). Refuses to drop reserved columns (`_id`, `_created_at`, `_updated_at`, `_deleted_at`) or a table's primary key column — drop the whole table instead if that's really the intent.

---

## rename-column — Rename a column without losing data

```bash
npx lsdb rename-column bookings notes remarks
npx lsdb rename-column                         # fully interactive: table, column, new name
npx lsdb rename-column bookings notes remarks --all-users
```

Renames the column's key in the schema file and overwrites the Google Sheet **header cell in place** — existing row data is preserved, unlike a drop-and-re-add. This is what prevents the real risk it closes: renaming a column in the schema file alone desyncs every existing row from that point on, and a later `sync`/`auto-sync` has no way to recover data under the old header name. Warns (doesn't block) if another table's `ref()` points at the old name — those `ref()` strings in other schema files aren't rewritten automatically.

---

## lsdb.config.ts structure

```typescript
import type { SheetDBConfig } from 'longcelot-sheet-db';

export default {
  projectName: 'my-app',
  superAdminEmail: 'admin@example.com',
  actors: [
    { name: 'admin',   sheetIdEnv: 'ADMIN_SHEET_ID' },
    { name: 'student', sheetIdEnv: 'DEV_STUDENT_SHEET_ID' },
    { name: 'teacher', sheetIdEnv: 'DEV_TEACHER_SHEET_ID' },
  ],
  onSchemaMismatch: 'warn', // 'warn' | 'error' | 'auto-sync'
} satisfies SheetDBConfig;
```

The `sheetIdEnv` field tells each CLI command which env var holds the sheet ID for that actor.

---

## Common Mistakes

- **Running `sync` without `.env` configured** — `sync` fails at OAuth if env vars are missing. Run `doctor` first.
- **Committing `.lsdb-tokens.json`** — Contains OAuth refresh tokens. Verify it is in `.gitignore` before any push.
- **Not running `sync` after schema changes** — Schema files are the source of truth. New columns don't appear in Sheets until `sync` runs.
- **Re-seeding without `--skip-existing`** — Running `seed` twice throws `ValidationError: Unique constraint violation` for any unique column. Use `--skip-existing` for idempotent seeds or `--upsert` to update.
- **Forgetting `--token-file` in CI** — Without it, `sync` blocks waiting for interactive input and the CI job hangs.
- **Using a dynamic seed file without `export default async function`** — Named exports or non-function defaults are treated as the static plain-object format and must return `Record<string, unknown[]>` directly.
- **Expecting `drop-column`/`drop-table` to be additive-safe like `sync`** — They're destructive by design: real Google Sheets columns/tabs (and all data in them) are deleted. Always run with `--dry-run` first if unsure, especially with `--all-users`.
- **Renaming a column in the schema file by hand instead of `rename-column`** — A manual rename leaves the live sheet's header on the old name, silently desyncing every existing row. Use `lsdb rename-column` so the schema file and sheet header change together.
- **Expecting `rename-column`/`drop-column` to update `ref()` strings in other schema files** — They warn if another table's `ref('table.column')` points at what's being renamed/dropped, but don't rewrite it for you. Update those `ref()` calls manually.
