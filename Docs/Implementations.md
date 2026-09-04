# longcelot-sheet-db — Implementation

> Companion to [`architecture.md`](./architecture.md) (concepts) and
> [`system-architecure.md`](./system-architecure.md) (diagrams). This document explains
> **how the design is actually coded** — the concrete mechanisms, data flow, and the
> non-obvious decisions behind them — walking through the real source files in `src/`.

---

## 1. How This Fits Together

Three layers of source, each with one job, wired by one shared contract:

```
src/schema/    → describes data          (defineTable, columnBuilder)
src/adapter/   → moves data              (SheetAdapter, SQL adapters, CRUD, access control)
src/auth/      → proves identity          (OAuth, JWT)
src/cli/       → operates on the above offline (sync, validate, migrate, ...)
```

Every storage engine (`SheetAdapter`, the Postgres/MySQL/Prisma adapters) implements the
same `DatabaseAdapter` / `TableOperations` interface (`src/adapter/types.ts`), so
`adapter.withContext(ctx).table(name).create({...})` is identical application code
regardless of which engine sits underneath. That contract — not any single class — is the
core design decision everything else in this document supports.

---

## 2. Schema DSL: Builder Pattern → Plain Data

`string()`, `number()`, `boolean()`, `date()`, `json()` (`src/schema/columnBuilder.ts`) each
return a `ColumnBuilder` wrapping a mutable `ColumnDefinition`. Every modifier
(`.required()`, `.unique()`, `.default()`, `.min()`, `.max()`, `.enum()`, `.pattern()`,
`.readonly()`, `.primary()`, `.ref()`, `.index()`) mutates that same object and returns
`this`, which is what makes the fluent chain read declaratively:

```typescript
email: string().required().unique().min(5).max(100)
```

`.primary()` is implemented as sugar, not a separate code path — it just sets
`unique: true` and `required: true` alongside `primary: true`:

```typescript
primary(): this {
  this.definition.primary = true;
  this.definition.unique = true;
  this.definition.required = true;
  return this;
}
```

`.build()` extracts the plain `ColumnDefinition` object at the end of the chain, so nothing
downstream of `defineTable()` ever touches a `ColumnBuilder` — only inert data.

**`defineTable()`** (`src/schema/defineTable.ts`) does four things, in order:

1. Resolves every column to its `ColumnDefinition` (unwrapping `ColumnBuilder`s that are
   still mid-chain, or accepting a raw `ColumnDefinition` directly).
2. Rejects more than one `.primary()` column with a `SchemaError` naming every offending
   column, so the failure is diagnosable rather than "first one silently wins."
3. Injects the reserved auto-columns based on table options — `_created_at`/`_updated_at`
   (readonly `date`) when `timestamps: true`, `_deleted_at` when `softDelete: true`, and
   `_id` (readonly, required, unique `string`) **unconditionally**, on every table.
4. Returns a fully-resolved `TableSchema` — the one shape every later layer (CRUD, CLI,
   SQL DDL generation, ER diagrams) consumes.

This means `TableSchema` is the single source of truth radiating outward: the same object
that validates a `create()` call also generates `schema.sql`/`schema.prisma` (`lsdb migrate`)
and the Mermaid ER diagram (`lsdb erdiagram`) — there's no separate schema description to
keep in sync by hand.

**Circular reference detection.** `SheetAdapter.registerSchema()` runs a DFS
(`detectCircularRefs()`) over the `ref()` graph on every registration, throwing a
`SchemaError` the moment a cycle appears — this fails fast at startup rather than at some
later `create()` call that happens to walk the cycle.

---

## 3. The Shared `DatabaseAdapter` Contract

```typescript
interface DatabaseAdapter {
  withContext(context: UserContext): DatabaseAdapter;
  asActor(targetActor: string, targetSheetId: string): DatabaseAdapter;
  table(tableName: string): TableOperations;
}

interface TableOperations {
  create, createMany, findMany, findOne, update, upsert, delete, count
}
```

`SheetAdapter` and `SQLAdapterBase` (shared by the Postgres/MySQL adapters) both implement
this **independently**, but their `withContext()`/`asActor()` logic is line-for-line
identical — actor/role normalization, the deprecation warning path for the legacy
`role`/`targetRole` fields, and context cloning via `Object.create(this)` so a new context
never mutates the adapter it was derived from. `SheetAdapter.table()` additionally kicks off
an async schema-version check (`_pendingSchemaCheck`) that `SQLAdapterBase.table()` doesn't,
because SQL engines never auto-sync schema at runtime (see §8).

**`createDatabaseAdapter({ driver })`** (`src/adapter/createDatabaseAdapter.ts`) is the one
branch point application code should ever need:

```typescript
const driver = config.driver ?? (process.env.DB_DRIVER as DBDriver) ?? 'sheets';
switch (driver) {
  case 'sheets':   return createSheetAdapter(config.sheets ?? sheetsConfigFromEnv());
  case 'postgres': return createPostgresAdapter(config.postgres ?? { connectionString: process.env.DATABASE_URL });
  case 'mysql':    return createMySQLAdapter(config.mysql ?? { connectionString: process.env.DATABASE_URL });
}
```

`pg` and `mysql2` are optional `peerDependencies`, `require()`'d lazily only inside
`createPostgresAdapter()`/`createMySQLAdapter()` — importing this package for Sheets-only
use never pulls either driver in. `'prisma'` is deliberately **not** a `DBDriver` value:
`createPrismaAdapter({ client })` needs an already-constructed, already-`prisma generate`'d
client object, and no environment variable can hold a live object — Prisma-track consumers
keep one line of branching in their own app instead.

---

## 4. Context & Access Control — One Gate, Every Engine

Every operation carries a `UserContext { userId, actor, actorSheetId, targetActor?,
targetSheetId? }`. `src/adapter/accessControl.ts` holds two pure functions extracted
verbatim out of `SheetAdapter`'s original private methods specifically so the SQL adapters
enforce **identical** rules instead of re-implementing the branching logic:

**`hasPermission(schema, context, permissions)`** — decision order:

1. No context → deny.
2. `context.role === 'admin'` → allow unconditionally (short-circuits everything else).
3. Same actor, no `targetActor` set → allow (you can always read/write your own data).
4. `schema.actor === 'admin'` and caller isn't admin → deny (admin tables are never
   cross-actor reachable).
5. Cross-actor request (`targetActor` set and different from `context.role`) → look up
   `permissions[context.role]`; throw `PermissionError` if it's missing entirely, if
   `targetActor` isn't in `canAccess`, or if `tables` is set and doesn't list this table.

**`resolveNonAdminTenantKey(schema, context)`** decides *which* physical store a granted
request actually touches: same-actor requests use `context.actorSheetId`; a granted
cross-actor request must supply `context.targetSheetId` or it throws — there is no implicit
fallback that could silently point a cross-actor read at the wrong tenant.

For `SheetAdapter`, that key is a real spreadsheet ID. For the SQL adapters
(`SQLAdapterBase.table()`), the exact same function's return value becomes the value bound
to an injected `tenant_id` column (`TenantScope` in `queryBuilder.ts`) — a non-Sheets engine
has no physical per-user file, so tenancy is expressed as a WHERE-clause column instead. This
is the mechanism that lets one permission model serve every engine without a second
implementation.

> **Trust boundary, stated explicitly in the code's own comments:** `hasPermission()` is
> *authorization* only — it trusts `context.role` as an already-true fact and never
> re-verifies who is making the claim. The `role === 'admin'` branch is exactly as safe as
> whatever server-side code constructed the `UserContext`. That construction must derive
> `role` from a verified JWT (`verifyJwt()`, §7) plus a trusted lookup — never from
> client-controlled input.

---

## 5. CRUD Engine (`src/adapter/crud.ts`)

`CRUDOperations` is the storage-agnostic Sheets implementation of `TableOperations` — it
depends only on the narrow `StorageClient` interface (`getAllRows`, `appendRow`,
`appendRows`, `updateRow`, `deleteRow`, `writeHeader`), not the concrete `SheetClient`, which
is what would let a non-Sheets engine plug into the same class if one were ever built for it.

### 5.1 `create()` pipeline

```
generate PK (if primary()) → generate _id → validateAndApplyDefaults()
  → validateForeignKeys() → checkUniqueness() → stamp _created_at/_updated_at
  → serializeValue() per column → appendRow() → maybeExtendValidation()
```

- `_id` is generated with `nanoid()` **before** validation, specifically so the
  "`_id` is required" check on the auto-injected `_id` column always trivially passes —
  the caller never supplies it, and it's never optional.
- `validateAndApplyDefaults()` is a single pass over `schema.columns` that applies
  `default()` (create-only), enforces `required`, `enum`, `min`/`max`, `pattern`, and
  rejects a `readonly` column present in an **update** payload. Defaults are deliberately
  never applied on `update()` — an omitted field keeps its existing value instead of being
  reset.
- `validateForeignKeys()` walks every `ref()` column and calls the injected `FKResolver`
  (built by `SheetAdapter.createFKResolver()`, which spins up a throwaway `CRUDOperations`
  against the referenced table and does a `findOne()`). `options.skipFKValidation` bypasses
  this for bulk seeding.
- `checkUniqueness()` does a `findOne({ where: { [col]: value } })` per `unique()` column —
  correct, but means N unique columns cost N extra reads per `create()`/`update()`; those
  reads are cheap in practice because they go through the same read cache as everything else
  (§6).

### 5.2 Serialization: the sheet is a grid of strings

Every cell in Google Sheets is text, so `serializeValue()`/`deserializeRow()` are the
translation boundary between `Record<string, unknown>` and `string[]`:

| Type | Write | Read |
|---|---|---|
| `boolean` | `'TRUE'/'FALSE'` or `'1'/'0'`, per `column.booleanFormat ?? defaultBooleanFormat` | Accepts **either** format regardless of which is currently configured — a sheet's history can mix formats after a config change |
| `date` | `Date` → `.toISOString()`; a raw ISO string passed through unchanged | Unwraps an accidental literal-quote wrapper (from an old `JSON.stringify(date)` bug class) before re-parsing; falls back to the raw value if it still doesn't parse, rather than discarding data |
| `json` | `JSON.stringify(value)` | `JSON.parse()`, falling back to the raw string on parse failure |
| `number` | `String(value)` | `Number(value)` |
| everything else | `String(value)` | passed through |

The `Date`-vs-`JSON.stringify` handling is a deliberate footgun fix: `JSON.stringify(new
Date())` produces a **quoted** ISO string, and writing that literal quote pair into a cell
silently corrupts every later `new Date(cellValue)` read on that cell. `serializeValue()`
special-cases `instanceof Date` before the generic `typeof value === 'object'` branch so
passing a `Date` anywhere a `date()` column is expected is always safe.

### 5.3 Reading rows: filtering phantom rows

`getDataRows()` is the single read path every query method funnels through. It treats a row
as real only if its `_id` cell is non-empty — Sheets can carry formatting/validation past the
actual data range (checkbox/dropdown cells with no row behind them), and without this filter
those show up as phantom empty records. `findMany()`/`findOne()`/`count()` additionally strip
soft-deleted rows (`_deleted_at` populated) unless `includeDeleted: true` is passed.

### 5.4 `update()` / `upsert()` / `delete()`

- `update()` scans every row via `getDataRows()`, matches `options.where` with an
  in-memory equality check (`matchesWhere`), strips the primary-key column silently (it's
  readonly), validates/defaults/uniqueness the same way `create()` does, merges onto the
  existing row, and re-serializes the **entire** row before `updateRow()` — a partial cell
  write isn't possible with the Sheets `values.update` API used here, so every update
  round-trips the full row.
- `upsert()` does a `findOne({ includeDeleted: true })` first — `includeDeleted` matters
  because an already-soft-deleted row is still physically present; without it, upsert would
  wrongly take the `create()` branch against a row that's already there. On the update
  branch it strips `readonly` columns from the payload before calling `update()`, so a
  caller upserting a full row snapshot (e.g. a sync tool re-writing a row verbatim,
  `_created_at` included) doesn't trip the readonly-on-update rejection.
- `delete()` branches on `schema.softDelete`: soft-delete routes through `update()` setting
  `_deleted_at`; hard delete walks matching rows **in reverse** and calls `deleteRow()`
  per match, so deleting row *N* never shifts the still-to-be-checked indices of rows before
  it in the same pass.

### 5.5 Keeping validation dropdowns in sync between syncs (`maybeExtendValidation`)

`formatSheet()`/`syncSchema()` apply `boolean()`/`enum()` dropdown validation only to the
data rows that exist **at sync time**, plus a fixed `VALIDATION_ROW_BUFFER` (200 rows) of
headroom — an unbounded range would make Sheets report every one of those
formatted-but-empty rows as "has content" on every read. `create()` calls
`maybeExtendValidation()` every `VALIDATION_CHECK_INTERVAL` (100) rows to push that covered
range forward as real rows accumulate between `lsdb sync` runs, without re-checking (or
re-extending) on literally every insert. The interval is defined as exactly half the buffer
so coverage can never run out between checks — a check at row *R* extends coverage to
`R + 200`; the next check at `R + 100` still lands well inside that window.

---

## 6. `SheetClient` — The Google API Boundary and Its Read Cache

`SheetClient` (`src/adapter/sheetClient.ts`) is the only place `googleapis` is called
directly. Two design choices here carry the most operational weight:

### 6.1 The read cache exists to survive Google's quota, not for raw speed

`getAllRows()` is the funnel every `findMany`/`findOne`/`count`/`update`/`delete` call goes
through. Without a cache, one HTTP handler touching a table more than once in a single
request (e.g. `checkUniqueness()` calling `findOne()` per unique column) — or ordinary
concurrent traffic hitting a shared table — turns into one Sheets API read *per call*, which
is exactly what exhausts Google's per-user read quota under real load. The cache is:

```typescript
async getAllRows(spreadsheetId, sheetName) {
  if (!this.cacheEnabled) return this._fetchAllRows(spreadsheetId, sheetName);
  const cached = this._readCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.data;
  const inFlight = this._inFlightReads.get(key);
  if (inFlight) return inFlight;               // de-dupe concurrent reads for the same tab
  const promise = this._fetchAllRows(...).then(data => { cache it; return data });
  this._inFlightReads.set(key, promise);
  return promise;
}
```

Two-second TTL by default (`SheetReadCacheConfig`), enabled by default, and keyed per
`${spreadsheetId}::${sheetName}`. The **pairing invariant** the codebase depends on: every
write method (`appendRow`, `appendRows`, `updateRow`, `deleteRow`, `writeHeader`) calls
`invalidateCache()` for that same key before returning, so a read immediately after a write
through the same adapter instance always sees fresh data. A read path that bypasses
`getAllRows()`, or a write that forgets to invalidate, silently reintroduces stale reads or a
cache that never clears — which is why this pairing is called out explicitly in code
comments and in `CLAUDE.md` for this package.

### 6.2 Formatting and validation are applied only when something actually changed

`syncSchema()` only calls `writeHeader()`/`formatSheet()` when the tab is new or new columns
were added — an unchanged schema makes zero formatting API calls on repeat syncs. When it
does write, `formatSheet()` batches header fill color, frozen-row/column settings, auto-fit
column widths, and `ONE_OF_LIST` data-validation dropdowns for `boolean()`/`enum()` columns
into a **single** `batchUpdate` call rather than one round trip per concern.

`boolean()` columns deliberately use `ONE_OF_LIST` restricted to `TRUE`/`FALSE` (or `1`/`0`)
rather than Sheets' native `BOOLEAN` checkbox type — the native type writes a real `FALSE`
into every blank cell it covers, which is indistinguishable from a genuine row; `ONE_OF_LIST`
leaves an unselected cell genuinely empty, which is what lets `getDataRows()`'s `_id`-based
phantom-row filter (§5.3) work at all.

---

## 7. Actor Storage & Per-Actor Drive Placement

`src/adapter/driveTenancy.ts` is a small, deliberately shared module — its two functions are
used by both `SheetAdapter.createUserSheet()` (where an actor's *sheet* is placed) and
`DriveStorageAdapter` (where a file that actor *uploads* is placed), so the two can never
drift apart:

- **`resolveActorClient(userId, adminClient, credentials, cacheConfig, tokenStore,
  actorTokens)`** — resolution order: explicit `actorTokens` argument → `tokenStore.get(userId)`
  → fall back to the shared admin `SheetClient`. This is the actor-owned-Drive vs.
  shared-admin-Drive decision, made once and reused for both sheet creation and file uploads.
- **`resolveRoleFolder(client, driveFolder, role, sharedDriveId, cache, cacheKey)`** —
  resolves (creating if missing) `driveFolder.root/subfolders[role]`, memoized per
  `cacheKey` so an actor-owned client's folder ID is never confused with the shared admin
  client's folder of the same name.

`SheetAdapter`'s constructor injects its own `SheetClient` plus this tenancy config into
`DriveStorageAdapter` via a `_setClient()` back-channel — the consumer configures Drive
folder layout once, and both sheet placement and upload placement honor it identically, with
no credential or config repetition on the caller's side.

---

## 8. Auth: OAuth Manager + Stateless JWT Router

### 8.1 `OAuthManager` (`src/auth/oauth.ts`)

Thin wrapper over `google-auth-library`'s `OAuth2Client`, but with an important scope split:
`createOAuthManager()` defaults to `SHEETS_SCOPES` only (`spreadsheets`, `drive.file`) and
its tokens carry **no** `id_token`; `createLoginOAuthManager()` defaults to `LOGIN_SCOPES`
(`openid`, `email`, `profile`, plus `SHEETS_SCOPES`), whose tokens do. `verifyToken()` on a
manager built the first way always throws — this split exists so an app can request identity
scopes on the user's own login grant while doing all actual Sheets/Drive work under a
separate, server-held admin token, rather than forcing Google's "hasn't verified this app"
interstitial onto every login for scopes the login flow itself never uses.

### 8.2 `createAuthRouter()` (`src/auth/router.ts`) — stateless by design

The router is two routes wired as one framework-agnostic handler function
(`app.use(auth.handler)`), and it is deliberately **session-store-free**:

- **CSRF via a self-verifying `state` value**, not a session lookup. `signState(secret)`
  produces `nonce.timestamp.HMAC-SHA256(nonce.timestamp)`; `verifyState()` recomputes the
  HMAC with `crypto.timingSafeEqual` (constant-time, avoiding a timing side-channel) and
  additionally rejects anything older than 10 minutes. Because the value is self-contained,
  the router needs nothing server-side to verify it round-tripped through Google unmodified.
- **JWT issuance without a dependency.** `signJwt()`/`verifyJwt()` hand-roll HS256 using only
  Node's built-in `crypto` — base64url-encode header/payload, HMAC-sign, and (on verify)
  compare with `timingSafeEqual` before checking `exp`. `verifyJwt()` is exported standalone
  specifically so a downstream app has a package-supported way to check the token without
  reimplementing this itself.
- **`onUser(profile, adapter)` is where *your* authorization policy lives**, not lsdb's.
  The router only proves *who Google says the user is*; whether that identity is allowed
  into the app is entirely the callback's decision. `registrationPolicy: 'open'` falls
  through to a JWT built from the bare Google profile when `onUser` returns `null`;
  `'login-only'` sends `401` instead — no self-registration path exists in that mode.
- **Errors are logged server-side, not echoed to the browser.** A caught exception from
  token verification or `onUser` (which might carry a DB error, a Sheets API error, or a
  stack trace) is `console.error`'d and replaced with a generic message in the HTTP
  response — the recipient at that point is the end user's own browser mid-redirect, not a
  trusted operator, so leaking exception detail there is an information-disclosure risk.

### 8.3 Passwords (`src/auth/password.ts`)

`hashPassword`/`comparePassword` wrap `bcrypt` directly; `validatePasswordStrength` is a
plain synchronous rule check (length, character classes) run before hashing, so weak
passwords are rejected before any hashing cost is spent on them.

---

## 9. SQL Engines: Same Contract, Different Wire Format

`SQLAdapterBase` (`src/adapter/sql/sqlAdapterBase.ts`) is shared by
`createPostgresAdapter()`/`createMySQLAdapter()`. It re-implements `withContext()`/
`asActor()` identically to `SheetAdapter` (down to the deprecation-warning behavior for
`role`/`targetRole`), and delegates every permission decision to the **exact same**
`hasPermission()`/`resolveNonAdminTenantKey()` from §4 — no second permission implementation
exists for the SQL path.

**Tenancy without a physical per-user file.** `table()` resolves a `TenantScope { column:
tenantColumn, value: resolveNonAdminTenantKey(...) }` for every non-admin schema (default
column name `tenant_id`, configurable) and hands it to `SQLTableOperations`. `queryBuilder.ts`
folds that into every generated statement's `WHERE` clause (and every `INSERT`'s implicit
scoping, via the same resolved value) — the same `context.actorSheetId`/`targetSheetId`
values that are spreadsheet IDs on the Sheets engine become an opaque tenant key here.

**Dialect abstraction is small on purpose** (`src/adapter/sql/dialect.ts`) — five concerns
only: identifier quoting (`"col"` vs. `` `col` ``), placeholder style (`$1` vs. `?`), boolean
literal representation (native `true`/`false` vs. `1`/`0`), `LIMIT`/`OFFSET` syntax (MySQL
needs a `LIMIT` sentinel before an `OFFSET`-only query is valid), and native
constraint-violation classification (`23505`/`23503` Postgres error codes vs. MySQL's
`ER_DUP_ENTRY`/`ER_NO_REFERENCED_ROW*` codes) for `errorTranslation.ts` to turn into the same
`ValidationError` either engine's Sheets counterpart would throw. `queryBuilder.ts`'s
`buildSelect`/`buildInsert`/`buildUpdate`/`buildDelete` are pure functions returning
`{ text, params }` — always parameterized, never string-interpolated values, so SQL
injection isn't a class of bug that can appear here regardless of what a caller passes as
`where`/`data`.

`SQLTableOperations.upsert()` carries the identical `includeDeleted` and
readonly-column-stripping fixes as `CRUDOperations.upsert()` (§5.4) — ported deliberately so
behavior doesn't silently diverge between engines on this specific edge case.

---

## 10. CLI: Schema Files In, Live Sheets/DB Out

The CLI (`src/cli/`) never touches runtime application row data except via the explicit
`seed`/`mock-users`/`migrate-data` commands — every other command operates on schema
*structure*.

- **Schema files are loaded with a plain `require()`** (`loadCLIConfig()`,
  `loadSchemasWithPaths()` for `erdiagram`) — no Google API call, no OAuth, just executing
  the TypeScript/compiled-JS files on disk and collecting whatever `defineTable()` produced.
  This is why `lsdb erdiagram` is the one command with zero network dependency.
- **`buildAdminAdapter()`** (`src/cli/lib/adminAdapter.ts`) is the shared setup every
  Sheets-touching command (`sync`, `drop-table`, `drop-column`, `rename-column`, `doctor`,
  `status`) goes through: validate the three required env vars, resolve tokens
  (`--token-file` for CI, or the interactive/loopback OAuth flow otherwise via
  `resolveTokens()`), construct a `SheetAdapter`, register schemas, and return an
  admin-context adapter plus the raw admin sheet ID.
- **`resolveSheetTargets()`** is the shared `--all-users` fan-out: it always includes the
  actor's configured dev/shared sheet (`process.env[actorCfg.sheetIdEnv]`), and with
  `--all-users` additionally reads every row of the admin `users` table and adds each
  matching user's `actor_sheet_id` as its own labeled target — the same traversal
  `migrate-data --all-users` and `seed --all-actors` reuse.
- **Schema drift detection is a SHA-256 hash, not a raw diff.** `computeSchemaHash()`
  (`src/utils/schemaHash.ts`) normalizes a `TableSchema` — excluding auto-fields
  (`_id`, etc.), sorting columns by name, and keeping only the properties that matter for
  drift (`type`, `required`, `unique`, `primary`, `enum`, `booleanFormat`) — before hashing,
  so column *reordering* or the addition of new modifiers the hash doesn't track never
  triggers a false mismatch. `SheetAdapter.upsertSchemaVersion()`/`getSchemaVersion()` store
  this hash per `(actor_sheet_id, table_name)` in the admin `schema_versions` table on every
  sync; `withContext()` optionally kicks off `_doSchemaVersionCheck()` in the background
  (`onSchemaMismatch: 'warn' | 'error' | 'auto-sync'`) to compare a live sheet's hash against
  what's currently registered in code.

---

## 11. Error Handling Design

Four custom error classes (`src/errors/`) — `ValidationError`, `PermissionError`,
`SchemaError`, `SchemaMismatchError` — are thrown everywhere instead of a bare `Error`, so
callers can branch on *what actually went wrong* (a bad field value vs. an access-control
denial vs. a missing table vs. stale schema) rather than string-matching a message. Every
validation failure in `crud.ts` carries the offending column name; every permission failure
in `accessControl.ts` carries the caller's role — both are structured fields on the error
object, not just embedded in the text.

---

## 12. Module-to-Responsibility Map

| File | Responsibility |
|---|---|
| `schema/columnBuilder.ts` | Fluent builder → `ColumnDefinition` |
| `schema/defineTable.ts` | Assembles `TableSchema`, injects `_id`/timestamps/soft-delete, rejects duplicate PKs |
| `adapter/types.ts` | `DatabaseAdapter` / `TableOperations` / `StorageClient` contracts |
| `adapter/accessControl.ts` | `hasPermission()`, `resolveNonAdminTenantKey()` — shared by every engine |
| `adapter/createDatabaseAdapter.ts` | Single env-driven factory across engines |
| `adapter/sheetAdapter.ts` | Sheets `DatabaseAdapter`: context, sheet creation, sync, schema versioning |
| `adapter/crud.ts` | Engine-agnostic-shaped CRUD logic over a `StorageClient` |
| `adapter/sheetClient.ts` | Google Sheets/Drive API calls, read cache, formatting/validation |
| `adapter/driveTenancy.ts` | Actor-vs-admin Drive client + folder resolution, shared by sheet and file placement |
| `adapter/driveStorageAdapter.ts` | `StorageAdapter` implementation backing `adapter.upload()`/`deleteFile()` |
| `adapter/sql/*` | Postgres/MySQL `DatabaseAdapter`s: dialect, query builder, FK resolver, error translation |
| `auth/oauth.ts` | `OAuthManager`, scope configuration |
| `auth/router.ts` | Express-shaped OAuth login/callback routes, stateless JWT issuance/verification |
| `auth/password.ts` | bcrypt hashing/comparison, password-strength rules |
| `utils/schemaHash.ts` | Normalized SHA-256 hash for schema-drift detection |
| `utils/validationRules.ts` | Maps `boolean()`/`enum()` columns to Sheets dropdown validation rules |
| `cli/lib/adminAdapter.ts` | Shared CLI setup: env checks, token resolution, admin-context adapter |
| `cli/commands/*` | One file per `lsdb` subcommand |
| `errors/*` | `ValidationError`, `PermissionError`, `SchemaError`, `SchemaMismatchError` |

---

## 13. Design Decisions Worth Naming Explicitly

- **One contract, many engines** — the entire multi-engine story (§3) exists because
  `DatabaseAdapter`/`TableOperations` was extracted as an explicit interface rather than
  application code depending on `SheetAdapter`'s concrete shape.
- **Permission logic lives in exactly one place** (§4) — `accessControl.ts` was pulled out
  of `SheetAdapter` specifically so the SQL adapters couldn't drift from it by
  reimplementation.
- **The read cache is a correctness pairing, not an optimization flag** (§6.1) — every new
  read path must go through `getAllRows()`; every new write must call `invalidateCache()`.
- **Actor ≠ RBAC role** (see `architecture.md` §4) — actors are fixed storage domains
  decided at deploy time; dynamic per-user permissions are explicitly out of scope and left
  to the integrating application's own `roles` table.
- **Never trust the browser with a database connection** — the auth layer proves identity
  and issues a JWT; the application backend is the only thing that ever holds Sheets/Drive/DB
  credentials (see `system-architecure.md` §9).
- **Fail loud, fail typed** — custom errors over bare `Error`, explicit `SchemaError` on a
  primary-key conflict or unregistered table, explicit `PermissionError` with the denied
  role attached, rather than a generic thrown string anywhere in the request path.
