import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { createSheetAdapter } from '../../adapter/sheetAdapter';
import { createOAuthManager } from '../../auth/oauth';
import { TableSchema } from '../../schema/types';

const TOKENS_FILE = '.sheet-db-tokens.json';

function readTokens(): any | null {
  const tokenPath = path.join(process.cwd(), TOKENS_FILE);
  if (!fs.existsSync(tokenPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(tokenPath, 'utf-8'));
  } catch {
    return null;
  }
}

function saveTokens(tokens: any): void {
  fs.writeFileSync(
    path.join(process.cwd(), TOKENS_FILE),
    JSON.stringify(tokens, null, 2),
    'utf-8'
  );
}

async function resolveTokens(
  oauth: ReturnType<typeof createOAuthManager>
): Promise<any> {
  const stored = readTokens();

  // Attempt to refresh if we have a stored refresh_token
  if (stored?.refresh_token) {
    try {
      console.log(chalk.cyan('🔄 Refreshing OAuth tokens...\n'));
      const refreshed = await oauth.refreshTokens(stored.refresh_token);
      // Keep existing refresh_token if the new response doesn't include one
      const merged = { ...stored, ...refreshed };
      saveTokens(merged);
      return merged;
    } catch {
      console.log(chalk.yellow('⚠️  Token refresh failed. Re-authorizing...\n'));
    }
  }

  // Full OAuth flow
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

export async function syncCommand(options: { allUsers?: boolean }) {
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
    console.error(chalk.red('❌ sheet-db.config.ts not found. Run: sheet-db init'));
    process.exit(1);
  }

  // Collect schemas
  const schemas: TableSchema[] = [];
  const schemasDir = path.join(process.cwd(), 'schemas');

  for (const actor of config.actors) {
    const actorDir = path.join(schemasDir, actor);
    if (!fs.existsSync(actorDir)) continue;

    const files = fs.readdirSync(actorDir).filter((f) => f.endsWith('.ts'));
    for (const file of files) {
      try {
        const schema = require(path.join(actorDir, file)).default;
        schemas.push(schema);
      } catch (error) {
        console.error(chalk.red(`❌ Failed to load schema: ${file} — ${error}`));
      }
    }
  }

  if (schemas.length === 0) {
    console.log(chalk.yellow('⚠️  No schemas found. Nothing to sync.'));
    return;
  }

  console.log(chalk.cyan(`Found ${schemas.length} schema(s). Starting OAuth flow...\n`));

  // Resolve OAuth tokens (refresh or full flow)
  const oauth = createOAuthManager({
    clientId: process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    redirectUri: process.env.GOOGLE_REDIRECT_URI!,
  });

  let tokens: any;
  try {
    tokens = await resolveTokens(oauth);
  } catch (err) {
    console.error(chalk.red(`❌ Authentication failed: ${err}`));
    process.exit(1);
  }

  // Create adapter and sync each schema
  const adapter = createSheetAdapter({
    adminSheetId: process.env.ADMIN_SHEET_ID!,
    credentials: {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      redirectUri: process.env.GOOGLE_REDIRECT_URI!,
    },
    tokens,
  });

  adapter.registerSchemas(schemas);

  let synced = 0;
  let failed = 0;

  // Sync admin schemas first
  const adminSchemas = schemas.filter(s => s.actor === 'admin');
  const userSchemas = schemas.filter(s => s.actor !== 'admin');

  console.log(chalk.bold('\nSyncing Admin Schemas...'));
  for (const schema of adminSchemas) {
    try {
      await adapter.syncSchema(schema);
      console.log(chalk.green(`  ✓ ${schema.name} (${schema.actor})`));
      synced++;
    } catch (err) {
      console.error(chalk.red(`  ✖ ${schema.name} — ${err}`));
      failed++;
    }
  }

  if (options.allUsers && userSchemas.length > 0) {
    console.log(chalk.bold('\nSyncing User Schemas...'));
    try {
      // Fetch all users from admin sheet to get their actor_sheet_id
      const usersTable = adapter.table('users');
      const allUsers = await usersTable.findMany({});
      
      for (const user of allUsers) {
        if (!user.actor_sheet_id) continue;
        
        console.log(chalk.cyan(`\nUser: ${user.email} (${user.role})`));
        const roleSchemas = userSchemas.filter(s => s.actor === user.role);
        
        // inject context for this user to resolve correct sheet ID
        const userAdapter = adapter.withContext({
          userId: user.user_id,
          role: user.role,
          actorSheetId: user.actor_sheet_id
        });

        for (const schema of roleSchemas) {
          try {
            await userAdapter.syncSchema(schema);
            console.log(chalk.green(`  ✓ ${schema.name} (${schema.actor})`));
            synced++;
          } catch (err) {
            console.error(chalk.red(`  ✖ ${schema.name} — ${err}`));
            failed++;
          }
        }
      }
    } catch (err) {
      console.log(chalk.yellow(`⚠️ Could not fetch users table for all-users sync. Is it initialized? ${err}`));
    }
  } else if (userSchemas.length > 0) {
    console.log(chalk.yellow('\nℹ Skipping user schemas sync. Use --all-users to sync to all user sheets.'));
  }

  console.log();
  console.log(chalk.bold(`Sync complete: ${synced} synced, ${failed} failed.`));

  if (failed > 0) process.exit(1);
}

