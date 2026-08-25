import chalk from 'chalk';
import { TableSchema } from '../../schema/types';

/**
 * Restricts `schemas` to the tables named in a `--table` flag. Accepts a comma-separated list
 * (`--table users,credentials,setup`) as well as a single name, so a caller who only needs a
 * handful of tables isn't forced to operate on every table just to reach the ones they want.
 * Shared by `migrate-data`'s script-generation/`--run` paths and `sync`'s per-actor/`--all-users`
 * paths, which previously duplicated (or lacked) this filtering logic independently.
 * Exits with an actionable error listing exactly which requested names weren't found, rather than
 * silently dropping them or reporting only the first miss.
 */
export function filterSchemasByTable(schemas: TableSchema[], table: string | undefined): TableSchema[] {
  if (!table) return schemas;

  const requested = table.split(',').map((t) => t.trim()).filter(Boolean);
  const requestedSet = new Set(requested);
  const filtered = schemas.filter((s) => requestedSet.has(s.name));

  const found = new Set(filtered.map((s) => s.name));
  const missing = requested.filter((t) => !found.has(t));
  if (missing.length > 0) {
    console.error(chalk.red(`❌ No schema found for table(s): ${missing.join(', ')}`));
    process.exit(1);
  }

  return filtered;
}
