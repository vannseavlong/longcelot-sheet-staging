"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initCommand = initCommand;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const inquirer_1 = __importDefault(require("inquirer"));
const chalk_1 = __importDefault(require("chalk"));
async function initCommand() {
    console.log(chalk_1.default.blue.bold('🚀 Initializing longcelot-sheet-db project...\n'));
    const answers = await inquirer_1.default.prompt([
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
            filter: (input) => input.split(',').map((s) => s.trim()),
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
    fs_1.default.writeFileSync('sheet-db.config.ts', configContent);
    fs_1.default.writeFileSync('.env', envContent);
    if (!fs_1.default.existsSync('schemas')) {
        fs_1.default.mkdirSync('schemas');
    }
    const adminSchemas = {
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
        const actorDir = path_1.default.join('schemas', actor);
        if (!fs_1.default.existsSync(actorDir)) {
            fs_1.default.mkdirSync(actorDir, { recursive: true });
        }
        if (actor === 'admin') {
            for (const [name, content] of Object.entries(adminSchemas)) {
                fs_1.default.writeFileSync(path_1.default.join(actorDir, `${name}.ts`), content);
            }
        }
    }
    console.log(chalk_1.default.green('✅ Project initialized successfully!\n'));
    console.log(chalk_1.default.yellow('Created files:'));
    console.log('  - sheet-db.config.ts');
    console.log('  - .env');
    console.log('  - schemas/');
    console.log(chalk_1.default.cyan('\nNext steps:'));
    console.log('  1. Run: npm install longcelot-sheet-db');
    console.log('  2. Generate tables: pnpm sheet-db generate <table-name>');
    console.log('  3. Sync to sheets: pnpm sheet-db sync\n');
}
//# sourceMappingURL=init.js.map