#!/usr/bin/env node

import { Command } from 'commander';
import { initCommand } from './commands/init';
import { generateCommand } from './commands/generate';
import { syncCommand } from './commands/sync';
import { validateCommand } from './commands/validate';
import { seedCommand } from './commands/seed';
import { mockUsersCommand } from './commands/mock-users';
import { doctorCommand } from './commands/doctor';
import { statusCommand } from './commands/status';
import { exportCommand } from './commands/export';

const program = new Command();

program
  .name('sheet-db')
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
  .action(syncCommand);

program
  .command('validate')
  .description('Validate all schemas')
  .action(validateCommand);

program
  .command('seed <seed-file>')
  .description('Seed initial data into Google Sheets from a JS/TS file')
  .option('--all-actors', 'Distribute seed data to all actor sheets (per users table)')
  .action((seedFile, options) => seedCommand(seedFile, options));

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
  .command('export')
  .description('Export schemas to Prisma schema or SQL DDL')
  .option('--prisma', 'Generate Prisma schema.prisma')
  .option('--sql', 'Generate SQL DDL (CREATE TABLE statements)')
  .option('--output <dir>', 'Output directory (default: current directory)')
  .action((options) => exportCommand(options));

program.parse(process.argv);
