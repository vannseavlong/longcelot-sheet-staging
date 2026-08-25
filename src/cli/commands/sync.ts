import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import { createSheetAdapter } from '../../adapter/sheetAdapter';
import { createOAuthManager } from '../../auth/oauth';
import { TableSchema, ActorConfig } from '../../schema/types';
import { computeSchemaHash } from '../../utils/schemaHash';
import { resolveActorName } from '../../utils/actorConfig';
import { resolveConfigPath } from '../../utils/cliFiles';
import { withBackoff } from '../lib/backoff';
import { resolveTokens } from '../lib/oauthFlow';
import { filterSchemasByTable } from '../lib/filterSchemasByTable';

function loadSchemasForActor(role: string, schemasRoot: string): TableSchema[] {
  const schemas: TableSchema[] = [];
  const actorDir = path.join(schemasRoot, role);
  if (!fs.existsSync(actorDir)) return schemas;

  const files = fs.readdirSync(actorDir).filter((f) => f.endsWith('.ts'));
  for (const file of files) {
    try {
      const schema = require(path.join(actorDir, file)).default;
      schemas.push(schema);
    } catch (error) {
      console.error(chalk.red(`  ❌ Failed to load schema: ${file} — ${error}`));
    }
  }
  return schemas;
}

function printStatusTable(
  rows: Array<{ actor: string; sheetId: string; tables: number; status: string }>
): void {
  const colW = [10, 26, 8, 12];
  const header = ['Actor', 'Sheet ID', 'Tables', 'Status'];
  const sep = colW.map((w) => '─'.repeat(w)).join('─┼─');

  const fmt = (row: string[]) =>
    row.map((cell, i) => cell.padEnd(colW[i])).join(' │ ');

  console.log();
  console.log(chalk.bold(fmt(header)));
  console.log(sep);
  for (const r of rows) {
    const sheetDisplay = r.sheetId ? r.sheetId.slice(0, 24) + (r.sheetId.length > 24 ? '..' : '') : chalk.gray('(not set)');
    console.log(fmt([r.actor, sheetDisplay, String(r.tables), r.status]));
  }
  console.log();
}

export async function syncCommand(options: {
  allUsers?: boolean;
  dryRun?: boolean;
  tokenFile?: string;
  /** Comma-separated table names to restrict the sync to, e.g. `'bookings,payments'`. A single name also works. */
  table?: string;
}) {
  console.log(chalk.blue.bold('🔄 Syncing schemas to Google Sheets...\n'));

  require('dotenv').config();

  const requiredEnvVars = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI'];
  for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
      console.error(chalk.red(`❌ Missing environment variable: ${envVar}`));
      process.exit(1);
    }
  }

  let config: { actors: ActorConfig[]; projectName?: string; schemasDir?: string };
  try {
    config = require(resolveConfigPath()).default;
  } catch {
    console.error(chalk.red('❌ lsdb.config.ts not found. Run: lsdb init'));
    process.exit(1);
  }

  // Validate admin actor has a sheet ID set
  const adminActor = config.actors.find((a) => resolveActorName(a) === 'admin');
  const adminSheetId = adminActor ? process.env[adminActor.sheetIdEnv] : process.env.ADMIN_SHEET_ID;
  if (!adminSheetId) {
    console.error(chalk.red(`❌ Admin sheet ID not set. Add ${adminActor?.sheetIdEnv ?? 'ADMIN_SHEET_ID'} to your .env`));
    process.exit(1);
  }

  const schemasRoot = config.schemasDir
    ? path.resolve(process.cwd(), config.schemasDir)
    : path.join(process.cwd(), 'schemas');

  // Collect all schemas across actors
  const allSchemas: TableSchema[] = [];
  for (const actor of config.actors) {
    allSchemas.push(...loadSchemasForActor(resolveActorName(actor), schemasRoot));
  }

  if (allSchemas.length === 0) {
    console.log(chalk.yellow('⚠️  No schemas found. Nothing to sync.'));
    return;
  }

  // --table restricts which tables actually get synced below, without affecting schema
  // *registration* — the admin `users` table (needed for --all-users' user lookup, and for
  // schema-mismatch/FK resolution generally) must stay registered even when it's excluded
  // from this run's sync scope.
  const schemasToSync = filterSchemasByTable(allSchemas, options.table);

  if (options.table) {
    console.log(
      chalk.cyan(
        `Found ${allSchemas.length} schema(s), restricting sync to ${schemasToSync.length}: ` +
          `${schemasToSync.map((s) => s.name).join(', ')}\n`
      )
    );
  } else {
    console.log(chalk.cyan(`Found ${allSchemas.length} schema(s). Starting OAuth flow...\n`));
  }

  const oauth = createOAuthManager({
    clientId: process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    redirectUri: process.env.GOOGLE_REDIRECT_URI!,
  });

  let tokens: unknown;
  try {
    if (options.tokenFile) {
      const tokenFilePath = path.resolve(process.cwd(), options.tokenFile);
      if (!fs.existsSync(tokenFilePath)) {
        console.error(chalk.red(`❌ Token file not found: ${tokenFilePath}`));
        process.exit(1);
      }
      tokens = JSON.parse(fs.readFileSync(tokenFilePath, 'utf-8'));
      console.log(chalk.green(`✅ Loaded tokens from ${options.tokenFile}\n`));
    } else {
      tokens = await resolveTokens(oauth);
    }
  } catch (err) {
    console.error(chalk.red(`❌ Authentication failed: ${err}`));
    process.exit(1);
  }

  const adapter = createSheetAdapter({
    adminSheetId,
    credentials: {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      redirectUri: process.env.GOOGLE_REDIRECT_URI!,
    },
    tokens,
  });

  adapter.registerSchemas(allSchemas);

  const statusRows: Array<{ actor: string; sheetId: string; tables: number; status: string }> = [];
  let totalSynced = 0;
  let totalFailed = 0;

  console.log(chalk.bold('Syncing actor schemas...\n'));

  for (const actorCfg of config.actors) {
    const actorName = resolveActorName(actorCfg);
    const sheetId = actorName === 'admin' ? adminSheetId : process.env[actorCfg.sheetIdEnv];
    const actorSchemas = schemasToSync.filter((s) => s.actor === actorName);

    if (!sheetId) {
      console.log(chalk.yellow(`  ⚠ ${actorName}: ${actorCfg.sheetIdEnv} not set — skipping`));
      statusRows.push({ actor: actorName, sheetId: '', tables: actorSchemas.length, status: '⚠ skipped' });
      continue;
    }

    if (actorSchemas.length === 0) {
      console.log(chalk.gray(`  - ${actorName}: no schemas`));
      statusRows.push({ actor: actorName, sheetId, tables: 0, status: '– no schemas' });
      continue;
    }

    let actorSynced = 0;
    let actorFailed = 0;
    const syncAdapter = actorName === 'admin'
      ? adapter
      : adapter.withContext({ userId: 'sync-cli', actor: actorName, actorSheetId: sheetId });

    for (const schema of actorSchemas) {
      try {
        await syncAdapter.syncSchema(schema);
        actorSynced++;
        totalSynced++;
      } catch (err) {
        console.error(chalk.red(`    ✖ ${schema.name} — ${err}`));
        actorFailed++;
        totalFailed++;
      }
    }

    const status = actorFailed === 0 ? '✅ synced' : `❌ ${actorFailed} failed`;
    statusRows.push({ actor: actorName, sheetId, tables: actorSynced, status });
    console.log(chalk.green(`  ✓ ${actorName}: ${actorSynced} table(s) synced`));
  }

  // --all-users: push user actor schemas to all registered user sheets
  if (options.allUsers) {
    const userSchemas = schemasToSync.filter((s) => s.actor !== 'admin');
    const dryRun = options.dryRun ?? false;

    if (dryRun) {
      console.log(chalk.bold.yellow('\n[DRY RUN] --all-users: previewing changes without applying...\n'));
    } else {
      console.log(chalk.bold('\nSyncing to all registered user sheets (--all-users)...\n'));
    }

    if (userSchemas.length === 0) {
      console.log(chalk.yellow('⚠️  No user schemas found — nothing to sync.'));
    } else {
      try {
        const usersTable = adapter.table('users');
        const allUsers = await usersTable.findMany({});
        const usersWithSheets = allUsers.filter((u) => u.actor_sheet_id);

        if (usersWithSheets.length === 0) {
          console.log(chalk.yellow('⚠️  No users with actor_sheet_id found in admin users table.'));
        }

        let allUsersSynced = 0;
        let allUsersFailed = 0;

        for (const user of usersWithSheets) {
          const actorSheetId = user.actor_sheet_id as string;
          const roleSchemas = userSchemas.filter((s) => s.actor === user.role);

          if (roleSchemas.length === 0) continue;

          const userAdapter = adapter.withContext({
            userId: user.user_id as string,
            actor: user.role as string,
            actorSheetId,
          });

          console.log(chalk.cyan(`  ${user.email ?? user.user_id} (${user.role}) → ${actorSheetId}`));

          for (const schema of roleSchemas) {
            const currentHash = computeSchemaHash(schema);
            const stored = await adapter.getSchemaVersion(actorSheetId, schema.name);
            const needsSync = !stored || stored.schema_hash !== currentHash;

            if (!needsSync) {
              console.log(chalk.gray(`    ✓ ${schema.name} — up to date`));
              continue;
            }

            if (dryRun) {
              const reason = !stored ? 'new table' : 'schema changed';
              console.log(chalk.yellow(`    ~ ${schema.name} — would sync (${reason})`));
              allUsersSynced++;
              continue;
            }

            try {
              await withBackoff(() => userAdapter.syncSchema(schema));
              await adapter.upsertSchemaVersion(
                actorSheetId,
                schema.name,
                currentHash,
                Object.keys(schema.columns).length
              );
              console.log(chalk.green(`    ✓ ${schema.name} — synced`));
              allUsersSynced++;
              totalSynced++;
            } catch (err) {
              console.error(chalk.red(`    ✖ ${schema.name} — ${err}`));
              allUsersFailed++;
              totalFailed++;
            }
          }
        }

        const verb = dryRun ? 'would sync' : 'synced';
        console.log();
        console.log(chalk.bold(`All-users result: ${allUsersSynced} ${verb}, ${allUsersFailed} failed.`));
      } catch (err) {
        console.log(chalk.yellow(`⚠️  Could not fetch users table for --all-users sync: ${err}`));
      }
    }
  }

  printStatusTable(statusRows);
  console.log(chalk.bold(`Sync complete: ${totalSynced} synced, ${totalFailed} failed.`));

  if (totalFailed > 0) process.exit(1);
}
