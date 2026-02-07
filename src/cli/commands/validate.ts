import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import { TableSchema } from '../../schema/types';

export async function validateCommand() {
  console.log(chalk.blue.bold('🔍 Validating schemas...\n'));

  let config;
  try {
    config = require(path.join(process.cwd(), 'sheet-db.config.ts')).default;
  } catch {
    console.error(chalk.red('❌ sheet-db.config.ts not found'));
    process.exit(1);
  }

  const schemas: TableSchema[] = [];
  const errors: string[] = [];
  const tableNames = new Set<string>();
  const schemasDir = path.join(process.cwd(), 'schemas');

  for (const actor of config.actors) {
    const actorDir = path.join(schemasDir, actor);

    if (!fs.existsSync(actorDir)) {
      console.log(chalk.yellow(`⚠️  No schemas found for actor: ${actor}`));
      continue;
    }

    const files = fs.readdirSync(actorDir).filter((f) => f.endsWith('.ts'));

    for (const file of files) {
      try {
        const schema = require(path.join(actorDir, file)).default;

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
        } else {
          tableNames.add(schema.name);
        }

        if (!schema.columns || Object.keys(schema.columns).length === 0) {
          errors.push(`Schema ${schema.name} has no columns`);
        }

        for (const [colName, col] of Object.entries(schema.columns)) {
          const column = col as any;
          if (column.enum && (!Array.isArray(column.enum) || column.enum.length === 0)) {
            errors.push(`Column ${schema.name}.${colName} has invalid enum`);
          }

          if (column.min !== undefined && column.max !== undefined && column.min > column.max) {
            errors.push(`Column ${schema.name}.${colName} has min > max`);
          }
        }

        schemas.push(schema);
      } catch (error) {
        errors.push(`Failed to load schema: ${file} - ${error}`);
      }
    }
  }

  console.log(chalk.cyan(`Validated ${schemas.length} schemas\n`));

  if (errors.length > 0) {
    console.log(chalk.red.bold('❌ Validation errors:\n'));
    errors.forEach((err) => {
      console.log(chalk.red(`   - ${err}`));
    });
    console.log();
    process.exit(1);
  }

  console.log(chalk.green('✅ All schemas are valid!\n'));

  console.log(chalk.cyan('Schemas by actor:'));
  for (const actor of config.actors) {
    const actorSchemas = schemas.filter((s) => s.actor === actor);
    if (actorSchemas.length > 0) {
      console.log(chalk.bold(`\n  ${actor}:`));
      actorSchemas.forEach((s) => {
        const colCount = Object.keys(s.columns).length;
        console.log(`    - ${s.name} (${colCount} columns)`);
      });
    }
  }
  console.log();
}
