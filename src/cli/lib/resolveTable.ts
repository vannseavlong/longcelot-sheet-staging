import chalk from 'chalk';
import inquirer from 'inquirer';
import { LoadedSchema } from './schemaLoader';
import { closestMatch } from '../../utils/suggest';

export type TableResolution = { ok: true; table: LoadedSchema } | { ok: false; error: string };

/**
 * Resolves a user-typed table reference against every loaded schema. Table names are only
 * unique per actor (see skills/schema/SKILL.md), so a bare name that matches more than one
 * actor is treated as ambiguous rather than guessing — the caller can disambiguate with
 * 'actor/tableName'.
 */
export function resolveTableRef(all: LoadedSchema[], rawName: string): TableResolution {
  if (rawName.includes('/')) {
    const [actor, name] = rawName.split('/');
    const match = all.find((s) => s.actor === actor && s.schema.name === name);
    if (match) return { ok: true, table: match };
    const candidates = all.filter((s) => s.actor === actor).map((s) => s.schema.name);
    const suggestion = closestMatch(name, candidates);
    return {
      ok: false,
      error: `Table '${rawName}' not found.${suggestion ? ` Did you mean '${actor}/${suggestion}'?` : ''}`,
    };
  }

  const matches = all.filter((s) => s.schema.name === rawName);
  if (matches.length === 1) return { ok: true, table: matches[0] };
  if (matches.length > 1) {
    const actors = matches.map((m) => m.actor).join(', ');
    return {
      ok: false,
      error: `Table '${rawName}' exists under multiple actors (${actors}). Use 'actor/${rawName}' to disambiguate.`,
    };
  }

  const suggestion = closestMatch(rawName, all.map((s) => s.schema.name));
  const available = all.map((s) => `${s.actor}/${s.schema.name}`).join(', ') || '(none)';
  return {
    ok: false,
    error: `Table '${rawName}' not found.${suggestion ? ` Did you mean '${suggestion}'?` : ''} Available: ${available}`,
  };
}

/**
 * Resolves a table from a CLI argument, exiting with a clear error on an invalid name — or,
 * if no argument was given, prompts an interactive single-select list. Shared by drop-column
 * and rename-column, which both operate on exactly one table.
 */
export async function promptOrResolveTable(all: LoadedSchema[], tableName: string | undefined): Promise<LoadedSchema> {
  if (tableName) {
    const result = resolveTableRef(all, tableName);
    if (!result.ok) {
      console.error(chalk.red(`❌ ${result.error}`));
      process.exit(1);
    }
    return result.table;
  }

  const { chosen } = await inquirer.prompt([
    {
      type: 'list',
      name: 'chosen',
      message: 'Which table?',
      choices: all.map((s) => ({ name: `${s.actor}/${s.schema.name}`, value: `${s.actor}/${s.schema.name}` })),
    },
  ]);
  const result = resolveTableRef(all, chosen);
  if (!result.ok) throw new Error(result.error); // unreachable — chosen came from the choices list itself
  return result.table;
}
