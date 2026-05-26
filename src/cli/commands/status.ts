import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import { TableSchema } from '../../schema/types';

export async function statusCommand() {
  console.log(chalk.blue.bold('📊 Sheet-DB Project Status\n'));

  require('dotenv').config();

  interface CLIConfig {
    projectName?: string;
    actors: Array<{ role: string; sheetIdEnv?: string } | string>;
  }
  // Load config
  let config: CLIConfig;
  try {
    config = require(path.join(process.cwd(), 'sheet-db.config.ts')).default;
  } catch {
    console.error(chalk.red('❌ sheet-db.config.ts not found. Run: sheet-db init'));
    process.exit(1);
  }

  // Project info
  console.log(chalk.bold('Project'));
  console.log(`  Name:    ${config.projectName || chalk.gray('(not set)')}`);
  const actorRoles: string[] = (config.actors ?? []).map((a: { role?: string } | string) =>
    typeof a === 'string' ? a : a.role ?? ''
  );
  console.log(`  Actors:  ${actorRoles.join(', ') || chalk.gray('(none)')}`);
  console.log();

  // Environment
  console.log(chalk.bold('Environment'));
  const baseEnvVars: [string, string | undefined][] = [
    ['GOOGLE_CLIENT_ID', process.env.GOOGLE_CLIENT_ID ? '(set)' : undefined],
    ['GOOGLE_CLIENT_SECRET', process.env.GOOGLE_CLIENT_SECRET ? '(set)' : undefined],
    ['GOOGLE_REDIRECT_URI', process.env.GOOGLE_REDIRECT_URI],
  ];
  // Show sheet ID env vars per actor
  const actorSheetEnvVars: [string, string | undefined][] = (config.actors ?? []).map(
    (a: { role?: string; sheetIdEnv?: string } | string) => {
      const envKey = typeof a === 'string'
        ? (a === 'admin' ? 'ADMIN_SHEET_ID' : `DEV_${a.toUpperCase()}_SHEET_ID`)
        : (a.sheetIdEnv ?? 'ADMIN_SHEET_ID');
      return [envKey, process.env[envKey]] as [string, string | undefined];
    }
  );
  const envVars = [...actorSheetEnvVars, ...baseEnvVars];

  for (const [name, value] of envVars) {
    const display = value ? chalk.green(value) : chalk.red('(missing)');
    console.log(`  ${name}: ${display}`);
  }
  console.log();

  // OAuth tokens
  const tokensPath = path.join(process.cwd(), '.sheet-db-tokens.json');
  console.log(chalk.bold('OAuth Tokens'));
  if (fs.existsSync(tokensPath)) {
    try {
      const tokens = JSON.parse(fs.readFileSync(tokensPath, 'utf-8'));
      const expired = tokens.expiry_date ? Date.now() > tokens.expiry_date : false;
      const expiresAt = tokens.expiry_date
        ? new Date(tokens.expiry_date).toLocaleString()
        : 'unknown';
      console.log(`  Status:          ${expired ? chalk.yellow('expired (will auto-refresh)') : chalk.green('valid')}`);
      console.log(`  Access expires:  ${expiresAt}`);
      console.log(`  Refresh token:   ${tokens.refresh_token ? chalk.green('present') : chalk.red('missing')}`);
    } catch {
      console.log(`  ${chalk.red('⚠ Token file could not be parsed')}`);
    }
  } else {
    console.log(`  ${chalk.yellow('No tokens found — run: sheet-db sync')}`);
  }
  console.log();

  // Schemas by actor
  const schemasDir = path.join(process.cwd(), 'schemas');
  if (!fs.existsSync(schemasDir)) {
    console.log(chalk.yellow('No schemas/ directory found. Run: sheet-db init'));
    return;
  }

  const schemasByActor: Record<string, TableSchema[]> = {};
  let totalSchemas = 0;

  for (const actorEntry of (config.actors || [])) {
    const actor = typeof actorEntry === 'string' ? actorEntry : actorEntry.role;
    const actorDir = path.join(schemasDir, actor);
    schemasByActor[actor] = [];

    if (!fs.existsSync(actorDir)) continue;

    const files = fs.readdirSync(actorDir).filter((f) => f.endsWith('.ts'));
    for (const file of files) {
      try {
        const schema: TableSchema = require(path.join(actorDir, file)).default;
        schemasByActor[actor].push(schema);
        totalSchemas++;
      } catch {
        // Skip unloadable schemas
      }
    }
  }

  console.log(chalk.bold(`Tables (${totalSchemas} total)`));

  for (const [actor, schemas] of Object.entries(schemasByActor)) {
    if (schemas.length === 0) {
      console.log(`\n  ${chalk.cyan(actor)} ${chalk.gray('(no schemas)')}`);
      continue;
    }

    console.log(`\n  ${chalk.cyan.bold(actor)}`);
    for (const schema of schemas) {
      const columnCount = Object.keys(schema.columns).length;
      const flags = [
        schema.timestamps ? 'timestamps' : '',
        schema.softDelete ? 'softDelete' : '',
      ].filter(Boolean).join(', ');

      console.log(
        `    ${chalk.white(schema.name.padEnd(30))} ${chalk.gray(`${columnCount} columns`)}` +
        (flags ? chalk.gray(`  [${flags}]`) : '')
      );
    }
  }

  console.log();
}
