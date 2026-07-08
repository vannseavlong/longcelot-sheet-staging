import fs from 'fs';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { loadCLIConfig, buildAdminAdapter, resolveSheetTargets } from '../lib/adminAdapter';
import { loadSchemasWithPaths, LoadedSchema } from '../lib/schemaLoader';
import { resolveTableRef } from '../lib/resolveTable';
import { resolveActorName } from '../../utils/actorConfig';

export interface DropTableOptions {
  allUsers?: boolean;
  yes?: boolean;
  dryRun?: boolean;
  tokenFile?: string;
}

function findReferencingTables(all: LoadedSchema[], tableName: string, excluding: Set<string>): string[] {
  const referencing: string[] = [];
  for (const { schema } of all) {
    if (excluding.has(schema.name)) continue;
    for (const col of Object.values(schema.columns)) {
      if (col.ref?.split('.')[0] === tableName) {
        referencing.push(schema.name);
        break;
      }
    }
  }
  return referencing;
}

export async function dropTableCommand(tableNames: string[], options: DropTableOptions) {
  console.log(chalk.blue.bold('🗑️  Drop table...\n'));

  const config = loadCLIConfig();
  const all = loadSchemasWithPaths(config);

  if (all.length === 0) {
    console.log(chalk.yellow('⚠️  No schemas found. Nothing to drop.'));
    return;
  }

  let selected: LoadedSchema[];

  if (tableNames.length === 0) {
    const { chosen } = await inquirer.prompt([
      {
        type: 'checkbox',
        name: 'chosen',
        message: 'Select table(s) to drop (space to toggle, enter to confirm):',
        choices: all.map((s) => ({ name: `${s.actor}/${s.schema.name}`, value: `${s.actor}/${s.schema.name}` })),
      },
    ]);
    if (chosen.length === 0) {
      console.log(chalk.yellow('No tables selected. Nothing to do.'));
      return;
    }
    selected = chosen.map((ref: string) => {
      const result = resolveTableRef(all, ref);
      if (!result.ok) throw new Error(result.error); // unreachable — ref came from the choices list itself
      return result.table;
    });
  } else {
    const errors: string[] = [];
    selected = [];
    for (const name of tableNames) {
      const result = resolveTableRef(all, name);
      if (result.ok) {
        selected.push(result.table);
      } else {
        errors.push(result.error);
      }
    }
    if (errors.length > 0) {
      console.error(chalk.red.bold('❌ Invalid table name(s):\n'));
      errors.forEach((e) => console.error(chalk.red(`   - ${e}`)));
      process.exit(1);
    }
  }

  const selectedNames = new Set(selected.map((s) => s.schema.name));

  console.log(chalk.bold('Plan:\n'));
  for (const table of selected) {
    console.log(`  ${chalk.white(`${table.actor}/${table.schema.name}`)} ${chalk.gray(`(${table.filePath})`)}`);
    const referencing = findReferencingTables(all, table.schema.name, selectedNames);
    if (referencing.length > 0) {
      console.log(chalk.yellow(`    ⚠ referenced by ref() in: ${referencing.join(', ')} — those FK columns will break`));
    }
  }
  console.log();

  if (options.dryRun) {
    console.log(chalk.yellow('[DRY RUN] No changes made.'));
    return;
  }

  if (!options.yes) {
    const { confirmed } = await inquirer.prompt([
      { type: 'confirm', name: 'confirmed', message: `Drop ${selected.length} table(s)? This deletes the schema file and the live Google Sheet tab.`, default: false },
    ]);
    if (!confirmed) {
      console.log(chalk.gray('Cancelled.'));
      return;
    }
  }

  const { adminCtx, adminSheetId } = await buildAdminAdapter({
    config,
    schemas: all.map((s) => s.schema),
    tokenFile: options.tokenFile,
  });

  const resultRows: Array<{ table: string; sheet: string; status: string }> = [];

  for (const table of selected) {
    fs.unlinkSync(table.filePath);

    const actorCfg = config.actors.find((a) => resolveActorName(a) === table.actor);
    const targets = await resolveSheetTargets(adminCtx, table.actor, adminSheetId, actorCfg, options.allUsers ?? false);

    if (targets.length === 0) {
      resultRows.push({ table: `${table.actor}/${table.schema.name}`, sheet: '(none)', status: chalk.gray('– file deleted, no sheet configured') });
      continue;
    }

    for (const target of targets) {
      try {
        await adminCtx.getClient().deleteSheet(target.sheetId, table.schema.name);
        resultRows.push({ table: `${table.actor}/${table.schema.name}`, sheet: target.label, status: chalk.green('✅ dropped') });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes('not found')) {
          resultRows.push({ table: `${table.actor}/${table.schema.name}`, sheet: target.label, status: chalk.gray('– tab already absent') });
        } else {
          resultRows.push({ table: `${table.actor}/${table.schema.name}`, sheet: target.label, status: chalk.red(`❌ ${message}`) });
        }
      }

      try {
        await adminCtx.table('schema_versions').delete({ where: { actor_sheet_id: target.sheetId, table_name: table.schema.name } });
      } catch {
        // best-effort cleanup — schema_versions bookkeeping, not fatal if it fails
      }
    }
  }

  console.log(chalk.bold('\nResult:\n'));
  for (const row of resultRows) {
    console.log(`  ${chalk.white(row.table.padEnd(28))} ${chalk.gray(row.sheet.padEnd(24))} ${row.status}`);
  }
  console.log();
}

export default dropTableCommand;
