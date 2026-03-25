import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import { createSheetAdapter } from '../../adapter/sheetAdapter';

export async function seedCommand(seedFile: string, opts?: any) {
  console.log(chalk.blue.bold('🌱 Seeding data into Google Sheets...\n'));

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

  // Load tokens
  const tokensPath = path.join(process.cwd(), '.sheet-db-tokens.json');
  if (!fs.existsSync(tokensPath)) {
    console.error(chalk.red('❌ No OAuth tokens found. Run: sheet-db sync'));
    process.exit(1);
  }

  let tokens: any;
  try {
    tokens = JSON.parse(fs.readFileSync(tokensPath, 'utf-8'));
  } catch {
    console.error(chalk.red('❌ Failed to read tokens file.'));
    process.exit(1);
  }

  // Load seed file
  const seedFilePath = path.resolve(process.cwd(), seedFile);
  if (!fs.existsSync(seedFilePath)) {
    console.error(chalk.red(`❌ Seed file not found: ${seedFilePath}`));
    process.exit(1);
  }

  let seedData: Record<string, any[]>;
  try {
    seedData = require(seedFilePath);
  } catch (err) {
    console.error(chalk.red(`❌ Failed to load seed file: ${err}`));
    process.exit(1);
  }

  // Load config and schemas
  let config: any;
  try {
    config = require(path.join(process.cwd(), 'sheet-db.config.ts')).default;
  } catch {
    console.error(chalk.red('❌ sheet-db.config.ts not found. Run: sheet-db init'));
    process.exit(1);
  }

  const adapter = createSheetAdapter({
    adminSheetId: process.env.ADMIN_SHEET_ID!,
    credentials: {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      redirectUri: process.env.GOOGLE_REDIRECT_URI!,
    },
    tokens,
  });

  // Load and register all schemas
  const schemasDir = path.join(process.cwd(), 'schemas');
  for (const actor of config.actors) {
    const actorDir = path.join(schemasDir, actor);
    if (!fs.existsSync(actorDir)) continue;
    const files = fs.readdirSync(actorDir).filter((f) => f.endsWith('.ts'));
    for (const file of files) {
      try {
        const schema = require(path.join(actorDir, file)).default;
        adapter.registerSchema(schema);
      } catch {}
    }
  }

  // Use admin context for seeding
  const adapterWithContext = adapter.withContext({ userId: 'seed-cli', role: 'admin', actorSheetId: process.env.ADMIN_SHEET_ID! });

  let totalInserted = 0;
  let totalFailed = 0;

  if (opts && opts.allActors) {
    console.log(chalk.cyan('\nSeeding to all actor sheets (--all-actors)...'));

    // Read users from admin users table
    let users: any[] = [];
    try {
      users = await adapterWithContext.table('users').findMany();
    } catch {
      console.error(chalk.red('❌ Could not read admin users table. Make sure `users` schema is registered and admin sheet has been synced.'));
      process.exit(1);
    }

    if (!users || users.length === 0) {
      console.warn(chalk.yellow('No users found in admin users table. Nothing to seed.'));
      return;
    }

    let totalInsertedActors = 0;
    let totalFailedActors = 0;

    for (const user of users) {
      if (!user.actor_sheet_id) continue;
      const targetAdapter = adapter.withContext({ userId: 'seed-cli', role: 'admin', actorSheetId: user.actor_sheet_id });

      for (const [tableName, records] of Object.entries(seedData)) {
        if (!Array.isArray(records)) continue;
        for (const record of records) {
          try {
            await targetAdapter.table(tableName).create(record);
            totalInsertedActors++;
          } catch {
            totalFailedActors++;
          }
        }
      }
    }

    console.log();
    console.log(chalk.bold(`Seed complete (all-actors): ${totalInsertedActors} inserted, ${totalFailedActors} failed.`));
    if (totalFailedActors > 0) process.exit(1);

    return;
  }

  for (const [tableName, records] of Object.entries(seedData)) {
    if (!Array.isArray(records)) {
      console.warn(chalk.yellow(`  ⚠️  Skipping "${tableName}": expected an array of records`));
      continue;
    }

    console.log(chalk.cyan(`\nSeeding ${tableName} (${records.length} records)...`));
    let inserted = 0;
    let failed = 0;

    for (const record of records) {
      try {
        await adapterWithContext.table(tableName).create(record);
        inserted++;
      } catch (err) {
        console.error(chalk.red(`  ✖ Failed: ${err}`));
        failed++;
      }
    }

    const status = failed === 0 ? chalk.green('✓') : chalk.yellow('⚠');
    console.log(`  ${status} ${inserted} inserted, ${failed} failed`);
    totalInserted += inserted;
    totalFailed += failed;
  }

  console.log();
  console.log(chalk.bold(`Seed complete: ${totalInserted} inserted, ${totalFailed} failed.`));

  if (totalFailed > 0) process.exit(1);
}
