import chalk from 'chalk';
import { createOAuthManager } from '../../auth/oauth';
import { resolveTokens, readTokens } from '../lib/oauthFlow';
import { TOKENS_FILENAME } from '../../utils/cliFiles';

/**
 * Standalone entry point for the OAuth handshake that `sync` (and drop-table/drop-column/
 * rename-column, via buildAdminAdapter) already trigger implicitly on first run. Existing
 * behavior is untouched — this just gives that same flow its own command, so a project can be
 * scaffolded (`init`) and authorized (`auth`) as two separate, explicit steps before the first
 * `sync`, instead of authorization happening as a surprise mid-`sync`.
 */
export async function authCommand(options: { force?: boolean }): Promise<void> {
  require('dotenv').config();

  const requiredEnvVars = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI'];
  for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
      console.error(chalk.red(`❌ Missing environment variable: ${envVar}`));
      console.log(chalk.gray('   Run `lsdb init` first, then fill in .env.'));
      process.exit(1);
    }
  }

  if (!options.force) {
    const stored = readTokens() as Record<string, unknown> | null;
    if (stored?.refresh_token) {
      console.log(chalk.cyan(`ℹ Already authorized — ${TOKENS_FILENAME} has a stored refresh token.`));
      console.log(chalk.gray('  Re-checking it still works (pass --force to re-authorize from scratch)...\n'));
    }
  }

  const oauth = createOAuthManager({
    clientId: process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    redirectUri: process.env.GOOGLE_REDIRECT_URI!,
  });

  console.log(chalk.blue.bold('🔐 Authorizing lsdb with Google...\n'));

  try {
    await resolveTokens(oauth, { force: options.force });
  } catch (err) {
    console.error(chalk.red(`❌ Authentication failed: ${err}`));
    process.exit(1);
  }

  console.log(chalk.green('✅ You are authenticated.'));
  console.log(chalk.cyan('\nNext step: ') + chalk.white('lsdb sync\n'));
}
