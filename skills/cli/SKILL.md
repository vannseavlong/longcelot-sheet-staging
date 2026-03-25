---
name: cli
description: Use the longcelot-sheet-db CLI (sheet-db). Use when running sheet-db init, generate, sync, validate, seed, doctor, or status commands — or when scaffolding a new project, generating schema files interactively, syncing schemas to Google Sheets, diagnosing configuration issues, or checking project status.
license: MIT
metadata:
  package: longcelot-sheet-db
  version: "0.1.5"
---

# longcelot-sheet-db — CLI Reference (`sheet-db`)

All commands are available as `sheet-db <command>` (global install) or via:

```bash
npx sheet-db <command>
pnpm dlx sheet-db <command>
yarn dlx sheet-db <command>
bunx sheet-db <command>
```

---

## init — Scaffold a new project

```bash
npx sheet-db init
```

**What it creates:**
- `sheet-db.config.ts` — Project configuration (project name, actors list)
- `.env` — Environment variable template
- `schemas/` — Schemas directory with default admin schemas (`users`, `credentials`)

Run this **once** when first adding `longcelot-sheet-db` to a project.

---

## generate — Interactive schema generator

```bash
npx sheet-db generate bookings
```

Launches an interactive prompt that asks:
- Column name
- Column type (`string` | `number` | `boolean` | `date` | `json`)
- Modifiers (`required`, `unique`, `default`, etc.)

Writes a new schema file to the `schemas/` directory. Use instead of hand-authoring schema files when you're not sure of the syntax.

---

## sync — Sync schemas to Google Sheets

```bash
npx sheet-db sync
```

**What it does:**
1. Loads all schemas from `schemas/`
2. Validates environment variables (`GOOGLE_CLIENT_ID`, etc.)
3. Handles OAuth: reads stored tokens from `.sheet-db-tokens.json`, prompts for browser authorization if no token is found, and stores tokens for future use
4. Calls `adapter.syncSchema()` for every schema
5. Creates missing sheet tabs and adds missing column headers — **never deletes data**

Run after:
- Adding new schemas
- Adding new columns to existing schemas
- Setting up a new environment

> `.sheet-db-tokens.json` is written to the project root and should be in `.gitignore`.

---

## validate — Validate all schemas

```bash
npx sheet-db validate
```

Checks all schema files in `schemas/` for:
- Duplicate table names (within same actor)
- Invalid column modifiers
- Unknown actor references (actor not listed in `sheet-db.config.ts`)
- Missing required schema fields (`name`, `actor`, `columns`)

Use this in CI to catch schema problems before they reach Google Sheets.

---

## seed — Load initial/test data

```bash
npx sheet-db seed
```

Loads initial or test data into your sheets. Reads seed definitions from your project. Useful for populating development and staging environments with realistic data.

---

## doctor — Diagnostics and health checks

```bash
npx sheet-db doctor
```

Runs a series of environment and configuration checks:
- Verifies all required environment variables are set
- Checks Google OAuth credentials are valid
- Validates `sheet-db.config.ts` structure
- Reports any issues with color-coded output

Run `doctor` first when debugging mysterious adapter errors.

---

## status — Show project status

```bash
npx sheet-db status
```

Displays:
- All registered tables and their actors
- Associated Google Sheet IDs
- Schema counts per actor
- Current configuration summary

---

## sheet-db.config.ts structure

The init command generates this file. Customize actors and project name here:

```typescript
export default {
  projectName: 'my-app',
  actors: ['admin', 'user', 'seller'], // all roles that own data
};
```

---

## Common Mistakes

- **Running `sync` without `.env` configured** — `sync` will fail at the OAuth step if environment variables are missing. Run `doctor` first to verify environment setup.
- **Committing `.sheet-db-tokens.json`** — This file contains OAuth tokens. It is added to `.gitignore` by `init` but verify it is excluded before pushing to a public repo.
- **Running `generate` with a name that conflicts** — If a schema with the same `name` and `actor` already exists, you'll get a duplicate error on next `validate`. Use unique table names per actor.
- **Not running `sync` after schema changes** — Schema files are the source of truth. After adding columns or tables, you must run `sync` to create the corresponding headers in Google Sheets; otherwise `create()` will fail silently or store data in wrong columns.
- **`init` on an existing project** — Running `init` again will not overwrite existing files, but always review generated defaults and merge manually if needed.
