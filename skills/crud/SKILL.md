---
name: crud
description: Perform create, read, update, and delete operations with longcelot-sheet-db. Use when writing data to Google Sheets, querying records with where/orderBy/limit/offset, updating or deleting rows, using withContext() for actor isolation, or understanding how permission checks and sheet routing work.
license: MIT
metadata:
  package: longcelot-sheet-db
  version: "0.1.5"
---

# longcelot-sheet-db — CRUD Operations

All data access goes through a context-bound table instance. The pattern is always:

```
adapter → withContext(userContext) → table(name) → create | findMany | findOne | update | delete
```

## withContext() — Required for Every Operation

Every operation requires an active context that determines:
- **Which sheet** to read from/write to (via `actorSheetId`)
- **Which role** is acting (used for permission checks)

```typescript
const ctx = adapter.withContext({
  userId: 'user_123',          // Your app's user ID
  role: 'user',                // Must match schema's actor field
  actorSheetId: 'sheet-id',   // The user's Google Sheet ID
});
```

For **admin** actors, `actorSheetId` is ignored — the adapter always uses `adminSheetId`:

```typescript
const adminCtx = adapter.withContext({
  userId: 'admin_001',
  role: 'admin',
  actorSheetId: 'ignored-for-admin',
});
```

## create()

```typescript
const record = await ctx.table('bookings').create({
  booking_id: 'bk_001',
  service: 'Consultation',
  date: new Date().toISOString(),
  price: 100,
  // status defaults to 'pending' (defined in schema)
});
// record._id is auto-generated (nanoid)
// record._created_at, record._updated_at set if timestamps: true
```

**What create() does internally:**
1. Validates required fields
2. Applies column defaults
3. Checks unique constraints (throws `Error: Unique constraint violation: column '...' already has value '...'`)
4. Generates `_id` (nanoid)
5. Sets timestamps if enabled
6. Appends a row to the sheet

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

### FindOptions type

```typescript
interface FindOptions {
  where?: Partial<Record<string, any>>;
  orderBy?: string;
  order?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}
```

Soft-deleted rows are automatically excluded when `softDelete: true` is set on the schema.

## findOne()

Returns the **first** record matching the where clause, or `null` if none found:

```typescript
const booking = await ctx.table('bookings').findOne({
  where: { booking_id: 'bk_001' },
});
```

## update()

Updates **all** rows matching the where clause:

```typescript
const updated = await ctx.table('bookings').update({
  where: { booking_id: 'bk_001' },
  data: { status: 'confirmed' },
});
// Returns array of updated records
```

**Behavior:**
- Each matching row is re-validated and written individually
- `readonly()` columns are silently skipped
- `_updated_at` is refreshed automatically if `timestamps: true`
- Unique constraints are re-checked per row (excluding current row's own `_id`)

### UpdateOptions type

```typescript
interface UpdateOptions {
  where: Partial<Record<string, any>>;
  data: Partial<Record<string, any>>;
}
```

## delete()

```typescript
await ctx.table('bookings').delete({
  where: { booking_id: 'bk_001' },
});
```

**Behavior depends on schema:**
- **Without `softDelete: true`**: Rows are physically removed (iterates in reverse order to avoid index shift)
- **With `softDelete: true`**: `_deleted_at` is set to the current timestamp; rows remain in the sheet and are excluded from `findMany`/`findOne` results

### DeleteOptions type

```typescript
interface DeleteOptions {
  where: Partial<Record<string, any>>;
}
```

## Serialization

| TypeScript value | Stored in Sheet as |
|--|--|
| `true` / `false` | `"TRUE"` / `"FALSE"` |
| `{ key: val }` (json column) | `JSON.stringify(...)` |
| `null` / `undefined` | `""` (empty string) |
| `Date` / ISO string | Stored as-is |

All deserialization is automatic on read.

## SheetAdapter.syncSchema()

Creates missing sheet tabs and adds missing column headers. **Never deletes data or removes columns.** Run after defining new schemas:

```typescript
await adapter.syncSchema(bookingsSchema);
```

Use the CLI instead where possible: `npx sheet-db sync`.

## Performance Characteristics

| Operation | Typical latency |
|--|--|
| Read (findMany / findOne) | 200–500ms |
| Write (create / update / delete) | 300–700ms |

All reads load the entire sheet into memory. Suitable for hundreds to low thousands of rows per table.

## Common Mistakes

- **Using `table()` without `withContext()`** — Always call `adapter.withContext(...)` first; calling `adapter.table(...)` directly bypasses permission checks.
- **Forgetting to `await`** — All CRUD methods return Promises; missing `await` silently returns a pending Promise.
- **`where` clause with no matches** — `update()` and `delete()` simply do nothing if no rows match; they do **not** throw.
- **`findOne()` returning `null`** — Always guard with a null check before accessing properties.
- **Large datasets** — All rows are loaded into memory per read. If you expect thousands of rows, consider adding `limit` to every `findMany()` call.
