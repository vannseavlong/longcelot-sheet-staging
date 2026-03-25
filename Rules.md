# Development Rules

This document defines the mandatory rules for development, feature work, debugging, and publishing in this repository.

Package manager preference: use `pnpm` for local development and release workflow.

## 1) Purpose

Use these rules as a **quality gate** before every commit and before every package publish.

- Keep code readable and maintainable
- Keep TypeScript strictly typed
- Keep CI green (build, test, lint)
- Keep release process predictable

---

## 2) Core Engineering Rules

### 2.1 Clean Code Mindset

- Write code for the next developer, not only for today.
- Keep functions focused (single responsibility).
- Prefer clear naming over clever abstractions.
- Avoid duplicated logic; extract shared helpers when duplication appears.
- Keep changes minimal and scoped to the problem.
- Do not mix unrelated refactors with a feature/fix PR.

### 2.2 TypeScript Safety Rules (Strict)

- **No `any` type** in production code.
- Prefer `unknown` + runtime narrowing over `any`.
- Type all function inputs/outputs explicitly when inference is unclear.
- Keep `strict` mode assumptions intact.
- Do not silence type errors with unsafe casts unless justified and documented.

### 2.3 Error Handling Rules

- Use explicit error messages with actionable context.
- Use existing custom errors where appropriate (`ValidationError`, `PermissionError`, `SchemaError`).
- Never swallow errors silently unless there is an intentional fallback.
- If intentionally ignoring an error, add a short reason comment.

### 2.4 CLI & Adapter Rules

- Preserve backward-compatible CLI behavior unless change is intentional and documented.
- Validate required environment variables before runtime operations.
- Keep actor-permission boundaries strict.
- Ensure new commands/options have clear help descriptions.

### 2.5 Testing Rules

- New features must include or update tests.
- Bug fixes must add regression coverage when possible.
- Unit tests go in `tests/unit/`.
- Integration tests go in `test/integration/`.
- Do not merge with failing tests.

### 2.6 Documentation Rules

- Update relevant docs (`README.md`, `API.md`, `CHANGELOG.md`, `TODO.md`) when behavior changes.
- Keep examples and command usage synchronized with actual CLI behavior.

---

## 3) Development Workflow Rules

Apply this flow for **new features**, **enhancements**, and **debugging**.

1. Understand the problem and affected modules.
2. Make the smallest safe change that solves root cause.
3. Run local quality checks.
4. Update tests and docs.
5. Confirm checklist items before commit.

### 3.1 Commit Message Standard

Use Conventional Commits:

- `feat(scope): ...`
- `fix(scope): ...`
- `docs(scope): ...`
- `test(scope): ...`
- `refactor(scope): ...`
- `chore(scope): ...`

---

## 4) Mandatory Pre-Commit Checklist

Before each commit, confirm all items:

- [ ] Scope is focused (no unrelated changes)
- [ ] No `any` introduced
- [ ] No dead code / unused variables
- [ ] Lint passes
- [ ] Build passes
- [ ] Tests pass
- [ ] Docs updated if behavior changed
- [ ] Changelog updated (if user-facing change)

Recommended commands:

```bash
pnpm run lint
pnpm run build
pnpm test
```

(If `pnpm` is unavailable, use equivalent `npm` commands.)

---

## 5) Mandatory Pre-Publish Checklist

Before publishing a new package version:

- [ ] Working tree is clean
- [ ] Version is bumped correctly in `package.json`
- [ ] `CHANGELOG.md` includes release notes
- [ ] `README.md` and CLI docs match current behavior
- [ ] Lint/build/tests are all green locally
- [ ] CI is green on the target branch
- [ ] npm authentication/permissions confirmed
- [ ] Git tag format is correct (e.g., `v0.1.6`)
- [ ] Tag and commit pushed to remote
- [ ] Release command executed intentionally

Recommended release flow:

```bash
pnpm run lint
pnpm run build
pnpm test
pnpm version patch
git push origin main --follow-tags
pnpm publish
```

---

## 6) Definition of Done (DoD)

A task is considered done only when:

- Code is clean, typed, and readable
- Lint/build/tests pass
- Docs and changelog are updated
- CI passes
- Reviewer can understand the change without extra explanation

---

## 7) Team Agreement

All contributors agree to follow this file for:

- Day-to-day development
- Feature implementation
- Bug fixing
- Release preparation

If a rule must be broken for a valid reason, document the exception in the PR description.
