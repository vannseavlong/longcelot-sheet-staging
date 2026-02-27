import fs from 'fs';
import path from 'path';
import chalk from 'chalk';

interface CheckResult {
  label: string;
  ok: boolean;
  message?: string;
}

function check(label: string, ok: boolean, message?: string): CheckResult {
  return { label, ok, message };
}

export async function doctorCommand() {
  console.log(chalk.blue.bold('🩺 Running diagnostics...\n'));

  require('dotenv').config();

  const results: CheckResult[] = [];

  // 1. Config file
  const configPath = path.join(process.cwd(), 'sheet-db.config.ts');
  results.push(check('Config file (sheet-db.config.ts)', fs.existsSync(configPath)));

  // 2. .env file
  const envPath = path.join(process.cwd(), '.env');
  results.push(check('.env file', fs.existsSync(envPath), 'Create a .env file with required variables'));

  // 3. Required env vars
  const requiredEnvVars = [
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    'GOOGLE_REDIRECT_URI',
    'ADMIN_SHEET_ID',
  ];

  for (const envVar of requiredEnvVars) {
    results.push(check(
      `Env var: ${envVar}`,
      !!process.env[envVar],
      `Set ${envVar} in your .env file`
    ));
  }

  // 4. Schemas directory
  const schemasDir = path.join(process.cwd(), 'schemas');
  results.push(check('schemas/ directory', fs.existsSync(schemasDir), 'Run: sheet-db init'));

  // 5. Schema files
  let schemaCount = 0;
  if (fs.existsSync(schemasDir)) {
    const actorDirs = fs.readdirSync(schemasDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);

    for (const actor of actorDirs) {
      const actorDir = path.join(schemasDir, actor);
      const files = fs.readdirSync(actorDir).filter((f) => f.endsWith('.ts'));
      schemaCount += files.length;
    }
  }
  results.push(check(
    `Schema files (${schemaCount} found)`,
    schemaCount > 0,
    'Run: sheet-db generate <table-name> to create schemas'
  ));

  // 6. OAuth tokens
  const tokensPath = path.join(process.cwd(), '.sheet-db-tokens.json');
  results.push(check(
    'OAuth tokens (.sheet-db-tokens.json)',
    fs.existsSync(tokensPath),
    'Run: sheet-db sync to authorize and create tokens'
  ));

  // 7. OAuth token validity (basic check)
  if (fs.existsSync(tokensPath)) {
    try {
      const tokens = JSON.parse(fs.readFileSync(tokensPath, 'utf-8'));
      const hasRefreshToken = !!tokens.refresh_token;
      const expiryDate = tokens.expiry_date;
      const expired = expiryDate ? Date.now() > expiryDate : false;

      results.push(check(
        'OAuth refresh token present',
        hasRefreshToken,
        'Re-run: sheet-db sync to get a refresh token'
      ));

      if (expiryDate) {
        results.push(check(
          `Access token ${expired ? '(expired — will auto-refresh)' : '(valid)'}`,
          true
        ));
      }
    } catch {
      results.push(check('OAuth token file parseable', false, 'Delete .sheet-db-tokens.json and run: sheet-db sync'));
    }
  }

  // Print results
  let passed = 0;
  let failed = 0;

  for (const result of results) {
    if (result.ok) {
      console.log(`  ${chalk.green('✓')} ${result.label}`);
      passed++;
    } else {
      console.log(`  ${chalk.red('✖')} ${result.label}${result.message ? chalk.gray(` — ${result.message}`) : ''}`);
      failed++;
    }
  }

  console.log();

  if (failed === 0) {
    console.log(chalk.green.bold(`✅ All ${passed} checks passed. You're good to go!`));
  } else {
    console.log(chalk.yellow.bold(`⚠️  ${failed} check(s) failed, ${passed} passed.`));
    console.log(chalk.gray('Fix the issues above before running sheet-db sync.'));
    process.exit(1);
  }
}
