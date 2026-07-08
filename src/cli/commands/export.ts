import chalk from 'chalk';
import { migrateCommand, generatePrismaModel, generateSQLTable } from './migrate';

/**
 * @deprecated `lsdb export` is deprecated — use `lsdb migrate` instead.
 * `migrate` now names the schema/DDL export command (--prisma/--sql); the old
 * `lsdb migrate` (data row export) has been renamed to `lsdb migrate-data`.
 */
export async function exportCommand(options: { prisma?: boolean; sql?: boolean; output?: string }) {
  console.warn(
    chalk.yellow(
      '⚠️  Deprecation: `lsdb export` is renamed to `lsdb migrate`.\n' +
      '   Update your scripts to use `lsdb migrate` — the old name will be removed in a future release.\n'
    )
  );
  return migrateCommand(options);
}

// Re-exported for anyone importing directly from the old module path.
export { generatePrismaModel, generateSQLTable };

export default exportCommand;
