import fs from 'fs';
import path from 'path';
import inquirer from 'inquirer';
import chalk from 'chalk';

export async function initCommand() {
  console.log(chalk.blue.bold('🚀 Initializing longcelot-sheet-db project...\n'));

  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'projectName',
      message: 'Project name:',
      default: 'my-app',
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
      filter: (input) => input.split(',').map((s: string) => s.trim()),
    },
    {
      type: 'input',
      name: 'googleClientId',
      message: 'Google Client ID:',
    },
    {
      type: 'input',
      name: 'googleClientSecret',
      message: 'Google Client Secret:',
    },
    {
      type: 'input',
      name: 'googleRedirectUri',
      message: 'Google Redirect URI:',
      default: 'http://localhost:3000/auth/callback',
    },
    {
      type: 'input',
      name: 'adminSheetId',
      message: 'Admin Sheet ID (leave empty to create later):',
    },
  ]);

  const configContent = `export default {
  projectName: "${answers.projectName}",
  superAdminEmail: "${answers.superAdminEmail}",
  actors: ${JSON.stringify(answers.actors, null, 2)}
};
`;

  const envContent = `GOOGLE_CLIENT_ID=${answers.googleClientId}
GOOGLE_CLIENT_SECRET=${answers.googleClientSecret}
GOOGLE_REDIRECT_URI=${answers.googleRedirectUri}
ADMIN_SHEET_ID=${answers.adminSheetId}
SUPER_ADMIN_EMAIL=${answers.superAdminEmail}
`;

  fs.writeFileSync('sheet-db.config.ts', configContent);
  fs.writeFileSync('.env', envContent);

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
  };

  for (const actor of answers.actors) {
    const actorDir = path.join('schemas', actor);
    if (!fs.existsSync(actorDir)) {
      fs.mkdirSync(actorDir, { recursive: true });
    }

    if (actor === 'admin') {
      for (const [name, content] of Object.entries(adminSchemas)) {
        fs.writeFileSync(path.join(actorDir, `${name}.ts`), content);
      }
    }
  }

  console.log(chalk.green('✅ Project initialized successfully!\n'));
  console.log(chalk.yellow('Created files:'));
  console.log('  - sheet-db.config.ts');
  console.log('  - .env');
  console.log('  - schemas/');
  console.log(chalk.cyan('\nNext steps:'));
  console.log('  1. Run: npm install longcelot-sheet-db');
  console.log('  2. Generate tables: pnpm sheet-db generate <table-name>');
  console.log('  3. Sync to sheets: pnpm sheet-db sync\n');
}
