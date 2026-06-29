import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import { createSheetAdapter } from '../../adapter/sheetAdapter';
import { resolveActorName } from '../../utils/actorConfig';
import { resolveConfigPath, resolveTokensPath } from '../../utils/cliFiles';

export interface SeedOptions {
  allActors?: boolean;
  skipExisting?: boolean;
  upsert?: boolean;
}

async function loadSeedData(seedFilePath: string): Promise<Record<string, unknown[]>> {
  const mod = require(seedFilePath) as
    | Record<string, unknown[]>
    | { default: Record<string, unknown[]> | ((env: NodeJS.ProcessEnv) => Promise<Record<string, unknown[]>>) };

  const exported = (mod as { default?: unknown }).default ?? mod;

  if (typeof exported === 'function') {
    return await (exported as (env: NodeJS.ProcessEnv) => Promise<Record<string, unknown[]>>)(process.env);
  }

  return exported as Record<string, unknown[]>;
}

export async function seedCommand(seedFile: string, opts?: SeedOptions) {
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
  const tokensPath = resolveTokensPath();
  if (!fs.existsSync(tokensPath)) {
    console.error(chalk.red('❌ No OAuth tokens found. Run: lsdb sync'));
    process.exit(1);
  }

  let tokens: unknown;
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

  let seedData: Record<string, unknown[]>;
  try {
    seedData = await loadSeedData(seedFilePath);
  } catch (err) {
    console.error(chalk.red(`❌ Failed to load seed file: ${err}`));
    process.exit(1);
  }

  // Load config and schemas
  interface CLIConfig {
    actors: Array<{ name?: string; role?: string } | string>;
  }
  let config: CLIConfig;
  try {
    config = require(resolveConfigPath()).default;
  } catch {
    console.error(chalk.red('❌ lsdb.config.ts not found. Run: lsdb init'));
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
  for (const actorEntry of config.actors) {
    const actor = resolveActorName(actorEntry);
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
  const adapterWithContext = adapter.withContext({ userId: 'seed-cli', actor: 'admin', actorSheetId: process.env.ADMIN_SHEET_ID! });

  const isSkipExisting = opts?.skipExisting ?? false;
  const isUpsert = opts?.upsert ?? false;

  async function seedTable(
    ctx: ReturnType<typeof adapter.withContext>,
    tableName: string,
    records: unknown[]
  ): Promise<{ inserted: number; skipped: number; updated: number; failed: number }> {
    let inserted = 0;
    let skipped = 0;
    let updated = 0;
    let failed = 0;

    for (const record of records) {
      try {
        const row = record as Record<string, unknown>;
        if (isUpsert) {
          // Determine unique column(s) for upsert — use _id if present, else first provided key
          const whereKey = Object.keys(row)[0];
          const where = { [whereKey]: row[whereKey] };
          await ctx.table(tableName).upsert({ where, data: row, skipFKValidation: true });
          updated++;
        } else if (isSkipExisting) {
          // Try create; skip on unique constraint violation
          try {
            await ctx.table(tableName).create(row, { skipFKValidation: true });
            inserted++;
          } catch (err) {
            if (err instanceof Error && err.message.includes('Unique constraint')) {
              skipped++;
            } else {
              throw err;
            }
          }
        } else {
          await ctx.table(tableName).create(row, { skipFKValidation: true });
          inserted++;
        }
      } catch (err) {
        console.error(chalk.red(`  ✖ Failed: ${err}`));
        failed++;
      }
    }

    return { inserted, skipped, updated, failed };
  }

  let totalInserted = 0;
  let totalFailed = 0;

  if (opts?.allActors) {
    console.log(chalk.cyan('\nSeeding to all actor sheets (--all-actors)...'));

    let users: Record<string, unknown>[] = [];
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
      const targetAdapter = adapter.withContext({ userId: 'seed-cli', actor: 'admin', actorSheetId: user.actor_sheet_id as string });

      for (const [tableName, records] of Object.entries(seedData)) {
        if (!Array.isArray(records)) continue;
        const result = await seedTable(targetAdapter, tableName, records);
        totalInsertedActors += result.inserted + result.updated;
        totalFailedActors += result.failed;
      }
    }

    console.log();
    console.log(chalk.bold(`Seed complete (all-actors): ${totalInsertedActors} inserted/updated, ${totalFailedActors} failed.`));
    if (totalFailedActors > 0) process.exit(1);

    return;
  }

  for (const [tableName, records] of Object.entries(seedData)) {
    if (!Array.isArray(records)) {
      console.warn(chalk.yellow(`  ⚠️  Skipping "${tableName}": expected an array of records`));
      continue;
    }

    console.log(chalk.cyan(`\nSeeding ${tableName} (${records.length} records)...`));
    const result = await seedTable(adapterWithContext, tableName, records);

    const status = result.failed === 0 ? chalk.green('✓') : chalk.yellow('⚠');
    const parts = [];
    if (result.inserted > 0) parts.push(`${result.inserted} inserted`);
    if (result.updated > 0) parts.push(`${result.updated} upserted`);
    if (result.skipped > 0) parts.push(`${result.skipped} skipped`);
    if (result.failed > 0) parts.push(`${result.failed} failed`);
    console.log(`  ${status} ${parts.join(', ')}`);
    totalInserted += result.inserted + result.updated;
    totalFailed += result.failed;
  }

  console.log();
  console.log(chalk.bold(`Seed complete: ${totalInserted} inserted/updated, ${totalFailed} failed.`));

  if (totalFailed > 0) process.exit(1);
}
