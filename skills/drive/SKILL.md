---
name: drive
description: Configure Google Drive integration with longcelot-sheet-db. Use when organising created sheets into Drive folders (driveFolder config), targeting a Google Workspace Shared Drive (sharedDriveId), creating user sheets in the actor's own Google Drive instead of the admin's (actorTokens in createUserSheet), persisting per-actor OAuth tokens between requests (TokenStore), uploading files to Google Drive or a custom provider (StorageAdapter / DriveStorageAdapter / adapter.upload()), or deleting previously uploaded files (adapter.deleteFile()).
license: MIT
metadata:
  package: longcelot-sheet-db
  version: "0.1.19"
---

# longcelot-sheet-db — Drive Architecture & File Upload

This skill covers five configuration options added in v0.1.19 that control how the adapter interacts with Google Drive beyond basic sheet access.

---

## 1. Drive Folder Organisation (`driveFolder`)

By default every created spreadsheet lands at the root of the owning Drive. `driveFolder` lets you group them into a named folder hierarchy.

```typescript
import { createSheetAdapter } from 'longcelot-sheet-db';

const adapter = createSheetAdapter({
  adminSheetId: process.env.ADMIN_SHEET_ID!,
  credentials: { clientId, clientSecret, redirectUri },
  tokens: adminTokens,
  driveFolder: {
    root: 'bEasy Staging',         // top-level folder at Drive root
    subfolders: {
      admin:   'Admin Data',
      seller:  'Sellers',
      cleaner: 'Cleaners',
    },
  },
});
```

Result in Drive:
```
My Drive/
└── bEasy Staging/
    ├── Admin Data/
    ├── Sellers/       ← seller-user123, seller-user456
    └── Cleaners/      ← cleaner-user789
```

**Behaviour:**
- Root folder and each role subfolder are created automatically on first `createUserSheet` call for that role.
- Folder IDs are cached in memory — subsequent calls for the same role skip the lookup.
- If `subfolders[role]` is omitted, the role name itself is used as the subfolder name.
- Works alongside `sharedDriveId` — folders are created inside the Shared Drive when that option is set.

### `DriveFolderConfig` type

```typescript
interface DriveFolderConfig {
  root: string;                         // folder name at Drive root; created if missing
  subfolders?: Record<string, string>;  // role → subfolder name (defaults to role name)
}
```

---

## 2. Shared Drive Support (`sharedDriveId`)

For Google Workspace teams that manage data in a Shared Drive rather than personal My Drive accounts:

```typescript
const adapter = createSheetAdapter({
  adminSheetId: process.env.ADMIN_SHEET_ID!,
  credentials: { ... },
  tokens: adminTokens,
  sharedDriveId: process.env.SHARED_DRIVE_ID,  // optional; falls back to My Drive
  driveFolder: {
    root: 'Staging',
    subfolders: { seller: 'Sellers' },
  },
});
```

When `sharedDriveId` is set:
- All `files.create` calls pass `supportsAllDrives: true`.
- Folder lookups (`files.list`) are scoped to the Shared Drive via `corpora: 'drive'` + `driveId`.
- `driveFolder.root` is created at the root of the Shared Drive, not My Drive.

---

## 3. Actor-Owned Sheets (`actorTokens` in `createUserSheet`)

**Problem with the default:** `createUserSheet` normally uses the admin's OAuth tokens, placing every user sheet inside the admin's Google Drive. The admin's 15 GB quota absorbs all users' data.

**Solution:** pass `actorTokens` — the OAuth token set returned during the user's own Google login — and the sheet is created in **the actor's Drive**. The admin is then shared as an editor so the adapter can read/write it.

```typescript
// In your /auth/callback or onUser handler:
const tokens = await oauth.getTokens(req.query.code as string);
// tokens = { access_token, refresh_token, expiry_date, id_token, ... }

// When registering the new user:
const sheetId = await adminAdapter.createUserSheet(
  userId,
  'seller',
  profile.email,
  {
    actorTokens: tokens as OAuthTokens,           // sheet created in seller's Drive
    extraFields: { display_name: profile.name },  // extra users table columns
  }
);
```

**What happens internally:**
1. A temporary `SheetClient` is created from `actorTokens` using the same OAuth credentials.
2. `createSpreadsheet('seller-userId')` is called via the **actor's** client → sheet lands in their Drive.
3. The actor's client shares the sheet with `SUPER_ADMIN_EMAIL` (writer access).
4. The actor already owns the sheet — no reverse share needed.

**Fallback:** when neither `actorTokens` nor `tokenStore` is configured, the existing admin-client behaviour is used (fully backward compatible).

### `CreateUserSheetOptions` type

```typescript
interface CreateUserSheetOptions {
  actorTokens?: OAuthTokens;             // actor's Google OAuth tokens
  extraFields?: Record<string, unknown>; // extra columns merged into users table row
}
```

### `OAuthTokens` type

```typescript
interface OAuthTokens {
  access_token?: string | null;
  refresh_token?: string | null;
  expiry_date?: number | null;
  id_token?: string | null;
  token_type?: string | null;
  scope?: string | null;
}
```

---

## 4. Per-Actor Token Persistence (`tokenStore`)

When actor tokens are stored at login time (e.g. in a database) and you can't easily pass them at the `createUserSheet` call site, provide a `TokenStore`:

```typescript
import type { TokenStore, OAuthTokens } from 'longcelot-sheet-db';

// Your implementation (Redis, Prisma, file, Map, …)
const myTokenStore: TokenStore = {
  async get(actorId: string): Promise<OAuthTokens | null> {
    return db.oauthTokens.findFirst({ where: { userId: actorId } });
  },
  async set(actorId: string, tokens: OAuthTokens): Promise<void> {
    await db.oauthTokens.upsert({
      where: { userId: actorId },
      create: { userId: actorId, ...tokens },
      update: tokens,
    });
  },
};

const adapter = createSheetAdapter({
  adminSheetId: process.env.ADMIN_SHEET_ID!,
  credentials: { ... },
  tokens: adminTokens,
  tokenStore: myTokenStore,
});
```

**At login time** — call `tokenStore.set` after the Google callback:

```typescript
const tokens = await oauth.getTokens(code) as OAuthTokens;
await myTokenStore.set(userId, tokens);
```

**At registration time** — `createUserSheet` calls `tokenStore.get(userId)` automatically:

```typescript
// No need to pass actorTokens here — tokenStore.get(userId) is called internally
const sheetId = await adminAdapter.createUserSheet(userId, 'seller', email);
```

**Priority order** in `createUserSheet`:
1. `options.actorTokens` (explicit — always wins)
2. `tokenStore.get(userId)` (looked up if no explicit tokens)
3. Admin client fallback (if neither is present)

### `TokenStore` type

```typescript
interface TokenStore {
  get(actorId: string): Promise<OAuthTokens | null>;
  set(actorId: string, tokens: OAuthTokens): Promise<void>;
}
```

---

## 5. File Upload (`StorageAdapter` / `DriveStorageAdapter`)

### Built-in Drive upload

```typescript
import { createSheetAdapter, DriveStorageAdapter } from 'longcelot-sheet-db';

const adapter = createSheetAdapter({
  adminSheetId: process.env.ADMIN_SHEET_ID!,
  credentials: { ... },
  tokens: adminTokens,
  storage: new DriveStorageAdapter({ folder: 'uploads' }),
  // driveFolder optional — DriveStorageAdapter uses its own folder path
});

// Upload a file — the returned URL renders directly, format chosen from mimeType
const url = await adapter.upload(imageBuffer, {
  filename: 'product.jpg',
  mimeType: 'image/jpeg',
  folder: 'uploads/products',  // nested path; each segment created if missing
  public: true,                 // sets Drive permission: anyone / reader
});
// → 'https://drive.google.com/thumbnail?id=FILE_ID&sz=w1000' — drop straight into <img src>

// Store url in a string() column — it's just a URL, provider-agnostic
await ctx.table('products').update({
  where: { product_id: 'p123' },
  data: { image_url: url },
});

// Delete a file — works for any URL format upload() has ever returned
await adapter.deleteFile(url); // extracts FILE_ID from the URL automatically
```

`DriveStorageAdapter` is injected with the adapter's own `SheetClient` automatically — no credential repetition.

### Link format by `mimeType`

`linkFormat: 'auto'` (the default) picks the renderable format from `mimeType`:

| `mimeType` prefix | Returned URL | Use it in |
|---|---|---|
| `image/*` | `https://drive.google.com/thumbnail?id=…&sz=w1000` | `<img src>` |
| `video/*` | `https://drive.google.com/file/d/…/preview` | `<iframe src>` |
| anything else | `https://drive.google.com/file/d/…/view` | a clickable open/preview link |

Pass `linkFormat: 'download'` to get the raw `https://drive.google.com/uc?id=…` download-endpoint URL instead — needed when a caller wants the actual file bytes (e.g. a server-side job re-fetching the file), not a rendered preview.

Already have rows saved with the old `uc?id=` links, or ones saved with `linkFormat: 'download'`? Normalise on read instead of re-uploading:

```typescript
import { toDriveEmbedUrl } from 'longcelot-sheet-db';

const embeddable = toDriveEmbedUrl(row.image_url, 'image'); // 'video' / 'file' also supported
```

### `UploadOptions` type

```typescript
interface UploadOptions {
  filename: string;
  mimeType: string;
  folder?: string;                   // subfolder path; each segment created if missing
  public?: boolean;                  // set Drive permission: anyone / reader
  linkFormat?: 'auto' | 'download';  // 'auto' (default): renderable URL by mimeType; 'download': raw uc?id= link
}
```

### Custom storage provider

Implement the two-method `StorageAdapter` interface to use S3, GCS, Cloudinary, or any other provider:

```typescript
import type { StorageAdapter, UploadOptions } from 'longcelot-sheet-db';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

const s3 = new S3Client({ region: 'ap-southeast-1' });

const s3Storage: StorageAdapter = {
  async upload(file: Buffer, options: UploadOptions): Promise<string> {
    const key = `${options.folder ?? 'uploads'}/${options.filename}`;
    await s3.send(new PutObjectCommand({
      Bucket: process.env.S3_BUCKET!,
      Key: key,
      Body: file,
      ContentType: options.mimeType,
      ACL: options.public ? 'public-read' : 'private',
    }));
    return `https://${process.env.S3_BUCKET}.s3.amazonaws.com/${key}`;
  },
  async delete(url: string): Promise<void> {
    const key = new URL(url).pathname.slice(1);
    await s3.send(new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET!, Key: key }));
  },
};

const adapter = createSheetAdapter({ ..., storage: s3Storage });
```

Migrating from Drive to S3 later means re-uploading files and updating the URL column — the schema never changes.

### `StorageAdapter` interface

```typescript
interface StorageAdapter {
  upload(file: Buffer, options: UploadOptions): Promise<string>; // returns public URL
  delete(url: string): Promise<void>;
}
```

---

## Common Mistakes

- **`driveFolder` not creating expected structure** — The `root` folder is created at the root of My Drive (or the Shared Drive root when `sharedDriveId` is set). If the folder already exists under a parent, the adapter creates a new one at Drive root. Verify the first lookup finds the right parent.
- **Passing `actorTokens` without storing the `refresh_token`** — Google only returns `refresh_token` on first authorization. If you discard it, `actorTokens` will expire in 1 hour and `createUserSheet` will fail for that user. Always persist the `refresh_token` via `tokenStore.set`.
- **Calling `adapter.upload()` with no `storage` configured** — Throws `SchemaError: No storage adapter configured`. Pass `storage: new DriveStorageAdapter()` or a custom adapter to `createSheetAdapter`.
- **Expecting `DriveStorageAdapter` to use `driveFolder.root`** — `DriveStorageAdapter` manages its own folder path (the `folder` option in `UploadOptions`). It does not inherit the `driveFolder` root. Uploaded files land where you tell the `folder` option, independent of where sheets are placed.
- **Using `sharedDriveId` without `supportsAllDrives` on existing Drive calls** — The adapter handles this automatically; the caveat is that the OAuth user must have access to the Shared Drive. Check Google Workspace admin permissions if file creation fails with a 404.
- **`tokenStore.get` returning stale / expired tokens** — The adapter does not auto-refresh tokens retrieved from `tokenStore`. Call `oauth.refreshTokens(storedRefreshToken)` before storing, or refresh in your `tokenStore.get` implementation.
- **Assuming `adapter.upload()` still returns `uc?id=`** — It now returns a renderable URL by default (thumbnail/preview/viewer, chosen from `mimeType`). Code that parses the URL expecting the old download-link shape (or a custom `toEmbeddableImageUrl()`-style helper written against it) should either be deleted (the link already renders) or updated — `linkFormat: 'download'` opts back into the old shape if you specifically need it.
- **Writing your own `uc?id=` → embeddable-URL conversion helper** — Don't; it's built in. Use `toDriveEmbedUrl(url, kind)` to normalise a pre-existing download-format link instead of reimplementing the regex/rewrite yourself.
