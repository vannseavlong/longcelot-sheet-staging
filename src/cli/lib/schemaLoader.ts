import fs from 'fs';
import path from 'path';
import { TableSchema } from '../../schema/types';
import { resolveActorName } from '../../utils/actorConfig';

export interface LoadedSchema {
  schema: TableSchema;
  filePath: string;
  actor: string;
}

interface SchemaLoaderConfig {
  actors: Array<{ name?: string; role?: string } | string>;
  schemasDir?: string;
}

/**
 * Like the ad-hoc `loadSchemas`/`loadSchemasForActor` helpers duplicated across sync.ts,
 * export.ts, export-data.ts, status.ts, and validate.ts — but also keeps each schema's
 * originating file path, needed by drop-table/drop-column/rename-column to edit or delete
 * the file the schema came from.
 */
export function loadSchemasWithPaths(config: SchemaLoaderConfig): LoadedSchema[] {
  const results: LoadedSchema[] = [];
  const schemasRoot = config.schemasDir
    ? path.resolve(process.cwd(), config.schemasDir)
    : path.join(process.cwd(), 'schemas');

  for (const actorEntry of config.actors) {
    const actor = resolveActorName(actorEntry);
    const actorDir = path.join(schemasRoot, actor);
    if (!fs.existsSync(actorDir)) continue;

    const files = fs.readdirSync(actorDir).filter((f) => f.endsWith('.ts') || f.endsWith('.js'));
    for (const file of files) {
      const filePath = path.join(actorDir, file);
      try {
        const schema = require(filePath).default;
        if (schema?.columns) results.push({ schema, filePath, actor });
      } catch {
        // skip unloadable files
      }
    }
  }

  return results;
}
