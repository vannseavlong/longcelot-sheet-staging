---
name: migrations
description: Manage schema versions and migrate data out of longcelot-sheet-db. Use when exporting schemas to Prisma or SQL DDL, generating a data migration script, pushing schema changes to all registered user sheets with sync --all-users, dropping or renaming a table/column safely (schema file + live sheet + schema_versions together), configuring onSchemaMismatch detection, understanding the schema_versions admin table, or planning a migration from Google Sheets to a production database.
license: MIT
metadata:
  package: longcelot-sheet-db
  version: "0.1.29"
---

# longcelot-sheet-db — Schema Versioning & Migrations

---

## 1. Schema Version Tracking (Runtime)

`longcelot-sheet-db` hashes every registered schema (SHA-256) and stores the hash in the built-in `schema_versions` admin table. On every `withContext()` call for a non-admin user, the current hash is compared against the stored hash for that user's sheet.

### schema_versions table (built-in)

Scaffolded automatically by `lsdb init`. Do not modify this table's schema manually.

| Column | Type | Description |
|---|---|---|
| `schema_version_id` | string PK | auto-generated |
| `actor_sheet_id` | string | the user's sheet ID |
| `table_name` | string | the table being tracked |
| `schema_hash` | string | SHA-256 of the schema definition |
| `synced_at` | string | ISO timestamp of last successful sync |
| `column_count` | number | number of columns at sync time |

### Configure mismatch behavior

```typescript
const adapter = createSheetAdapter({
  // ...
  onSchemaMismatch: 'warn',      // log to stderr, continue (default)
  // onSchemaMismatch: 'error',  // throw SchemaMismatchError
  // onSchemaMismatch: 'auto-sync', // silently sync the user sheet before proceeding
});
```

| Mode | When to use |
|---|---|
| `'warn'` | Safe default — alerts without blocking. Good for gradual rollouts. |
| `'error'` | Hard-fail stale clients in staging/test. Catch issues early. |
| `'auto-sync'` | Seamless self-healing. Adds latency on mismatch but users never see errors. |

### computeSchemaHash() utility

```typescript
import { computeSchemaHash } from 'longcelot-sheet-db';

const hash = computeSchemaHash(bookingsSchema);
// Deterministic SHA-256 string — same schema definition always produces the same hash
```

---

## 2. sync --all-users (Bulk Schema Push)

After schema changes, push updates to every registered user sheet:

```bash
npx lsdb sync --all-users              # apply to all users
npx lsdb sync --all-users --dry-run    # preview without writing
```

**What it does:**
1. Reads all rows from the admin `users` table
2. For each user, fetches their `actor_sheet_id`
3. Calls `syncSchema()` for every table schema (adds missing columns/tabs — never deletes)
4. Updates `schema_versions` for each successfully synced table
5. Uses **exponential backoff** (1 s → 32 s) to handle Google Sheets API rate limits

**`--dry-run`** prints which user sheets are outdated without applying any changes.

---

## 3. lsdb migrate (Schema Export)

Export all defined schemas to a target format for migration:

```bash
npx lsdb migrate --prisma --output ./prisma      # generates schema.prisma
npx lsdb migrate --sql --output ./migrations     # generates CREATE TABLE DDL
```

> Deprecated alias: `lsdb export` still works but emits a deprecation warning.

### Prisma output example

```prisma
model bookings {
  booking_id  String   @id @default(cuid())
  service     String
  date        String
  status      String   @default("pending")
  price       Float?
  user_id     String
  users       users    @relation(fields: [user_id], references: [id])
  created_at  DateTime @default(now())
  updated_at  DateTime @updatedAt

  @@map("bookings")
}
```

The exporter emits `@id` for `primary()` columns and `@relation` for `ref()` columns. Review and adjust the output — treat it as a starting point, not final code.

### SQL DDL output example

```sql
CREATE TABLE bookings (
  booking_id VARCHAR(255) PRIMARY KEY,
  service VARCHAR(255) NOT NULL,
  date VARCHAR(255) NOT NULL,
  status VARCHAR(255) DEFAULT 'pending',
  price FLOAT,
  user_id VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
```

---

## 4. lsdb migrate-data (Data Migration Script Generator)

```bash
npx lsdb migrate-data                                     # generate for all tables
npx lsdb migrate-data --table bookings                    # single table only
npx lsdb migrate-data --table users,credentials,setup     # only these tables (comma-separated)
npx lsdb migrate-data --all-users                         # also include every registered user sheet
npx lsdb migrate-data --output ./scripts     # custom output directory
npx lsdb migrate-data --dry-run              # preview plan without writing
```

> Deprecated alias: `lsdb export-data` still works but emits a deprecation warning.

Generates a `migrate-data.js` script with `insertRow()` stubs for each table. The developer replaces the stubs with their production DB client:

```javascript
// Generated migrate-data.js (excerpt)
const { createSheetAdapter } = require('longcelot-sheet-db');

async function migrateBookings(adapter) {
  const ctx = adapter.withContext({ userId: 'migrate-data', actor: 'admin', actorSheetId: '...' });
  const rows = await ctx.table('bookings').findMany();

  for (const row of rows) {
    await insertRow('bookings', {
      booking_id: row.booking_id,
      service: row.service,
      // ... map all columns
    });
  }
}

// Replace this stub with your DB client
async function insertRow(table, data) {
  // e.g. await prisma.bookings.create({ data })
  // or   await knex(table).insert(data)
  console.log(`[dry-run] INSERT INTO ${table}`, data);
}
```

---

## 5. Full Migration Path to Production Database

```
longcelot-sheet-db (staging/MVP)
    ↓
1. npx lsdb migrate --prisma --output ./prisma
2. Review schema.prisma — adjust types, add indexes, remove lsdb-specific columns
3. npx prisma migrate dev  (or equivalent for your ORM)
4. Write migration script:  npx lsdb migrate-data --output ./scripts
5. Edit migrate-data.js — replace insertRow() stub with your DB client
6. Run node scripts/migrate-data.js against staging DB
7. Validate data integrity
8. Replace createSheetAdapter() with your production DB client in application code
```

---

## 6. Dropping & Renaming Schema Elements

Unlike `sync` (additive-only — never deletes or renames), these commands update the schema file, the live Google Sheet, and the relevant `schema_versions` record together:

```bash
npx lsdb drop-table bookings                      # schema file + Google Sheet tab
npx lsdb drop-column bookings notes                # schema file + Google Sheet column
npx lsdb rename-column bookings notes remarks      # in-place header rename — data preserved
```

All three accept `--all-users` to also apply to every registered user's personal sheet, and print a plan with a confirmation prompt (`--yes` to skip, `--dry-run` to preview). Full flag reference: `skills/cli/SKILL.md`.

`rename-column` matters most here because of what section 1 above describes: a schema-file-only rename (hand-editing the column key with no corresponding sheet change) desyncs every existing row from the schema's expectations, and the next `onSchemaMismatch: 'auto-sync'` trigger or `sync --all-users` run has no way to recover data under the old header name — `sync` only ever appends missing columns, it never renames or backfills. `rename-column` avoids that entirely by editing the sheet's header cell directly instead of dropping and re-adding the column.

### What persists after migration

| Field | Persists? | Notes |
|---|---|---|
| `user_id` | ✅ Yes | Your logical user identity — becomes PK in SQL |
| `_id` | ✅ Optional | Can become PK if you prefer nanoid strings |
| `actor_sheet_id` | ❌ No | Google Drive path — has no meaning in SQL |
| `_created_at`, `_updated_at` | ✅ Yes | Map to `created_at`, `updated_at` in SQL |
| `_deleted_at` | ✅ Optional | Map to `deleted_at` if keeping soft-delete |

---

## Common Mistakes

- **Modifying `schema_versions` manually** — This table is managed by the adapter. Manual edits cause false mismatch detections.
- **Running `sync --all-users` without `--dry-run` first** — Always preview with `--dry-run` before applying bulk changes to user sheets in production.
- **Using `'auto-sync'` in production without testing** — Each mismatch triggers a Sheets API call before the user's request completes. Monitor latency impact.
- **Not reviewing exported Prisma/SQL** — The export is a starting point. Check data types (all strings/numbers are broad; tighten them), add proper indexes, and remove sheet-internal columns (`_id`, `schema_version_id`, etc.) that your SQL schema doesn't need.
- **Forgetting `_id` in `migrate-data.js`** — Existing `_id` values are valid nanoid strings and can be carried into SQL as the primary key, preserving existing references in your data.
- **Hand-editing a schema file to remove or rename a column instead of using `drop-column`/`rename-column`** — `sync` never deletes or renames anything, so a manual edit leaves the live sheet out of sync with no automatic recovery path. Use the dedicated commands so the schema file and sheet change together.
