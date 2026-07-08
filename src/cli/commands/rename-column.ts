import chalk from 'chalk';
import inquirer from 'inquirer';
import { loadCLIConfig, buildAdminAdapter, resolveSheetTargets } from '../lib/adminAdapter';
import { loadSchemasWithPaths, LoadedSchema } from '../lib/schemaLoader';
import { promptOrResolveTable } from '../lib/resolveTable';
import { resolveActorName } from '../../utils/actorConfig';
import { renameColumnKey } from '../../utils/schemaFileMutator';
import { RESERVED_COLUMN_NAMES } from '../../schema/reservedColumns';
import { computeSchemaHash } from '../../utils/schemaHash';
import { closestMatch } from '../../utils/suggest';
import { ColumnDefinition } from '../../schema/types';

export interface RenameColumnOptions {
  allUsers?: boolean;
  yes?: boolean;
  dryRun?: boolean;
  tokenFile?: string;
}

const NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

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

function validateNewName(newName: string, table: LoadedSchema): string | undefined {
  if (!NAME_PATTERN.test(newName)) {
    return `'${newName}' is not a valid column name — use letters, numbers, and underscores, starting with a letter or underscore`;
  }
  if ((RESERVED_COLUMN_NAMES as readonly string[]).includes(newName)) {
    return `'${newName}' is a reserved column name and cannot be used`;
  }
  if (newName in table.schema.columns) {
    return `'${newName}' already exists on '${table.schema.name}'`;
  }
  return undefined;
}

export async function renameColumnCommand(
  tableName: string | undefined,
  oldName: string | undefined,
  newName: string | undefined,
  options: RenameColumnOptions
) {
  console.log(chalk.blue.bold('✏️  Rename column...\n'));

  const config = loadCLIConfig();
  const all = loadSchemasWithPaths(config);

  if (all.length === 0) {
    console.log(chalk.yellow('⚠️  No schemas found. Nothing to rename.'));
    return;
  }

  const table = await promptOrResolveTable(all, tableName);
  const selectable = Object.keys(table.schema.columns).filter(
    (name) => !(RESERVED_COLUMN_NAMES as readonly string[]).includes(name)
  );

  if (selectable.length === 0) {
    console.log(chalk.yellow(`⚠️  '${table.schema.name}' has no renameable columns (only reserved columns present).`));
    return;
  }

  let resolvedOldName: string;
  if (oldName) {
    if ((RESERVED_COLUMN_NAMES as readonly string[]).includes(oldName)) {
      console.error(chalk.red(`❌ '${oldName}' is a reserved auto-generated column and cannot be renamed`));
      process.exit(1);
    }
    if (!(oldName in table.schema.columns)) {
      const suggestion = closestMatch(oldName, selectable);
      console.error(chalk.red(`❌ Column '${oldName}' not found on '${table.schema.name}'.${suggestion ? ` Did you mean '${suggestion}'?` : ''} Available: ${selectable.join(', ')}`));
      process.exit(1);
    }
    resolvedOldName = oldName;
  } else {
    const { chosen } = await inquirer.prompt([
      { type: 'list', name: 'chosen', message: `Which column on '${table.schema.name}'?`, choices: selectable },
    ]);
    resolvedOldName = chosen;
  }

  let resolvedNewName: string;
  if (newName) {
    const error = validateNewName(newName, table);
    if (error) {
      console.error(chalk.red(`❌ ${error}`));
      process.exit(1);
    }
    resolvedNewName = newName;
  } else {
    const { chosen } = await inquirer.prompt([
      {
        type: 'input',
        name: 'chosen',
        message: `New name for '${resolvedOldName}':`,
        validate: (v: string) => validateNewName(v.trim(), table) ?? true,
      },
    ]);
    resolvedNewName = chosen.trim();
  }

  if (resolvedOldName === resolvedNewName) {
    console.log(chalk.yellow('New name is the same as the old name. Nothing to do.'));
    return;
  }

  console.log(chalk.bold('Plan:\n'));
  console.log(`  Table:  ${chalk.white(`${table.actor}/${table.schema.name}`)}`);
  console.log(`  Rename: ${chalk.white(resolvedOldName)} → ${chalk.white(resolvedNewName)}`);
  const referencing = findReferencingColumns(all, table.schema.name, resolvedOldName);
  if (referencing.length > 0) {
    console.log(chalk.yellow(`    ⚠ referenced by ref('${table.schema.name}.${resolvedOldName}') in: ${referencing.join(', ')} — update those ref() strings manually`));
  }
  console.log();

  if (options.dryRun) {
    console.log(chalk.yellow('[DRY RUN] No changes made.'));
    return;
  }

  if (!options.yes) {
    const { confirmed } = await inquirer.prompt([
      { type: 'confirm', name: 'confirmed', message: `Rename '${resolvedOldName}' to '${resolvedNewName}' on '${table.schema.name}'? This updates the schema file and the live Google Sheet header — existing row data is preserved.`, default: true },
    ]);
    if (!confirmed) {
      console.log(chalk.gray('Cancelled.'));
      return;
    }
  }

  const fileResult = renameColumnKey(table.filePath, resolvedOldName, resolvedNewName);
  if (!fileResult.ok) {
    console.error(chalk.red(`❌ ${fileResult.reason}`));
    process.exit(1);
  }

  const { adminCtx, adminSheetId } = await buildAdminAdapter({
    config,
    schemas: all.map((s) => s.schema),
    tokenFile: options.tokenFile,
  });

  const updatedColumns: Record<string, ColumnDefinition> = {};
  for (const [key, value] of Object.entries(table.schema.columns)) {
    updatedColumns[key === resolvedOldName ? resolvedNewName : key] = value;
  }
  const updatedSchema = {
    ...table.schema,
    columns: updatedColumns,
    pkColumn: table.schema.pkColumn === resolvedOldName ? resolvedNewName : table.schema.pkColumn,
  };
  const newHash = computeSchemaHash(updatedSchema);

  const actorCfg = config.actors.find((a) => resolveActorName(a) === table.actor);
  const targets = await resolveSheetTargets(adminCtx, table.actor, adminSheetId, actorCfg, options.allUsers ?? false);

  const resultRows: Array<{ sheet: string; status: string }> = [];

  for (const target of targets) {
    try {
      const rows = await adminCtx.getClient().getAllRows(target.sheetId, table.schema.name);
      if (rows.length === 0) {
        resultRows.push({ sheet: target.label, status: chalk.gray('– tab not synced yet, nothing to rename') });
        continue;
      }

      const headers = rows[0];
      const index = headers.indexOf(resolvedOldName);

      if (index < 0) {
        resultRows.push({ sheet: target.label, status: chalk.gray('– column already absent from sheet') });
        continue;
      }

      await adminCtx.getClient().updateHeaderCell(target.sheetId, table.schema.name, index, resolvedNewName);
      await adminCtx.upsertSchemaVersion(target.sheetId, table.schema.name, newHash, Object.keys(updatedColumns).length);
      resultRows.push({ sheet: target.label, status: chalk.green('✅ renamed (data preserved)') });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      resultRows.push({ sheet: target.label, status: chalk.red(`❌ ${message}`) });
    }
  }

  console.log(chalk.bold(`\nResult (${table.schema.name}: ${resolvedOldName} → ${resolvedNewName}):\n`));
  for (const row of resultRows) {
    console.log(`  ${chalk.gray(row.sheet.padEnd(28))} ${row.status}`);
  }
  console.log();
}

export default renameColumnCommand;
