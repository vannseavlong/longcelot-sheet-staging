import { createSheetAdapter, SheetAdapterConfig } from './sheetAdapter';
import { createPostgresAdapter, PostgresAdapterConfig } from './sql/postgresAdapter';
import { createMySQLAdapter, MySQLAdapterConfig } from './sql/mysqlAdapter';
import type { DatabaseAdapter } from './types';
import { SchemaError } from '../errors/SchemaError';

/**
 * `'prisma'` is deliberately not a driver here — createPrismaAdapter() requires an
 * already-constructed PrismaClient instance from the consumer (see prismaAdapter.ts), and there
 * is no environment variable that can contain a live object. Prisma-track consumers keep one
 * line of branching in their own app instead (`driver === 'prisma' ? createPrismaAdapter({...})
 * : createDatabaseAdapter()`) — see FAQ.md #13.
 */
export type DBDriver = 'sheets' | 'postgres' | 'mysql';

export interface DatabaseAdapterFactoryConfig {
  /** Falls back to $DB_DRIVER, then 'sheets'. */
  driver?: DBDriver;
  sheets?: SheetAdapterConfig;
  postgres?: PostgresAdapterConfig;
  mysql?: MySQLAdapterConfig;
}

function sheetsConfigFromEnv(): SheetAdapterConfig {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  const adminSheetId = process.env.ADMIN_SHEET_ID;

  if (!clientId || !clientSecret || !redirectUri || !adminSheetId) {
    throw new SchemaError(
      "createDatabaseAdapter() with driver 'sheets' requires GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, " +
        'GOOGLE_REDIRECT_URI, and ADMIN_SHEET_ID env vars (or pass `sheets: {...}` explicitly).'
    );
  }

  let tokens: unknown = {};
  if (process.env.SHEETS_TOKENS_JSON) {
    try {
      tokens = JSON.parse(process.env.SHEETS_TOKENS_JSON);
    } catch {
      throw new SchemaError('SHEETS_TOKENS_JSON env var is not valid JSON.');
    }
  }

  return { adminSheetId, credentials: { clientId, clientSecret, redirectUri }, tokens };
}

/**
 * Single top-level factory: pick the storage engine via one config value (or one env var), not a
 * different import per environment. This is simultaneously Phase 16.2's "single top-level
 * factory" and Phase 16.7's "env-driven adapter selection" — a dev's `.env` points at
 * `DB_DRIVER=sheets`, a CI/CD pipeline's env points at `DB_DRIVER=postgres` (+ `$DATABASE_URL`),
 * with zero application code branching for those two tracks.
 */
export function createDatabaseAdapter(config: DatabaseAdapterFactoryConfig = {}): DatabaseAdapter {
  const driver = config.driver ?? (process.env.DB_DRIVER as DBDriver | undefined) ?? 'sheets';

  switch (driver) {
    case 'sheets':
      return createSheetAdapter(config.sheets ?? sheetsConfigFromEnv());
    case 'postgres':
      return createPostgresAdapter(config.postgres ?? { connectionString: process.env.DATABASE_URL });
    case 'mysql':
      return createMySQLAdapter(config.mysql ?? { connectionString: process.env.DATABASE_URL });
    default:
      throw new SchemaError(`Unknown DB_DRIVER '${String(driver)}'. Expected 'sheets' | 'postgres' | 'mysql'.`);
  }
}
