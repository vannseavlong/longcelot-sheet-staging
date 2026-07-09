#!/usr/bin/env node

import path from 'path';
import chalk from 'chalk';
import { Command } from 'commander';
import { initCommand } from './commands/init';
import { generateCommand } from './commands/generate';
import { syncCommand } from './commands/sync';
import { validateCommand } from './commands/validate';
import { seedCommand } from './commands/seed';
import { mockUsersCommand } from './commands/mock-users';
import { doctorCommand } from './commands/doctor';
import { statusCommand } from './commands/status';
import { migrateCommand } from './commands/migrate';
import { migrateDataCommand } from './commands/migrate-data';
import { exportCommand } from './commands/export';
import { exportDataCommand } from './commands/export-data';
import { dropTableCommand } from './commands/drop-table';
import { dropColumnCommand } from './commands/drop-column';
import { renameColumnCommand } from './commands/rename-column';
import { erdiagramCommand } from './commands/erdiagram';

const invokedAs = path.basename(process.argv[1] ?? '');
if (invokedAs === 'sheet-db') {
  console.warn(
    chalk.yellow(
      '⚠️  Deprecation: the `sheet-db` command is renamed to `lsdb`.\n' +
      '   Update your scripts to use `lsdb` — the old name will be removed in a future release.\n'
    )
  );
}

const program = new Command();

program
  .name('lsdb')
  .description('Google Sheets-backed staging database CLI')
  .version('0.1.0');

program
  .command('init')
  .description('Initialize a new longcelot-sheet-db project')
  .option('--integrate', 'Integrate into an existing project without overwriting configs')
  .action(initCommand);

program
  .command('generate <table-name>')
  .description('Generate a new table schema')
  .action(generateCommand);

program
  .command('sync')
  .description('Sync schemas to Google Sheets')
  .option('--all-users', 'Sync schema changes to all registered user sheets')
  .option('--dry-run', 'Preview --all-users changes without applying them')
  .option('--token-file <path>', 'Path to existing tokens JSON file (for CI/CD — skips interactive OAuth prompt)')
  .action(syncCommand);

program
  .command('validate')
  .description('Validate all schemas')
  .action(validateCommand);

program
  .command('seed <seed-file>')
  .description('Seed initial data into Google Sheets from a JS/TS file')
  .option('--all-actors', 'Distribute seed data to all actor sheets (per users table)')
  .option('--skip-existing', 'Skip rows where a unique column already matches (no error)')
  .option('--upsert', 'Update existing row on unique conflict instead of throwing')
  .action((seedFile, options) => seedCommand(seedFile, {
    allActors: options.allActors,
    skipExisting: options.skipExisting,
    upsert: options.upsert,
  }));

program
  .command('mock-users [count]')
  .description('Create mock user sheets for development/testing')
  .action((count) => mockUsersCommand(count));

program
  .command('doctor')
  .description('Run diagnostics: check env vars, config, OAuth tokens, and schemas')
  .action(doctorCommand);

program
  .command('status')
  .description('Show project status: tables, actors, sheet IDs, and token info')
  .action(statusCommand);

program
  .command('migrate')
  .description('Export schemas to Prisma schema or SQL DDL')
  .option('--prisma', 'Generate Prisma schema.prisma')
  .option('--sql', 'Generate SQL DDL (CREATE TABLE statements)')
  .option('--output <dir>', 'Output directory (default: current directory)')
  .action((options) => migrateCommand(options));

program
  .command('migrate-data')
  .description('Generate a data export script to move row data from Google Sheets to a production DB')
  .option('--table <name>', 'Export a single table only')
  .option('--all-users', 'Include all registered user sheets in addition to the admin sheet')
  .option('--output <dir>', 'Output directory for migrate-data.js (default: current directory)')
  .option('--dry-run', 'Preview export plan without writing any files')
  .action((options) => migrateDataCommand({ ...options, allUsers: options.allUsers }));

program
  .command('export')
  .description('[deprecated] Use migrate instead. Exports schemas to Prisma schema or SQL DDL.')
  .option('--prisma', 'Generate Prisma schema.prisma')
  .option('--sql', 'Generate SQL DDL (CREATE TABLE statements)')
  .option('--output <dir>', 'Output directory (default: current directory)')
  .action((options) => exportCommand(options));

program
  .command('export-data')
  .description('[deprecated] Use migrate-data instead. Generates a data export script.')
  .option('--table <name>', 'Export a single table only')
  .option('--all-users', 'Include all registered user sheets in addition to the admin sheet')
  .option('--output <dir>', 'Output directory (default: current directory)')
  .option('--dry-run', 'Preview export plan without writing any files')
  .action((options) => exportDataCommand({ ...options, allUsers: options.allUsers }));

program
  .command('erdiagram')
  .description('Generate a Mermaid ER diagram of table schemas and relationships as a Markdown file')
  .option('--output <file>', 'Output file path (default: ER-DIAGRAM.md in project root)')
  .option('--yes', 'Overwrite an existing output file without prompting')
  .action((options) => erdiagramCommand(options));

program
  .command('drop-table [table-names...]')
  .description('Delete table schema file(s) and the corresponding Google Sheet tab(s)')
  .option('--all-users', 'Also drop from every registered user sheet')
  .option('--yes', 'Skip the confirmation prompt')
  .option('--dry-run', 'Preview without making changes')
  .option('--token-file <path>', 'Path to existing tokens JSON file (for CI/CD — skips interactive OAuth prompt)')
  .action((tableNames, options) => dropTableCommand(tableNames, options));

program
  .command('drop-column [table-name] [column-names...]')
  .description('Delete column(s) from a table schema file and the live Google Sheet')
  .option('--all-users', 'Also drop from every registered user sheet')
  .option('--yes', 'Skip the confirmation prompt')
  .option('--dry-run', 'Preview without making changes')
  .option('--token-file <path>', 'Path to existing tokens JSON file (for CI/CD — skips interactive OAuth prompt)')
  .action((tableName, columnNames, options) => dropColumnCommand(tableName, columnNames, options));

program
  .command('rename-column [table-name] [old-name] [new-name]')
  .description('Rename a column in a table schema file and the live Google Sheet header, preserving existing data')
  .option('--all-users', 'Also rename on every registered user sheet')
  .option('--yes', 'Skip the confirmation prompt')
  .option('--dry-run', 'Preview without making changes')
  .option('--token-file <path>', 'Path to existing tokens JSON file (for CI/CD — skips interactive OAuth prompt)')
  .action((tableName, oldName, newName, options) => renameColumnCommand(tableName, oldName, newName, options));

program.parse(process.argv);
