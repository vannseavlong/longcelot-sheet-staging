import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { createOAuthManager } from '../../auth/oauth';
import { resolveTokensPath, TOKENS_FILENAME } from '../../utils/cliFiles';

export function readTokens(): unknown | null {
  const tokenPath = resolveTokensPath();
  if (!fs.existsSync(tokenPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(tokenPath, 'utf-8'));
  } catch {
    return null;
  }
}

export function saveTokens(tokens: unknown): void {
  const tokenPath = path.join(process.cwd(), TOKENS_FILENAME);
  // mode: 0o600 — owner read/write only. This file holds a Google OAuth refresh_token, which is a
  // long-lived bearer credential for the admin's Sheets/Drive access; default file permissions
  // (typically 0o644, world/group-readable) would leave it exposed to any other local user or
  // process on a shared machine or CI runner.
  fs.writeFileSync(tokenPath, JSON.stringify(tokens, null, 2), { encoding: 'utf-8', mode: 0o600 });
  try {
    fs.chmodSync(tokenPath, 0o600);
  } catch {
    // Best-effort — e.g. unsupported on some Windows filesystems. writeFileSync's own `mode`
    // above already covers the common case (file didn't previously exist with looser permissions).
  }
}

/**
 * Refreshes stored tokens if present, otherwise walks the user through the interactive
 * browser OAuth flow. Shared by every CLI command that needs to talk to the Sheets API
 * (sync, drop-table, drop-column, rename-column).
 */
export async function resolveTokens(
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
  console.log(chalk.green(`✅ Tokens saved to ${TOKENS_FILENAME}\n`));
  return tokens;
}
