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

## [Unreleased]

_Nothing yet — add your in-progress changes here before the next release._

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

[Unreleased]: https://github.com/vannseavlong/longcelot-sheet-staging/compare/v0.1.5...HEAD
[0.1.5]: https://github.com/vannseavlong/longcelot-sheet-staging/compare/v0.1.0...v0.1.5
[0.1.0]: https://github.com/vannseavlong/longcelot-sheet-staging/releases/tag/v0.1.0
