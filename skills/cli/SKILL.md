---
name: cli
description: Use the longcelot-sheet-db CLI (sheet-db). Use when running sheet-db init, generate, sync, validate, seed, mock-users, doctor, status, export, or migrate commands — or when scaffolding a new project, generating schema files, syncing schemas to Google Sheets (including CI-friendly --token-file), seeding with --skip-existing or --upsert, diagnosing configuration issues, exporting schemas to Prisma/SQL, or pushing schema changes to all user sheets.
license: MIT
metadata:
  package: longcelot-sheet-db
  version: "0.1.15"
---

# longcelot-sheet-db — CLI Reference (`sheet-db`)

All commands are available as `sheet-db <command>` (global install) or via:

```bash
npx sheet-db <command>
pnpm dlx sheet-db <command>
yarn dlx sheet-db <command>
bunx sheet-db <command>
```

---

## init — Scaffold a new project

```bash
npx sheet-db init
npx sheet-db init --integrate   # merge into existing project without overwriting
```

**What it creates:**
- `sheet-db.config.ts` — Project configuration (project name, actors with env var mapping)
- `.env` — Environment variable template (one `DEV_*_SHEET_ID` per actor)
- `schemas/` — Schemas directory with default admin schemas (`users`, `credentials`, `schema_versions`)

Run `init` **once** when first adding the package. Use `--integrate` to add it to an existing project without overwriting existing files.

---

## generate — Interactive schema generator

```bash
npx sheet-db generate bookings
```

Launches an interactive prompt to define columns (name, type, modifiers). Writes a new schema file to `schemas/<actor>/`.

---

## sync — Sync schemas to Google Sheets

```bash
npx sheet-db sync                          # sync all actor sheets
npx sheet-db sync --all-users              # also push to all registered user sheets
npx sheet-db sync --all-users --dry-run    # preview --all-users changes without writing
npx sheet-db sync --token-file /tmp/t.json # CI/CD: load tokens from file, skip OAuth prompt
```

**What it does:**
1. Loads all schemas from `schemas/`
2. Validates environment variables
3. **Auth**: reads `.sheet-db-tokens.json`, refreshes if stale, prompts for browser auth if absent
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
echo "$SHEET_DB_TOKENS" > /tmp/tokens.json
npx sheet-db sync --token-file /tmp/tokens.json
```

> `.sheet-db-tokens.json` is written to the project root on first interactive auth. Add it to `.gitignore`. Never commit OAuth tokens.

---

## validate — Validate all schemas

```bash
npx sheet-db validate
```

Checks all schema files in `schemas/` for:
- Duplicate table names within the same actor
- Invalid column modifiers
- Unknown actor references (actor not listed in `sheet-db.config.ts`)
- Missing required schema fields (`name`, `actor`, `columns`)

Use in CI to catch schema problems before `sync`.

---

## seed — Load initial/test data

```bash
npx sheet-db seed <seed-file>
npx sheet-db seed seeds/admin.ts --skip-existing   # skip on unique conflict (idempotent)
npx sheet-db seed seeds/admin.ts --upsert          # update on unique conflict
npx sheet-db seed seeds/users.ts --all-actors      # distribute data across all user sheets
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
npx sheet-db mock-users
npx sheet-db mock-users 5   # create 5 mock users
```

Generates mock Google Sheets for development/testing. Lets you inspect what real users see without registering real accounts.

---

## doctor — Diagnostics and health checks

```bash
npx sheet-db doctor
```

Checks:
- All required environment variables are set
- Google OAuth credentials are valid
- `sheet-db.config.ts` structure is correct
- `.sheet-db-tokens.json` exists and is readable

Run `doctor` first when debugging mysterious adapter errors.

---

## status — Show project status

```bash
npx sheet-db status
```

Displays registered tables, actors, sheet IDs, schema counts, and token info.

---

## export — Export schemas to SQL/Prisma

```bash
npx sheet-db export --prisma --output ./prisma    # generate schema.prisma
npx sheet-db export --sql --output ./migrations   # generate CREATE TABLE DDL
```

Exports all table schemas to a target format. Use as a starting point when migrating from Google Sheets to a production database. For the full migration guide see `skills/migrations/SKILL.md`.

---

## migrate — Generate data migration script

```bash
npx sheet-db migrate
npx sheet-db migrate --table users --output ./scripts
npx sheet-db migrate --dry-run   # preview plan without writing files
```

Generates a `migrate.js` script with `insertRow()` stubs. Replace the stubs with your production DB client to transfer data row-by-row.

---

## sheet-db.config.ts structure

```typescript
import type { SheetDBConfig } from 'longcelot-sheet-db';

export default {
  projectName: 'my-app',
  superAdminEmail: 'admin@example.com',
  actors: [
    { role: 'admin',   sheetIdEnv: 'ADMIN_SHEET_ID' },
    { role: 'student', sheetIdEnv: 'DEV_STUDENT_SHEET_ID' },
    { role: 'teacher', sheetIdEnv: 'DEV_TEACHER_SHEET_ID' },
  ],
  onSchemaMismatch: 'warn', // 'warn' | 'error' | 'auto-sync'
} satisfies SheetDBConfig;
```

The `sheetIdEnv` field tells each CLI command which env var holds the sheet ID for that actor.

---

## Common Mistakes

- **Running `sync` without `.env` configured** — `sync` fails at OAuth if env vars are missing. Run `doctor` first.
- **Committing `.sheet-db-tokens.json`** — Contains OAuth refresh tokens. Verify it is in `.gitignore` before any push.
- **Not running `sync` after schema changes** — Schema files are the source of truth. New columns don't appear in Sheets until `sync` runs.
- **Re-seeding without `--skip-existing`** — Running `seed` twice throws `ValidationError: Unique constraint violation` for any unique column. Use `--skip-existing` for idempotent seeds or `--upsert` to update.
- **Forgetting `--token-file` in CI** — Without it, `sync` blocks waiting for interactive input and the CI job hangs.
- **Using a dynamic seed file without `export default async function`** — Named exports or non-function defaults are treated as the static plain-object format and must return `Record<string, unknown[]>` directly.
