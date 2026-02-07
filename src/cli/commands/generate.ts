import fs from 'fs';
import path from 'path';
import inquirer from 'inquirer';
import chalk from 'chalk';

export async function generateCommand(tableName: string) {
  console.log(chalk.blue.bold(`📝 Generating table schema: ${tableName}\n`));

  let config;
  try {
    config = require(path.join(process.cwd(), 'sheet-db.config.ts')).default;
  } catch {
    console.error(chalk.red('❌ sheet-db.config.ts not found. Run: sheet-db init'));
    process.exit(1);
  }

  const answers = await inquirer.prompt([
    {
      type: 'list',
      name: 'actor',
      message: 'Which actor owns this table?',
      choices: config.actors,
    },
    {
      type: 'confirm',
      name: 'timestamps',
      message: 'Add timestamps (_created_at, _updated_at)?',
      default: true,
    },
    {
      type: 'confirm',
      name: 'softDelete',
      message: 'Enable soft delete (_deleted_at)?',
      default: false,
    },
  ]);

  const columns: any[] = [];
  let addMore = true;

  while (addMore) {
    const column = await inquirer.prompt([
      {
        type: 'input',
        name: 'name',
        message: 'Column name (or press Enter to finish):',
      },
    ]);

    if (!column.name) {
      addMore = false;
      continue;
    }

    const columnDetails = await inquirer.prompt([
      {
        type: 'list',
        name: 'type',
        message: `Type for ${column.name}:`,
        choices: ['string', 'number', 'boolean', 'date', 'json'],
      },
      {
        type: 'confirm',
        name: 'required',
        message: 'Required?',
        default: false,
      },
      {
        type: 'confirm',
        name: 'unique',
        message: 'Unique?',
        default: false,
      },
      {
        type: 'input',
        name: 'defaultValue',
        message: 'Default value (leave empty for none):',
      },
    ]);

    columns.push({
      name: column.name,
      ...columnDetails,
    });
  }

  const columnsCode = columns
    .map((col) => {
      let line = `    ${col.name}: ${col.type}()`;

      if (col.required) line += '.required()';
      if (col.unique) line += '.unique()';
      if (col.defaultValue) {
        const value = col.type === 'string' ? `"${col.defaultValue}"` : col.defaultValue;
        line += `.default(${value})`;
      }

      line += ',';
      return line;
    })
    .join('\n');

  const schemaContent = `import { defineTable, string, number, boolean, date, json } from 'longcelot-sheet-db';

export default defineTable({
  name: '${tableName}',
  actor: '${answers.actor}',
  timestamps: ${answers.timestamps},
  softDelete: ${answers.softDelete},
  columns: {
${columnsCode}
  },
});
`;

  const actorDir = path.join(process.cwd(), 'schemas', answers.actor);
  if (!fs.existsSync(actorDir)) {
    fs.mkdirSync(actorDir, { recursive: true });
  }

  const filePath = path.join(actorDir, `${tableName}.ts`);
  fs.writeFileSync(filePath, schemaContent);

  console.log(chalk.green(`\n✅ Schema created: ${filePath}`));
  console.log(chalk.cyan('\nNext: Run "sheet-db sync" to create the sheet\n'));
}
