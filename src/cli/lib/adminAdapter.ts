import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import { createSheetAdapter, SheetAdapter } from '../../adapter/sheetAdapter';
import { createOAuthManager } from '../../auth/oauth';
import { ActorConfig, TableSchema } from '../../schema/types';
import { resolveConfigPath } from '../../utils/cliFiles';
import { resolveActorName } from '../../utils/actorConfig';
import { resolveTokens } from './oauthFlow';

export interface CLIConfig {
  actors: ActorConfig[];
  projectName?: string;
  schemasDir?: string;
}

export function loadCLIConfig(): CLIConfig {
  try {
    return require(resolveConfigPath()).default;
  } catch {
    console.error(chalk.red('❌ lsdb.config.ts not found. Run: lsdb init'));
    process.exit(1);
  }
}

/**
 * Sets up a fully-wired SheetAdapter (env checks, OAuth, admin context) with the given schemas
 * registered — shared by drop-table/drop-column/rename-column, which each also need direct
 * SheetClient access (via adapter.getClient()) alongside normal table() CRUD for reading the
 * admin `users` table on --all-users.
 */
export async function buildAdminAdapter(params: {
  config: CLIConfig;
  schemas: TableSchema[];
  tokenFile?: string;
}): Promise<{ adapter: SheetAdapter; adminCtx: SheetAdapter; adminSheetId: string }> {
  require('dotenv').config();

  const requiredEnvVars = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI'];
  for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
      console.error(chalk.red(`❌ Missing environment variable: ${envVar}`));
      process.exit(1);
    }
  }

  const adminActor = params.config.actors.find((a) => resolveActorName(a) === 'admin');
  const adminSheetId = adminActor ? process.env[adminActor.sheetIdEnv] : process.env.ADMIN_SHEET_ID;
  if (!adminSheetId) {
    console.error(chalk.red(`❌ Admin sheet ID not set. Add ${adminActor?.sheetIdEnv ?? 'ADMIN_SHEET_ID'} to your .env`));
    process.exit(1);
  }

  const oauth = createOAuthManager({
    clientId: process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    redirectUri: process.env.GOOGLE_REDIRECT_URI!,
  });

  let tokens: unknown;
  try {
    if (params.tokenFile) {
      const tokenFilePath = path.resolve(process.cwd(), params.tokenFile);
      if (!fs.existsSync(tokenFilePath)) {
        console.error(chalk.red(`❌ Token file not found: ${tokenFilePath}`));
        process.exit(1);
      }
      tokens = JSON.parse(fs.readFileSync(tokenFilePath, 'utf-8'));
      console.log(chalk.green(`✅ Loaded tokens from ${params.tokenFile}\n`));
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

  adapter.registerSchemas(params.schemas);
  const adminCtx = adapter.withContext({ userId: 'schema-cli', actor: 'admin', actorSheetId: adminSheetId });

  return { adapter, adminCtx, adminSheetId };
}

export interface SheetTarget {
  sheetId: string;
  /** Human-readable label for status output, e.g. 'admin', 'seller (dev/shared)', 'seller:user_123'. */
  label: string;
}

/**
 * Resolves which live Google Sheets a change to an actor's table should apply to: the admin
 * sheet for actor:'admin', or the actor's configured dev/shared sheet plus (with --all-users)
 * every registered user's personal actor sheet, read from the admin `users` table exactly like
 * sync.ts's --all-users flow does.
 */
export async function resolveSheetTargets(
  adminCtx: SheetAdapter,
  actor: string,
  adminSheetId: string,
  actorCfg: ActorConfig | undefined,
  allUsers: boolean
): Promise<SheetTarget[]> {
  if (actor === 'admin') {
    return [{ sheetId: adminSheetId, label: 'admin' }];
  }

  const targets: SheetTarget[] = [];
  const configuredSheetId = actorCfg ? process.env[actorCfg.sheetIdEnv] : undefined;
  if (configuredSheetId) {
    targets.push({ sheetId: configuredSheetId, label: `${actor} (dev/shared)` });
  }

  if (allUsers) {
    try {
      const users = await adminCtx.table('users').findMany({});
      for (const user of users) {
        if (user.role === actor && user.actor_sheet_id) {
          targets.push({ sheetId: user.actor_sheet_id as string, label: `${actor}:${user.user_id}` });
        }
      }
    } catch (err) {
      console.log(chalk.yellow(`  ⚠ Could not fetch registered users for --all-users: ${err}`));
    }
  }

  return targets;
}
