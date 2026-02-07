#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const commander_1 = require("commander");
const init_1 = require("./commands/init");
const generate_1 = require("./commands/generate");
const sync_1 = require("./commands/sync");
const validate_1 = require("./commands/validate");
const program = new commander_1.Command();
program
    .name('sheet-db')
    .description('Google Sheets-backed staging database CLI')
    .version('0.1.0');
program
    .command('init')
    .description('Initialize a new longcelot-sheet-db project')
    .action(init_1.initCommand);
program
    .command('generate <table-name>')
    .description('Generate a new table schema')
    .action(generate_1.generateCommand);
program
    .command('sync')
    .description('Sync schemas to Google Sheets')
    .action(sync_1.syncCommand);
program
    .command('validate')
    .description('Validate all schemas')
    .action(validate_1.validateCommand);
program.parse(process.argv);
//# sourceMappingURL=index.js.map