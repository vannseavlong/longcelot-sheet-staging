---
name: crud
description: Perform data operations with longcelot-sheet-db. Use when writing data to Google Sheets, querying records with where/orderBy/limit/offset, bulk inserting with createMany, upserting with upsert, counting rows with count, updating or deleting rows, using withContext() for actor isolation, or understanding how permission checks and sheet routing work. For cross-actor operations (teacher accessing student sheet), see skills/permissions/SKILL.md.
license: MIT
metadata:
  package: longcelot-sheet-db
  version: "0.1.15"
---

# longcelot-sheet-db — CRUD Operations

All data access goes through a context-bound table instance. The pattern is always:

```
adapter → withContext(userContext) → table(name) → operation
```

---

## withContext() — Required for Every Operation

Every operation requires an active context that determines:
- **Which sheet** to read from/write to (via `actorSheetId`)
- **Which role** is acting (used for permission checks)

```typescript
const ctx = adapter.withContext({
  userId: 'user_123',         // Your app's user ID
  role: 'user',               // Must match schema's actor field
  actorSheetId: 'sheet-id',  // The user's Google Sheet ID
});
```

For **admin** actors, `actorSheetId` is still required in the context but the adapter always routes to `adminSheetId` internally:

```typescript
const adminCtx = adapter.withContext({
  userId: 'admin_001',
  role: 'admin',
  actorSheetId: process.env.ADMIN_SHEET_ID!,
});
```

---

## create()

```typescript
const record = await ctx.table('bookings').create({
  service: 'Consultation',
  date: new Date().toISOString(),
  price: 100,
  // status defaults to 'pending' (from schema definition)
});
// record._id is auto-generated (nanoid)
// record._created_at, record._updated_at set if timestamps: true
```

**What create() does internally:**
1. Auto-generates string PK via nanoid if `primary()` column is empty
2. Validates required fields and enums
3. Applies column defaults
4. Checks unique constraints (throws `ValidationError` on conflict)
5. Validates foreign keys via `ref()` columns (unless `skipFKValidation: true`)
6. Generates `_id` (nanoid) and timestamps
7. Appends one row to the sheet

### CreateOptions

```typescript
interface CreateOptions {
  skipFKValidation?: boolean; // Set true for bulk seed operations
}
```

---

## createMany()

Inserts multiple rows in a **single Google Sheets API call** — dramatically faster than looping `create()`:

```typescript
const records = await ctx.table('products').createMany([
  { name: 'Widget A', price: 9.99, category: 'tools' },
  { name: 'Widget B', price: 19.99, category: 'tools' },
]);
// Each record gets its own auto-generated _id
// Returns array of created records
```

All validation (required fields, unique constraints, FK checks) runs per-row before the batch write. If any row fails validation, it throws before writing anything.

---

## findMany()

```typescript
const bookings = await ctx.table('bookings').findMany({
  where: { status: 'pending' },
  orderBy: 'date',
  order: 'desc',    // 'asc' | 'desc'
  limit: 10,
  offset: 0,
});
```

All filtering, sorting, and pagination happen **in memory** after fetching all rows. Not suitable for large datasets (performance degrades beyond ~1000 rows).

Rows with an empty `_id` (e.g. a cell that only has checkbox/dropdown formatting applied but was never written by `create()`) are filtered out before any other processing — they are never returned as phantom `null`-filled records.

### FindOptions type

```typescript
interface FindOptions {
  where?: Record<string, unknown>;
  orderBy?: string;
  order?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
  includeDeleted?: boolean; // see softDelete in skills/schema/SKILL.md — default: false
}
```

---

## findOne()

Returns the **first** matching record, or `null` if none found:

```typescript
const booking = await ctx.table('bookings').findOne({
  where: { booking_id: 'bk_001' },
});
// Always guard: if (booking) { ... }
```

---

## count()

Returns the number of matching rows **without loading the full row data**:

```typescript
const pending = await ctx.table('orders').count({ where: { status: 'pending' } });
const total   = await ctx.table('orders').count(); // no filter = all rows
```

Internally still reads all rows (Google Sheets has no server-side COUNT), but skips deserializing full row objects — faster than `findMany().length` for large tables.

---

## update()

Updates **all** rows matching the where clause:

```typescript
const updatedCount = await ctx.table('bookings').update({
  where: { booking_id: 'bk_001' },
  data: { status: 'confirmed' },
});
// Returns number of rows updated
```

**Behavior:**
- PK (`primary()`) columns are silently stripped from `data` — they are read-only
- `readonly()` columns throw `ValidationError` if included in `data`
- Column `default()` values are **never** applied on `update()` — a field omitted from `data` keeps its existing value, it is not reset to the schema default. Defaults only ever apply on `create()`.
- `_updated_at` is refreshed automatically if `timestamps: true`
- Unique constraints are re-checked per row (excluding the current row's own `_id`)

### UpdateOptions type

```typescript
interface UpdateOptions {
  where: Record<string, unknown>;
  data: Record<string, unknown>;
  skipFKValidation?: boolean;
}
```

---

## upsert()

Insert-or-update: if a matching row exists it is updated; otherwise a new row is created:

```typescript
await ctx.table('users').upsert({
  where: { email: 'admin@example.com' },
  data: { role: 'admin', status: 'active' },
});
```

**Behavior:**
- Calls `findOne({ where })` first; if found → calls `update()`; if not found → calls `create()` with `{ ...where, ...data }`
- Suitable for idempotent initialization (e.g., seeding a super-admin)

### UpsertOptions type

```typescript
interface UpsertOptions {
  where: Record<string, unknown>;
  data: Record<string, unknown>;
  skipFKValidation?: boolean;
}
```

---

## delete()

```typescript
const deletedCount = await ctx.table('bookings').delete({
  where: { booking_id: 'bk_001' },
});
```

**Behavior depends on schema:**
- **Without `softDelete: true`**: Rows are physically removed (iterates in reverse order to prevent index shift)
- **With `softDelete: true`**: `_deleted_at` is set to current ISO timestamp; rows remain in the sheet and are automatically excluded from `findMany`/`findOne`/`count` results

### DeleteOptions type

```typescript
interface DeleteOptions {
  where: Record<string, unknown>;
}
```

---

## Serialization

| TypeScript value | Stored in Sheet as |
|---|---|
| `true` / `false` | `"TRUE"` / `"FALSE"` |
| `{ key: val }` (json column) | `JSON.stringify(...)` |
| `null` / `undefined` | `""` (empty string) |
| Numbers | String representation |
| ISO date strings | Stored as-is |

All deserialization is automatic on read.

---

## Performance Characteristics

| Operation | Typical latency |
|---|---|
| Read (findMany / findOne / count) | 200–500 ms |
| Write (create) | 300–700 ms |
| Bulk write (createMany, N rows) | 300–700 ms (same as single — one API call) |
| Update / delete | 300–700 ms per matched row |

All reads load the entire sheet into memory. Suitable for hundreds to low thousands of rows per table. Use `limit` on `findMany()` if you only need the first N results.

---

## Common Mistakes

- **Using `adapter.table()` without `withContext()`** — Always call `adapter.withContext(...)` first. Calling `adapter.table(...)` directly throws a `PermissionError` because there is no context to check.
- **Forgetting to `await`** — All CRUD methods return Promises; missing `await` silently returns a pending Promise object instead of data.
- **`where` clause with no matches** — `update()`, `delete()`, and `count()` return `0` if nothing matches. They do **not** throw.
- **`findOne()` returning `null`** — Always guard with a null check before accessing properties.
- **Looping `create()` for many rows** — Each call is one API request (300–700 ms). Use `createMany()` to batch them into one call.
- **Expecting server-side filtering** — All filtering is in-memory after a full sheet read. Avoid very large `findMany()` calls without `limit`.
