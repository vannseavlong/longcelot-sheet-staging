import fs from 'fs';
import path from 'path';
import chalk from 'chalk';

export const CONFIG_FILENAME = 'lsdb.config.ts';
export const TOKENS_FILENAME = '.lsdb-tokens.json';

const LEGACY_CONFIG_FILENAME = 'sheet-db.config.ts';
const LEGACY_TOKENS_FILENAME = '.sheet-db-tokens.json';

let warnedLegacyConfig = false;
let warnedLegacyTokens = false;

/**
 * Resolves the CLI config file path, preferring `lsdb.config.ts` over the
 * deprecated `sheet-db.config.ts`. Returns the canonical path if neither exists,
 * so callers' existing "not found" handling continues to work unchanged.
 */
export function resolveConfigPath(cwd: string = process.cwd()): string {
  const current = path.join(cwd, CONFIG_FILENAME);
  if (fs.existsSync(current)) return current;

  const legacy = path.join(cwd, LEGACY_CONFIG_FILENAME);
  if (fs.existsSync(legacy)) {
    if (!warnedLegacyConfig) {
      console.warn(
        chalk.yellow(
          `⚠️  ${LEGACY_CONFIG_FILENAME} is deprecated — rename it to ${CONFIG_FILENAME}. ` +
          'Support for the old filename will be removed in a future release.'
        )
      );
      warnedLegacyConfig = true;
    }
    return legacy;
  }

  return current;
}

/**
 * Resolves the OAuth tokens file path, preferring `.lsdb-tokens.json` over the
 * deprecated `.sheet-db-tokens.json`. Returns the canonical path if neither exists,
 * so callers' existing existence checks continue to work unchanged.
 */
export function resolveTokensPath(cwd: string = process.cwd()): string {
  const current = path.join(cwd, TOKENS_FILENAME);
  if (fs.existsSync(current)) return current;

  const legacy = path.join(cwd, LEGACY_TOKENS_FILENAME);
  if (fs.existsSync(legacy)) {
    if (!warnedLegacyTokens) {
      console.warn(
        chalk.yellow(
          `⚠️  ${LEGACY_TOKENS_FILENAME} is deprecated — lsdb sync will save new tokens to ${TOKENS_FILENAME}.`
        )
      );
      warnedLegacyTokens = true;
    }
    return legacy;
  }

  return current;
}
