---
name: schema
description: Define tables and columns for longcelot-sheet-db using defineTable() and the fluent column builder API. Use when creating or modifying schema files, adding columns, configuring timestamps/soft-delete, setting up primary keys with auto-generation, adding foreign key references with runtime enforcement, or understanding column modifiers like required, unique, enum, default, ref, and index.
license: MIT
metadata:
  package: longcelot-sheet-db
  version: "0.1.15"
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
    booking_id: string().primary(),          // PK: auto-generates nanoid if omitted on create
    service:    string().required(),
    date:       date().required(),
    status:     string().enum(['pending', 'confirmed', 'cancelled']).default('pending'),
    price:      number().min(0),
    notes:      string(),
    user_id:    string().ref('users._id'),   // FK: validated at runtime on create/update
  },
});
```

### Auto-generated columns

These are always present and must NOT be defined manually:

| Column | Always present | Requires option |
|---|---|---|
| `_id` | ✅ (nanoid) | — |
| `_created_at` | ✅ when `timestamps: true` | `timestamps: true` |
| `_updated_at` | ✅ when `timestamps: true` | `timestamps: true` |
| `_deleted_at` | ✅ when `softDelete: true` | `softDelete: true` |

---

## Column Builders

Import individual builders from `longcelot-sheet-db`:

```typescript
import { string, number, boolean, date, json } from 'longcelot-sheet-db';
```

| Builder | Stored as | Notes |
|---|---|---|
| `string()` | Plain text | |
| `number()` | Numeric text | Deserialized to `Number` on read |
| `boolean()` | `"TRUE"` / `"FALSE"` | Deserialized to `true`/`false` on read |
| `date()` | ISO 8601 string | Store ISO strings; no auto-conversion |
| `json()` | JSON string | Serialized with `JSON.stringify`, parsed on read |

---

## Column Modifiers (Fluent Chain)

All modifiers return `this` — chain them freely:

```typescript
string().required().unique().min(5).max(200)
number().min(0).max(100).default(50)
string().enum(['active', 'inactive']).default('active')
string().pattern(/^[a-z0-9-]+$/)
string().readonly()
string().primary()
string().ref('users._id')
string().index()
```

### Full modifier reference

| Modifier | Applies to | Runtime effect |
|---|---|---|
| `.required()` | all | Throws `ValidationError` if `null`/`undefined` on `create()` |
| `.unique()` | all | Throws `ValidationError` if value already exists in the column |
| `.default(value)` | all | Applied when field is omitted on `create()` — never on `update()`. Accepts arrays/objects too, e.g. `json().default([])` |
| `.min(n)` | string, number | Min length (string) or min value (number) |
| `.max(n)` | string, number | Max length (string) or max value (number) |
| `.enum([...])` | string | Throws `ValidationError` if value not in list |
| `.pattern(regex)` | string | Throws `ValidationError` if value doesn't match |
| `.readonly()` | all | Throws `ValidationError` if included in `update()` data |
| `.primary()` | string, number | **String PK**: auto-generates nanoid on `create()` if omitted. **Number PK**: developer must supply. Only one `primary()` column allowed per table. PK is silently stripped from `update()` data. |
| `.ref('table.col')` | string | **FK enforcement**: on `create()` and `update()`, reads the referenced table and throws `ValidationError` if the value doesn't exist. Pass `{ skipFKValidation: true }` to bypass. |
| `.index()` | all | Metadata marker — index support planned |

---

## primary() Behavior (PK auto-generation)

```typescript
// string PK — value is auto-generated if not supplied
const record = await ctx.table('orders').create({
  customer_id: 'cust_001',
  total: 99.99,
  // order_id is omitted — nanoid is generated automatically
});
// record.order_id = 'V1StGXR8_Z5j...' (nanoid)

// number PK — developer MUST supply the value
const record = await ctx.table('counters').create({
  counter_id: 42,  // required — cannot be auto-generated for numbers
  label: 'views',
});
```

- Only **one** `primary()` column is allowed per table; `defineTable()` throws `SchemaError` if more than one is found.
- The PK column is **always read-only** on `update()` — it is silently stripped from the data.

---

## ref() Behavior (FK runtime enforcement)

```typescript
// If 'users._id' does not contain 'user_999', this throws:
// ValidationError: FK violation: users._id 'user_999' does not exist
await ctx.table('bookings').create({
  user_id: 'user_999', // ref('users._id') — validated at runtime
  service: 'Consultation',
});

// Skip FK validation for bulk seed operations:
await ctx.table('bookings').create(data, { skipFKValidation: true });
```

Both the referenced table and column must be registered with `adapter.registerSchemas()`. Circular `ref()` chains throw `SchemaError: Circular reference detected` at registration time.

---

## Actor System

The `actor` field in `defineTable()` controls which Google Sheet stores the data:

- `actor: 'admin'` → data lives in `adminSheetId` (central admin sheet)
- `actor: 'user'` (or any custom role) → data lives in the user's personal `actorSheetId`

```typescript
// Admin-owned: lives in the central admin spreadsheet
export default defineTable({ name: 'users', actor: 'admin', ... });

// User-owned: lives in each user's personal sheet
export default defineTable({ name: 'profile', actor: 'user', ... });
```

---

## File Naming Conventions

```
schemas/
├── admin/
│   ├── users.ts
│   ├── credentials.ts
│   └── schema_versions.ts   # scaffolded by init — do not modify
└── user/
    ├── profile.ts
    └── bookings.ts
```

- File name: `snake_case` matching the table `name`
- Use `export default` for each schema file
- Organize by actor inside `schemas/`

---

## Common Mistakes

- **Defining `_id`, `_created_at`, `_updated_at`, or `_deleted_at` manually** — These are auto-generated; including them in `columns` causes schema validation errors.
- **Duplicate table names across actors** — `name` must be unique **per actor**, not globally. Two actors can each have a `profile` table.
- **More than one `primary()` column** — `defineTable()` throws `SchemaError: only one primary() allowed per table`.
- **`ref()` without registering the referenced schema** — If `user_id` references `users._id` but `users` is not registered via `registerSchemas()`, FK validation throws `SchemaError: Referenced table 'users' is not registered`.
- **Using `softDelete: true` and expecting hard deletes** — With `softDelete` enabled, `table.delete()` sets `_deleted_at` and leaves the row. Use `table.findMany()` — soft-deleted rows are automatically excluded.
- **`actor` mismatch in `withContext()`** — If you call `withContext({ role: 'user' })` but access a table with `actor: 'admin'`, a `PermissionError` is thrown.
