import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import { TableSchema, ColumnDefinition } from '../../schema/types';
import { resolveActorName } from '../../utils/actorConfig';

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

  const actorRoles: string[] = config.actors.map((a: { name?: string; role?: string } | string) => resolveActorName(a));

  for (const actorCfg of config.actors) {
    const actor = resolveActorName(actorCfg);
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

        if (!actorRoles.includes(schema.actor)) {
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

        for (const [colName, col] of Object.entries(schema.columns as Record<string, ColumnDefinition>)) {
          if (col.enum && (!Array.isArray(col.enum) || col.enum.length === 0)) {
            errors.push(`Column ${schema.name}.${colName} has invalid enum`);
          }

          if (col.min !== undefined && col.max !== undefined && col.min > col.max) {
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
  for (const role of actorRoles) {
    const actorSchemas = schemas.filter((s) => s.actor === role);
    if (actorSchemas.length > 0) {
      console.log(chalk.bold(`\n  ${role}:`));
      actorSchemas.forEach((s) => {
        const colCount = Object.keys(s.columns).length;
        console.log(`    - ${s.name} (${colCount} columns)`);
      });
    }
  }
  console.log();
}
