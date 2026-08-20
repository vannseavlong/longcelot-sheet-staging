# lsdb Architecture

`lsdb` is a schema-first, actor-aware `DatabaseAdapter`. The same `adapter.withContext(ctx).table(name).create(...)` call works whether the engine underneath is Google Sheets, Postgres, MySQL, or a caller-supplied Prisma client — the Sheets engine additionally layers OAuth, an actor-based sheet-per-tenant storage model, and a read cache on top of the shared `TableOperations` contract.

Five views, each isolating one part of the mechanism:

1. Engine selection and the shared contract
2. Sheets-engine module map
3. A `findMany()` call end-to-end, including the read cache
4. The actor storage model and cross-actor access
5. The CLI's own dependency surface

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

## Cross-Cutting Concerns

- **One permission matrix, every engine.** `accessControl.ts`'s `hasPermission()` / `resolveNonAdminTenantKey()` are shared verbatim by `SheetAdapter`, `SQLAdapterBase`, and `PrismaAdapterBase` — a SQL engine has no physical per-user sheet, so `context.actorSheetId` / `targetSheetId` are reused as an opaque `tenant_id` column value instead.
- **Read cache correctness is a pairing, not a feature.** Any new read path must go through `SheetClient.getAllRows()`; any new write must call `invalidateCache()` for that tab.
- **Schema drift is versioned per actor sheet.** `SheetAdapter` writes a `schema_versions` row (hash + column count) into the admin sheet on every sync, and can detect/react to mismatches at runtime via `SchemaMismatchBehaviour`.
- **Custom errors carry the failure mode.** `ValidationError`, `PermissionError`, `SchemaError`, `SchemaMismatchError` — never a bare `Error` — so callers can branch on what actually went wrong.
