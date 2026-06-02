# Bug Fix — longcelot-sheet-db

---

## Bug fixed in this release

### `sync` now adds new columns to existing tables ✅

**Reported issue**: Running `sheet-db sync` after adding a new column to an existing schema did nothing. The tab already existed, so `syncSchema()` skipped header writing entirely and reported "✅ synced" regardless — giving a false impression the sheet was up to date. The only workaround was manually typing column headers directly in Google Sheets.

**Root cause**: `syncSchema()` gated all header writes behind `if (rows.length === 0)`. Headers were only written when the tab was completely empty (i.e., brand new). For any tab that already had data, the condition was never true.

**Fix**: When the tab already exists, `syncSchema()` now reads the current row-1 headers, diffs them against the schema column list, and appends any missing headers to the right of the existing ones. The fix is purely additive — existing headers and data rows are never modified or deleted.

**Behaviour by case:**

| Tab state | Before | After |
|-----------|--------|-------|
| New tab (does not exist) | Creates tab and writes all headers ✅ | Same ✅ |
| Existing tab, headers in sync | No-op ✅ | No-op ✅ |
| Existing tab, schema has new columns | Does nothing ✗ | Appends missing headers ✅ |
| Existing tab, has data rows | Does nothing ✗ | Appends headers, data rows untouched ✅ |

**Example:**

```typescript
// 1. Original schema synced — "users" tab has: _id | name | email
const usersSchema = defineTable({
  name: 'users',
  actor: 'admin',
  columns: { name: string().required(), email: string().required() },
});

// 2. Developer adds phone and role columns
const usersSchema = defineTable({
  name: 'users',
  actor: 'admin',
  columns: {
    name: string().required(),
    email: string().required(),
    phone: string(),       // new
    role: string(),        // new
  },
});

// 3. Run: npx sheet-db sync
// Before fix → "✅ synced" but sheet still has: _id | name | email
// After fix  → "✅ synced" and sheet now has:  _id | name | email | phone | role
```

**No breaking changes.** Existing column order is preserved. Data in existing rows is untouched.
