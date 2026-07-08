import chalk from 'chalk';
import { migrateDataCommand, generateMigrateDataScript } from './migrate-data';
import { TableSchema } from '../../schema/types';

/**
 * @deprecated `lsdb export-data` is deprecated — use `lsdb migrate-data` instead.
 * Kept for backward compatibility; the data-export behaviour is unchanged.
 */
export async function exportDataCommand(options: {
  output?: string;
  table?: string;
  allUsers?: boolean;
  dryRun?: boolean;
}) {
  console.warn(
    chalk.yellow(
      '⚠️  Deprecation: `lsdb export-data` is renamed to `lsdb migrate-data`.\n' +
      '   Update your scripts to use `lsdb migrate-data` — the old name will be removed in a future release.\n'
    )
  );
  return migrateDataCommand(options);
}

// Re-exported for anyone importing directly from the old module path.
export function generateExportDataScript(schemas: TableSchema[], allUsers = false): string {
  return generateMigrateDataScript(schemas, allUsers);
}

export default exportDataCommand;
