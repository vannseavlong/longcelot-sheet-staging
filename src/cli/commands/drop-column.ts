import chalk from 'chalk';
import inquirer from 'inquirer';
import { loadCLIConfig, buildAdminAdapter, resolveSheetTargets } from '../lib/adminAdapter';
import { loadSchemasWithPaths, LoadedSchema } from '../lib/schemaLoader';
import { promptOrResolveTable } from '../lib/resolveTable';
import { resolveActorName } from '../../utils/actorConfig';
import { removeColumnLine } from '../../utils/schemaFileMutator';
import { RESERVED_COLUMN_NAMES } from '../../schema/reservedColumns';
import { computeSchemaHash } from '../../utils/schemaHash';
import { closestMatch } from '../../utils/suggest';
import { ColumnDefinition } from '../../schema/types';

export interface DropColumnOptions {
  allUsers?: boolean;
  yes?: boolean;
  dryRun?: boolean;
  tokenFile?: string;
}

function selectableColumns(table: LoadedSchema): string[] {
  return Object.keys(table.schema.columns).filter(
    (name) => !(RESERVED_COLUMN_NAMES as readonly string[]).includes(name) && name !== table.schema.pkColumn
  );
}

function findReferencingColumns(all: LoadedSchema[], tableName: string, columnName: string): string[] {
  const referencing: string[] = [];
  for (const { schema } of all) {
    for (const col of Object.values(schema.columns)) {
      if (col.ref === `${tableName}.${columnName}`) {
        referencing.push(schema.name);
        break;
      }
    }
  }
  return referencing;
}

export async function dropColumnCommand(
  tableName: string | undefined,
  columnNames: string[],
  options: DropColumnOptions
) {
  console.log(chalk.blue.bold('🗑️  Drop column...\n'));

  const config = loadCLIConfig();
  const all = loadSchemasWithPaths(config);

  if (all.length === 0) {
    console.log(chalk.yellow('⚠️  No schemas found. Nothing to drop.'));
    return;
  }

  const table = await promptOrResolveTable(all, tableName);
  const selectable = selectableColumns(table);

  if (selectable.length === 0) {
    console.log(chalk.yellow(`⚠️  '${table.schema.name}' has no droppable columns (only reserved/primary-key columns remain).`));
    return;
  }

  let columns: string[];

  if (columnNames.length === 0) {
    const { chosen } = await inquirer.prompt([
      {
        type: 'checkbox',
        name: 'chosen',
        message: `Select column(s) to drop from '${table.schema.name}' (space to toggle, enter to confirm):`,
        choices: selectable,
      },
    ]);
    if (chosen.length === 0) {
      console.log(chalk.yellow('No columns selected. Nothing to do.'));
      return;
    }
    columns = chosen;
  } else {
    const errors: string[] = [];
    columns = [];
    for (const name of columnNames) {
      if ((RESERVED_COLUMN_NAMES as readonly string[]).includes(name)) {
        errors.push(`'${name}' is a reserved auto-generated column and cannot be dropped`);
      } else if (name === table.schema.pkColumn) {
        errors.push(`'${name}' is the primary key — drop the whole table instead of its PK column`);
      } else if (!(name in table.schema.columns)) {
        const suggestion = closestMatch(name, selectable);
        errors.push(`Column '${name}' not found on '${table.schema.name}'.${suggestion ? ` Did you mean '${suggestion}'?` : ''} Available: ${selectable.join(', ')}`);
      } else {
        columns.push(name);
      }
    }
    if (errors.length > 0) {
      console.error(chalk.red.bold('❌ Invalid column name(s):\n'));
      errors.forEach((e) => console.error(chalk.red(`   - ${e}`)));
      process.exit(1);
    }
  }

  console.log(chalk.bold('Plan:\n'));
  console.log(`  Table: ${chalk.white(`${table.actor}/${table.schema.name}`)}`);
  for (const col of columns) {
    console.log(`  Drop column: ${chalk.white(col)}`);
    const referencing = findReferencingColumns(all, table.schema.name, col);
    if (referencing.length > 0) {
      console.log(chalk.yellow(`    ⚠ referenced by ref('${table.schema.name}.${col}') in: ${referencing.join(', ')} — those FK columns will break`));
    }
  }
  console.log();

  if (options.dryRun) {
    console.log(chalk.yellow('[DRY RUN] No changes made.'));
    return;
  }

  if (!options.yes) {
    const { confirmed } = await inquirer.prompt([
      { type: 'confirm', name: 'confirmed', message: `Drop ${columns.length} column(s) from '${table.schema.name}'? This removes them from the schema file and deletes the live Google Sheet column(s), including all data in them.`, default: false },
    ]);
    if (!confirmed) {
      console.log(chalk.gray('Cancelled.'));
      return;
    }
  }

  const removed: string[] = [];
  for (const col of columns) {
    const result = removeColumnLine(table.filePath, col);
    if (result.ok) {
      removed.push(col);
    } else {
      console.log(chalk.yellow(`  ⚠ Skipping '${col}' — ${result.reason}`));
    }
  }

  if (removed.length === 0) {
    console.log(chalk.yellow('\nNo columns could be safely removed from the schema file. Nothing changed on Google Sheets.'));
    return;
  }

  const { adminCtx, adminSheetId } = await buildAdminAdapter({
    config,
    schemas: all.map((s) => s.schema),
    tokenFile: options.tokenFile,
  });

  const updatedColumns: Record<string, ColumnDefinition> = { ...table.schema.columns };
  for (const col of removed) delete updatedColumns[col];
  const updatedSchema = { ...table.schema, columns: updatedColumns };
  const newHash = computeSchemaHash(updatedSchema);

  const actorCfg = config.actors.find((a) => resolveActorName(a) === table.actor);
  const targets = await resolveSheetTargets(adminCtx, table.actor, adminSheetId, actorCfg, options.allUsers ?? false);

  const resultRows: Array<{ sheet: string; status: string }> = [];

  for (const target of targets) {
    try {
      const rows = await adminCtx.getClient().getAllRows(target.sheetId, table.schema.name);
      if (rows.length === 0) {
        resultRows.push({ sheet: target.label, status: chalk.gray('– tab not synced yet, nothing to remove') });
        continue;
      }

      const headers = rows[0];
      const indexes = removed.map((col) => headers.indexOf(col)).filter((i) => i >= 0);

      if (indexes.length === 0) {
        resultRows.push({ sheet: target.label, status: chalk.gray('– column(s) already absent from sheet') });
        continue;
      }

      await adminCtx.getClient().deleteColumns(target.sheetId, table.schema.name, indexes);
      await adminCtx.upsertSchemaVersion(target.sheetId, table.schema.name, newHash, Object.keys(updatedColumns).length);
      resultRows.push({ sheet: target.label, status: chalk.green(`✅ dropped ${indexes.length} column(s)`) });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      resultRows.push({ sheet: target.label, status: chalk.red(`❌ ${message}`) });
    }
  }

  console.log(chalk.bold(`\nResult (${table.schema.name}: ${removed.join(', ')}):\n`));
  for (const row of resultRows) {
    console.log(`  ${chalk.gray(row.sheet.padEnd(28))} ${row.status}`);
  }
  console.log();
}

export default dropColumnCommand;
