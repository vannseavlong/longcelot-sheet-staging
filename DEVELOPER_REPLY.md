# Feature Request Reply — Drive Architecture & File Upload

**To:** Feature Requester (bEasy)
**Date:** 2026-06-19
**Re:** Feature Request — Drive Architecture & File Upload (5 items)

---

Thank you for the thorough write-up. All five requests are well-grounded in real production pain, and the bEasy context makes the priority ordering clear. Here is how each feature has been analysed, designed, and implemented.

---

## Feature 1 — Actor-owned sheets (sheets live in the actor's Drive) ✅

**Your diagnosis was correct.** `createUserSheet` was always calling `spreadsheets.create` using the admin's OAuth client, so every user sheet ended up inside the admin's Google Drive. The admin's 15 GB quota is shared by every registered user, and one expired admin refresh token brings the entire backend down.

**Design decision — options object over positional param:**

The existing 4th positional parameter (`extraFields`) has been promoted into an options object. This is a minor breaking change for callers who pass `extraFields` positionally, but the migration is mechanical:

```ts
// Before (0.1.x)
await adapter.createUserSheet(userId, role, email, { full_name: 'Alice' })

// After (0.2.x) — extraFields moves into options
await adapter.createUserSheet(userId, role, email, {
  extraFields: { full_name: 'Alice' },
})

// New: pass actor tokens to create in actor's Drive
await adapter.createUserSheet(userId, role, email, {
  actorTokens: { access_token, refresh_token, expiry_date },
  extraFields: { full_name: 'Alice' },
})
```

**What happens when `actorTokens` is provided:**

1. A temporary `SheetClient` is instantiated with the actor's tokens (same OAuth credentials, different token set).
2. The spreadsheet is created via the actor's client → it lands in the actor's Google Drive.
3. The actor's client shares the sheet with the admin email (via `shareWithUser`), giving the admin write access.
4. The actor already owns the sheet — no need to share back with them.

When `actorTokens` is not provided, behaviour is identical to the previous release (sheet is created in the admin's Drive, then shared with the user).

**Where to get `actorTokens`:** the `access_token` and `refresh_token` are returned by `oauth.getTokens(code)` during the Google callback. Store the refresh token in your database keyed by `userId`; reconstruct the token object when calling `createUserSheet`.

---

## Feature 2 — Folder and subfolder organisation for Drive ✅

**Implementation approach:**

`driveFolder` is added to `SheetAdapterConfig`. On first `createUserSheet` call for each role, the adapter looks up (or creates) the configured folder hierarchy via the Drive API, then caches the folder ID. Subsequent calls for the same role skip the lookup.

```ts
const adapter = createSheetAdapter({
  adminSheetId: process.env.ADMIN_SHEET_ID,
  credentials: { ... },
  tokens: adminTokens,
  driveFolder: {
    root: 'bEasy Staging',
    subfolders: {
      admin:   'Admin Data',
      seller:  'Sellers',
      cleaner: 'Cleaners',
    },
  },
})
```

When a seller registers, the package:
1. Looks up (or creates) `My Drive/bEasy Staging/` (root folder)
2. Looks up (or creates) `My Drive/bEasy Staging/Sellers/` (role subfolder)
3. Creates the spreadsheet inside the `Sellers/` folder

If `subfolders[role]` is not specified, the role name itself is used as the subfolder name.

**Important:** The Drive `files.list` query is scoped so it only searches within the configured parent, avoiding false matches from other folders with the same name.

---

## Feature 3 — Pluggable file upload (`StorageAdapter` + `DriveStorageAdapter`) ✅

**Design rationale — injection over repetition:**

Rather than requiring callers to re-specify credentials in `DriveStorageAdapter`, the adapter automatically injects its own `SheetClient` into the storage adapter at construction time via a `_setClient` hook. Callers only write:

```ts
import { DriveStorageAdapter } from 'longcelot-sheet-db'

const adapter = createSheetAdapter({
  ...,
  storage: new DriveStorageAdapter({ folder: 'uploads' }),
})
```

For custom providers, implement the two-method `StorageAdapter` interface:

```ts
import type { StorageAdapter, UploadOptions } from 'longcelot-sheet-db'

class S3StorageAdapter implements StorageAdapter {
  async upload(file: Buffer, options: UploadOptions): Promise<string> {
    // upload to S3, return public URL
  }
  async delete(url: string): Promise<void> {
    // extract key from URL, call s3.deleteObject
  }
}
```

**API on the adapter:**

```ts
const url = await adapter.upload(buffer, {
  filename: 'product.jpg',
  mimeType: 'image/jpeg',
  folder: 'uploads/products',   // relative path; created if missing
  public: true,                  // sets Drive permission: anyone/reader
})
// returns: https://drive.google.com/uc?id=FILE_ID

await adapter.deleteFile(url)
```

The URL stored in your `string()` column is **provider-agnostic** — just a URL. Migrating from Drive to S3 means re-uploading files and updating the URLs in the sheet; the schema is untouched.

Calling `adapter.upload()` when no `storage` option was configured throws `SchemaError: No storage adapter configured`.

---

## Feature 4 — Per-actor `TokenStore` interface ✅

**Design:** `TokenStore` is a two-method interface the caller implements. The package calls `tokenStore.get(userId)` in `createUserSheet` when `actorTokens` is not passed directly — useful when the auth handler stores tokens at login time and the route that calls `createUserSheet` doesn't have them in scope.

```ts
interface TokenStore {
  get(actorId: string): Promise<OAuthTokens | null>
  set(actorId: string, tokens: OAuthTokens): Promise<void>
}
```

Priority order in `createUserSheet`:
1. `options.actorTokens` (explicit, takes priority)
2. `tokenStore.get(userId)` (looked up if no explicit tokens)
3. Admin client fallback (current behaviour, if neither is present)

**Typical usage:**

```ts
// In your auth callback — store the actor's tokens
await tokenStore.set(userId, {
  access_token: tokens.access_token,
  refresh_token: tokens.refresh_token,
  expiry_date: tokens.expiry_date,
})

// In your registration handler — tokens are looked up automatically
await adminAdapter.createUserSheet(userId, role, email)
// ↑ calls tokenStore.get(userId) internally
```

The `TokenStore` can be backed by any store — a Map for tests, a Redis client, your ORM, a file per actor. The package never persists tokens itself.

> **Note:** The `TokenStore` is currently used only at `createUserSheet` time (sheet creation). Per-CRUD-call token rotation (auto-refresh before every read/write) is a planned follow-up (see TODO.md Phase 8.4).

---

## Feature 5 — Shared Drive (Google Workspace) support ✅

**Implementation:** `sharedDriveId` is added to `SheetAdapterConfig`. When set, all Drive `files.create` and `files.list` calls pass `supportsAllDrives: true`. If `driveFolder` is also configured, folder lookups are scoped to the Shared Drive. If no `driveFolder` is set, the sheet is created at the root of the Shared Drive.

```ts
const adapter = createSheetAdapter({
  adminSheetId: process.env.ADMIN_SHEET_ID,
  credentials: { ... },
  tokens: adminTokens,
  sharedDriveId: process.env.SHARED_DRIVE_ID,
  driveFolder: {
    root: 'Staging',
    subfolders: { seller: 'Sellers', cleaner: 'Cleaners' },
  },
})
```

This is a drop-in flag — no other code changes required. Falls back to My Drive behaviour when omitted.

---

## Breaking changes in this release

| Location | Change |
|----------|--------|
| `createUserSheet(userId, role, email, extraFields?)` | 4th param is now `options?: CreateUserSheetOptions` — move `extraFields` inside: `{ extraFields: { ... } }` |
| `SheetClient.createSpreadsheet` | Now uses Drive API `files.create` internally (same result, but `parents` and `supportsAllDrives` support added). No change for callers. |

---

## Summary

| # | Feature | Status | Files changed |
|---|---------|--------|---------------|
| 1 | Actor-owned sheets (actorTokens) | ✅ | `sheetAdapter.ts`, `types.ts` |
| 2 | Drive folder organisation | ✅ | `sheetClient.ts`, `sheetAdapter.ts`, `types.ts` |
| 3 | Pluggable file upload + DriveStorageAdapter | ✅ | `driveStorageAdapter.ts` (new), `sheetClient.ts`, `sheetAdapter.ts`, `types.ts`, `index.ts` |
| 4 | TokenStore per-actor lifecycle | ✅ | `sheetAdapter.ts`, `types.ts`, `index.ts` |
| 5 | Shared Drive support | ✅ | `sheetClient.ts`, `sheetAdapter.ts` |

All existing tests continue to pass. New unit tests cover actor-owned creation, folder caching, upload delegation, tokenStore fallback, and sharedDriveId propagation.
