import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import { createSheetAdapter } from '../../adapter/sheetAdapter';

function makeEmail(userId: string, role: string) {
  return `${role}.${userId}@example.local`;
}

export async function mockUsersCommand(countArg?: string | number) {
  const count = Number(countArg) || 3;

  console.log(chalk.blue.bold(`
🧪 Creating ${count} mock users (development)...
`));

  require('dotenv').config();

  const requiredEnvVars = [
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    'GOOGLE_REDIRECT_URI',
    'ADMIN_SHEET_ID',
    'SUPER_ADMIN_EMAIL',
  ];

  for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
      console.error(chalk.red(`❌ Missing environment variable: ${envVar}`));
      process.exit(1);
    }
  }

  const tokensPath = path.join(process.cwd(), '.sheet-db-tokens.json');
  if (!fs.existsSync(tokensPath)) {
    console.error(chalk.red('❌ No OAuth tokens found. Run: sheet-db sync'));
    process.exit(1);
  }

  let tokens: any;
  try {
    tokens = JSON.parse(fs.readFileSync(tokensPath, 'utf-8'));
  } catch {
    console.error(chalk.red('❌ Failed to read tokens file.'));
    process.exit(1);
  }

  // Load config and schemas
  let config: any;
  try {
    config = require(path.join(process.cwd(), 'sheet-db.config.ts')).default;
  } catch {
    console.error(chalk.red('❌ sheet-db.config.ts not found. Run: sheet-db init'));
    process.exit(1);
  }

  const adapter = createSheetAdapter({
    adminSheetId: process.env.ADMIN_SHEET_ID!,
    credentials: {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      redirectUri: process.env.GOOGLE_REDIRECT_URI!,
    },
    tokens,
  });

  // Load and register all schemas
  const schemasDir = path.join(process.cwd(), 'schemas');
  for (const actor of config.actors) {
    const actorDir = path.join(schemasDir, actor);
    if (!fs.existsSync(actorDir)) continue;
    const files = fs.readdirSync(actorDir).filter((f) => f.endsWith('.ts'));
    for (const file of files) {
      try {
        const schema = require(path.join(actorDir, file)).default;
        adapter.registerSchema(schema);
      } catch (err) {
        // ignore failures to require optional schemas
      }
    }
  }

  let created = 0;
  for (let i = 0; i < count; i++) {
    const userId = `mock-${Date.now().toString(36)}-${i}`;
    // Rotate roles among configured actors (skip admin)
    const actors = config.actors.filter((a: string) => a !== 'admin');
    const role = actors[i % actors.length] || 'student';
    const email = makeEmail(userId, role);

    try {
      const sheetId = await adapter.createUserSheet(userId, role, email);
      console.log(chalk.green(`  ✓ Created ${role} user ${userId} → sheet ${sheetId}`));
      created++;
    } catch (err) {
      console.error(chalk.red(`  ✖ Failed to create user ${userId}: ${err}`));
    }
  }

  console.log();
  console.log(chalk.bold(`Done. ${created}/${count} mock users created.`));
}

export default mockUsersCommand;
