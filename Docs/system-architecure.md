# lsdb Architecture

`lsdb` is a schema-first, actor-aware `DatabaseAdapter`. The same `adapter.withContext(ctx).table(name).create(...)` call works whether the engine underneath is Google Sheets, Postgres, MySQL, or a caller-supplied Prisma client — the Sheets engine additionally layers OAuth, an actor-based sheet-per-tenant storage model, and a read cache on top of the shared `TableOperations` contract.

## Main Architecture (Overview)

This is the single main diagram for the presentation/report — it walks the full request path top to bottom: schema definition → auth → the shared adapter core (context, permissions, CRUD, errors) → the two storage paths (Google Sheets by default, SQL engines when scaling up). Each node pairs a plain-language label with the actual module/class behind it, so it should read for both a technical and a non-technical audience. §1–§5 below remain as the zoomed-in detail views for anyone who wants the implementation-level version of one part.

```mermaid
flowchart TB
    App["Your Application\ncalls one API — same code regardless of engine"]
    CLI["lsdb CLI\nnpx lsdb init / generate / sync / validate / migrate"]

    subgraph SCHEMA["Schema Layer — define your data once"]
        Define["Table Definitions\ndefineTable() + columnBuilder()"]
        Ver["Schema Versioning\nSHA-256 hash + column count,\nwritten as a row in the schema_versions table\non every sync"]
        Define --> Ver
    end

    CLI --> Define

    subgraph AUTHL["Auth Layer"]
        OA["Google Sign-In\nOAuth Manager (googleapis)"]
        JWTR["App Sign-In\nAuth Router — Express-shaped routes, issues JWT"]
        Verify["Token Verification\nverifyJwt() — plain function, no framework dependency"]
        PWD["Password Storage\nbcrypt hash & compare"]
        OA --> JWTR
        PWD --> JWTR
        JWTR -.->|"issues"| Verify
    end

    subgraph CORE["Adapter Core — one contract, every engine"]
        direction TB
        Factory{{"Single Entry Point\ncreateDatabaseAdapter({ driver })"}}
        Ctx["Who's Asking\nRequest Context: userId · role · actorSheetId"]
        Perm[["Access Control\naccessControl.ts — same permission rules on every engine"]]
        CRUD["Data Operations\nCRUDOperations: create · findMany · update · upsert · delete · count"]
        Err[/"Error Handling\nValidationError · PermissionError · SchemaError"/]
        Factory --> Perm
        Perm -->|"allowed"| CRUD
        Perm -->|"denied"| Err
        CRUD -->|"on failure"| Err
    end

    App -->|"adapter.withContext(ctx).table(name)\n— identity already verified upstream"| Factory
    Verify -.->|"verified identity becomes"| Ctx
    Ctx -.->|"decides which row\ngoes where"| Factory
    Define -.->|"validates records against"| CRUD

    subgraph SHEETS["Google Sheets Engine — default: zero setup, staging/MVP"]
        direction TB
        Cache[["Performance Guard\nRead Cache, 2s TTL — stays under Google's API quota"]]
        AdminSheet[("Shared Registry\nCentral Admin Sheet: users · schema versions · ownership map")]
        ActorSheets[("Per-User/Role Storage\nActor Sheets — one tab per table\ne.g. user sheet, seller sheet")]
        Cache --> AdminSheet
        Cache --> ActorSheets
        ActorSheets -.->|"reading another actor's data:\nblocked by default,\nallowed only if access control grants it"| AdminSheet
        Upload[["File Uploads — optional\nDriveStorageAdapter.upload() / .delete()"]]
        DriveCfg[("Drive Folder Config\ndriveFolder path + sharedDriveId\n— also chooses where each actor sheet is created")]
        Upload --> DriveCfg
        DriveCfg -.->|"same folder tree,\nsame credentials"| ActorSheets
    end

    CRUD -.->|"file/image columns\n(opt-in)"| Upload

    subgraph SQLENG["SQL Engines — production / scale path"]
        direction TB
        PGDB[("PostgreSQL")]
        MYDB[("MySQL")]
        PRDB[("Prisma\nany supported database\n— schema only, no automated\ndata cutover")]
    end

    CRUD -->|"default"| Cache
    CRUD -->|"scale up when ready"| PGDB
    CRUD --> MYDB
    CRUD --> PRDB
    Ver --> AdminSheet

    ActorSheets -.->|"graduate to production:\nlsdb migrate --sql --apply\n+ lsdb migrate-data --run"| PGDB
    ActorSheets -.->|"same cutover path"| MYDB
```

**How to read it, in one sentence:** every request carries *who's asking* (Request Context) through *one shared gate* (Access Control) before it ever touches storage, and storage itself can be the free/zero-setup Google Sheets path today and a production SQL database tomorrow — without the application layer changing at all.

**Known limitation worth stating in the report:** file uploads are Sheets-engine-only and don't move during a SQL cutover — `migrate-data --run` copies row data, not files sitting in Drive, so a table with an image/file column needs its own migration plan (e.g. re-pointing URLs at whatever object storage the production stack uses) alongside `migrate-data`.

The sections below (§1–§5) zoom into individual parts of this diagram in more implementation detail.

---

Five views, each isolating one part of the mechanism:

1. Engine selection and the shared contract
2. Sheets-engine module map
3. A `findMany()` call end-to-end, including the read cache
4. The actor storage model and cross-actor access
5. The CLI's own dependency surface

Five more views below (§6–§10) cover angles the above don't: the end-user login flow, the permission matrix in full, the staging→production cutover, physical deployment, and how `lsdb erdiagram` itself works.

---

## 1. Engine Selection & the Shared Contract

`createDatabaseAdapter({ driver })` (or `$DB_DRIVER`) is the only branch point in application code. Every engine below it implements the identical `DatabaseAdapter` / `TableOperations` interface and delegates cross-actor permission checks to the same `accessControl.ts` — that's what lets application CRUD code stay engine-agnostic.

```mermaid
flowchart LR
    App["Application Backend"] -->|"adapter.withContext(ctx).table(name)"| Sel

    subgraph FACTORY["createDatabaseAdapter({ driver })"]
        Sel{"driver ?? $DB_DRIVER"}
    end

    Sel -->|"'sheets' (default)"| SA["SheetAdapter"]
    Sel -->|"'postgres'"| PG["Postgres Adapter"]
    Sel -->|"'mysql'"| MY["MySQL Adapter"]
    PR["Prisma Adapter"] -.->|"createPrismaAdapter({ client })<br/>called directly — no live object in env vars"| App

    SA & PG & MY & PR -->|"implement"| Contract["DatabaseAdapter / TableOperations<br/>same create / findMany / update / upsert / delete / count"]

    SA --> AC[["accessControl.ts<br/>shared cross-actor permission matrix"]]
    PG --> AC
    MY --> AC
    PR --> AC

    SA -->|"OAuth2 + googleapis"| Sheets[("Google Sheets / Drive API")]
    PG --> PgDB[("Postgres")]
    MY --> MyDB[("MySQL")]
    PR -->|"wraps the caller's own client"| AnyDB[("any Prisma-supported DB")]
```

`pg` and `mysql2` are optional peer dependencies, lazily `require`'d only inside `createPostgresAdapter()` / `createMySQLAdapter()`, so importing this package never pulls either in for Sheets-only consumers. `'prisma'` isn't a `DBDriver` value — `createPrismaAdapter()` needs an already-constructed client, and no env var can hold a live object.

---

## 2. Sheets-Engine Module Map

```mermaid
flowchart TD
    subgraph ADAPTER["src/adapter"]
        SA2["sheetAdapter.ts<br/>SheetAdapter"]
        CRUD["crud.ts<br/>CRUDOperations"]
        SC["sheetClient.ts<br/>SheetClient + read cache"]
        AC2["accessControl.ts"]
        DSA["driveStorageAdapter.ts"]
        TY["types.ts<br/>DatabaseAdapter contract"]
    end

    subgraph SCHEMA["src/schema"]
        DT["defineTable.ts"]
        CB["columnBuilder.ts"]
        ST["types.ts<br/>TableSchema / UserContext"]
    end

    subgraph AUTH["src/auth"]
        OA["oauth.ts"]
        PW["password.ts<br/>bcrypt"]
        RT["router.ts<br/>Express OAuth callback + JWT"]
    end

    subgraph ERRORS["src/errors"]
        ERR["ValidationError · PermissionError<br/>SchemaError · SchemaMismatchError"]
    end

    SA2 -.->|"implements"| TY
    SA2 --> CRUD
    SA2 --> AC2
    SA2 --> DSA
    SA2 --> OA
    SA2 --> DT
    CRUD --> SC
    CRUD --> ERR
    DT --> ST
    CB --> ST
    RT --> SA2
    RT --> OA
    SC -->|"googleapis"| GAPI["Google Sheets / Drive API"]
    DSA -->|"shares the SheetClient instance"| SC
```

`accessControl.ts` was extracted verbatim from `SheetAdapter`'s former private `hasPermission()` so the SQL adapters enforce identical semantics instead of reimplementing the branching logic — `SQLAdapterBase` and `PrismaAdapterBase` both import the same two functions shown in diagram 1.

---

## 3. Request Flow: `findMany()` Through the Read Cache

```mermaid
sequenceDiagram
    participant App as Application
    participant SA as SheetAdapter
    participant AC as accessControl
    participant CRUD as CRUDOperations
    participant SC as SheetClient
    participant Cache as read cache (2s TTL)
    participant API as Google Sheets API

    App->>SA: withContext({userId, role, actorSheetId}).table('orders').findMany()
    SA->>AC: hasPermission(schema, context, permissions)
    AC-->>SA: allow, or throw PermissionError
    SA->>CRUD: findMany(options)
    CRUD->>SC: getAllRows(sheetId, 'orders')
    SC->>Cache: look up tab entry
    alt entry present, under 2s old
        Cache-->>SC: cached rows
    else miss or expired
        SC->>API: spreadsheets.values.get
        API-->>SC: rows
        SC->>Cache: store rows
    end
    SC-->>CRUD: raw rows
    CRUD-->>SA: validated, typed records
    SA-->>App: Record<string, unknown>[]

    Note over SC,Cache: appendRow / appendRows / updateRow / deleteRow / writeHeader<br/>each invalidate that tab's cache entry on the way out
```

The cache exists to stay under Google's per-user Sheets API read quota — every read path is required to route through `getAllRows()`, and every write method must pair with `invalidateCache()`, or the system silently regresses to stale reads or a cache that never clears.

---

## 4. Actor-Based Storage Model

An **actor** decides *where* a row lives (which spreadsheet, which schemas) and is fixed at deploy time in `lsdb.config.ts` — it is not the same thing as an application RBAC role, which is dynamic and lives in the consumer's own `roles` table.

```mermaid
flowchart TD
    ADM[("Central Admin Sheet<br/>actor = admin")]
    ADM --- T1["users (registry)"]
    ADM --- T2["schema_versions"]
    ADM --- T3["actor → sheet ownership map"]

    UA[("user-actor sheet<br/>one tab per table")]
    SE[("seller-actor sheet<br/>one tab per table")]

    Ctx["UserContext<br/>{ userId, role, actorSheetId,<br/>targetActor?, targetSheetId? }"]

    Ctx -->|"role = 'admin' → unrestricted"| ADM
    Ctx -->|"role = 'user', no targetActor → own sheet"| UA
    Ctx -.->|"targetActor = 'seller' → gated by\naccessControl.hasPermission()"| SE

    style SE stroke-dasharray: 4 4
```

Dashed = conditional: cross-actor reads are blocked by default and only pass if the permission matrix grants them. `Docs/architecture.md` §4 lists the two supported patterns for legitimate cross-actor reads today (a shared admin table the admin context queries on the caller's behalf) — a first-class `adapter.join()` that runs concurrent per-sheet queries and joins in memory is still on the roadmap.

---

## 5. CLI Surface

The CLI only ever touches schema files and sheet/DB *structure* — never runtime row data outside `seed` / `mock-users` / `export*`.

```mermaid
flowchart LR
    subgraph SETUP["setup"]
        INIT["lsdb init"]
        AUTH["lsdb auth"]
        GEN["lsdb generate"]
    end

    subgraph SYNC_GRP["sync & verify"]
        SYNC["lsdb sync"]
        VAL["lsdb validate"]
        DOC["lsdb doctor"]
        STAT["lsdb status"]
        ERD["lsdb erdiagram"]
    end

    subgraph EVOLVE["schema evolution"]
        DTB["lsdb drop-table"]
        DCL["lsdb drop-column"]
        RCL["lsdb rename-column"]
    end

    subgraph CUTOVER["SQL cutover"]
        MIG["lsdb migrate --sql --apply"]
        MIGD["lsdb migrate-data --run"]
    end

    subgraph DATA["data"]
        SEED["lsdb seed"]
        MOCK["lsdb mock-users"]
        EXP["lsdb export"]
        EXPD["lsdb export-data"]
    end

    Files[("schema/*.ts<br/>defineTable()")]
    Tokens[(".lsdb-tokens.json")]
    Admin[("Admin Sheet + actor sheets")]
    SQLDB[("Postgres / MySQL")]

    INIT --> Files
    AUTH --> Tokens --> Admin
    GEN --> Files
    Files --> SYNC --> Admin
    Files --> VAL
    Admin --> DOC
    Admin --> STAT
    Files --> ERD
    Files --> DTB --> Admin
    Files --> DCL --> Admin
    Files --> RCL --> Admin
    Files --> MIG --> SQLDB
    Admin --> MIGD --> SQLDB
    SEED --> Admin
    MOCK --> Admin
    Admin --> EXP
    Admin --> EXPD
```

`migrate --sql` generates DDL from the same `TableSchema` definitions the Sheets engine validates against; `migrate-data --run` is the actual cutover, reading current sheet rows and writing them into the target Postgres/MySQL connection.

`lsdb auth` is optional, not a hard prerequisite the diagram implies by position — every other command that touches `Admin` (`sync`, `drop-table`, `drop-column`, `rename-column`) runs the identical OAuth handshake itself on first use if `.lsdb-tokens.json` isn't already there. Running `auth` explicitly just does that handshake as its own step, up front.

---

## 6. Login / OAuth Flow, End-to-End

The Auth Layer in the main diagram is two boxes; this is what actually happens on the wire when a user signs in, from `src/auth/router.ts` and `src/auth/oauth.ts`.

```mermaid
sequenceDiagram
    participant U as Browser (end user)
    participant R as Auth Router
    participant G as Google OAuth
    participant H as onUser() — your app's callback
    participant A as SheetAdapter

    U->>R: GET {basePath}/auth/google
    R->>R: signState(jwtSecret) — HMAC-signed, unpredictable nonce (CSRF defense)
    R-->>U: redirect to Google's consent screen

    U->>G: approve requested scopes
    G-->>U: redirect to {basePath}/auth/callback?code&state
    U->>R: GET /auth/callback?code&state

    R->>R: verifyState(state) — reject if missing, tampered, or older than 10 min
    R->>G: exchange code for tokens (getTokens)
    G-->>R: tokens, incl. id_token
    R->>G: verifyToken(id_token)
    G-->>R: GoogleProfile { sub, email, name, ... }

    R->>H: onUser(profile, adapter)
    H->>A: look up or create the user record
    A-->>H: user record, or null
    H-->>R: user record | null

    alt user resolved (found, or auto-created under 'open' policy)
        R->>R: signJwt(user, jwtSecret, jwtExpiresInSeconds)
        R-->>U: redirect to frontendUrl?token=... (or #token=... if tokenDelivery: 'fragment')
    else null under 'login-only' policy
        R-->>U: 401 — not an authorised user
    end

    Note over U,R: Every later request: browser attaches the JWT,<br/>backend calls verifyJwt(token, secret) — the framework-agnostic<br/>half of Auth Layer from §_Main Architecture_
```

Two details worth calling out to a technical audience: the `state` parameter isn't a session lookup — it's self-contained and HMAC-signed, so the router needs no session store to be CSRF-safe. And `onUser()` is where *your* application's authorization policy lives — lsdb only proves the person is who Google says they are; whether that email is allowed into your app (`'open'` self-registration vs. `'login-only'` admin allowlist) is a callback you supply, not something lsdb decides for you.

---

## 7. Cross-Actor Permission Matrix

This is `accessControl.ts`'s `hasPermission()` spelled out as a table — the same rules the "Access Control" box in the main diagram enforces on every engine.

| Caller's role | Table's actor | `targetActor` set? | Result | Why |
|---|---|---|---|---|
| `admin` | any | — | ✅ Allowed | Admin is unrestricted — short-circuits every other check. |
| any non-admin | same as caller's own role | not set | ✅ Allowed | Reading/writing your own actor's data needs no special grant. |
| any non-admin | `admin` (e.g. `schema_versions`, the `users` registry) | any | ❌ Denied | Admin-actor tables are never reachable from a non-admin context, cross-actor or not. |
| non-admin | a different actor (e.g. `user` → `seller`) | set to that actor | ⚠️ Conditional | Allowed only if `permissions[role].canAccess` includes that actor **and**, if `permissions[role].tables` is set, the specific table is on that allowlist. |
| non-admin | a different actor, but caller's role has no entry in `permissions` at all | set | ❌ Denied (throws `PermissionError`) | "`'<role>' has no cross-actor permissions configured`" |

Once access is granted, `resolveNonAdminTenantKey()` decides *which* physical sheet (or tenant key, for SQL engines) the query actually runs against: same-actor requests use `context.actorSheetId`; a granted cross-actor request must supply `context.targetSheetId` or it throws — there's no implicit fallback that could accidentally point a cross-actor read at the wrong tenant.

> **Trust boundary — read this before citing the matrix as "secure."** `hasPermission()` performs *authorization* only: it trusts `context.role`/`context.actor` as already-true facts and never re-verifies who's making the claim. The `role === 'admin'` branch that grants unrestricted access is exactly as safe as whatever code built the `UserContext` object being passed in. That construction must happen in your application's own trusted server code, deriving `role` from a verified JWT (`verifyJwt()`, §6) plus a server-side lookup of the user's real role — never from client-controlled input (a query param, an unsigned cookie, a request body field). If application code ever did `role: req.query.role`, an attacker sending `?role=admin` would sail through this exact check, and `hasPermission()` would be behaving correctly given its inputs — the vulnerability would be one layer up, in how the context was built, not in this function.

```mermaid
flowchart TD
    Start{"context provided?"} -->|no| Deny1["Deny"]
    Start -->|yes| IsAdmin{"role == 'admin'?"}
    IsAdmin -->|yes| Allow1["Allow — unrestricted"]
    IsAdmin -->|no| SameActor{"schema.actor == role<br/>AND no targetActor?"}
    SameActor -->|yes| Allow2["Allow — own data"]
    SameActor -->|no| AdminTable{"schema.actor == 'admin'?"}
    AdminTable -->|yes| Deny2["Deny — admin-only table"]
    AdminTable -->|no| HasTarget{"targetActor set<br/>and != role?"}
    HasTarget -->|no| MatchOwn{"schema.actor == role?"}
    MatchOwn -->|yes| Allow3["Allow"]
    MatchOwn -->|no| Deny3["Deny"]
    HasTarget -->|yes| MatchTarget{"schema.actor == targetActor?"}
    MatchTarget -->|no| Deny4["Deny"]
    MatchTarget -->|yes| HasPerm{"permissions[role]<br/>configured?"}
    HasPerm -->|no| Throw1["Throw PermissionError"]
    HasPerm -->|yes| CanAccess{"canAccess includes<br/>targetActor?"}
    CanAccess -->|no| Throw2["Throw PermissionError"]
    CanAccess -->|yes| TableAllowed{"perm.tables set<br/>and table not listed?"}
    TableAllowed -->|yes| Throw3["Throw PermissionError"]
    TableAllowed -->|no| Allow4["Allow"]
```

---

## 8. Staging → Production Cutover

Backs up the "Google Sheets as a staging database" narrative directly: staging isn't just "we happened to use Sheets" — it's a deliberate stage in a pipeline that ends in a real database, validated against the same schema definitions both times.

```mermaid
flowchart LR
    Dev["Development / Staging\nGoogle Sheets"] -->|"validate schema unchanged"| Cutover

    subgraph Cutover["Promote to Production"]
        direction TB
        DDL["lsdb migrate --sql --apply\ngenerates schema from the same TableSchema defs"]
        Data["lsdb migrate-data --run\ncopies existing rows across"]
        DDL --> Data
    end

    Cutover --> Prod["Production\nPostgreSQL / MySQL"]

    Note["No rewrite needed —\napplication code targets the same DatabaseAdapter interface\nbefore and after cutover"]
    Cutover -.-> Note
    style Note fill:none,stroke:none,color:#888
```

One gap to state plainly rather than let a reader assume it away: this cutover moves *row data*, not files — see the "Known limitation" note under the main diagram regarding Drive-hosted uploads.

---

## 9. Deployment / Physical Topology

Everything above is a *logical* view — modules and data flow. This is *where it actually runs*: three separate machines/services, and who's allowed to talk to whom.

```mermaid
flowchart LR
    subgraph DEV["Developer / CI Machine"]
        direction TB
        CLI2["lsdb CLI\ninit · generate · sync · auth · migrate"]
        Tokens2[(".lsdb-tokens.json\nadmin OAuth tokens")]
        EnvDev[(".env\nGOOGLE_CLIENT_ID/SECRET · GOOGLE_REDIRECT_URI · ADMIN_SHEET_ID")]
        CLI2 --> Tokens2
    end

    subgraph BACKEND["Your Backend Server — runtime"]
        direction TB
        AppSrv["Node.js process\n(Express, or any framework)"]
        LSDB["lsdb package\nimported in-process — not a separate service"]
        AppSrv --> LSDB
    end

    subgraph GCLOUD["Google Cloud"]
        direction TB
        OAuthSrv["OAuth 2.0\nAuthorization Server"]
        SheetsAPI["Sheets API"]
        DriveAPI["Drive API"]
    end

    subgraph SQLHOST["Optional: Managed SQL\nonly when driver = postgres / mysql"]
        SQLDB2[("PostgreSQL / MySQL")]
    end

    User["End User\n(browser)"] -->|"HTTPS — all app traffic + login"| AppSrv
    User -.->|"redirected here only\nfor Google's own consent screen"| OAuthSrv

    LSDB -->|"HTTPS, using stored tokens"| SheetsAPI
    LSDB -->|"HTTPS, uploads + spreadsheet placement"| DriveAPI
    LSDB -.->|"connection string\n(driver = postgres/mysql)"| SQLDB2

    DEV -.->|"ships schema + credentials\nahead of runtime deploy"| BACKEND
```

The point worth defending live: the browser never talks to Google Sheets, Drive, or the database directly — only to your backend. The one exception, being redirected to Google's own consent screen mid-login, is standard OAuth behavior, not a gap in that boundary.

---

## 10. How `lsdb erdiagram` Generates Its Output

Mechanically, in order, from `src/cli/commands/erdiagram.ts`:

```mermaid
flowchart TD
    Cmd["npx lsdb erdiagram"] --> Cfg["loadCLIConfig()\nplain require() of lsdb.config.ts\n— no dotenv, no env check"]
    Cfg --> Load["loadSchemasWithPaths()\nrequire()s every schema file straight off disk\n— no Google API call, no OAuth"]
    Load --> Check{"Any schemas found?"}
    Check -->|"no"| Warn["⚠️ 'No schemas found' — exit"]
    Check -->|"yes"| Gen["generateMermaidERDiagram(schemas)"]

    subgraph GEN["generateMermaidERDiagram()"]
        direction TB
        Tables["For each schema:\nemit `tableName { type colName MARKER }`\nMARKER = PK (pkColumn, default _id) / FK (has .ref) / UK (.unique)"]
        Rels["For each column with .ref:\nemit a relationship line —\n||--o{ normally, ||--|| if the FK column is .unique.\nRefs to an unregistered table are silently skipped."]
        Tables --> Rels
    end

    Gen --> MD["buildMarkdown()\nwraps the diagram in a full file:\ntitle, generated timestamp,\n'Tables by actor' list, then a ```mermaid fence"]
    MD --> Resolve["resolveOutputPath()\nprompts overwrite / rename / cancel\nif ER-DIAGRAM.md already exists\n(--yes skips the prompt)"]
    Resolve --> Write["Write to disk\ndefault: ER-DIAGRAM.md"]
```

Two things worth knowing if you cite this as evidence of "schema-first" in the report: the ER diagram is derived *entirely* from your `defineTable()` calls — there's no separate diagramming step to keep in sync — and a foreign-key arrow only appears when `.ref('otherTable.column')` points at a table that's actually registered on the same adapter; a typo'd or not-yet-defined reference is dropped rather than crashing the command.

`erdiagram` is also the one CLI command that never touches Google at all — no `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/`GOOGLE_REDIRECT_URI`, no OAuth handshake, no network call. Every other command that reaches `Admin` in §5 (`sync`, `drop-table`, `drop-column`, `rename-column`, `doctor`, `status`) goes through `buildAdminAdapter()`, which requires those three env vars and opens a live connection; `erdiagram` reads only your local schema files and prints what it finds.

---

## Cross-Cutting Concerns

- **One permission matrix, every engine.** `accessControl.ts`'s `hasPermission()` / `resolveNonAdminTenantKey()` are shared verbatim by `SheetAdapter`, `SQLAdapterBase`, and `PrismaAdapterBase` — a SQL engine has no physical per-user sheet, so `context.actorSheetId` / `targetSheetId` are reused as an opaque `tenant_id` column value instead.
- **Read cache correctness is a pairing, not a feature.** Any new read path must go through `SheetClient.getAllRows()`; any new write must call `invalidateCache()` for that tab.
- **Schema drift is versioned per actor sheet.** `SheetAdapter` writes a `schema_versions` row (hash + column count) into the admin sheet on every sync, and can detect/react to mismatches at runtime via `SchemaMismatchBehaviour`.
- **Custom errors carry the failure mode.** `ValidationError`, `PermissionError`, `SchemaError`, `SchemaMismatchError` — never a bare `Error` — so callers can branch on what actually went wrong.
