import fs from 'fs';
import path from 'path';
import inquirer from 'inquirer';
import chalk from 'chalk';

function printBanner(): void {
  const c = chalk.hex('#05b5fb').bold;
  const lines = [
    '█     ██  █  █  ██   ███ ████ █    ██  ████',
    '█    █  █ ██ █ █    █    █    █    █  █  █  ',
    '█    █  █ █ ██ █ ██ █   ███  █    █  █  █  ',
    '█    █  █ █  █ █  █ █   █    █    █  █  █  ',
    '████  ██  █  █  ███  ███ ████ ████  ██   █  ',
    '',
    '     ███  █  █ ████ ████ ████    ███  ███   ',
    '     █    █  █ █    █     █      █  █ █  █  ',
    '      ██  ████ ███  ███   █      █  █ ███   ',
    '        █ █  █ █    █     █      █  █ █  █  ',
    '     ███  █  █ ████ ████  █      ███  ███   ',
  ];

  console.log();
  lines.forEach((line) => console.log('  ' + c(line)));
  console.log();
  console.log('  ' + chalk.hex('#05b5fb')('Google Sheets-backed Staging Database Adapter'));
  console.log();
}

export async function initCommand() {
  printBanner();

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
  ]);

  const configContent = `export default {
  projectName: "${answers.projectName}",
  superAdminEmail: "${answers.superAdminEmail}",
  actors: ${JSON.stringify(answers.actors, null, 2)}
};
`;

  const envContent = `# Google OAuth credentials
# Get these at: https://console.cloud.google.com/apis/credentials
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:3000/auth/callback

# Your central admin Google Sheet ID
# Create a blank Google Sheet and paste the ID from its URL here
ADMIN_SHEET_ID=

# Super admin email (new user sheets will be shared with this account)
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

  console.log(chalk.green('\n✅ Project initialized!\n'));
  console.log(chalk.yellow('Created:'));
  console.log('  ' + chalk.white('sheet-db.config.ts'));
  console.log('  ' + chalk.white('.env'));
  console.log('  ' + chalk.white('schemas/'));

  console.log(chalk.cyan('\nNext steps:'));
  console.log('  1. ' + chalk.white('Fill in your .env file:'));
  console.log('     ' + chalk.gray('GOOGLE_CLIENT_ID=<your-client-id>'));
  console.log('     ' + chalk.gray('GOOGLE_CLIENT_SECRET=<your-client-secret>'));
  console.log('     ' + chalk.gray('ADMIN_SHEET_ID=<your-sheet-id>'));
  console.log('     ' + chalk.dim('→ https://console.cloud.google.com/apis/credentials'));
  console.log('  2. ' + chalk.white('Generate tables:  sheet-db generate <table-name>'));
  console.log('  3. ' + chalk.white('Sync to sheets:   sheet-db sync\n'));
}
