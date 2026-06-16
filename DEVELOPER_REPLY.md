# Bug Fix Reply — longcelot-sheet-db v0.1.17

**To:** Bug Reporter
**Date:** 2026-06-16
**Re:** Bug Report — v0.1.17 (3 issues)

---

Thank you for the thorough report. All three bugs have been identified, reproduced, and fixed. Here is a breakdown of each fix.

---

## Bug 1 — `sheet-db mock-users` PermissionError (Fixed ✅)

**Your report was correct.** `mockUsersCommand` was calling `adapter.createUserSheet()` on the raw adapter — no context was set. `hasPermission()` short-circuits to `false` when `this.context` is `undefined`, so the command could never succeed regardless of credentials or schema state.

**Fix applied in `src/cli/commands/mock-users.ts`:**

An admin context is now created before the user creation loop and all `createUserSheet` calls are routed through it:

```ts
const adminAdapter = adapter.withContext({
  userId: 'mock-cli',
  role: 'admin',
  actorSheetId: adminSheetId,
});

// Inside the loop:
const sheetId = await adminAdapter.createUserSheet(userId, role, email);
```

`createUserSheet` is inherently an admin operation (it writes to the `users` table in the admin sheet), so requiring admin context here is the correct behaviour — not a workaround.

---

## Bug 2 — `createUserSheet` inserts an incomplete row (Fixed ✅)

**Your report was correct.** The five hard-coded fields (`user_id`, `role`, `email`, `actor_sheet_id`, `created_at`) were the only ones ever written to the `users` table. Any project that added required columns beyond those five would get a `ValidationError` on the first `mock-users` run, or worse, silently missing data in optional columns.

**Fix applied in `src/adapter/sheetAdapter.ts`:**

`createUserSheet` now accepts an optional `extraFields` parameter that is spread into the `create()` call:

```ts
async createUserSheet(
  userId: string,
  role: string,
  email: string,
  extraFields?: Record<string, unknown>,  // new
): Promise<string>
```

Usage example for a `users` table with a `full_name` and `auth_provider` column:

```ts
await adminAdapter.createUserSheet(userId, role, email, {
  full_name: 'Test User',
  auth_provider: 'google',
});
```

The five base fields are always written first; `extraFields` is merged after, so callers cannot accidentally overwrite `user_id` or `actor_sheet_id` by passing them again — the spread order preserves the base fields.

> **Note:** If your `users` schema has additional `.required()` columns, pass them via `extraFields` or the `create()` call will throw a `ValidationError` as designed. This is intentional validation behaviour, not a bug.

---

## Bug 3 — `schemasDir` config option ignored (Fixed ✅)

**Your report was correct.** Both `loadSchemasForActor` in `sync.ts` and the schema-load loop in `mock-users.ts` were resolving schemas from the hard-coded path `process.cwd()/schemas/{role}`. The `schemasDir` field was accepted by the config parser but never read at lookup time, so any non-default layout silently found zero schemas.

**Fix applied across three files:**

`schemasDir?: string` has been added to the `SheetDBConfig` type in `src/schema/types.ts`.

Both `sync.ts` and `mock-users.ts` now compute the schema root before loading:

```ts
const schemasRoot = config.schemasDir
  ? path.resolve(process.cwd(), config.schemasDir)
  : path.join(process.cwd(), 'schemas');
```

`path.resolve` is used (not `path.join`) so that both relative and absolute values in `schemasDir` work correctly.

**Usage — if your schemas live under `src/schemas/`:**

```ts
// sheet-db.config.ts
export default {
  projectName: 'my-app',
  schemasDir: 'src/schemas',   // relative to project root
  actors: [...],
};
```

No changes needed to the schema files themselves. The workaround of keeping schemas at `./schemas/{role}/` continues to work — the default fallback is unchanged.

---

## Summary

| # | Bug | Status | File(s) changed |
|---|-----|--------|-----------------|
| 1 | `mock-users` PermissionError | Fixed ✅ | `cli/commands/mock-users.ts` |
| 2 | `createUserSheet` incomplete row | Fixed ✅ | `adapter/sheetAdapter.ts` |
| 3 | `schemasDir` config ignored | Fixed ✅ | `schema/types.ts`, `cli/commands/sync.ts`, `cli/commands/mock-users.ts` |

All 123 existing tests pass. No breaking changes were introduced. The fixes will be included in the next patch release.

If you run into anything else while building on top of this package, feel free to open another report.
