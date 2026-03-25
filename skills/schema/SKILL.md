---
name: schema
description: Define tables and columns for longcelot-sheet-db using defineTable() and the fluent column builder API. Use when creating or modifying schema files, adding columns, configuring timestamps/soft-delete, or understanding column modifiers like required, unique, enum, default, ref, and index.
license: MIT
metadata:
  package: longcelot-sheet-db
  version: "0.1.5"
---

# longcelot-sheet-db — Schema Definition

Schemas are the primary contract between your code and Google Sheets. Each `defineTable()` call produces one sheet (tab) inside a Google Spreadsheet.

## defineTable()

```typescript
import { defineTable, string, number, boolean, date, json } from 'longcelot-sheet-db';

export default defineTable({
  name: 'bookings',     // Sheet tab name — must be unique per actor
  actor: 'user',        // Which role owns this table ('admin' | your custom actors)
  timestamps: true,     // Adds _created_at, _updated_at columns
  softDelete: true,     // Adds _deleted_at; delete() sets it instead of removing the row
  columns: {
    booking_id: string().required().unique(),
    service:    string().required(),
    date:       date().required(),
    status:     string().enum(['pending', 'confirmed', 'cancelled']).default('pending'),
    price:      number().min(0),
    notes:      string(),
  },
});
```

### Auto-generated columns

These are always present and must NOT be defined manually:

| Column | Always present | Requires option |
|--|--|--|
| `_id` | ✅ (nanoid) | — |
| `_created_at` | ✅ when `timestamps: true` | `timestamps: true` |
| `_updated_at` | ✅ when `timestamps: true` | `timestamps: true` |
| `_deleted_at` | ✅ when `softDelete: true` | `softDelete: true` |

## Column Builders

Import individual builders from `longcelot-sheet-db`:

```typescript
import { string, number, boolean, date, json } from 'longcelot-sheet-db';
```

| Builder | Stored as | Notes |
|--|--|--|
| `string()` | Plain text | |
| `number()` | Numeric text | |
| `boolean()` | `"TRUE"` / `"FALSE"` | |
| `date()` | ISO 8601 string | |
| `json()` | JSON string | Serialized with `JSON.stringify` |

## Column Modifiers (Fluent Chain)

All modifiers return `this` — chain them freely:

```typescript
string().required().unique().min(5).max(200)
number().min(0).max(100).default(50)
string().enum(['active', 'inactive']).default('active')
string().pattern(/^[a-z0-9-]+$/)
string().ref('users._id')   // Foreign key hint (not yet enforced at runtime)
string().index()            // Marks column for future index support
string().readonly()         // Cannot be updated after creation
string().primary()          // Marks as primary key (metadata only)
```

### Full modifier reference

| Modifier | Applies to | Effect |
|--|--|--|
| `.required()` | all | Rejects `null`/`undefined`/`""` |
| `.unique()` | all | Throws `Error` if value already exists in column |
| `.default(value)` | all | Applied when field is omitted on `create()` |
| `.min(n)` | string, number | Min length (string) or min value (number) |
| `.max(n)` | string, number | Max length (string) or max value (number) |
| `.enum([...])` | string | Throws if value not in list |
| `.pattern(regex)` | string | Throws if value doesn't match |
| `.readonly()` | all | Field skipped during `update()` |
| `.primary()` | all | Metadata only — no enforcement |
| `.ref('table.col')` | string | Documents FK intent — not enforced yet |
| `.index()` | all | Metadata only — index support planned |

## Actor System

The `actor` field in `defineTable()` controls which Google Sheet stores the data:

- `actor: 'admin'` → data lives in `adminSheetId` (central admin sheet)
- `actor: 'user'` (or any custom role) → data lives in the user's personal `actorSheetId`

```typescript
// Admin-owned table: lives in the central admin spreadsheet
export default defineTable({ name: 'users', actor: 'admin', ... });

// User-owned table: lives in each user's personal sheet
export default defineTable({ name: 'profile', actor: 'user', ... });
```

## File Naming Conventions

- Schema files: `snake_case` matching the table name
  - e.g., `student_teacher_map.ts` for `name: 'student_teacher_map'`
- Use `export default` for schema files
- Organize by actor in `schemas/` directory:
  ```
  schemas/
  ├── admin/
  │   ├── users.ts
  │   └── credentials.ts
  └── user/
      ├── profile.ts
      └── bookings.ts
  ```

## Common Mistakes

- **Defining `_id`, `_created_at`, `_updated_at`, or `_deleted_at` manually** — These are auto-generated; duplicating them causes schema errors.
- **Duplicate table names across actors** — Each `actor` has its own spreadsheet so `name` must be unique **per actor**, not globally.
- **Using `softDelete: true` then hard-deleting** — With `softDelete` enabled, `table.delete()` sets `_deleted_at` and `findMany()` auto-excludes soft-deleted rows. Use `includeSoftDeleted: true` in find options if you need them.
- **`actor` mismatch in `withContext()`** — If you call `withContext({ role: 'user' })` but access a table with `actor: 'admin'`, a `PermissionError` is thrown.
