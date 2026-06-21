import chalk from 'chalk';
import { exportDataCommand, generateExportDataScript } from './export-data';
import { TableSchema } from '../../schema/types';

/**
 * @deprecated `sheet-db migrate` is deprecated — use `sheet-db export-data` instead.
 * "migrate" in standard tooling means schema-only DDL changes (Prisma Migrate, Rails, Flyway).
 * This command generates a DATA export script; the correct name is `export-data`.
 */
export async function migrateCommand(options: { output?: string; table?: string; dryRun?: boolean }) {
  console.warn(
    chalk.yellow(
      '⚠️  Deprecation: `sheet-db migrate` is renamed to `sheet-db export-data`.\n' +
      '   Update your scripts to use `sheet-db export-data` — the old name will be removed in a future release.\n'
    )
  );
  return exportDataCommand(options);
}

// Re-export for tests that import generateMigrationScript directly
export function generateMigrationScript(schemas: TableSchema[]): string {
  return generateExportDataScript(schemas, false);
}

export default migrateCommand;
