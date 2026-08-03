# OWASP Top 10:2025 — Security Posture of `longcelot-sheet-db`

This document follows **OWASP Top 10:2025**. For each category: what we've implemented, and what
the integrating developer or end user needs to know. `lsdb` is a three-party system:

| Party | Who this is | Controls |
|---|---|---|
| **Package** (us) | The `longcelot-sheet-db` maintainers | The adapter, CLI, auth helpers shipped in this repo |
| **Developer** ("you") | The team building an app on top of `lsdb` | Your Express/Next.js app, your `onUser` callback, your Google Cloud project, your deploy pipeline |
| **End user** | The person logging into *your* app | Their own Google account, their own device |

See [SECURITY.md](./SECURITY.md) for the vulnerability-reporting process and
[FAQ.md §3](./FAQ.md#3-security-model) for the underlying security model this builds on.

**Scope reminder**: `lsdb` is designed for MVPs, prototypes, staging, and internal tools — not a
hardened multi-tenant production database. Several items below have "graduate to a production DB"
as the honest answer.

---

## Two questions we get asked directly

### "An end user's Google account gets compromised — what do we do?"

**Package**: nothing automatic — Google doesn't push account-compromise events to third-party OAuth
clients, so `lsdb` has no visibility into this.

Blast radius depends on which OAuth flow the account belongs to:
- A compromised **login-only** account only threatens your app's own session — bounded to 1 day by
  default via the JWT expiry (see A04).
- A compromised **admin/Sheets-owner** account is equivalent to a stolen database superuser
  credential. Revoke the OAuth grant in
  [Google Account → Security → Third-party access](https://myaccount.google.com/permissions), rotate
  `GOOGLE_CLIENT_SECRET`, delete `.lsdb-tokens.json` everywhere it's deployed, re-authenticate.
- A compromised **per-user production sheet owner** (`actorTokens` path) only exposes that one
  user's sheet.

**Developer**: detect via your own logging (`lsdb` doesn't log auth events by default — see A09),
contain by revoking the session/JWT, enable 2FA upstream on the account entirely outside `lsdb`.

**End user**: enable 2FA on their Google account, periodically review
[Google Account → Security → Third-party access](https://myaccount.google.com/permissions).

### "Someone edits the Sheet directly instead of going through the API — what happens?"

Google Sheets has no row/cell-level ACL to block a manual edit by anyone with Editor access.

- Nothing prevents the edit. Every validation rule (`required()`, `enum()`, `pattern()`, `unique()`,
  `ref()` FK checks) only runs inside `create()`/`update()` — a manual edit bypasses all of it.
- The Sheets-native dropdown for `enum()`/`boolean()` columns is a UI guard, not a hard constraint.
- `findMany()`/`update()`/`count()`/`delete()` self-heal against one specific class of manual damage:
  rows with an empty `_id` are filtered out as "phantom rows."
- There is no checksum, audit log, or tamper-detection mechanism in `lsdb`.

**Package**: this is architecturally out of scope for a Sheets-backed adapter — there's no Sheets
API feature to intercept or block manual grid edits.

**Developer**: restrict spreadsheet sharing to the minimum set of humans — ideally just the service
account. If tamper evidence matters to your use case, that's the signal to
[migrate to a production database](./FAQ.md#8-migration-to-production), where
`CHECK`/`FOREIGN KEY` constraints are enforced regardless of how a row was written.

---

## A01:2025 — Broken Access Control

**We implement**: cross-actor access requires an explicit permission-matrix entry (deny-by-default,
`src/adapter/accessControl.ts`); `admin` bypasses all checks by design; OAuth login is
CSRF-protected via a signed, time-boxed `state` parameter (`src/auth/router.ts`); no code path
anywhere fetches a user-supplied URL server-side (no SSRF surface).

**Developers need to know**: configure the `permissions` matrix correctly; keep RBAC sub-roles
(registrar/librarian/etc.) as rows in a table, not separate actors — see
[FAQ.md §2](./FAQ.md#2-actors-vs-rbac-roles); restrict spreadsheet Editor access to the minimum set
of humans; there's no row/column-level security within one actor's sheet; any feature you build that
fetches a user-supplied URL server-side is your own SSRF risk.

**End users need to know**: don't share their session/JWT; use their own device only.

---

## A02:2025 — Security Misconfiguration

**We implement**: `lsdb init` scaffolds/updates the consumer project's `.gitignore` to cover `.env`
and `.lsdb-tokens.json`; both files are written with `0o600` permissions; Postgres connections
auto-enable SSL for any non-localhost connection string.

**Developers need to know**: never commit `.env`/`.lsdb-tokens.json` even with the scaffold (it can
be deleted/edited); restrict Sheets sharing; run `lsdb doctor` before deploys; use a real secret
manager in production, not checked-in config.

---

## A03:2025 — Software Supply Chain Failures

**We implement**: no `postinstall`/`preinstall`/`prepare` scripts — no code executes on
`npm install`; `pnpm-lock.yaml` is committed, pinning the full dependency graph; `pg`/`mysql2` are
optional peer dependencies, lazily required only inside `createPostgresAdapter()`/
`createMySQLAdapter()`, so a Sheets-only consumer never pulls either in.

**Developers need to know**: run `npm audit`/`pnpm audit` on your app's full dependency tree (we
couldn't run this ourselves in the review environment — don't treat that as a clean bill of health);
verify package provenance/integrity, not just the package name (typosquatting is a real risk for any
`npm install`).

---

## A04:2025 — Cryptographic Failures

**We implement**: the JWT `createAuthRouter` issues carries an `exp` claim
(`jwtExpiresInSeconds`, default 1 day); a new exported `verifyJwt(token, secret)` validates the
signature (constant-time comparison) and expiry; `tokenDelivery: 'fragment'` option delivers the
token as `#token=...` instead of `?token=...`, so it never reaches server access logs or `Referer`
headers; `hashPassword()`/`validatePasswordStrength()` reject passwords over bcrypt's 72-byte limit
instead of silently truncating; `.lsdb-tokens.json`/`.env` are written with `0o600` permissions;
OAuth tokens are never logged directly (`status.ts` only prints `present`/`missing`).

**Developers need to know**: choose a strong, secret-manager-stored `jwtSecret`; set
`tokenDelivery: 'fragment'` if query-string exposure is a concern for your deployment; this package
never handles TLS — that's your reverse proxy/hosting layer; `.lsdb-tokens.json` is plaintext on
disk restricted by file permissions, not encrypted at rest — treat it as a credential.

---

## A05:2025 — Injection

**We implement**: every SQL adapter value goes through parameterized placeholders, never
string-interpolated (`src/adapter/sql/queryBuilder.ts`); Sheets writes use
`valueInputOption: 'RAW'`, so a string like `=1+1` is stored and displayed as literal text, not
evaluated as a live formula, when viewed in Google Sheets itself.

**Developers need to know**: if you export `lsdb` data to CSV/XLSX and end users can write to those
fields, a cell starting with `=`, `+`, `-`, or `@` can be evaluated as a formula by Excel/LibreOffice
on open (CWE-1236) — sanitize at your export boundary; see the
[OWASP CSV Injection cheat sheet](https://owasp.org/www-community/attacks/CSV_Injection).

---

## A06:2025 — Insecure Design

**We implement**: schema-mutation commands (`sync`, `drop-column`, `rename-column`) are
additive-by-default; destructive operations require an explicit command and confirmation prompt
(`--yes` to skip); actor/RBAC separation is enforced in naming (`actor` vs application role).

**Developers need to know**: rate-limit your own auth endpoints (e.g. `express-rate-limit` in front
of `authRouter.handler` — `lsdb` has no built-in rate limiting); know when your app has outgrown the
Sheets-backed model — see [FAQ.md §8](./FAQ.md#8-migration-to-production).

---

## A07:2025 — Authentication Failures

**We implement**: JWT expiry and OAuth CSRF `state` (see A01/A04).

**Developers need to know**: no rate limiting on login/callback endpoints — add your own; no session
revocation list — a JWT is valid until `exp`, by design for a stateless router; enforce 2FA/stronger
policy on the admin Google account specifically.

**End users need to know**: use a strong, unique password if your app also uses `hashPassword`
alongside Google login; enable 2FA on their Google account.

---

## A08:2025 — Software or Data Integrity Failures

**We implement**: no install-time code execution; `upsert()`'s "safe to rerun" guarantee is
hardened across all three adapters (Sheets, SQL, Prisma).

**Developers need to know**: treat `.lsdb-tokens.json`/CI secrets as high-value credentials in your
pipeline's secret store, not plaintext CI env dumps; review generated DDL before
`migrate --apply` against a production database.

---

## A09:2025 — Security Logging and Alerting Failures

**We implement**: `createAuthRouter`'s auth-failure paths (token verification, `onUser` errors) are
now logged server-side via `console.error`; token values are never printed by the CLI
(`status.ts` only shows `present`/`missing`).

**Developers need to know**: our server-side logging is a floor, not a ceiling — it's unstructured
`console.error`, not a hook into your real alerting stack. Wrap `onUser`/the auth router with your
own logging wired to actual alerting; add a `changed_by` column (set from `context.userId`) if you
need a per-row audit trail.

---

## A10:2025 — Mishandling of Exceptional Conditions

**We implement**: `createAuthRouter`'s callback no longer echoes caught exceptions into the HTTP
response — a failed token verification or `onUser` error now returns a fixed, generic message to
the client while the real error is logged server-side (previously it leaked internal error detail to
the end user's browser — CWE-209); other error paths already fail safe/closed (a corrupt token file
forces re-authentication rather than proceeding; missing permission config throws rather than
defaulting to allow).

**Developers need to know**: audit your own `onUser` callback and any route handler in the request
path for the same pattern — don't `res.json({ error: String(err) })` on a route reachable by an
untrusted client.

---

## Responsibility matrix

| # | Category | We implement | Developer must handle | End user must handle |
|---|---|---|---|---|
| A01 | Broken Access Control | Cross-actor matrix, CSRF `state`, no SSRF surface | Configure `permissions`; minimize Sheet sharing | Protect their session |
| A02 | Security Misconfiguration | `.gitignore` scaffolding, `0o600` secrets, Postgres SSL | Don't commit secrets; use a secret manager | — |
| A03 | Software Supply Chain Failures | Committed lockfile, no install-time scripts | Audit your full dependency tree | — |
| A04 | Cryptographic Failures | JWT expiry + `verifyJwt()`, `0o600` token files, bcrypt guard | Strong `jwtSecret`; TLS; `tokenDelivery: 'fragment'` if needed | — |
| A05 | Injection | Parameterized SQL, RAW-mode Sheets writes | Sanitize before CSV/XLSX export | — |
| A06 | Insecure Design | Additive schema mutations | Rate-limit auth endpoints | — |
| A07 | Authentication Failures | JWT expiry, CSRF `state` | Rate limiting; 2FA on admin account | Strong password + 2FA |
| A08 | Software/Data Integrity Failures | No install-time code execution | Treat CI tokens as high-value secrets | — |
| A09 | Logging and Alerting Failures | Server-side logging of auth failures | Wire real logging/alerting | — |
| A10 | Mishandling of Exceptional Conditions | Sanitized auth error responses | Audit your own error handlers | — |

---

## Attribution

Category names and ordering above are from the
[OWASP Top 10:2025](https://owasp.org/Top10/2025/) ([github.com/OWASP/Top10](https://github.com/OWASP/Top10)),
© 2003–2025 [The OWASP® Foundation, Inc.](https://owasp.org/), licensed under
[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Everything else — the findings,
code references, and fix descriptions — is this project's own independent audit, not an OWASP
publication, review, or endorsement. "OWASP" and the OWASP logo are registered trademarks of The
OWASP Foundation; this project is not affiliated with or certified by OWASP.
