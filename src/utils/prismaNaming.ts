import type { TableSchema } from '../schema/types';

/**
 * Prisma Client exposes each model as a camelCase (first-letter-lowercased) property of the
 * generated client — `model products {}` becomes `client.products`. migrate.ts's
 * generatePrismaModel() writes `model ${schema.name}` verbatim (no transform), so this is the
 * one place that transform is defined; prismaAdapter.ts's runtime model lookup applies the same
 * transform so the two can never silently drift apart.
 */
export function toPrismaModelName(schemaName: string): string {
  if (schemaName.length === 0) return schemaName;
  return schemaName.charAt(0).toLowerCase() + schemaName.slice(1);
}

/**
 * Prisma field names must start with a letter — a leading underscore is a hard parse error
 * ("This line is not a valid field or attribute definition"), confirmed by running real
 * `prisma generate` against this package's own reserved columns (Phase 16.2). Every schema has
 * `_id` (defineTable() injects it unconditionally) plus `_created_at`/`_updated_at`/`_deleted_at`
 * when configured, so this isn't an edge case — it broke `lsdb migrate --prisma`'s output for
 * every table. generatePrismaModel() strips the leading underscore(s) for the Prisma field name
 * and preserves the real column name via `@map("_id")`, so the physical column Prisma reads/
 * writes is unchanged; prismaAdapter.ts uses the same transform to translate between the raw
 * column names the rest of this package uses (e.g. `_id`) and the Prisma Client property names
 * it actually exposes (e.g. `id`).
 */
export function toPrismaFieldName(columnName: string): string {
  return columnName.replace(/^_+/, '') || columnName;
}

/** Per-schema column-name <-> Prisma-field-name lookup, built from toPrismaFieldName() above. */
export interface PrismaFieldMap {
  /** raw column name -> Prisma field name, e.g. '_id' -> 'id' */
  toField: Record<string, string>;
  /** Prisma field name -> raw column name, e.g. 'id' -> '_id' */
  toRaw: Record<string, string>;
}

export function buildPrismaFieldMap(schema: Pick<TableSchema, 'columns'>): PrismaFieldMap {
  const toField: Record<string, string> = {};
  const toRaw: Record<string, string> = {};
  for (const columnName of Object.keys(schema.columns)) {
    const fieldName = toPrismaFieldName(columnName);
    toField[columnName] = fieldName;
    toRaw[fieldName] = columnName;
  }
  return { toField, toRaw };
}
