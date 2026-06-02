import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { createSheetAdapter } from '../../adapter/sheetAdapter';
import { createOAuthManager } from '../../auth/oauth';
import { TableSchema, ActorConfig } from '../../schema/types';
import { computeSchemaHash } from '../../utils/schemaHash';

function isRateLimitError(err: unknown): boolean {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    return msg.includes('429') || msg.includes('quota') || msg.includes('rate limit');
  }
  return false;
}

async function withBackoff<T>(fn: () => Promise<T>, maxRetries = 5): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (isRateLimitError(err) && attempt < maxRetries) {
        const delayMs = Math.min(Math.pow(2, attempt) * 1000, 32_000);
        console.log(chalk.yellow(`  ⏳ Rate limited — retrying in ${delayMs / 1000}s (attempt ${attempt + 1}/${maxRetries})...`));
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }
      throw err;
    }
  }
  throw new Error('Max retries exceeded');
}

const TOKENS_FILE = '.sheet-db-tokens.json';

function readTokens(): unknown | null {
  const tokenPath = path.join(process.cwd(), TOKENS_FILE);
  if (!fs.existsSync(tokenPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(tokenPath, 'utf-8'));
  } catch {
    return null;
  }
}

function saveTokens(tokens: unknown): void {
  fs.writeFileSync(
    path.join(process.cwd(), TOKENS_FILE),
    JSON.stringify(tokens, null, 2),
    'utf-8'
  );
}

async function resolveTokens(
  oauth: ReturnType<typeof createOAuthManager>
): Promise<unknown> {
  const stored = readTokens() as Record<string, unknown> | null;

  if (stored?.refresh_token) {
    try {
      console.log(chalk.cyan('🔄 Refreshing OAuth tokens...\n'));
      const refreshed = await oauth.refreshTokens(stored.refresh_token as string);
      const merged = { ...stored, ...(refreshed as Record<string, unknown>) };
      saveTokens(merged);
      return merged;
    } catch {
      console.log(chalk.yellow('⚠️  Token refresh failed. Re-authorizing...\n'));
    }
  }

  const authUrl = oauth.getAuthUrl();
  console.log(chalk.cyan('🔐 Authorization required.\n'));
  console.log(chalk.white('Open the following URL in your browser:\n'));
  console.log(chalk.bold.underline(authUrl));
  console.log();

  const { code } = await inquirer.prompt([
    {
      type: 'input',
      name: 'code',
      message: 'Paste the authorization code from the redirect URL:',
      validate: (v) => (v.trim().length > 0 ? true : 'Code cannot be empty'),
    },
  ]);

  const tokens = await oauth.getTokens(code.trim());
  saveTokens(tokens);
  console.log(chalk.green(`✅ Tokens saved to ${TOKENS_FILE}\n`));
  return tokens;
}

function loadSchemasForActor(role: string): TableSchema[] {
  const schemas: TableSchema[] = [];
  const actorDir = path.join(process.cwd(), 'schemas', role);
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

export async function syncCommand(options: { allUsers?: boolean; dryRun?: boolean; tokenFile?: string }) {
  console.log(chalk.blue.bold('🔄 Syncing schemas to Google Sheets...\n'));

  require('dotenv').config();

  const requiredEnvVars = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI'];
  for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
      console.error(chalk.red(`❌ Missing environment variable: ${envVar}`));
      process.exit(1);
    }
  }

  let config: { actors: ActorConfig[]; projectName?: string };
  try {
    config = require(path.join(process.cwd(), 'sheet-db.config.ts')).default;
  } catch {
    console.error(chalk.red('❌ sheet-db.config.ts not found. Run: sheet-db init'));
    process.exit(1);
  }

  // Validate admin actor has a sheet ID set
  const adminActor = config.actors.find((a) => a.role === 'admin');
  const adminSheetId = adminActor ? process.env[adminActor.sheetIdEnv] : process.env.ADMIN_SHEET_ID;
  if (!adminSheetId) {
    console.error(chalk.red(`❌ Admin sheet ID not set. Add ${adminActor?.sheetIdEnv ?? 'ADMIN_SHEET_ID'} to your .env`));
    process.exit(1);
  }

  // Collect all schemas across actors
  const allSchemas: TableSchema[] = [];
  for (const actor of config.actors) {
    allSchemas.push(...loadSchemasForActor(actor.role));
  }

  if (allSchemas.length === 0) {
    console.log(chalk.yellow('⚠️  No schemas found. Nothing to sync.'));
    return;
  }

  console.log(chalk.cyan(`Found ${allSchemas.length} schema(s). Starting OAuth flow...\n`));

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
    const sheetId = actorCfg.role === 'admin' ? adminSheetId : process.env[actorCfg.sheetIdEnv];
    const actorSchemas = allSchemas.filter((s) => s.actor === actorCfg.role);

    if (!sheetId) {
      console.log(chalk.yellow(`  ⚠ ${actorCfg.role}: ${actorCfg.sheetIdEnv} not set — skipping`));
      statusRows.push({ actor: actorCfg.role, sheetId: '', tables: actorSchemas.length, status: '⚠ skipped' });
      continue;
    }

    if (actorSchemas.length === 0) {
      console.log(chalk.gray(`  - ${actorCfg.role}: no schemas`));
      statusRows.push({ actor: actorCfg.role, sheetId, tables: 0, status: '– no schemas' });
      continue;
    }

    let actorSynced = 0;
    let actorFailed = 0;
    const syncAdapter = actorCfg.role === 'admin'
      ? adapter
      : adapter.withContext({ userId: 'sync-cli', role: actorCfg.role, actorSheetId: sheetId });

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
    statusRows.push({ actor: actorCfg.role, sheetId, tables: actorSynced, status });
    console.log(chalk.green(`  ✓ ${actorCfg.role}: ${actorSynced} table(s) synced`));
  }

  // --all-users: push user actor schemas to all registered user sheets
  if (options.allUsers) {
    const userSchemas = allSchemas.filter((s) => s.actor !== 'admin');
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
            role: user.role as string,
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
