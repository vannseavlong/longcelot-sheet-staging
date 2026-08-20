import fs from 'fs';
import path from 'path';
import inquirer from 'inquirer';
import chalk from 'chalk';

function printBanner(): void {
  const c = chalk.hex('#05b5fb').bold;
  const lines = [
    '█     ██  █  █  ██   ███ ████ █     ██  ████     ███ █  █ ████ ████ ████    ███  ███ ',
    '█    █  █ ██ █ █    █    █    █    █  █  █      █    █  █ █    █     █      █  █ █  █',
    '█    █  █ █ ██ █ ██ █    ███  █    █  █  █       ██  ████ ███  ███   █      █  █ ███',
    '█    █  █ █  █ █  █ █    █    █    █  █  █         █ █  █ █    █     █      █  █ █  █',
    '████  ██  █  █  ███  ███ ████ ████  ██   █      ███  █  █ ████ ████  █      ███  ███',

    
  ];

  console.log();
  lines.forEach((line) => console.log('  ' + c(line)));
  console.log();
  console.log('  ' + chalk.hex('#05b5fb')('Google Sheets-backed Staging Database Adapter'));
  console.log();
}

/**
 * Adds any of `entries` missing from the project's `.gitignore` (creating the file if absent).
 * `lsdb init` writes `.env` (OAuth client secret) and, after the first `lsdb sync`,
 * `.lsdb-tokens.json` (a Google refresh_token) into the project root — with no `.gitignore`
 * covering them, a routine `git add .` commits both secrets straight into history. Additive and
 * idempotent: existing `.gitignore` content, ordering, and comments are left untouched, and
 * entries already present (exact line match) are skipped rather than duplicated.
 */
export function ensureGitignoreEntries(entries: string[]): void {
  const gitignorePath = '.gitignore';
  const existing = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, 'utf-8') : '';
  const existingLines = new Set(existing.split('\n').map((line) => line.trim()));

  const missing = entries.filter((entry) => !existingLines.has(entry));
  if (missing.length === 0) return;

  const separator = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
  const block = `${separator}${existing.length > 0 ? '\n' : ''}# Added by lsdb init — never commit OAuth credentials or tokens\n${missing.join('\n')}\n`;
  fs.writeFileSync(gitignorePath, existing + block, 'utf-8');
  console.log(chalk.green(`✅ Added ${missing.join(', ')} to .gitignore`));
}

export async function initCommand(options: { integrate?: boolean }) {
  printBanner();

  if (options.integrate) {
    console.log(chalk.blue('Integrating into an existing project...\n'));
  }

  const defaultProjectName = path.basename(process.cwd());

  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'projectName',
      message: 'Project name:',
      default: defaultProjectName,
      when: !options.integrate,
    },
    {
      type: 'input',
      name: 'superAdminEmail',
      message: 'Super admin email:',
      validate: (input) => input.includes('@') || 'Please enter a valid email',
    },
    {
      type: 'input',
      name: 'actors',
      message: 'Actors (comma-separated):',
      default: 'admin,user',
      filter: (input: string) => input.split(',').map((s: string) => s.trim()),
    },
  ]);

  const projectName = options.integrate ? defaultProjectName : answers.projectName;

  const actorConfigs = answers.actors.map((role: string) => ({
    name: role,
    sheetIdEnv: role === 'admin' ? 'ADMIN_SHEET_ID' : `DEV_${role.toUpperCase()}_SHEET_ID`,
  }));

  const configContent = `export default {
  projectName: "${projectName}",
  superAdminEmail: "${answers.superAdminEmail}",
  actors: ${JSON.stringify(actorConfigs, null, 2)},
  // Schema mismatch behaviour: 'warn' | 'error' | 'auto-sync'
  onSchemaMismatch: 'warn',
};
`;

  const nonAdminActors = answers.actors.filter((a: string) => a !== 'admin');
  const devSheetVars = nonAdminActors
    .map((role: string) => `DEV_${role.toUpperCase()}_SHEET_ID=`)
    .join('\n');

  const envContent = `# Google OAuth credentials
# Get these at: https://console.cloud.google.com/apis/credentials
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:3000/auth/callback

# Your central admin Google Sheet ID
# Create a blank Google Sheet and paste the ID from its URL here
ADMIN_SHEET_ID=
${nonAdminActors.length > 0 ? `\n# Development actor sheet IDs (one per actor type)\n${devSheetVars}\n` : ''}
# Super admin email (new user sheets will be shared with this account)
SUPER_ADMIN_EMAIL=${answers.superAdminEmail}
`;

  const hasExistingConfig = fs.existsSync('lsdb.config.ts') || fs.existsSync('sheet-db.config.ts');
  if (!hasExistingConfig || !options.integrate) {
    fs.writeFileSync('lsdb.config.ts', configContent);
  } else {
    console.log(chalk.yellow('ℹ A config file already exists (lsdb.config.ts or sheet-db.config.ts), skipping creation.'));
  }

  if (!fs.existsSync('.env') || !options.integrate) {
    // mode: 0o600 — this file holds the Google OAuth client secret; default permissions would
    // leave it group/world-readable on a shared machine or CI runner.
    fs.writeFileSync('.env', envContent, { encoding: 'utf-8', mode: 0o600 });
  } else {
    console.log(chalk.yellow('ℹ .env already exists, please merge Google OAuth vars manually.'));
    // Optionally append to .env
    const currentEnv = fs.readFileSync('.env', 'utf-8');
    if (!currentEnv.includes('GOOGLE_CLIENT_ID')) {
      fs.appendFileSync('.env', '\n' + envContent);
      console.log(chalk.green('✅ Appended Google Sheet DB variables to .env'));
    }
  }

  ensureGitignoreEntries(['.env', '.lsdb-tokens.json', 'node_modules']);

  if (!fs.existsSync('schemas')) {
    fs.mkdirSync('schemas');
  }

  const adminSchemas: Record<string, string> = {
    users: `import { defineTable, string } from 'longcelot-sheet-db';

export default defineTable({
  name: 'users',
  actor: 'admin',
  timestamps: true,
  columns: {
    user_id: string().required().unique(),
    role: string().required(),
    email: string().required().unique(),
    actor_sheet_id: string(),
    status: string().enum(['active', 'inactive']).default('active'),
  },
});
`,
    credentials: `import { defineTable, string } from 'longcelot-sheet-db';

export default defineTable({
  name: 'credentials',
  actor: 'admin',
  columns: {
    user_id: string().required(),
    password_hash: string(),
    provider: string().enum(['oauth', 'local']).required(),
  },
});
`,
    schema_versions: `import { defineTable, string, number } from 'longcelot-sheet-db';

export default defineTable({
  name: 'schema_versions',
  actor: 'admin',
  columns: {
    schema_version_id: string().primary(),
    actor_sheet_id: string().required(),
    table_name: string().required(),
    schema_hash: string().required(),
    synced_at: string().required(),
    column_count: number().required(),
  },
});
`,
  };

  for (const role of answers.actors) {
    const actorDir = path.join('schemas', role);
    if (!fs.existsSync(actorDir)) {
      fs.mkdirSync(actorDir, { recursive: true });
    }

    if (role === 'admin') {
      for (const [name, content] of Object.entries(adminSchemas)) {
        fs.writeFileSync(path.join(actorDir, `${name}.ts`), content);
      }
    }
  }

  console.log(chalk.green('\n✅ Project initialized!\n'));
  console.log(chalk.yellow('Created:'));
  console.log('  ' + chalk.white('lsdb.config.ts'));
  console.log('  ' + chalk.white('.env'));
  console.log('  ' + chalk.white('schemas/'));

  console.log(chalk.cyan('\nNext steps:'));
  console.log('  1. ' + chalk.white('Fill in your .env file:'));
  console.log('     ' + chalk.gray('GOOGLE_CLIENT_ID=<your-client-id>'));
  console.log('     ' + chalk.gray('GOOGLE_CLIENT_SECRET=<your-client-secret>'));
  console.log('     ' + chalk.gray('ADMIN_SHEET_ID=<your-sheet-id>'));
  console.log('     ' + chalk.dim('→ https://console.cloud.google.com/apis/credentials'));
  console.log('  2. ' + chalk.white('Authorize:        lsdb auth'));
  console.log('  3. ' + chalk.white('Generate tables:  lsdb generate <table-name>'));
  console.log('  4. ' + chalk.white('Sync to sheets:   lsdb sync\n'));
}
