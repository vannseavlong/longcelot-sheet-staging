# Changelog

> **How to read this file**
>
> Every time a new version is released, a new section is added here at the top.
> Changes are grouped by type:
> - **Added** – new features
> - **Changed** – changes to existing behaviour
> - **Fixed** – bug fixes
> - **Removed** – removed features
> - **Security** – security fixes
>
> The `[Unreleased]` section collects changes that are merged but not yet published to npm.
> When you run `npm publish`, rename `[Unreleased]` to the new version number and date.

All notable changes to this project will be documented in this file.
This project follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) and [Semantic Versioning](https://semver.org/).

---

## [0.1.40] — 2026-07-26

### Added

- **`toDriveEmbedUrl(url, kind?)`, `classifyDriveMediaKind(mimeType)`, `buildDriveViewUrl(fileId, kind)`, `buildDriveDownloadUrl(fileId)`, `extractDriveFileId(url)`** — exported from `src/utils/driveMedia.ts`. `toDriveEmbedUrl()` normalises a Drive link (old `uc?id=` download links included) into the renderable form for a given media kind, for rows saved before this release.
- **`UploadOptions.linkFormat?: 'auto' | 'download'`** — `'auto'` (default) returns a renderable URL; `'download'` opts back into the raw `uc?id=` download-endpoint URL for callers that need the actual file bytes (e.g. server-side re-fetching) rather than a rendered preview.

### Changed

- **`DriveStorageAdapter.upload()` now returns a URL that renders directly, chosen from `mimeType`, instead of the `uc?id=` download-endpoint link.** Every downstream project needed the link to load inline in `<img>`/`<video>`/`<iframe>`, and `uc?id=` doesn't reliably do that — more than one project ended up writing its own conversion helper against the URL this package produced. Images now get `drive.google.com/thumbnail?id=…&sz=w1000` (`<img src>`), videos get `drive.google.com/file/d/…/preview` (`<iframe src>`), everything else gets `drive.google.com/file/d/…/view` (a clickable open/preview link). See FAQ.md §14. **Behaviour change**: code that parsed or stored the old `uc?id=` shape should either drop that handling (the link already renders) or pass `linkFormat: 'download'` to keep the previous URL format.
- **`DriveStorageAdapter.delete()` / `adapter.deleteFile()`** now extract the file ID from any URL format `upload()` can produce (`uc?id=`, `thumbnail?id=`, `/file/d/{id}/...`), not just the old `uc?id=` shape.

See FAQ.md §14 for the full rationale and migration notes.

---

## [0.1.39] — 2026-07-14

### Fixed

- **`upsert()` threw a native unique-constraint violation when re-run against a row that had already been migrated as soft-deleted.** All three adapters' `upsert()` checked for an existing row via `findOne({ where: options.where })` with no `includeDeleted` option — since `findOne()` excludes soft-deleted rows by default, an already-soft-deleted target row was invisible to this check, so `upsert()` wrongly concluded the row didn't exist yet and called `create()`, which failed on the database's own primary-key constraint (the row was very much still there). Found immediately after the [0.1.38] `includeDeleted` fix, same F2 cutover: once soft-deleted rows started actually reaching the target database, a rerun against one of them broke `migrate-data`'s core "safe to rerun" idempotency guarantee. Fixed by passing `includeDeleted: true` to `upsert()`'s own existence check in all three adapters — `update()` itself needed no change, since none of the three ever filtered its own row-matching query by soft-delete status in the first place.

See FAQ.md §13 for the full incident write-up (F2 Render Postgres data cutover).

---

## [0.1.38] — 2026-07-14

### Fixed

- **`lsdb migrate-data` silently excluded soft-deleted rows from the cutover, breaking foreign-key integrity on the target database whenever another row still referenced one.** Every read in `migrate-data.ts` (both the live `--run` path and the generated stub-script path) used plain `findMany({})`, which — per the package's documented soft-delete behavior — excludes rows with `_deleted_at` set by default. Found via the real F2 data cutover: an `orders` row's `assigned_cleaner_id` pointed at a `cleaners` row that genuinely exists but was soft-deleted (a real historical fact — an order really was handled by that cleaner before they were removed from the roster), so the cleaner never got migrated even though the order referencing it did, failing with a real FK violation on the target database. Fixed by reading every table (and the `users` lookup for `--all-users`) with `findMany({ includeDeleted: true })` instead — this only changes what gets migrated, not what the application sees afterward, since the target database's own `findMany()` still filters `_deleted_at` by default post-cutover.

See FAQ.md §13 for the full incident write-up (F2 Render Postgres data cutover), including the separate, non-package dangling-reference issue (a `category_products` row pointing at a category that never existed at all, not even soft-deleted) found and cleaned up alongside this fix.

---

## [0.1.37] — 2026-07-13

### Fixed

- **`lsdb migrate-data --run` could upsert a table's rows before the table it references via `ref()` had any rows at all, failing with a real foreign-key violation.** `migrate-data.ts` has its own `loadSchemas()` — duplicated from `migrate.ts`'s, not shared — which never received the `sortSchemasByDependency()` fix from the [0.1.34] FK-ordering incident. Found via the real F2 data cutover: `category_addon_items.ts` (`ref('category_addons._id')`) sorts alphabetically before `category_addons.ts`, so its rows were upserted first, against an empty `category_addons` table — `FK violation: Key (addon_id)=(...) is not present in table "category_addons"`. Fixed by wiring the existing `sortSchemasByDependency()` into both of `migrate-data.ts`'s call sites (the live `--run` path and the stub-script-generation path), same topological sort already used and tested for `migrate --sql --apply`.

See FAQ.md §13 for the full incident write-up (F2 Render Postgres data cutover).

---

## [0.1.36] — 2026-07-13

### Fixed

- **`create()`/`createMany()`/`update()` built their column list straight from the caller's data object, with no schema awareness — a stray key that isn't a declared column reached the database as a literal column reference and failed.** Found via the real F2 data cutover: `lsdb migrate-data --run` upserts the exact row it reads back from Sheets, and a real Sheet tab had a leftover/legacy column (`task_information`) that predates the current `categories.ts` schema — Postgres correctly rejected it with `column "task_information" of relation "categories" does not exist` (the Prisma adapter would hit the equivalent "Unknown argument" instead). `SQLTableOperations.serializeRow()` and the new `PrismaTableOperations.filterKnownColumns()` now drop any key that isn't a real entry in `schema.columns` before it reaches `buildInsert()`/`buildUpdate()`/the Prisma delegate — every column a table actually has, including the system ones (`_id`/`_created_at`/`_updated_at`/`_deleted_at`), is a real `schema.columns` entry, so this only ever drops keys that were never part of the schema. `SheetAdapter`'s `CRUDOperations` was already unaffected — it writes by iterating known `headers`, not the payload's own keys.

See FAQ.md §13 for the full incident write-up (F2 Render Postgres data cutover).

---

## [0.1.35] — 2026-07-13

### Fixed

- **`upsert()` on an already-existing row threw `Column ... is readonly` when the payload included readonly system columns (`_id`, `_created_at`, `_updated_at`).** All three adapters (`SheetAdapter`'s `CRUDOperations`, `SQLTableOperations`, `PrismaTableOperations`) forwarded `upsert()`'s full data payload straight to `update()` on the existing-row branch — correct for a normal API caller, but `lsdb migrate-data --run` legitimately upserts the exact row it read back from Sheets (readonly fields included), so any idempotent rerun against already-migrated data crashed instead of just refreshing the non-readonly fields. Fixed by stripping readonly columns from the payload before calling `update()` in all three adapters' `upsert()` — an upsert into an existing row was never going to rewrite `_created_at` anyway, so this only changes behavior for exactly the case that used to throw.
- **`create()` unconditionally stamped `_created_at`/`_updated_at` to `now()` in all three adapters, discarding any caller-supplied value.** Found while fixing the bug above: `lsdb migrate-data` passes each row's real original Sheets timestamps on first creation, but every migrated row silently got "time of the migration run" instead of its true history. Fixed: `create()`/`createMany()` now only default to `now()` when the field is `undefined`/`null`, preserving a caller-supplied timestamp when present. Normal application `create()` calls are unaffected, since they never supply these fields themselves.

See FAQ.md §13 for the full incident write-up (F2 Render Postgres data cutover).

---

## [0.1.34] — 2026-07-13

### Fixed

- **`lsdb migrate --sql` (and `--apply`) could emit tables in an order that breaks their own inline `FOREIGN KEY` constraints.** `loadSchemas()` reads schema files via unsorted `fs.readdirSync()`, with no regard for `ref()` dependencies between tables, and `generateSQLTable()` emits foreign keys inline inside `CREATE TABLE` rather than as a deferred `ALTER TABLE`. Found via a real Render Postgres cutover: a schema file that `ref()`s another table happened to sort alphabetically *before* the table it references (`category_addon_items.ts` before `category_addons.ts`), so `--apply` failed live with `relation "category_addons" does not exist`, and a hand-applied `schema.sql` would hit the identical error. Fixed with `sortSchemasByDependency()` — a topological sort over every schema's `ref()` edges, run once right after `loadSchemas()` so both the `schema.sql` file output and the live `--apply` path get a dependency-safe table order. Self-referencing columns (e.g. a `parent_id` pointing at the same table) are handled without special-casing. A true circular FK between two tables (A references B, B references A) can't be resolved by reordering alone — that would need one side's constraint deferred to a post-creation `ALTER TABLE`, not implemented in this pass since no such cycle exists in practice yet. See FAQ.md §13 for the full incident write-up.

---

## [0.1.33] — 2026-07-13

### Fixed

- **`createPostgresAdapter()` and `lsdb migrate --sql --apply` had no SSL support, so both fail against any managed Postgres provider that requires it (Render, Heroku, Supabase, etc.).** A plain `new Pool({ connectionString })` doesn't surface a clear TLS error against these — the server just drops the connection mid-handshake, which `pg`/`pg-pool` report as the generic `Connection terminated unexpectedly`, making the real cause easy to misdiagnose as a network/credentials problem. Found via a real Render Postgres cutover: `lsdb migrate --sql --apply` failed exactly this way a few seconds into applying DDL. Fixed with a new `resolvePostgresSSL()` helper (`src/adapter/sql/resolvePostgresSSL.ts`), shared by both call sites — it enables `ssl: { rejectUnauthorized: false }` automatically for any non-localhost connection string, and leaves localhost/loopback connections (local dev, docker-compose test databases) untouched. `PostgresAdapterConfig` gained an optional `ssl` field to override the automatic detection when needed. See FAQ.md §13 for the full incident write-up.

---

## [0.1.32] — 2026-07-12

### Added

- **Pluggable SQL adapters — Postgres, MySQL, and Prisma (Phase 16.2).** `createPostgresAdapter()`, `createMySQLAdapter()`, and `createPrismaAdapter()` all implement the same `DatabaseAdapter`/`TableOperations` contract as `createSheetAdapter()` (Phase 16.1), so application CRUD code doesn't change when swapping engines at production cutover. `pg`/`mysql2` are optional peerDependencies, lazily required only inside their respective factories. `createPrismaAdapter({ client })` takes an already-`prisma generate`'d `PrismaClient` from the consumer rather than performing codegen itself — see FAQ.md #13.
- **`createDatabaseAdapter({ driver? })`** — single top-level factory picking the engine from config or `$DB_DRIVER` (defaults to `'sheets'`), serving both the "one config value" and CI/CD env-driven-selection stories at once. Does not support `driver: 'prisma'` (no env var can hold a live client instance) — documented as an intentional exception.
- **Actor → SQL tenancy model (Phase 16.3 ADR).** Every non-admin table gets an injected `tenant_id` column (configurable via `tenantColumn`), generalizing Sheets' per-user physical spreadsheet isolation onto shared SQL tables; `UserContext.actorSheetId`/`targetSheetId` are reused as the opaque tenant value, so `withContext()` call sites need zero changes across adapters. New `src/adapter/accessControl.ts` holds the cross-actor permission matrix and tenant-key resolution shared by every adapter; `SheetAdapter` now delegates to it instead of duplicating the logic. See FAQ.md #13.
- **Cross-adapter contract test suite (Phase 16.4).** `tests/contract/runContractSuite.ts` — one behavioral spec (CRUD, upsert, createMany, count, soft-delete, timestamps, uniqueness, FK validation, cross-actor permissions) run against `SheetAdapter`, and against real Postgres/MySQL/Prisma via opt-in `test/integration/sql/*.contract.test.ts` (`RUN_SQL_INTEGRATION_TESTS=1`), so adapter parity is enforced by running the same tests rather than by manual comparison.
- **`lsdb migrate --apply [--connection-string <url>] [--driver postgres|mysql] [--dry-run]`** — applies generated SQL DDL to a live database, or (`--prisma --apply`) shells out to `prisma migrate deploy`. Idempotent: `CREATE TABLE IF NOT EXISTS` handles tables; a native "already exists" error on `CREATE INDEX` (which has no `IF NOT EXISTS` in MySQL) is caught and treated as success.
- **`lsdb migrate-data --run [--connection-string <url>] [--driver postgres|mysql] [--token-file <path>]`** — runs the Sheets → SQL data cutover immediately, upserting every row by `_id` (unconditionally idempotent), instead of generating a `migrate-data.js` script with a stub `insertRow()` to fill in by hand. `--driver prisma` isn't supported (no way for a CLI process to construct a consumer's typed client).
- `generateSQLTable()`/`generatePrismaModel()` DDL fidelity (Phase 16.5): now emit `UNIQUE`/composite `UNIQUE(tenant_id, col)`, `DEFAULT`, `CREATE INDEX` for `index()` columns, `CHECK (col IN (...))`/a real Prisma `enum` block (or a doc-comment fallback for non-string-identifier-safe enums) for `enum()` columns, and the `tenant_id` column/field itself for non-admin tables.

### Fixed

Found via real Postgres/MySQL/Prisma integration testing while building the SQL adapters above (not previously caught since DDL output was only string-matched, never actually run through a real engine or parser) — see FAQ.md #13 for the full incident write-up:

- `date()` columns mapped to MySQL-only `DATETIME` in `generateSQLTable()`; Postgres has no such type. Now `TIMESTAMP`, valid on both.
- A bare column-level `UNIQUE` on a tenant-scoped table enforced uniqueness *globally* across every tenant instead of per-tenant, contradicting the adapters' own tenant-scoped uniqueness checks. Now a composite `UNIQUE(tenant_id, col)` on non-admin tables.
- `CREATE INDEX ... IF NOT EXISTS` is not valid MySQL syntax in any version (only `CREATE TABLE` supports it there) — removed; idempotency for indexes now lives in `migrate --apply`'s error handling instead.
- ISO 8601 datetime strings (`...T...Z`) are rejected by MySQL's `DATETIME`/`TIMESTAMP` columns (`ER_TRUNCATED_WRONG_VALUE`) — `SQLTableOperations` now normalizes to the space-separated form both engines accept.
- A bare literal `DEFAULT` on a `json()` column is rejected by MySQL 8.0.13+ (`ER_BLOB_CANT_HAVE_DEFAULT`) — now parenthesized (`DEFAULT ('{}')`), also valid on Postgres.
- Prisma field names can't start with `_` — broke `lsdb migrate --prisma`'s output for every table, since `_id` is always present. Now stripped for the Prisma field name with the real column name preserved via `@map()`; `createPrismaAdapter()` applies the identical transform at runtime.
- A one-sided `@relation` needs a matching back-relation field on the referenced model — `generatePrismaModel()` only saw one schema at a time and couldn't add it; a new `collectPrismaBackRelations()` pass fixes this.
- A bare field-level `@unique` on a tenant-scoped table enforced uniqueness *globally* across every tenant in Prisma too (same bug class as the SQL composite-`UNIQUE` fix above, found later via a real `prisma db push` + cross-tenant integration test). `generatePrismaModel()` now emits a model-level `@@unique([tenant_id, col])` for non-admin tables instead.

All four `DatabaseAdapter` implementations (Sheets, Postgres, MySQL, Prisma) now pass the full Phase 16.4 contract suite against real infrastructure.

---

## [0.1.31] — 2026-07-10

### Fixed

- **`date()` columns corrupted by a raw `Date` object write, produced unparseable values on read (Critical).** `serializeValue()` had no special case for `Date` instances — they fell into the generic `typeof value === 'object'` branch and got `JSON.stringify()`'d, which wraps the ISO string in a literal pair of quote characters (`'"2026-07-14T03:00:00.000Z"'`) that then got written into the cell as text. `deserializeRow()` had no `case 'date'` to strip that back out, so every later `new Date(cellValue)` on the consuming end produced an Invalid Date — reported downstream as an admin dashboard crashing on render for exactly this reason. Fixed in both directions: `serializeValue()` now normalizes any `Date` instance to `.toISOString()` before it can reach the `JSON.stringify()` path, and `deserializeRow()` gained a `date` case that strips a wrapping quote pair (if present) and re-normalizes to a clean ISO string — so rows already corrupted by the old behavior self-heal on the next read, no migration needed. See FAQ.md #10 for the incident write-up.

---

## [0.1.30] — 2026-07-09

### Added

- **`lsdb erdiagram [--output <file>] [--yes]`** — generates a Markdown file (default `ER-DIAGRAM.md`) containing a Mermaid `erDiagram` of every registered table: columns with type + `PK`/`FK`/`UK` markers, and a relationship line per `ref()` column (`||--||` when the FK column is `unique()`, otherwise `||--o{`). Offline — reads schema files only, no Google Sheets/OAuth calls. If the target file already exists, prompts to overwrite, save under a different name, or cancel; `--yes` overwrites non-interactively for scripting/CI.

---

## [0.1.29] — 2026-07-08

### Changed

- **`lsdb export` → `lsdb migrate`, `lsdb export-data` → `lsdb migrate-data` (breaking for the old `migrate` alias).** In standard tooling (Prisma Migrate, Rails, Flyway), "migrate" means schema/DDL export, so `migrate` now names that command (`--prisma`/`--sql`) and `migrate-data` names row-data export. `lsdb export`/`lsdb export-data` still work as deprecated aliases and forward to the new names with a warning. **The pre-existing deprecated `lsdb migrate` alias (which forwarded to row-data export) has been removed**, not kept — it can't mean both "schema export" and "row-data export" under the same name. Anyone still using the old `lsdb migrate` for row-data export must switch to `lsdb migrate-data`.

### Added

- **`lsdb drop-table [table-names...]`** — deletes a table's schema file and its corresponding Google Sheet tab together. Interactive checkbox selection when no names are given; `--all-users` to also drop from every registered user's personal sheet; `--yes`/`--dry-run`/`--token-file`. `sync` has always been additive-only (never deletes), so this is the first CLI path for actually removing a table.
- **`lsdb drop-column [table-name] [column-names...]`** — same, for individual columns. Resolves each column's position from the sheet's live header row (not the schema file's declared order, since `sync` appends new columns at the end) before deleting. Refuses to drop reserved auto-generated columns or a table's primary key.
- **`lsdb rename-column [table-name] [old-name] [new-name]`** — renames a column in the schema file and overwrites the Google Sheet header cell **in place**, preserving all existing row data (unlike a drop + re-add, which would lose it). This is the safe fix for the real risk this closes: a schema-file rename with no corresponding sheet update desyncs every existing row, and a subsequent `auto-sync`/`sync --all-users` has no way to recover the old data under the new name.
- All three commands: typo-tolerant "did you mean" errors for invalid table/column names, a printed plan + confirmation prompt before making changes, and a warning (non-blocking) when another schema's `ref()` points at the table/column being dropped or renamed.
- `SheetClient.deleteSheet()`, `SheetClient.deleteColumns()`, `SheetClient.updateHeaderCell()` — new low-level primitives backing the above.

---

## [0.1.28] — 2026-07-08

### Fixed

- **`getAllRows()` had no caching, causing `429 RESOURCE_EXHAUSTED` errors under real concurrency (Critical).** Every `findMany()`/`findOne()`/`count()`/`update()`/`delete()` call issued a fresh `values.get` request for the full tab, with no de-duplication even within a single logical operation (e.g. `checkUniqueness()` calling `findOne()` once per unique column) or across concurrent requests from different users hitting the same catalog table. Google's default Sheets API quota (60 read requests/min/user) exhausts quickly under this pattern — see FAQ.md #11 for the incident write-up.

### Added

- **In-memory read cache in `SheetClient`**, enabled by default with a 2-second TTL. Repeated or concurrent `getAllRows()` calls for the same `spreadsheetId` + tab within the TTL window are served from cache or de-duplicated into a single in-flight request instead of hitting the Sheets API each time.
- Every write path (`appendRow`, `appendRows`, `updateRow`, `deleteRow`, `writeHeader`) invalidates the cache entry for that tab, so a read immediately after a write through the same adapter always sees fresh data.
- New `cache?: SheetReadCacheConfig` option on `createSheetAdapter()` — `{ enabled?: boolean; ttlMs?: number }` — to tune or disable the cache. `SheetClient.invalidateCache(spreadsheetId, sheetName)` is exposed for callers that write to a sheet outside the adapter (e.g. a human editing it directly) and need to force the next read to be fresh.
- Tests: repeated reads served from cache, concurrent reads de-duplicated, per-tab cache isolation, TTL expiry refetches, `enabled: false` bypasses the cache, each write method invalidates its tab's cache entry, a failed read doesn't poison the cache.

## [0.1.27] — 2026-06-30

### Fixed

- **`dotenv` was never declared as a dependency.** Six CLI commands (`sync`, `seed`, `mock-users`, `status`, `doctor`, `export-data`) call `require('dotenv').config()`, but `dotenv` had never been added to `package.json` `dependencies` — a fresh install of the published package would throw `Cannot find module 'dotenv'` the moment almost any CLI command ran. Added `dotenv@^17.4.2` to `dependencies`.

## [0.1.26] — 2026-06-30

### Changed

- **CLI command renamed from `sheet-db` to `lsdb`.** The npm package itself is still published as `longcelot-sheet-db` — only the binary you run and its on-disk artifacts changed names. `sheet-db` keeps working as a deprecated alias (prints a one-time warning pointing to `lsdb`) and will be removed in a future release.
- **Config file renamed from `sheet-db.config.ts` to `lsdb.config.ts`.** `lsdb init` now scaffolds the new filename; existing `sheet-db.config.ts` files are still read automatically (with a deprecation warning) so existing projects keep working without manual changes.
- **OAuth token file renamed from `.sheet-db-tokens.json` to `.lsdb-tokens.json`.** `lsdb sync` reads the legacy filename if the new one isn't present yet (with a deprecation warning), and writes new/refreshed tokens to the new filename going forward.
- All CLI output, generated scripts (`export-data.js`), error messages, and documentation now reference `lsdb` instead of `sheet-db`.

## [0.1.25] — 2026-06-28

> Phase 11.4–11.5 — follow-ups to the 0.1.23 phantom-row fix, plus a numeric `orderBy` sort fix.

### Fixed

- **`findMany({ orderBy })` now sorts numeric columns numerically instead of lexicographically.** The comparator coerced every value to a string before comparing, so a numeric "manual sort order" column (e.g. `sort`, `display_order`) came back as `0, 1, 10, 11, 2, 3, ...` once values reached double digits. `CRUDOperations` now compares numerically when both sides of a pair parse cleanly as numbers, falling back to the existing string comparison otherwise — text/date columns sort exactly as before.
- **The bounded validation range from 0.1.23 no longer goes stale as rows are appended.** The fix in 0.1.23 bounded `setDataValidation` to `dataRowCount + 200` at the moment `sheet-db sync` last ran, but nothing kept that range growing afterward — a table fed purely through `create()` calls (no schema changes) would silently lose checkbox/dropdown UI past the original 200-row buffer, recoverable only by re-running `sync`. `CRUDOperations.create()` now self-heals: every 100 rows (half the buffer, so coverage never runs out), it calls the new `SheetClient.extendValidation()` to push the validated range another 200 rows ahead — at no cost in the common case (skipped entirely for schemas with no `boolean()`/`enum()` columns) and using the row number already returned by the Sheets API's own append response, so no extra read is needed to know "how many rows are there now."
- **`boolean()` columns no longer cause Sheets to write a real `FALSE` into blank cells, closing the root cause of the 0.1.23 phantom-row bug for boolean columns specifically.** Google Sheets' native `BOOLEAN` checkbox validation isn't just a rendering choice — applying it sets every blank cell in its range to an actual `FALSE` value, unlike `ONE_OF_LIST` (what `enum()` already used), where an unselected cell stays genuinely empty. `boolean()` now uses `ONE_OF_LIST` too, rendered as a dropdown of `'TRUE'`/`'FALSE'` (or `'1'`/`'0'`) instead of a checkbox. 0.1.23's bounded-range and defensive-`_id`-filter fixes remain in place as defense-in-depth for every other cause of phantom rows.

### Added

- **`SheetStyleConfig.booleanFormat?: 'TRUE_FALSE' | '1_0'`** — project-wide default value pair for `boolean()` columns. Default: `'TRUE_FALSE'`.
- **`boolean({ format })`** — per-column override of the value pair, taking priority over the project-wide default. Useful when one table needs to match an external system's `1`/`0` convention without changing the whole project.
- **`BooleanFormat` type** exported from the package.

### Changed

- **`SheetClient.appendRow()`** now returns the 1-based row number the new row was written to (was `Promise<void>`). Existing callers that ignore the return value are unaffected.
- Extracted `buildValidationRules()` into `src/utils/validationRules.ts`, shared between `SheetAdapter` (sync-time formatting) and `CRUDOperations` (the new self-heal check) instead of being duplicated.
- **`ColumnValidationRule`'s `BOOLEAN` variant removed** — `boolean()` columns produce `ONE_OF_LIST` rules exclusively now. `SheetClient` is internal (not exported from the package), so this isn't a public breaking change.
- **`computeSchemaHash()`** now includes each column's resolved `booleanFormat`, so changing a column's format is detected as schema drift by `onSchemaMismatch`/`sync --all-users` like any other column change.
- This changes the rendered appearance of every existing `boolean()` column on its next sync — a dropdown showing `TRUE`/`FALSE` text instead of a checkbox glyph. Already-written cell values are untouched (Sheets stores the same `'TRUE'`/`'FALSE'` text either way); `deserializeRow()` accepts both `'TRUE'` and `'1'` as true so rows written before and after a format change read back correctly.

---

## [0.1.23] — 2026-06-27

> Phase 11 — developer-reported bug fixes against 0.1.22.

### Fixed

- **Boolean/enum columns no longer leak ~1000 phantom rows into every read.** `formatSheet()` was applying `setDataValidation` with no `endRowIndex`, which the Sheets API treats as unbounded — every fresh tab got checkbox/dropdown formatting on all 1000 default grid rows, and a `values.get` read then trims to the last *formatted* cell, dragging in hundreds of empty rows as `null`-filled results. The validation range is now bounded to existing data rows plus a 200-row buffer. Independently, `findMany()`/`update()`/`count()`/`delete()` now filter out any row with an empty `_id` before returning it, so phantom rows from any cause (this bug, manual sheet edits, etc.) never reach a caller — existing synced sheets are protected without needing to re-sync.
- **`update()` no longer resets defaulted columns omitted from the patch body.** `validateAndApplyDefaults()` was applying `column.default` regardless of `create()` vs `update()` mode, so a partial `update()`/`PATCH` that omitted a defaulted column (e.g. `status: boolean().default(true)`) silently reset it back to the default instead of leaving the existing value alone. Defaults now only apply on `create()`.
- **`findMany()`/`findOne()`/`count()` now honor `softDelete`, matching the documented behavior.** Soft-deleted rows (`_deleted_at` populated) are excluded by default. Added `includeDeleted?: boolean` to `FindOptions` as an explicit opt-in for callers that need to see soft-deleted rows.

### Changed

- **`ColumnBuilder.default()`** now accepts arrays and objects (`JsonValue`), not just `string | number | boolean | null` — `json().default([])` previously failed to type-check even though it worked correctly at runtime.

---

## [0.1.22] — 2026-06-25

> Phase 10 — actor config naming, sheet formatting & UX.

### Added

- **`ActorConfig.name`** — new preferred field on actor entries in `sheet-db.config.ts` for the actor identifier. Replaces the misleadingly named `role` field, which read as an RBAC role assignment at the point of writing config (`{ role: 'operation' }` looks identical to an RBAC role, even after reading the docs). A shared `resolveActorName()` helper normalises `name`/`role`/bare-string actor entries across all CLI commands.
- **`UserContext.targetActor`** — new preferred field for the cross-actor target, replacing `targetRole`. Closes out the part of Phase 9.5's actor/role rename that didn't extend to the cross-actor fields.
- **Automatic sheet formatting** — `syncSchema()` / `createUserSheet()` now format every tab whenever headers are written (new tab or appended columns): auto-fit column widths (`autoResizeDimensions`), a header row fill color, a frozen header row, and `BOOLEAN`/`ONE_OF_LIST` data validation dropdowns for `boolean()`/`enum()` columns. No config required; no formatting calls when nothing changed.
- **`sheetStyle` config option** on `createSheetAdapter()` — `{ headerColor?, freezeHeader?, freezeFirstColumn? }`. Overrides the built-in header color (`#E8F0FE`) and freeze defaults (`freezeHeader: true`, `freezeFirstColumn: false`).
- **`SheetClient.formatSheet()`** (new method, exported types `ColumnValidationRule` / `SheetFormattingOptions`) — builds the batched `repeatCell` / `updateSheetProperties` / `autoResizeDimensions` / `setDataValidation` requests in a single `batchUpdate` call.

### Changed

- **`ActorConfig.role` is deprecated** — use `name` instead. Both fields are accepted; passing only `role` emits a `console.warn` deprecation notice and still works.
- **`UserContext.targetRole` is deprecated** — use `targetActor` instead. Both fields are accepted; passing only `targetRole` emits a `console.warn` deprecation notice and still works. `asActor()`'s first parameter is renamed `targetActor` (positional — no call-site changes needed).
- **CLI commands** (`init`, `sync`, `mock-users`, `seed`, `generate`, `status`, `validate`, `export`, `export-data`) updated to read `name` (falling back to deprecated `role`) from actor config entries.
- **README / API.md / Docs/developerGuide.md / skills (`core`, `cli`, `permissions`)** — actor config examples and cross-actor examples updated to `name:`/`targetActor:`; new "Sheet Formatting" sections documenting `sheetStyle`.

### Deprecated

- **`ActorConfig.role`** — use `name` instead. Will be removed in a future minor release.
- **`UserContext.targetRole`** — use `targetActor` instead. Will be removed in a future minor release.

---

## [0.1.21] — 2026-06-21

> Phase 9 — CLI naming, docs alignment, actor/role API.

### Added

- **`sheet-db export-data`** — new CLI command replacing `sheet-db migrate`. Generates an `export-data.js` script that reads row data from Google Sheets and stubs an `insertRow()` call for the target DB. Keeps full backward compatibility: `sheet-db migrate` still works but emits a deprecation warning.
- **`sheet-db export-data --all-users`** — extends data export to cover every registered user sheet. Reads all `actor_sheet_id` values from the admin `users` table and generates a per-user loop in the script, with `userId` passed to `insertRow` for correct FK association in the target DB.
- **`sheet-db export-data --dry-run`** — previews what would be exported without writing any files.
- **`UserContext.actor`** — new preferred field on `UserContext` for the actor/data-domain identifier. Replaces the misleadingly named `role` field.

### Changed

- **`UserContext.role` is deprecated** — the `role` field conflates the package's data-domain concept (which Google Sheet / schemas to use) with application-level RBAC roles (what a user is allowed to do). Renamed to `actor`. Both fields are accepted; passing only `role` emits a `console.warn` deprecation notice and still works. Update call sites to `withContext({ actor: '...' })`.
- **All internal `withContext` call sites** updated to `actor:` in CLI commands (`seed`, `sync`, `mock-users`) and adapter helper (`asActor`).
- **README — Migration Path section** rewritten: removed "coming soon" labels, added "Which export command do I need?" decision table, added "Actors vs Application Roles" comparison table, added "Dev vs Production data model" note.
- **API.md** — `withContext()` and all cross-actor examples updated to `actor:`, `UserContext` type updated, `sheet-db migrate` section replaced with `sheet-db export-data`, migration scenarios table added.

### Deprecated

- **`sheet-db migrate`** — renamed to `sheet-db export-data`. The alias is kept and will be removed in a future minor release. Update your scripts and CI pipelines.
- **`UserContext.role`** — use `actor` instead. Will be removed in a future minor release.

---

## [0.1.20] — 2026-06-19

> Internal release — version bump only, no functional changes over 0.1.19.

---

## [0.1.19] — 2026-06-19

### Added

#### Adapter — Drive Architecture

- **`driveFolder` config option** — pass `{ root: string; subfolders?: Record<string, string> }` to `createSheetAdapter` to organise all created spreadsheets under a named folder hierarchy in Google Drive. Root folder and per-role subfolders are created automatically on first use and cached. Works with both My Drive and Shared Drives.
- **`sharedDriveId` config option** — when set, all Drive file-creation and folder-lookup calls pass `supportsAllDrives: true` and target the specified Shared Drive. Enables Google Workspace teams to centralise all staging sheets in a managed Shared Drive.
- **`tokenStore` config option** — accepts a `TokenStore` (`get(actorId)` / `set(actorId, tokens)`) so per-actor OAuth tokens can be persisted externally (Redis, DB, file). The adapter calls `tokenStore.get(userId)` in `createUserSheet` when `actorTokens` is not passed directly, enabling actor-owned sheet creation without surfacing tokens at every call site.
- **`storage` config option** — accepts any `StorageAdapter` implementation for file upload. Pass `new DriveStorageAdapter()` (built-in) or a custom provider (S3, GCS, Cloudinary). The adapter's own `SheetClient` is injected into `DriveStorageAdapter` automatically — no credential repetition required.
- **`DriveStorageAdapter` class** (exported) — built-in file upload via Google Drive. Resolves nested folder paths (`uploads/products`) on demand, caches folder IDs, and optionally sets `anyone / reader` permission for public access.
- **`adapter.upload(file, options)`** — delegates to the configured `StorageAdapter`. Returns a public URL (e.g. `https://drive.google.com/uc?id=...` for Drive). Throws `SchemaError` if no storage adapter is configured.
- **`adapter.deleteFile(url)`** — delegates delete to the configured `StorageAdapter`. `DriveStorageAdapter` extracts the Drive file ID from the URL and calls `drive.files.delete`.

#### Adapter — Actor-owned sheets

- **`createUserSheet` now accepts actor OAuth tokens** — when `actorTokens` are provided (or resolved via `tokenStore`), the spreadsheet is created in the **actor's own Google Drive** using their OAuth client. The actor client then shares the sheet with the admin email. This removes the admin's storage quota burden and eliminates the single-token dependency. Falls back to admin-client creation when no actor tokens are present (backward compatible).

#### New exported types

- `OAuthTokens` — shape of a Google OAuth token set (`access_token`, `refresh_token`, `expiry_date`, …)
- `TokenStore` — interface for per-actor token persistence
- `DriveFolderConfig` — shape of the `driveFolder` config option
- `UploadOptions` — `{ filename, mimeType, folder?, public? }` passed to `adapter.upload()`
- `StorageAdapter` — two-method interface (`upload`, `delete`) for pluggable file storage
- `CreateUserSheetOptions` — options object for `createUserSheet` (`actorTokens?`, `extraFields?`)

### Changed

- **`createUserSheet` 4th parameter** — previously `extraFields?: Record<string, unknown>` (positional). Now `options?: CreateUserSheetOptions`. **Migration:** wrap existing `extraFields` usage inside the options object: `{ extraFields: { ... } }`.
- **`SheetClient.createSpreadsheet`** — internally switched from `sheets.spreadsheets.create` to `drive.files.create` (same result; enables `parents` placement and Shared Drive support). No change for callers.
- **`SheetClient.shareWithUser`** — now uses the already-initialised `this.drive` instance instead of creating a new `google.drive` call per invocation.

### Added (internal)

- `SheetClient.findOrCreateFolder(name, parentId?, sharedDriveId?)` — Drive folder lookup with create-on-miss.
- `SheetClient.uploadFile(buffer, filename, mimeType, folderId?, makePublic?)` — multipart Drive upload.
- `SheetClient.deleteFile(fileId)` — Drive file deletion.

---

## [0.1.18] — 2026-06-16

### Fixed

#### CLI — `mock-users`
- **`sheet-db mock-users` no longer throws `PermissionError` unconditionally.** The command was calling `adapter.createUserSheet()` on the raw (context-less) adapter. `hasPermission()` returns `false` when `this.context` is `undefined`, so every run failed with 0 users created. Fixed by constructing an admin context (`role: 'admin'`) before the user creation loop and routing all `createUserSheet` calls through it.
- **`schemasDir` config option is now applied in `mock-users`.** Schema files were always loaded from the hard-coded path `process.cwd()/schemas/{role}` regardless of what `schemasDir` was set to in `sheet-db.config.ts`. Fixed in line with the same change made to `sync`.

#### Adapter — `createUserSheet`
- **`createUserSheet` now accepts an optional `extraFields` parameter.** Previously the method hard-coded exactly five fields into the `users` table row (`user_id`, `role`, `email`, `actor_sheet_id`, `created_at`). Projects with additional required columns on `users` received a `ValidationError` or permanently empty cells. The new signature is:
  ```ts
  createUserSheet(userId, role, email, extraFields?: Record<string, unknown>)
  ```
  `extraFields` is spread after the base fields, so callers can supply any extra schema columns without overwriting the core ones.

#### CLI — `sync`
- **`schemasDir` config option is now applied in `sync`.** `loadSchemasForActor` was hard-coded to `process.cwd()/schemas/{role}`. Projects with a custom `schemasDir` in `sheet-db.config.ts` always got "No schemas found." Fixed: the schemas root is now derived from `config.schemasDir` when set, with `path.resolve` so both relative and absolute paths work. Fallback is unchanged (`schemas/`).

#### Types
- Added `schemasDir?: string` to `SheetDBConfig` interface in `src/schema/types.ts`.

---

## [0.1.16] — 2026-06-02

### Added

#### Auth — Google Sign-In & Express route helpers
- **`createLoginOAuthManager(config)`** — new factory pre-configured with `openid email profile` scopes alongside Sheets scopes. Produces an `id_token` so `verifyToken()` works for user-facing Google Sign-In. `createOAuthManager` is unchanged (Sheets-only, no `id_token`).
- **`getAuthUrl(scopes?)`** — now accepts an optional `scopes` override on both managers.
- **`createAuthRouter(options)`** — Express-compatible middleware that wires `GET /auth/google` and `GET /auth/callback` automatically. Signs an HS256 JWT (Node built-in `crypto`, no extra dep) and redirects to `frontendUrl?token=...`. Options: `adapter`, `jwtSecret`, `frontendUrl`, `onUser`, `registrationPolicy`, `oauthConfig`, `basePath`.
- **`registrationPolicy`** on `createAuthRouter` — `'open'` (default, any Google user can get in) or `'login-only'` (user must already exist in your users table; `onUser` returning `null` sends a `401`). Solves the common pattern of admin/manager portals that block self-registration.
- Exported types: `AuthRouterOptions`, `AuthRouter`, `GoogleProfile`, `RegistrationPolicy`.

#### CRUD — new operations
- **`table.upsert({ where, data })`** — insert-or-update: calls `findOne` first; updates if found, creates if not. Exported `UpsertOptions` type.
- **`table.createMany(rows[])`** — batch insert. All rows validated individually then written in a single `values.append` API call (one round-trip regardless of row count). `SheetClient.appendRows()` added internally.
- **`table.count({ where? })`** — returns the number of matching rows without loading full row objects.

#### CLI — new flags
- **`seed <file> --skip-existing`** — skip rows where a unique column already matches; no error on re-seed (idempotent).
- **`seed <file> --upsert`** — update existing rows on unique conflict instead of throwing.
- **`seed <file>` dynamic format** — seed file may now `export default async function(env: NodeJS.ProcessEnv)` returning the seed object. Plain object export is still supported.
- **`sync --token-file <path>`** — load a pre-stored tokens JSON file instead of the interactive browser OAuth prompt; enables unattended CI/CD pipelines.

#### Skills / docs
- Added three new skill files: `skills/permissions/SKILL.md`, `skills/migrations/SKILL.md`, `skills/auth-router/SKILL.md`.
- Updated all five existing skills to v0.1.15 with accurate API descriptions.
- Updated `_artifacts/skill_tree.yaml`, `domain_map.yaml`, `skill_spec.md`.
- Updated `README.md`, `Docs/developerGuide.md` with new API sections and examples.
- Added `DEVELOPER_REPLY.md` — response to bEasy developer feedback.

### Changed
- `OAuthManager` constructor now accepts a `defaultScopes` parameter; `getAuthUrl` falls back to instance default scopes if none passed.
- Seed command now returns per-table stats (inserted / upserted / skipped / failed) instead of a single inserted/failed counter.
- `seed --all-actors` output label updated to "inserted/updated" to reflect upsert paths.

---

## [0.1.15] — 2026-05-26

> Internal release — version bump only, no functional changes over 0.1.14.

---

## [0.1.14] — 2026-05-26

> Internal release — version bump only, no functional changes over 0.1.13.

---

## [0.1.13] — 2026-05-26

### Added

#### Phase 5: CLI Completeness
- **`sheet-db migrate`** — generates a `migrate.js` script that reads every table from Google Sheets and calls a stub `insertRow()`. Replace the stub with your Prisma/Sequelize/MySQL client to move data to production. Supports `--table <name>` (single table), `--output <dir>`, and `--dry-run` (preview plan without writing files).
- **`sheet-db init --integrate`** — integrates into an existing project without overwriting `sheet-db.config.ts` or `.env`; appends missing Google OAuth vars to `.env` if needed.
- **`sheet-db mock-users [count]`** — creates mock Google Sheets for development (default: 3); rotates through configured non-admin actor roles.
- **`sheet-db seed <file> --all-actors`** — distributes seed records to every user's actor sheet by reading `actor_sheet_id` from the admin `users` table.
- **`sheet-db export --prisma / --sql`** — generates `schema.prisma` or SQL DDL from registered schemas; supports `--output <dir>`.
- **`sheet-db sync --all-users [--dry-run]`** — pushes schema changes to all registered user sheets; uses schema hash comparison to skip up-to-date sheets; exponential backoff on rate-limit errors.

#### TypeScript Strictness
- Replaced all `any` usages in production source with `unknown` or concrete types across: `crud.ts`, `sheetClient.ts`, `oauth.ts`, `generate.ts`, `seed.ts`, `mock-users.ts`, `status.ts`, `validate.ts`, `types.ts`, `columnBuilder.ts`.
- `ColumnDefinition.default` is now `string | number | boolean | null` (was `any`).
- `ColumnDefinition.enum` is now `(string | number | boolean)[]` (was `any[]`).
- `WhereClause` is now `Record<string, unknown>` (was `Record<string, any>`).
- `UpdateOptions.data` is now `Record<string, unknown>` (was `Record<string, any>`).
- CRUD method signatures updated to `Record<string, unknown>` throughout.

### Changed
- `CRUDOperations.create` / `findMany` / `findOne` return `Record<string, unknown>` instead of `Record<string, any>`.
- Boolean deserialization in `crud.ts` now checks `value === 'TRUE'` only (removed unreachable `|| value === true` branch after `sheetClient` was typed to return `string[][]`).

### Fixed
- `OAuth2Client.setCredentials` now correctly receives a `Credentials`-typed cast instead of raw `unknown`.

---

## [0.1.12] — 2026-05-26

### Added

#### Cross-Actor CRUD Operations (Phase 4)
- **`permissions` option on `SheetAdapterConfig`** — define a permission matrix that controls which roles can access other actors' sheets and which tables they may touch. Example: `{ teacher: { canAccess: ['student'], tables: ['scores', 'attendance'] } }`.
- **`targetRole` and `targetSheetId` on `UserContext`** — pass these alongside the caller's own context to route all CRUD operations to a different actor's sheet.
- **`asActor(targetRole, targetSheetId)`** on `SheetAdapter` — convenience method that clones the current context with cross-actor fields set, avoiding repetitive `withContext()` calls.
- **Cross-actor permission enforcement in `hasPermission()`** — checks the permission matrix for `canAccess` and optional `tables` restrictions. Throws `PermissionError` with a clear message for every violation scenario (no config, not in canAccess list, table not allowed, missing targetSheetId).
- **Cross-actor sheet routing in `resolveSpreadsheetId()`** — when `targetRole` is set and differs from the caller's role, CRUD operations use `targetSheetId` instead of `actorSheetId`. Admin role bypasses all checks.
- **`ActorPermission` type** exported from the package.
- **18 unit tests** in `tests/unit/crossActorPermissions.test.ts` covering same-actor access, `asActor()`, cross-actor allow/deny, missing targetSheetId, admin bypass, and CRUD routing verification (findMany / create / update / delete each confirmed to hit the correct spreadsheet ID).

#### Schema Export (Phase 3 — test coverage)
- **`generatePrismaModel` and `generateSQLTable` are now exported** from `src/cli/commands/export.ts`, making them unit-testable without going through the CLI.
- **19 unit tests** in `tests/unit/export.test.ts` covering: Prisma model generation (all DataTypes, PK `@id`, `@default(cuid())`, optional `?`, `@unique`, `@relation` for FK columns), SQL DDL generation (all DataTypes, `PRIMARY KEY`, `FOREIGN KEY`, `NOT NULL`, fallback `_id` PK).

#### Developer Experience
- **`jest.config.js` `maxWorkers: 1`** — prevents Jest worker SIGKILL on memory-constrained environments when all test suites run together.
- **`Docs/developerGuide.md` Section 13** — new cross-actor operations guide covering permission matrix config, `withContext` + `asActor()` usage, all four CRUD operations, security rules table, and multi-sheet aggregation pattern.

### Changed
- `TODO.md` Phase 3 and Phase 4 implementation checklists fully checked off.

---

## [0.1.9] — ready to publish

### Added

#### Schema Integrity (Q11)
- **`computeSchemaHash(schema)`** — exported utility that computes a deterministic SHA-256 hash of a table's column definitions. Hash changes when any column is added, removed, or retyped; ordering of column definitions does not affect the hash.
- **`SchemaMismatchError`** — new error class thrown when `onSchemaMismatch: 'error'` is set and a user actor sheet's schema hash differs from the registered schema.
- **`schema_versions` built-in admin table** — scaffolded automatically by `sheet-db init`. Stores one row per `(actor_sheet_id, table_name)` with `schema_hash`, `synced_at`, and `column_count`. Read and written internally by the adapter.
- **`onSchemaMismatch` adapter option** — `'warn'` logs to stderr and continues (default), `'error'` throws `SchemaMismatchError`, `'auto-sync'` silently syncs the actor sheet and updates the version record before the first CRUD operation completes.
- **Schema pre-flight in `withContext()`** — when `onSchemaMismatch` is configured, `withContext()` immediately starts an async version check in the background. All CRUD methods (`create`, `findMany`, `findOne`, `update`, `delete`) await this shared promise before proceeding — so the check runs exactly once per context instance, never per call.
- **`SheetAdapter.upsertSchemaVersion(actorSheetId, tableName, hash, columnCount)`** — public method for CLI tools and external tooling to write version records.
- **`SheetAdapter.getSchemaVersion(actorSheetId, tableName)`** — public method to read the stored version record for a given sheet + table pair.
- **`sync --all-users`** — pushes schema changes to every registered user sheet by reading `actor_sheet_id` values from the admin `users` table. Updates `schema_versions` after each successful sync. Skips sheets that are already up-to-date (hash match).
- **`sync --all-users --dry-run`** — previews which user sheets are outdated and what would be synced without applying any changes.
- **Exponential backoff in `sync --all-users`** — retries failing API calls up to 5 times with delays of 1 s → 2 s → 4 s → 8 s → 16 s (capped at 32 s) on Google Sheets rate-limit errors (HTTP 429 / quota exceeded).

#### Multi-Actor Config (Q10)
- **`ActorConfig` type** — actors in `sheet-db.config.ts` now use `{ role: string; sheetIdEnv: string }` objects, mapping each actor role to its sheet ID environment variable.
- **`SchemaMismatchBehaviour` type** — exported union `'warn' | 'error' | 'auto-sync'`.
- **Multi-actor `.env` scaffolding** — `sheet-db init` generates a `DEV_<ROLE>_SHEET_ID=` line for every non-admin actor.
- **Per-actor status table in `sync`** — `sheet-db sync` iterates all configured actors and prints: Actor | Sheet ID | Tables | Status. Actors without a sheet ID env var are skipped with a warning (non-fatal).
- **`actor_sheet_id` column on admin `users` table** — included in the schema scaffolded by `sheet-db init`.
- **`schema_versions` schema file** — `sheet-db init` now also writes `schemas/admin/schema_versions.ts`.
- **`onSchemaMismatch: 'warn'`** — included as a commented default in the config scaffolded by `sheet-db init`.

#### Primary Key & Foreign Key (Q pre-existing — shipped in 0.1.8)
- `primary()` column modifier — auto-generates a nanoid on `create()` for string PKs; strips PK silently on `update()`.
- `ref('table.column')` — FK validation on `create()` and `update()`; skip via `{ skipFKValidation: true }`.
- Circular reference detection at `registerSchema()` time.
- `sheet-db export --prisma` / `--sql` — generates `schema.prisma` and SQL DDL from registered schemas.

### Changed
- **`SheetDBConfig.actors`** type changed from `string[]` to `ActorConfig[]`. CLI commands normalize both shapes at runtime for backward compatibility.
- **`sync` command** resolves each actor's sheet ID from its `sheetIdEnv` field rather than hardcoding `ADMIN_SHEET_ID`.
- **`CRUDOperations` constructor** — accepts an optional fifth argument `preFlight?: Promise<void>` that each async method awaits before executing. Internal change; no API surface change for callers.

---

## [0.1.5] - 2026-03-09

### Added
- Download count badge in `README.md`

### Changed
- Updated `LICENSE` copyright year to 2026

---

## [0.1.0] - 2026-03-09

### Added
- Initial public release of `longcelot-sheet-db`
- `defineTable()` schema DSL with fluent column builders (`string()`, `number()`, `boolean()`, `date()`, `json()`)
- Column modifiers: `required`, `unique`, `default`, `min`, `max`, `enum`, `pattern`, `readonly`, `primary`, `ref`, `index`
- Auto-generated fields: `_id` (nanoid), `_created_at`, `_updated_at`, `_deleted_at`
- `SheetAdapter` — main adapter with actor-based sheet routing and permission enforcement
- `SheetClient` — low-level Google Sheets API wrapper
- `CRUDOperations` — `create`, `findMany`, `findOne`, `update`, `delete` with where/orderBy/limit/offset
- Uniqueness constraint enforcement via `checkUniqueness()` in `create()` and `update()`
- Soft delete support via `_deleted_at` column
- `OAuthManager` — full Google OAuth2 flow (auth URL, token exchange, refresh, verify)
- Password utilities: `hashPassword()`, `comparePassword()`, `validatePasswordStrength()` (bcrypt)
- CLI binary `sheet-db` with commands:
  - `init` — interactive project scaffolding
  - `generate` — interactive schema builder
  - `validate` — schema validation
  - `sync` — sync schemas to Google Sheets with OAuth token storage/refresh
  - `seed` — load initial/test data into sheets
  - `doctor` — diagnostics and environment health checks
  - `status` — show tables, actors, and sheet IDs
- Custom error classes: `ValidationError`, `PermissionError`, `SchemaError`
- Structured logger (`src/utils/logger.ts`) using chalk
- Environment variable validator (`src/utils/env.ts`)
- Jest test suite — 28 tests passing (unit + integration with `MockSheetClient`)
- CI/CD pipeline via `.github/workflows/ci.yml` (Node 18 & 20, build + test + lint)
- `SECURITY.md` — vulnerability reporting policy
- `CONTRIBUTING.md` — contribution guide
- `LICENSE` — MIT

### Changed
- `dist/` removed from version control and added to `.gitignore`
- `package.json` updated with `files`, `repository`, `engines`, `publishConfig` for npm publish readiness

---

[0.1.27]: https://github.com/vannseavlong/longcelot-sheet-staging/compare/v0.1.26...v0.1.27
[0.1.26]: https://github.com/vannseavlong/longcelot-sheet-staging/compare/v0.1.25...v0.1.26
[0.1.5]: https://github.com/vannseavlong/longcelot-sheet-staging/compare/v0.1.0...v0.1.5
[0.1.0]: https://github.com/vannseavlong/longcelot-sheet-staging/releases/tag/v0.1.0
