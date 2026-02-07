"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncCommand = syncCommand;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const chalk_1 = __importDefault(require("chalk"));
async function syncCommand() {
    console.log(chalk_1.default.blue.bold('🔄 Syncing schemas to Google Sheets...\n'));
    require('dotenv').config();
    const requiredEnvVars = [
        'GOOGLE_CLIENT_ID',
        'GOOGLE_CLIENT_SECRET',
        'GOOGLE_REDIRECT_URI',
        'ADMIN_SHEET_ID',
    ];
    for (const envVar of requiredEnvVars) {
        if (!process.env[envVar]) {
            console.error(chalk_1.default.red(`❌ Missing environment variable: ${envVar}`));
            process.exit(1);
        }
    }
    let config;
    try {
        config = require(path_1.default.join(process.cwd(), 'sheet-db.config.ts')).default;
    }
    catch {
        console.error(chalk_1.default.red('❌ sheet-db.config.ts not found'));
        process.exit(1);
    }
    console.log(chalk_1.default.yellow('⚠️  Note: This command requires valid OAuth tokens.'));
    console.log(chalk_1.default.yellow('    In production, implement proper OAuth flow.\n'));
    const schemas = [];
    const schemasDir = path_1.default.join(process.cwd(), 'schemas');
    for (const actor of config.actors) {
        const actorDir = path_1.default.join(schemasDir, actor);
        if (!fs_1.default.existsSync(actorDir)) {
            continue;
        }
        const files = fs_1.default.readdirSync(actorDir).filter((f) => f.endsWith('.ts'));
        for (const file of files) {
            try {
                const schema = require(path_1.default.join(actorDir, file)).default;
                schemas.push(schema);
            }
            catch (error) {
                console.error(chalk_1.default.red(`❌ Failed to load schema: ${file}`));
                console.error(error);
            }
        }
    }
    console.log(chalk_1.default.cyan(`Found ${schemas.length} schemas\n`));
    console.log(chalk_1.default.yellow('⚠️  Sync functionality requires implementation of:'));
    console.log('   1. OAuth token storage and refresh');
    console.log('   2. Admin sheet creation and access');
    console.log('   3. Per-user sheet creation\n');
    console.log(chalk_1.default.green('✅ Schema validation complete'));
    console.log(chalk_1.default.cyan('\nSchemas loaded:'));
    schemas.forEach((s) => {
        console.log(`   - ${s.name} (${s.actor})`);
    });
}
//# sourceMappingURL=sync.js.map