#!/usr/bin/env node

import { Command } from 'commander';
import { initCommand } from './commands/init';
import { generateCommand } from './commands/generate';
import { syncCommand } from './commands/sync';
import { validateCommand } from './commands/validate';

const program = new Command();

program
  .name('sheet-db')
  .description('Google Sheets-backed staging database CLI')
  .version('0.1.0');

program
  .command('init')
  .description('Initialize a new longcelot-sheet-db project')
  .action(initCommand);

program
  .command('generate <table-name>')
  .description('Generate a new table schema')
  .action(generateCommand);

program
  .command('sync')
  .description('Sync schemas to Google Sheets')
  .action(syncCommand);

program
  .command('validate')
  .description('Validate all schemas')
  .action(validateCommand);

program.parse(process.argv);
