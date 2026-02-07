"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateCommand = validateCommand;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const chalk_1 = __importDefault(require("chalk"));
async function validateCommand() {
    console.log(chalk_1.default.blue.bold('🔍 Validating schemas...\n'));
    let config;
    try {
        config = require(path_1.default.join(process.cwd(), 'sheet-db.config.ts')).default;
    }
    catch {
        console.error(chalk_1.default.red('❌ sheet-db.config.ts not found'));
        process.exit(1);
    }
    const schemas = [];
    const errors = [];
    const tableNames = new Set();
    const schemasDir = path_1.default.join(process.cwd(), 'schemas');
    for (const actor of config.actors) {
        const actorDir = path_1.default.join(schemasDir, actor);
        if (!fs_1.default.existsSync(actorDir)) {
            console.log(chalk_1.default.yellow(`⚠️  No schemas found for actor: ${actor}`));
            continue;
        }
        const files = fs_1.default.readdirSync(actorDir).filter((f) => f.endsWith('.ts'));
        for (const file of files) {
            try {
                const schema = require(path_1.default.join(actorDir, file)).default;
                if (!schema.name) {
                    errors.push(`Schema in ${file} is missing 'name'`);
                }
                if (!schema.actor) {
                    errors.push(`Schema ${schema.name} is missing 'actor'`);
                }
                if (!config.actors.includes(schema.actor)) {
                    errors.push(`Schema ${schema.name} has unknown actor: ${schema.actor}`);
                }
                if (tableNames.has(schema.name)) {
                    errors.push(`Duplicate table name: ${schema.name}`);
                }
                else {
                    tableNames.add(schema.name);
                }
                if (!schema.columns || Object.keys(schema.columns).length === 0) {
                    errors.push(`Schema ${schema.name} has no columns`);
                }
                for (const [colName, col] of Object.entries(schema.columns)) {
                    const column = col;
                    if (column.enum && (!Array.isArray(column.enum) || column.enum.length === 0)) {
                        errors.push(`Column ${schema.name}.${colName} has invalid enum`);
                    }
                    if (column.min !== undefined && column.max !== undefined && column.min > column.max) {
                        errors.push(`Column ${schema.name}.${colName} has min > max`);
                    }
                }
                schemas.push(schema);
            }
            catch (error) {
                errors.push(`Failed to load schema: ${file} - ${error}`);
            }
        }
    }
    console.log(chalk_1.default.cyan(`Validated ${schemas.length} schemas\n`));
    if (errors.length > 0) {
        console.log(chalk_1.default.red.bold('❌ Validation errors:\n'));
        errors.forEach((err) => {
            console.log(chalk_1.default.red(`   - ${err}`));
        });
        console.log();
        process.exit(1);
    }
    console.log(chalk_1.default.green('✅ All schemas are valid!\n'));
    console.log(chalk_1.default.cyan('Schemas by actor:'));
    for (const actor of config.actors) {
        const actorSchemas = schemas.filter((s) => s.actor === actor);
        if (actorSchemas.length > 0) {
            console.log(chalk_1.default.bold(`\n  ${actor}:`));
            actorSchemas.forEach((s) => {
                const colCount = Object.keys(s.columns).length;
                console.log(`    - ${s.name} (${colCount} columns)`);
            });
        }
    }
    console.log();
}
//# sourceMappingURL=validate.js.map