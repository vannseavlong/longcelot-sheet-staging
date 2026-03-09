# Contributing to longcelot-sheet-db

Thank you for your interest in contributing! This guide covers everything you need to get started.

---

## Table of Contents

- [Project Overview](#project-overview)
- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Commit Message Convention](#commit-message-convention)
- [Branch Strategy](#branch-strategy)
- [Code Style](#code-style)
- [Testing](#testing)
- [Submitting a Pull Request](#submitting-a-pull-request)
- [Reporting Bugs](#reporting-bugs)

---

## Project Overview

`longcelot-sheet-db` is a schema-first, actor-aware database adapter that uses Google Sheets as the storage engine. Built for MVPs, prototypes, and staging environments.

**Key areas of the codebase:**

| Folder | Purpose |
|---|---|
| `src/schema/` | Column builders and `defineTable()` DSL |
| `src/adapter/` | `SheetAdapter`, `SheetClient`, `CRUDOperations` |
| `src/auth/` | Google OAuth2 flow and bcrypt password utilities |
| `src/cli/` | CLI commands (`init`, `generate`, `sync`, `validate`, `seed`, `doctor`, `status`) |
| `src/errors/` | Custom error classes (`ValidationError`, `PermissionError`, `SchemaError`) |
| `src/utils/` | Logger and environment utilities |
| `test/` | Integration tests with `MockSheetClient` |
| `tests/` | Unit tests |

---

## Getting Started

### Prerequisites

- Node.js >= 16
- pnpm (preferred) or npm

### Local Setup

```bash
# 1. Fork and clone the repo
git clone https://github.com/vannseavlong/longcelot-sheet-staging.git
cd longcelot-sheet-staging

# 2. Install dependencies
pnpm install

# 3. Build the project
pnpm run build

# 4. Run tests
pnpm test

# 5. Link CLI locally for manual testing
npm link
sheet-db --help
```

### Environment Variables (for integration testing)

Create a `.env` file at the root:

```env
GOOGLE_CLIENT_ID=your_client_id
GOOGLE_CLIENT_SECRET=your_client_secret
GOOGLE_REDIRECT_URI=http://localhost:3000/auth/callback
ADMIN_SHEET_ID=your_sheet_id
SUPER_ADMIN_EMAIL=you@example.com
```

---

## Development Workflow

```bash
pnpm run dev          # Watch mode — recompiles on save
pnpm test             # Run all tests
pnpm run test:watch   # Tests in watch mode
pnpm run lint         # ESLint
pnpm run format       # Prettier
```

---

## Commit Message Convention

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <short description>
```

### Types

| Type | When to use |
|---|---|
| `feat` | A new feature |
| `fix` | A bug fix |
| `docs` | Documentation changes only |
| `test` | Adding or updating tests |
| `refactor` | Code change that neither fixes a bug nor adds a feature |
| `chore` | Build process, dependency updates, tooling |
| `perf` | Performance improvements |

### Examples

```
feat(cli): add status command
fix(crud): prevent unique constraint false positive on update
docs(readme): add download badge
test(integration): cover soft delete edge case
chore: bump version to 0.1.5
```

These commit types are what drive the **CHANGELOG** — so please follow them.

---

## Branch Strategy

```
main        → stable, production-ready releases
develop     → active development, PR target
feature/*   → new features (branch from develop)
fix/*       → bug fixes
docs/*      → documentation only
```

**Example:**

```bash
git checkout develop
git checkout -b feature/bulk-create
# ... make changes ...
git commit -m "feat(crud): add bulkCreate operation"
git push origin feature/bulk-create
# Open PR → develop
```

---

## Code Style

- **Language**: TypeScript (strict mode, ES2020, CommonJS)
- **Linting**: ESLint (`pnpm run lint`)
- **Formatting**: Prettier (`pnpm run format`)
- **Naming**: camelCase for files and variables, PascalCase for interfaces/classes
- **Imports**: relative paths only — no path aliases
- **Async**: always use `async/await`
- **Errors**: throw custom error classes from `src/errors/` (`ValidationError`, `PermissionError`, `SchemaError`)

> **Important**: `chalk` v4, `inquirer` v8, and `nanoid` v3 are pinned for CommonJS compatibility. Do **not** upgrade these to ESM-only versions.

---

## Testing

- Unit tests live in `tests/unit/`
- Integration tests live in `test/integration/` and use `MockSheetClient` (no real Google Sheets API calls)
- All tests must pass before opening a PR

```bash
pnpm test               # Run all 28+ tests
pnpm run test:coverage  # Generate coverage report
```

When adding a feature:
1. Add a unit test in `tests/unit/` for the logic
2. Add an integration test in `test/integration/` for the adapter behaviour

---

## Submitting a Pull Request

1. Fork the repo and create your branch from `develop`
2. Make your changes and write tests
3. Ensure all tests pass: `pnpm test`
4. Ensure linting passes: `pnpm run lint`
5. Update `CHANGELOG.md` under `[Unreleased]` with what you changed
6. Open a PR against `develop` with a clear description

PR title format (same as commit convention):
```
feat(scope): short description
```

---

## Reporting Bugs

Please open an issue on GitHub with:
- Node.js version
- Package version
- Minimal reproduction steps
- Expected vs actual behaviour

For security vulnerabilities, please read [SECURITY.md](SECURITY.md) before posting publicly.
