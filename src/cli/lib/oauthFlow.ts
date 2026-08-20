import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { createOAuthManager } from '../../auth/oauth';
import { resolveTokensPath, TOKENS_FILENAME } from '../../utils/cliFiles';
import { tryCaptureViaLoopback } from './oauthCallbackServer';
import { openBrowser } from './browser';

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
 * Prompts for the authorization code by hand — the original flow, kept as-is. Used whenever
 * automatic capture (see `tryCaptureViaLoopback`) isn't possible or doesn't complete, so a
 * non-loopback redirect URI, a busy port, a closed tab, or a timeout all degrade to this
 * rather than failing outright.
 */
async function promptForCode(): Promise<string> {
  const { code } = await inquirer.prompt([
    {
      type: 'input',
      name: 'code',
      message: 'Paste the authorization code from the redirect URL:',
      validate: (v) => (v.trim().length > 0 ? true : 'Code cannot be empty'),
    },
  ]);
  return code.trim();
}

/**
 * Refreshes stored tokens if present, otherwise walks the user through the interactive
 * browser OAuth flow. Shared by every CLI command that needs to talk to the Sheets API
 * (auth, sync, drop-table, drop-column, rename-column).
 *
 * @param options.force Skip the stored refresh token and force a fresh consent screen even if
 *   a valid one is on disk — used by `lsdb auth --force`.
 */
export async function resolveTokens(
  oauth: ReturnType<typeof createOAuthManager>,
  options: { force?: boolean } = {}
): Promise<unknown> {
  const stored = readTokens() as Record<string, unknown> | null;

  if (!options.force && stored?.refresh_token) {
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
  console.log(chalk.white('Opening your browser to authorize lsdb with Google...'));
  console.log(chalk.gray('If it does not open automatically, visit this URL:\n'));
  console.log(chalk.bold.underline(authUrl));
  console.log();

  openBrowser(authUrl);

  // Try to catch Google's redirect ourselves first; fall back to the manual-paste prompt for
  // anything automatic capture can't handle (non-loopback redirect URI, port in use, timeout...).
  const captured = await tryCaptureViaLoopback(oauth.getRedirectUri());
  const code = captured ?? (await promptForCode());

  const tokens = await oauth.getTokens(code);
  saveTokens(tokens);
  console.log(chalk.green(`✅ Tokens saved to ${TOKENS_FILENAME}\n`));
  return tokens;
}
