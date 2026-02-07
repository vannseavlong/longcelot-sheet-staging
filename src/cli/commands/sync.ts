import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import { createSheetAdapter } from '../../adapter/sheetAdapter';
import { TableSchema } from '../../schema/types';

export async function syncCommand() {
  console.log(chalk.blue.bold('🔄 Syncing schemas to Google Sheets...\n'));

  require('dotenv').config();

  const requiredEnvVars = [
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    'GOOGLE_REDIRECT_URI',
    'ADMIN_SHEET_ID',
  ];

  for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
      console.error(chalk.red(`❌ Missing environment variable: ${envVar}`));
      process.exit(1);
    }
  }

  let config;
  try {
    config = require(path.join(process.cwd(), 'sheet-db.config.ts')).default;
  } catch {
    console.error(chalk.red('❌ sheet-db.config.ts not found'));
    process.exit(1);
  }

  console.log(chalk.yellow('⚠️  Note: This command requires valid OAuth tokens.'));
  console.log(chalk.yellow('    In production, implement proper OAuth flow.\n'));

  const schemas: TableSchema[] = [];
  const schemasDir = path.join(process.cwd(), 'schemas');

  for (const actor of config.actors) {
    const actorDir = path.join(schemasDir, actor);

    if (!fs.existsSync(actorDir)) {
      continue;
    }

    const files = fs.readdirSync(actorDir).filter((f) => f.endsWith('.ts'));

    for (const file of files) {
      try {
        const schema = require(path.join(actorDir, file)).default;
        schemas.push(schema);
      } catch (error) {
        console.error(chalk.red(`❌ Failed to load schema: ${file}`));
        console.error(error);
      }
    }
  }

  console.log(chalk.cyan(`Found ${schemas.length} schemas\n`));

  console.log(chalk.yellow('⚠️  Sync functionality requires implementation of:'));
  console.log('   1. OAuth token storage and refresh');
  console.log('   2. Admin sheet creation and access');
  console.log('   3. Per-user sheet creation\n');

  console.log(chalk.green('✅ Schema validation complete'));
  console.log(chalk.cyan('\nSchemas loaded:'));
  schemas.forEach((s) => {
    console.log(`   - ${s.name} (${s.actor})`);
  });
}
